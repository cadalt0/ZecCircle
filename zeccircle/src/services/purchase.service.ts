import type { Database } from "../db/database.js";
import { evaluatePurchase, type PolicyDecision } from "../domain/policy.js";
import type { Circle, Member, Purchase } from "../domain/types.js";
import type { BitrefillApi } from "../integrations/bitrefill/api.js";
import { BitrefillApiError } from "../integrations/bitrefill/client.js";
import { QuoteError, quoteProduct, requiresPhoneNumber } from "../integrations/bitrefill/pricing.js";
import {
  INVOICE_FAILURE_STATUSES,
  INVOICE_SUCCESS_STATUSES,
  ORDER_FAILURE_STATUSES,
  ORDER_SUCCESS_STATUSES,
  type BitrefillInvoice,
  type RedemptionInfo,
} from "../integrations/bitrefill/schemas.js";
import { conflict, DomainError, expired, forbidden, invalidInput, notFound } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { majorToMinorCeil } from "../lib/money.js";
import { normalizeIndianMobile } from "../lib/phone.js";
import { sleep } from "../lib/time.js";
import type { AuditRepository } from "../repositories/audit.repository.js";
import type { CircleRepository } from "../repositories/circle.repository.js";
import type { MemberRepository } from "../repositories/member.repository.js";
import type { PurchaseRepository } from "../repositories/purchase.repository.js";
import type { CircleService } from "./circle.service.js";
import type { FundingRail, Settlement } from "./funding/funding-rail.js";
import type { Notifier } from "./notifier.js";
import type { PurchaseGuard } from "./purchase-guard.js";
import { noActivityLog, type ActivityLog } from "./activity/activity-log.js";

export interface PurchaseServiceDeps {
  db: Database;
  circles: CircleRepository;
  members: MemberRepository;
  purchases: PurchaseRepository;
  audit: AuditRepository;
  circleService: CircleService;
  bitrefill: BitrefillApi;
  /** How purchases are paid on-chain (Zcash), separate from Bitrefill fulfilment. */
  fundingRail: FundingRail;
  /** Hard rules for real purchases (allowed items, price and total spend). */
  guard: PurchaseGuard;
  /** Developer activity feed (optional). */
  activity?: ActivityLog;
  notifier: Notifier;
  logger: Logger;
  settings: {
    currency: string;
    proposalTtlMs: number;
    approvalTtlMs: number;
    priceTolerancePercent: number;
    invoicePollIntervalMs: number;
    invoicePollTimeoutMs: number;
  };
}

export interface ProposeInput {
  productId: string;
  packageId?: string | null;
  value?: number | null;
  phoneNumber?: string | null;
}

export interface Proposal {
  purchase: Purchase;
  /** What would happen if the member confirmed right now. */
  preview: PolicyDecision;
}

export type ConfirmOutcome =
  | { kind: "executing"; purchase: Purchase }
  | { kind: "awaiting_approval"; purchase: Purchase; reasons: string[] }
  | { kind: "denied"; purchase: Purchase; reason: string };

/**
 * Purchase lifecycle:
 *
 *   proposed --confirm--> executing --(Bitrefill)--> completed
 *       |         \--> awaiting_approval --approve--> executing
 *       |                     \--reject--> rejected
 *       \--cancel--> cancelled           (any) --error--> failed, (stale) --> expired
 *
 * Every transition is a compare-and-set on the current status, and the "check spend + reserve funds +
 * move to executing" step runs inside one transaction that holds the circle's lock, so double taps
 * and concurrent requests can never spend twice or overshoot a cap.
 */
export class PurchaseService {
  private readonly inFlight = new Set<Promise<void>>();
  private sweeper: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(private readonly deps: PurchaseServiceDeps) {}

  // ---------------------------------------------------------------- lifecycle

  /** Resumes interrupted work and starts the expiry sweeper. */
  async start(): Promise<void> {
    await this.recoverExecuting();
    await this.sweepExpired();
    this.sweeper = setInterval(
      () => void this.sweepExpired().catch((error) => this.deps.logger.warn({ err: error }, "expiry sweep failed")),
      60_000,
    );
    this.sweeper.unref();
  }

  /** Stops background work and waits for in-flight purchases to settle. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.allSettled([...this.inFlight]);
  }

  // ---------------------------------------------------------------- commands

  /** Called by the agent. Creates a proposal the member must confirm; never moves money. */
  async propose(memberTelegramId: number, input: ProposeInput): Promise<Proposal> {
    const { circle, member } = await this.deps.circleService.requireActiveMembership(memberTelegramId);

    let product;
    try {
      product = await this.deps.bitrefill.getProduct(input.productId);
    } catch (error) {
      if (error instanceof BitrefillApiError && error.status === 404) {
        throw notFound(`Product "${input.productId}" does not exist.`);
      }
      throw error;
    }

    let phoneNumber: string | null = null;
    if (input.phoneNumber) {
      phoneNumber = normalizeIndianMobile(input.phoneNumber);
      if (!phoneNumber) throw invalidInput("That doesn't look like an Indian mobile number. Send it with the country code, e.g. +91 98765 43210.");
    }
    if (requiresPhoneNumber(product) && !phoneNumber) {
      throw invalidInput(`${product.name} needs the phone number to top up. Ask the member for it.`);
    }

    let quote;
    try {
      quote = quoteProduct(product, { packageId: input.packageId, value: input.value }, circle.currency);
    } catch (error) {
      if (error instanceof QuoteError) throw invalidInput(error.message);
      throw error;
    }

    const allowed = await this.deps.guard.checkSelection({ productId: product.id, packageId: quote.packageId, phoneNumber });
    if (!allowed.ok) throw invalidInput(allowed.reason);

    const purchase = await this.deps.purchases.create({
      circleId: circle.id,
      memberId: member.id,
      productId: product.id,
      productName: product.name,
      packageId: quote.packageId,
      value: quote.value,
      phoneNumber,
      quotedMinor: quote.costMinor,
      currency: circle.currency,
      fulfilmentMode: this.deps.guard.mode,
    });
    await this.deps.audit.record({
      circleId: circle.id,
      actorTelegramId: memberTelegramId,
      action: "purchase.proposed",
      details: { purchaseId: purchase.id, productId: product.id, value: quote.value, quotedMinor: quote.costMinor },
    });

    const preview = evaluatePurchase({
      circle,
      member,
      amountMinor: purchase.quotedMinor,
      spent: await this.deps.circleService.getSpend(member),
    });
    return { purchase, preview };
  }

  /** The requesting member confirms a proposal. */
  async confirm(purchaseId: number, actorTelegramId: number): Promise<ConfirmOutcome> {
    const { purchase, member, circle } = await this.load(purchaseId);
    if (member.telegramId !== actorTelegramId) throw forbidden("Only the person who asked can confirm this purchase.");
    if (purchase.status !== "proposed") throw conflict(`This purchase is already ${humanStatus(purchase.status)}.`);
    if (Date.parse(purchase.createdAt) + this.deps.settings.proposalTtlMs < Date.now()) {
      await this.deps.purchases.transition(purchase.id, ["proposed"], "expired");
      throw expired("This proposal expired. Ask again and I'll get a fresh price.");
    }

    const outcome = await this.deps.db.transaction(async (): Promise<ConfirmOutcome> => {
      await this.deps.db.lockCircle(circle.id);
      const fresh = await this.reload(purchase.id);
      const decision = await this.withFunding(
        evaluatePurchase({
          circle: fresh.circle,
          member: fresh.member,
          amountMinor: purchase.quotedMinor,
          spent: await this.deps.circleService.getSpend(fresh.member),
        }),
        purchase,
        fresh.circle,
      );

      switch (decision.kind) {
        case "allow":
          if (!(await this.deps.purchases.transition(purchase.id, ["proposed"], "executing"))) throw conflict("This purchase was already handled.");
          await this.deps.audit.record({ circleId: circle.id, actorTelegramId, action: "purchase.confirmed", details: { purchaseId } });
          return { kind: "executing", purchase: { ...purchase, status: "executing" } };
        case "needs_approval":
          if (!(await this.deps.purchases.transition(purchase.id, ["proposed"], "awaiting_approval"))) throw conflict("This purchase was already handled.");
          await this.deps.audit.record({
            circleId: circle.id,
            actorTelegramId,
            action: "purchase.approval_requested",
            details: { purchaseId, reasons: decision.reasons },
          });
          return { kind: "awaiting_approval", purchase: { ...purchase, status: "awaiting_approval" }, reasons: decision.reasons };
        case "deny":
          await this.deps.purchases.transition(purchase.id, ["proposed"], "failed", { failureReason: decision.reason });
          await this.deps.audit.record({ circleId: circle.id, actorTelegramId, action: "purchase.denied", details: { purchaseId, reason: decision.reason } });
          return { kind: "denied", purchase: { ...purchase, status: "failed" }, reason: decision.reason };
      }
    });

    if (outcome.kind === "executing") {
      this.runInBackground(outcome.purchase.id);
    } else if (outcome.kind === "awaiting_approval") {
      await this.deps.notifier.notify({ type: "purchase_needs_approval", circle, member, purchase: outcome.purchase, reasons: outcome.reasons });
    }
    return outcome;
  }

  async cancel(purchaseId: number, actorTelegramId: number): Promise<Purchase> {
    const { purchase, circle, member } = await this.load(purchaseId);
    if (member.telegramId !== actorTelegramId) throw forbidden("Only the person who asked can cancel this purchase.");
    if (!(await this.deps.purchases.transition(purchase.id, ["proposed", "awaiting_approval"], "cancelled"))) {
      throw conflict(`This purchase is already ${humanStatus(purchase.status)}.`);
    }
    await this.deps.audit.record({ circleId: circle.id, actorTelegramId, action: "purchase.cancelled", details: { purchaseId } });
    return { ...purchase, status: "cancelled" };
  }

  /** Owner approves a purchase that was over the member's limits. The circle cap still applies. */
  async approve(purchaseId: number, ownerTelegramId: number): Promise<ConfirmOutcome> {
    const { purchase, member, circle } = await this.load(purchaseId);
    if (circle.ownerTelegramId !== ownerTelegramId) throw forbidden("Only the circle owner can approve purchases.");
    if (purchase.status !== "awaiting_approval") throw conflict(`This purchase is already ${humanStatus(purchase.status)}.`);

    const outcome = await this.deps.db.transaction(async (): Promise<ConfirmOutcome> => {
      await this.deps.db.lockCircle(circle.id);
      const fresh = await this.reload(purchase.id);
      const decision = await this.withFunding(
        evaluatePurchase({
          circle: fresh.circle,
          member: fresh.member,
          amountMinor: purchase.quotedMinor,
          spent: await this.deps.circleService.getSpend(fresh.member),
          ownerApproved: true,
        }),
        purchase,
        fresh.circle,
      );
      if (decision.kind !== "allow") {
        const reason = decision.kind === "deny" ? decision.reason : decision.reasons.join(", ");
        await this.deps.purchases.transition(purchase.id, ["awaiting_approval"], "failed", { failureReason: reason });
        await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "purchase.denied", details: { purchaseId, reason } });
        return { kind: "denied", purchase: { ...purchase, status: "failed" }, reason };
      }
      if (!(await this.deps.purchases.transition(purchase.id, ["awaiting_approval"], "executing", { approvedByTelegramId: ownerTelegramId }))) {
        throw conflict("This purchase was already handled.");
      }
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "purchase.approved", details: { purchaseId } });
      return { kind: "executing", purchase: { ...purchase, status: "executing", approvedByTelegramId: ownerTelegramId } };
    });

    if (outcome.kind === "executing") {
      await this.deps.notifier.notify({ type: "purchase_approved", circle, member, purchase: outcome.purchase });
      this.runInBackground(outcome.purchase.id);
    } else if (outcome.kind === "denied") {
      await this.deps.notifier.notify({
        type: "purchase_failed",
        circle,
        member,
        purchase: outcome.purchase,
        reason: outcome.reason,
        settlement: null,
      });
    }
    return outcome;
  }

  async reject(purchaseId: number, ownerTelegramId: number): Promise<Purchase> {
    const { purchase, member, circle } = await this.load(purchaseId);
    if (circle.ownerTelegramId !== ownerTelegramId) throw forbidden("Only the circle owner can reject purchases.");
    if (!(await this.deps.purchases.transition(purchase.id, ["awaiting_approval"], "rejected", { approvedByTelegramId: ownerTelegramId }))) {
      throw conflict(`This purchase is already ${humanStatus(purchase.status)}.`);
    }
    await this.deps.audit.record({ circleId: circle.id, actorTelegramId: ownerTelegramId, action: "purchase.rejected", details: { purchaseId } });
    const updated = { ...purchase, status: "rejected" as const };
    await this.deps.notifier.notify({ type: "purchase_rejected", circle, member, purchase: updated });
    return updated;
  }

  // ---------------------------------------------------------------- queries

  recentForMember(memberId: number, limit = 10): Promise<Purchase[]> {
    return this.deps.purchases.listRecentByMember(memberId, limit);
  }

  recentForCircle(circleId: number, limit = 15): Promise<Purchase[]> {
    return this.deps.purchases.listRecentByCircle(circleId, limit);
  }

  // ---------------------------------------------------------------- execution

  private runInBackground(purchaseId: number, resumeInvoiceId?: string): void {
    const task = this.execute(purchaseId, resumeInvoiceId)
      .catch((error) => this.deps.logger.error({ err: error, purchaseId }, "purchase execution crashed"))
      .finally(() => this.inFlight.delete(task));
    this.inFlight.add(task);
  }

  /**
   * Creates the Bitrefill invoice, checks the price against the approved quote, pays it from the
   * account balance and waits for delivery. Any failure before payment leaves no money spent.
   */
  private async execute(purchaseId: number, resumeInvoiceId?: string): Promise<void> {
    const { purchase, member, circle } = await this.load(purchaseId);
    if (purchase.status !== "executing") return;
    const log = this.deps.logger.child({ purchaseId });

    let invoiceId = resumeInvoiceId;
    if (!invoiceId) {
      let invoice: BitrefillInvoice;
      try {
        invoice = await this.deps.bitrefill.createBalanceInvoice({
          productId: purchase.productId,
          packageId: purchase.packageId,
          value: purchase.packageId ? null : Number(purchase.value),
          phoneNumber: purchase.phoneNumber,
        });
      } catch (error) {
        return this.fail(purchase, member, circle, describeUpstreamError(error, "Bitrefill could not create the invoice"), error);
      }

      const priceCheck = this.checkInvoicePrice(invoice, purchase);
      await this.deps.purchases.setInvoice(purchase.id, invoice.id, priceCheck.ok ? priceCheck.paidMinor : null);
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: null, action: "purchase.invoice_created", details: { purchaseId, invoiceId: invoice.id } });
      if (!priceCheck.ok) {
        return this.fail(purchase, member, circle, priceCheck.reason);
      }
      (this.deps.activity ?? noActivityLog).record({
        event: "bitrefill.invoice",
        circleId: circle.id,
        fields: {
          purchase: purchase.id,
          invoice: invoice.id,
          status: invoice.status,
          price: `${invoice.payment?.price} ${invoice.payment?.currency}`,
          quoted_cents: purchase.quotedMinor,
          mode: purchase.fulfilmentMode,
        },
      });
      const invoiceAllowed = await this.deps.guard.checkInvoice(invoice, purchase);
      if (!invoiceAllowed.ok) {
        return this.fail(purchase, member, circle, invoiceAllowed.reason);
      }

      // Pay on-chain first (testnet: send to the settlement address; later: the swap deposit).
      // If this fails, Bitrefill is never paid and the reservation is released.
      try {
        await this.deps.fundingRail.settle(purchase.id, (message) =>
          this.deps.notifier.notify({ type: "purchase_progress", circle, member, purchase, message }),
        );
      } catch (error) {
        return this.fail(purchase, member, circle, (error as Error).message, error);
      }

      try {
        await this.deps.bitrefill.payInvoice(invoice.id);
      } catch (error) {
        const reason =
          error instanceof BitrefillApiError && error.status === 403
            ? "The circle's Bitrefill balance is too low. The owner needs to top it up."
            : describeUpstreamError(error, "Bitrefill payment failed");
        return this.fail(purchase, member, circle, reason, error);
      }
      await this.deps.purchases.markPaid(purchase.id);
      await this.deps.audit.record({ circleId: circle.id, actorTelegramId: null, action: "purchase.paid", details: { purchaseId, invoiceId: invoice.id } });
      log.info({ invoiceId: invoice.id }, "invoice paid");
      invoiceId = invoice.id;
    }

    await this.awaitDelivery(purchase.id, invoiceId);
  }

  private async awaitDelivery(purchaseId: number, invoiceId: string): Promise<void> {
    const { pollIntervalMs, timeoutMs } = {
      pollIntervalMs: this.deps.settings.invoicePollIntervalMs,
      timeoutMs: this.deps.settings.invoicePollTimeoutMs,
    };
    const deadline = Date.now() + timeoutMs;

    // Always poll at least once; on shutdown, stop between polls (recoverExecuting resumes on restart).
    for (;;) {
      const { purchase, member, circle } = await this.load(purchaseId);
      if (purchase.status !== "executing") return;

      let invoice: BitrefillInvoice | null = null;
      try {
        invoice = await this.deps.bitrefill.getInvoice(invoiceId);
      } catch (error) {
        this.deps.logger.warn({ err: error, purchaseId }, "invoice poll failed; retrying");
      }

      const state = invoice ? deliveryState(invoice) : "pending";
      if (invoice && state === "delivered") {
        const redemptions = await this.fetchRedemptions(invoice);
        if (await this.deps.purchases.transition(purchaseId, ["executing"], "completed")) {
          await this.deps.audit.record({ circleId: circle.id, actorTelegramId: null, action: "purchase.completed", details: { purchaseId, invoiceId } });
          await this.deps.notifier.notify({
            type: "purchase_completed",
            circle,
            member,
            purchase: { ...purchase, status: "completed" },
            redemptions,
            settlement: await this.deps.fundingRail.getSettlement(purchaseId),
          });
        }
        return;
      }
      if (invoice && state === "failed") {
        const orderStatus = invoice.orders?.find((o) => ORDER_FAILURE_STATUSES.has(o.status))?.status;
        return this.fail(
          purchase,
          member,
          circle,
          `Bitrefill reported the order as "${orderStatus ?? invoice.status}". If it was paid, Bitrefill normally refunds it to the account balance.`,
        );
      }

      if (Date.now() > deadline) {
        // Money may already be spent, so keep the purchase "executing" (it still counts against caps)
        // and let a human look at the invoice instead of guessing.
        this.deps.logger.warn({ purchaseId, invoiceId }, "delivery still pending after timeout");
        await this.deps.notifier.notify({ type: "purchase_delayed", circle, member, purchase });
        return;
      }
      if (this.stopping) return;
      await sleep(pollIntervalMs);
    }
  }

  private async fetchRedemptions(invoice: BitrefillInvoice): Promise<RedemptionInfo[]> {
    const out: RedemptionInfo[] = [];
    for (const order of invoice.orders ?? []) {
      try {
        const full = await this.deps.bitrefill.getOrder(order.id);
        if (full.redemption_info) out.push(full.redemption_info);
      } catch (error) {
        this.deps.logger.error({ err: error, orderId: order.id }, "could not fetch order redemption info");
      }
    }
    return out;
  }

  private checkInvoicePrice(
    invoice: BitrefillInvoice,
    purchase: Purchase,
  ): { ok: true; paidMinor: number } | { ok: false; reason: string } {
    const price = invoice.payment?.price;
    const currency = invoice.payment?.currency;
    if (price === undefined) {
      return { ok: false, reason: "Bitrefill did not return a price for the invoice, so it was not paid." };
    }
    if (currency && currency.toUpperCase() !== purchase.currency.toUpperCase()) {
      return {
        ok: false,
        reason: `Bitrefill priced the invoice in ${currency}, but this circle uses ${purchase.currency}. Not paid.`,
      };
    }
    const paidMinor = majorToMinorCeil(price);
    const ceiling = Math.floor(purchase.quotedMinor * (1 + this.deps.settings.priceTolerancePercent / 100));
    if (paidMinor > ceiling) {
      return { ok: false, reason: "The price went up since it was approved, so it was not paid. Please ask again." };
    }
    return { ok: true, paidMinor };
  }

  private async fail(purchase: Purchase, member: Member, circle: Circle, reason: string, error?: unknown): Promise<void> {
    this.deps.logger.warn({ purchaseId: purchase.id, reason, err: error }, "purchase failed");
    if (!(await this.deps.purchases.transition(purchase.id, ["executing"], "failed", { failureReason: reason }))) return;
    await this.deps.fundingRail.release(purchase.id, reason);
    const settlement: Settlement | null = await this.deps.fundingRail.getSettlement(purchase.id);
    await this.deps.audit.record({ circleId: circle.id, actorTelegramId: null, action: "purchase.failed", details: { purchaseId: purchase.id, reason } });
    await this.deps.notifier.notify({ type: "purchase_failed", circle, member, purchase: { ...purchase, status: "failed" }, reason, settlement });
  }

  /**
   * After a restart: purchases stuck in "executing" either never got an invoice (safe to fail),
   * got an invoice that was never paid (fail; never auto-pay after a crash), or were paid
   * (resume waiting for delivery).
   */
  private async recoverExecuting(): Promise<void> {
    for (const purchase of await this.deps.purchases.listByStatus("executing")) {
      const { member, circle } = await this.load(purchase.id);
      if (!purchase.invoiceId) {
        await this.fail(purchase, member, circle, "Interrupted before an invoice was created. Nothing was charged.");
        continue;
      }
      try {
        const invoice = await this.deps.bitrefill.getInvoice(purchase.invoiceId);
        if (invoice.payment?.status === "unpaid" || invoice.status === "unpaid") {
          await this.fail(purchase, member, circle, "Interrupted before payment. Nothing was charged; please ask again.");
        } else {
          this.runInBackground(purchase.id, purchase.invoiceId);
        }
      } catch (error) {
        this.deps.logger.error({ err: error, purchaseId: purchase.id }, "could not recover purchase; leaving as executing");
      }
    }
  }

  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    const proposals = await this.deps.purchases.expireStale("proposed", new Date(now - this.deps.settings.proposalTtlMs).toISOString());
    const approvals = await this.deps.purchases.expireStale("awaiting_approval", new Date(now - this.deps.settings.approvalTtlMs).toISOString());
    if (proposals + approvals > 0) this.deps.logger.info({ proposals, approvals }, "expired stale purchases");
  }

  /**
   * If the policy allows the purchase, also reserve its on-chain cost. Not enough funds turns the
   * decision into a deny. Runs inside the caller's transaction, so the reservation and the status
   * change commit (or roll back) together.
   */
  private async withFunding(decision: PolicyDecision, purchase: Purchase, circle: Circle): Promise<PolicyDecision> {
    if (decision.kind !== "allow") return decision;
    // Hard real-money rules first (allowed items, price, total budget), then the circle's ZEC funds.
    const allowed = await this.deps.guard.checkSpend(purchase);
    if (!allowed.ok) return { kind: "deny", reason: allowed.reason };
    const funds = await this.deps.fundingRail.reserve(purchase, circle);
    return funds.ok ? decision : { kind: "deny", reason: funds.reason };
  }

  private async load(purchaseId: number): Promise<{ purchase: Purchase; member: Member; circle: Circle }> {
    const purchase = await this.deps.purchases.findById(purchaseId);
    if (!purchase) throw notFound("Purchase not found.");
    return { purchase, ...(await this.reload(purchaseId, purchase)) };
  }

  private async reload(purchaseId: number, known?: Purchase): Promise<{ member: Member; circle: Circle }> {
    const purchase = known ?? (await this.deps.purchases.findById(purchaseId));
    if (!purchase) throw notFound("Purchase not found.");
    const [member, circle] = await Promise.all([this.deps.members.findById(purchase.memberId), this.deps.circles.findById(purchase.circleId)]);
    if (!member || !circle) throw notFound("Purchase belongs to a circle or member that no longer exists.");
    return { member, circle };
  }
}

/**
 * Bitrefill's live API reports "not_delivered" both for unpaid invoices and while a paid order is being
 * fulfilled, so the order statuses decide: all delivered = done, any failed/refunded = failed.
 */
export function deliveryState(invoice: BitrefillInvoice): "delivered" | "failed" | "pending" {
  const orders = invoice.orders ?? [];
  if (INVOICE_FAILURE_STATUSES.has(invoice.status)) return "failed";
  if (orders.some((o) => ORDER_FAILURE_STATUSES.has(o.status))) return "failed";
  if (INVOICE_SUCCESS_STATUSES.has(invoice.status)) return "delivered";
  if (orders.length > 0 && orders.every((o) => ORDER_SUCCESS_STATUSES.has(o.status))) return "delivered";
  return "pending";
}

export function humanStatus(status: Purchase["status"]): string {
  return status === "awaiting_approval" ? "waiting for the owner" : status;
}

function describeUpstreamError(error: unknown, fallback: string): string {
  if (error instanceof DomainError) return error.message;
  if (error instanceof BitrefillApiError) return `${fallback}: ${error.message}`;
  return fallback;
}
