import { describe, expect, it } from "vitest";
import { DomainError } from "../src/lib/errors.js";
import { buildTestServices, circleWithMember, MEMBER, OWNER, STRANGER } from "./helpers.js";

describe("CircleService", () => {
  it("creates a circle with the creator as active owner", async () => {
    const { circleService } = await buildTestServices();
    const { circle, member } = await circleService.createCircle(OWNER, "  Sharma   Family ");
    expect(circle.name).toBe("Sharma Family");
    expect(member).toMatchObject({ role: "owner", status: "active" });
  });

  it("prevents being in two circles", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    await expect(circleService.createCircle(OWNER, "B")).rejects.toThrow(DomainError);
  });

  it("members join directly and active, with default limits; the owner is told", async () => {
    const s = await buildTestServices();
    const { member } = await circleWithMember(s);
    expect(member).toMatchObject({ status: "active", perPurchaseLimitMinor: 200, monthlyLimitMinor: 500 });
    expect(s.notifier.types()).toEqual(["member_joined"]);
  });

  it("an invite link is single use by default", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    const { token, maxUses } = await circleService.createInvite(OWNER.telegramId);
    expect(maxUses).toBe(1);
    await circleService.join(MEMBER, token);
    await expect(circleService.join(STRANGER, token)).rejects.toThrow(/no joins left/);
  });

  it("an invite link can allow several joins, then stops", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    const { token } = await circleService.createInvite(OWNER.telegramId, 2);
    await circleService.join(MEMBER, token);
    await circleService.join(STRANGER, token);
    await expect(circleService.join({ telegramId: 4004, displayName: "Late" }, token)).rejects.toThrow(/no joins left/);
    expect(await circleService.listMembers(OWNER.telegramId)).toHaveLength(3);
  });

  it("validates the number of joins", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    for (const bad of [0, -1, 1.5, 100]) {
      await expect(circleService.createInvite(OWNER.telegramId, bad)).rejects.toThrow(/Choose between/);
    }
  });

  it("the same person cannot use a link twice or join a second circle", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    const { token } = await circleService.createInvite(OWNER.telegramId, 3);
    await circleService.join(MEMBER, token);
    await expect(circleService.join(MEMBER, token)).rejects.toThrow(/already in this circle/);
    const other = { telegramId: 5005, displayName: "Other owner" };
    await circleService.createCircle(other, "B");
    const { token: tokenB } = await circleService.createInvite(other.telegramId);
    await expect(circleService.join(MEMBER, tokenB)).rejects.toThrow(/already in another circle/);
  });

  it("revoked, unknown and owner-less invites are refused", async () => {
    const { circleService } = await buildTestServices();
    await circleService.createCircle(OWNER, "A");
    const { token } = await circleService.createInvite(OWNER.telegramId, 3);
    await circleService.revokeInvites(OWNER.telegramId);
    await expect(circleService.join(MEMBER, token)).rejects.toThrow(DomainError);
    await expect(circleService.join(MEMBER, "garbage")).rejects.toThrow(DomainError);
  });

  it("only the owner can manage the circle", async () => {
    const s = await buildTestServices();
    const { member } = await circleWithMember(s);
    await expect(s.circleService.createInvite(MEMBER.telegramId)).rejects.toThrow(/Only the circle owner/);
    await expect(s.circleService.setMemberLimits(MEMBER.telegramId, member.id, 1, 1)).rejects.toThrow(/Only the circle owner/);
    await expect(s.circleService.removeMember(STRANGER.telegramId, member.id)).rejects.toThrow(/Only the circle owner/);
  });

  it("sets per-member limits and validates them", async () => {
    const s = await buildTestServices();
    const { member } = await circleWithMember(s);
    const updated = await s.circleService.setMemberLimits(OWNER.telegramId, member.id, 100, 300);
    expect(updated).toMatchObject({ perPurchaseLimitMinor: 100, monthlyLimitMinor: 300 });
    await expect(s.circleService.setMemberLimits(OWNER.telegramId, member.id, 500, 300)).rejects.toThrow(/cannot be higher/);
  });

  it("kicked members lose access and can join another circle later", async () => {
    const s = await buildTestServices();
    const { member } = await circleWithMember(s);
    await s.circleService.removeMember(OWNER.telegramId, member.id);
    expect(await s.circleService.getMembership(MEMBER.telegramId)).toBeNull();
    await expect(s.circleService.createCircle(MEMBER, "Mom's own")).resolves.toBeDefined();
  });

  it("the owner cannot be kicked or leave", async () => {
    const s = await buildTestServices();
    await circleWithMember(s);
    const owner = (await s.circleService.getMembership(OWNER.telegramId))!.member;
    await expect(s.circleService.removeMember(OWNER.telegramId, owner.id)).rejects.toThrow(DomainError);
    await expect(s.circleService.leave(OWNER.telegramId)).rejects.toThrow(DomainError);
  });
});
