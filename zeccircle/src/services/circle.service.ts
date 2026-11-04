import { randomBytes } from "node:crypto";
import type { Database } from "../db/database.js";
import type { Circle, Member, SpendSummary } from "../domain/types.js";
import { conflict, expired, forbidden, invalidInput, notFound } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { startOfMonthUtcIso } from "../lib/time.js";
import type { AuditRepository } from "../repositories/audit.repository.js";
import type { CircleRepository } from "../repositories/circle.repository.js";
import type { InviteRepository } from "../repositories/invite.repository.js";
import type { MemberRepository } from "../repositories/member.repository.js";
import type { PurchaseRepository } from "../repositories/purchase.repository.js";
import type { Notifier } from "./notifier.js";

export interface TelegramUser {
  telegramId: number;
  displayName: string;
}

export interface Membership {
  circle: Circle;
  member: Member;
}

export interface CircleServiceDeps {
  db: Database;
  circles: CircleRepository;
  members: MemberRepository;
  invites: InviteRepository;
  purchases: PurchaseRepository;
  audit: AuditRepository;
  notifier: Notifier;
  logger: Logger;
  settings: {
    currency: string;
    defaultCircleMonthlyLimit: number;
    defaultMemberPerPurchaseLimit: number;
    defaultMemberMonthlyLimit: number;
    inviteTtlMs: number;
  };
}

const MAX_CIRCLE_NAME = 48;
const MAX_MEMBERS_PER_CIRCLE = 20;

/** Circle lifecycle and membership management. All owner-only operations check ownership here. */
export class CircleService {
  constructor(private readonly deps: CircleServiceDeps) {}

  // ---------------------------------------------------------------- queries

  async getMembership(telegramId: number): Promise<Membership | null> {
    const member = await this.deps.members.findLiveByTelegramId(telegramId);
    if (!member) return null;
    const circle = await this.deps.circles.findById(member.circleId);
    if (!circle) return null;
    return { circle, member };
  }

  /** Membership that is allowed to shop (active, in an existing circle). */
  async requireActiveMembership(telegramId: number): Promise<Membership> {
    const membership = await this.getMembership(telegramId);
    if (!membership) throw notFound("You are not in a circle yet. Ask the owner for an invite link, or create one with /newcircle.");
    if (membership.member.status === "paused") throw forbidden("Your membership is paused by the circle owner.");
    return membership;
  }

  async requireOwner(telegramId: number): Promise<Membership> {
    const membership = await this.getMembership(telegramId);
    if (!membership || membership.member.role !== "owner") {
      throw forbidden("Only the circle owner can do that.");
    }
    return membership;
  }

  async listMembers(ownerTelegramId: number): Promise<Array<Member & { spentMinor: number }>> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const since = startOfMonthUtcIso();
    const members = await this.deps.members.listByCircle(circle.id);
    return Promise.all(
      members.map(async (m) => ({ ...m, spentMinor: await this.deps.purchases.spentByMemberSince(m.id, since) })),
    );
  }

  async getSpend(member: Member): Promise<SpendSummary> {
    const since = startOfMonthUtcIso();
    const [memberSpentMinor, circleSpentMinor] = await Promise.all([
      this.deps.purchases.spentByMemberSince(member.id, since),
      this.deps.purchases.spentByCircleSince(member.circleId, since),
    ]);
    return { memberSpentMinor, circleSpentMinor };
  }

  // ---------------------------------------------------------------- circle

  async createCircle(owner: TelegramUser, rawName: string): Promise<Membership> {
    const name = rawName.trim().replace(/\s+/g, " ");
    if (!name) throw invalidInput("Give your circle a name, e.g. /newcircle Sharma Family");
    if (name.length > MAX_CIRCLE_NAME) throw invalidInput(`Circle name must be at most ${MAX_CIRCLE_NAME} characters.`);
    if (await this.deps.members.findLiveByTelegramId(owner.telegramId)) {
      throw conflict("You are already in a circle. Leave it first (/leave) to create a new one.");
    }

    const s = this.deps.settings;
    const result = await this.deps.db.transaction(async () => {
      const circle = await this.deps.circles.create({
        name,
        ownerTelegramId: owner.telegramId,
        currency: s.currency,
        monthlyLimitMinor: s.defaultCircleMonthlyLimit,
        defaultPerPurchaseLimitMinor: s.defaultMemberPerPurchaseLimit,
        defaultMemberMonthlyLimitMinor: s.defaultMemberMonthlyLimit,
      });
      const member = await this.deps.members.create({
        circleId: circle.id,
        telegramId: owner.telegramId,
        displayName: owner.displayName,
        role: "owner",
        status: "active",
        // The owner is bounded only by the circle cap.
        perPurchaseLimitMinor: circle.monthlyLimitMinor,
        monthlyLimitMinor: circle.monthlyLimitMinor,
      });
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: owner.telegramId, action: "circle.created", details: { name } });
      return { circle, member };
    });

    this.deps.logger.info({ circleId: result.circle.id }, "circle created");
    return result;
  }

  async setCircleMonthlyLimit(ownerTelegramId: number, monthlyLimitMinor: number): Promise<Circle> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    await this.deps.circles.setMonthlyLimit(circle.id, monthlyLimitMinor);
    await this.deps.audit.record({
      circleId: circle.id,
      actorTelegramId: ownerTelegramId,
      action: "circle.limit_changed",
      details: { from: circle.monthlyLimitMinor, to: monthlyLimitMinor },
    });
    return { ...circle, monthlyLimitMinor };
  }

  async setCirclePaused(ownerTelegramId: number, paused: boolean): Promise<Circle> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    await this.deps.circles.setPaused(circle.id, paused);
    await this.deps.audit.record({
      circleId: circle.id,
      actorTelegramId: ownerTelegramId,
      action: paused ? "circle.paused" : "circle.resumed",
    });
    return { ...circle, paused };
  }

  // ---------------------------------------------------------------- invites

  /** Creates a join link that works for `maxUses` people (default 1) until it expires. */
  async createInvite(ownerTelegramId: number, maxUses = 1): Promise<{ token: string; expiresAt: Date; maxUses: number }> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const free = MAX_MEMBERS_PER_CIRCLE - (await this.deps.members.listByCircle(circle.id)).length;
    if (free <= 0) throw conflict(`A circle can have at most ${MAX_MEMBERS_PER_CIRCLE} members.`);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > free) {
      throw invalidInput(`Choose between 1 and ${free} joins for this link.`);
    }

    // 16 random bytes -> 22 base64url chars; fits Telegram's 64-char deep-link limit with a prefix.
    const token = randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + this.deps.settings.inviteTtlMs);
    await this.deps.invites.create(token, circle.id, ownerTelegramId, expiresAt, maxUses);
    await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "invite.created", details: { maxUses } });
    return { token, expiresAt, maxUses };
  }

  async revokeInvites(ownerTelegramId: number): Promise<number> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const count = await this.deps.invites.revokeAllForCircle(circle.id);
    await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "invite.revoked", details: { count } });
    return count;
  }

  // ---------------------------------------------------------------- joining

  /** Joins the circle straight away (no owner approval) using an invite link token. */
  async join(user: TelegramUser, token: string): Promise<Membership> {
    const invite = await this.deps.invites.findByToken(token);
    if (!invite || invite.revoked) throw notFound("This invite link is not valid. Ask the circle owner for a new one.");
    if (invite.useCount >= invite.maxUses) throw expired("This invite link has no joins left. Ask the circle owner for a new one.");
    if (new Date(invite.expiresAt).getTime() <= Date.now()) throw expired("This invite link has expired. Ask the circle owner for a new one.");

    const existing = await this.deps.members.findLiveByTelegramId(user.telegramId);
    if (existing) {
      throw conflict(
        existing.circleId === invite.circleId
          ? "You are already in this circle."
          : "You are already in another circle. Leave it first with /leave.",
      );
    }

    const circle = await this.deps.circles.findById(invite.circleId);
    if (!circle) throw notFound("This circle no longer exists.");

    const member = await this.deps.db.transaction(async () => {
      if ((await this.deps.members.listByCircle(circle.id)).length >= MAX_MEMBERS_PER_CIRCLE) {
        throw conflict("This circle is full.");
      }
      if (!(await this.deps.invites.claim(token))) {
        throw expired("This invite link is no longer valid. Ask the circle owner for a new one.");
      }
      const created = await this.deps.members.create({
        circleId: circle.id,
        telegramId: user.telegramId,
        displayName: user.displayName,
        role: "member",
        status: "active",
        perPurchaseLimitMinor: circle.defaultPerPurchaseLimitMinor,
        monthlyLimitMinor: circle.defaultMemberMonthlyLimitMinor,
      });
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: user.telegramId, action: "member.joined", details: { memberId: created.id } });
      return created;
    });

    await this.deps.notifier.notify({ type: "member_joined", circle, member });
    return { circle, member };
  }

  // ---------------------------------------------------------------- member management

  async getMemberForOwner(ownerTelegramId: number, memberId: number): Promise<Member> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    return this.requireMemberOf(circle, memberId);
  }

  async removeMember(ownerTelegramId: number, memberId: number): Promise<Member> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const member = await this.requireMemberOf(circle, memberId);
    if (member.role === "owner") throw invalidInput("The owner cannot be removed from their own circle.");

    await this.deps.db.transaction(async () => {
      if (!(await this.deps.members.transitionStatus(member.id, ["active", "paused"], "removed"))) {
        throw conflict("This member was already removed.");
      }
      await this.cancelOpenPurchases(member.id);
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "member.removed", details: { memberId } });
    });

    const updated = { ...member, status: "removed" as const };
    await this.deps.notifier.notify({ type: "member_removed", circle, member: updated });
    return updated;
  }

  async leave(telegramId: number): Promise<Circle> {
    const membership = await this.getMembership(telegramId);
    if (!membership) throw notFound("You are not in a circle.");
    const { circle, member } = membership;
    if (member.role === "owner") {
      throw invalidInput("Owners cannot leave their circle. Remove the other members and pause it instead.");
    }

    await this.deps.db.transaction(async () => {
      await this.deps.members.transitionStatus(member.id, ["active", "paused"], "removed");
      await this.cancelOpenPurchases(member.id);
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: telegramId, action: "member.left" });
    });

    await this.deps.notifier.notify({ type: "member_left", circle, member: { ...member, status: "removed" } });
    return circle;
  }

  async setMemberPaused(ownerTelegramId: number, memberId: number, paused: boolean): Promise<Member> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const member = await this.requireMemberOf(circle, memberId);
    if (member.role === "owner") throw invalidInput("Pause the whole circle with /pausecircle instead.");

    const ok = paused
      ? await this.deps.members.transitionStatus(member.id, ["active"], "paused")
      : await this.deps.members.transitionStatus(member.id, ["paused"], "active");
    if (!ok) throw conflict(paused ? "Only active members can be paused." : "This member is not paused.");

    await this.deps.audit.record({
      circleId: circle.id,
      actorTelegramId: ownerTelegramId,
      action: paused ? "member.paused" : "member.resumed",
      details: { memberId },
    });
    return { ...member, status: paused ? "paused" : "active" };
  }

  async setMemberLimits(
    ownerTelegramId: number,
    memberId: number,
    perPurchaseLimitMinor: number,
    monthlyLimitMinor: number,
  ): Promise<Member> {
    const { circle } = await this.requireOwner(ownerTelegramId);
    const member = await this.requireMemberOf(circle, memberId);
    if (member.role === "owner") throw invalidInput("The owner is limited only by the circle cap (/circlelimit).");
    if (perPurchaseLimitMinor > monthlyLimitMinor) {
      throw invalidInput("The per-purchase limit cannot be higher than the monthly limit.");
    }

    await this.deps.members.setLimits(member.id, perPurchaseLimitMinor, monthlyLimitMinor);
    await this.deps.audit.record({
      circleId: circle.id,
      actorTelegramId: ownerTelegramId,
      action: "member.limits_changed",
      details: { memberId, perPurchaseLimitMinor, monthlyLimitMinor },
    });
    return { ...member, perPurchaseLimitMinor, monthlyLimitMinor };
  }

  // ---------------------------------------------------------------- helpers

  private async requireMemberOf(circle: Circle, memberId: number): Promise<Member> {
    const member = await this.deps.members.findById(memberId);
    if (!member || member.circleId !== circle.id || member.status === "removed") {
      throw notFound(`No member #${memberId} in your circle. See /members.`);
    }
    return member;
  }

  private async cancelOpenPurchases(memberId: number): Promise<void> {
    for (const p of await this.deps.purchases.listRecentByMember(memberId, 50)) {
      if (p.status === "proposed" || p.status === "awaiting_approval") {
        await this.deps.purchases.transition(p.id, [p.status], "cancelled", { failureReason: "member left the circle" });
      }
    }
  }
}
