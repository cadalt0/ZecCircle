import type { Database } from "../db/database.js";
import { findLiveItem, LIVE_CURRENCY, LIVE_TOTAL_SPEND_CEILING_MINOR } from "../domain/live-purchase-rules.js";
import type { FulfilmentMode, Purchase } from "../domain/types.js";
import type { BitrefillInvoice } from "../integrations/bitrefill/schemas.js";
import type { Logger } from "../lib/logger.js";
import { formatMoney, majorToMinorCeil } from "../lib/money.js";
import type { PurchaseRepository } from "../repositories/purchase.repository.js";

export type GuardResult = { ok: true } | { ok: false; reason: string };

const OK: GuardResult = { ok: true };
const refuse = (reason: string): GuardResult => ({ ok: false, reason });

export interface SelectionInput {
  productId: string;
  packageId: string | null;
  /** Already normalized (country code + digits), or null. */
  phoneNumber: string | null;
}

/**
 * Last line of defence before real money moves. The purchase service asks it at three points:
 *   1. checkSelection - when the agent proposes something
 *   2. checkSpend     - inside the approval transaction, before anything is reserved
 *   3. checkInvoice   - after Bitrefill returns the invoice, before ZEC or Bitrefill is paid
 * None of these can be influenced by the agent: they read only the purchase and Bitrefill's answers.
 */
export interface PurchaseGuard {
  readonly mode: FulfilmentMode;
  checkSelection(input: SelectionInput): Promise<GuardResult>;
  checkSpend(purchase: Purchase): Promise<GuardResult>;
  checkInvoice(invoice: BitrefillInvoice, purchase: Purchase): Promise<GuardResult>;
}

/** Fake fulfilment (BITREFILL_MODE=mock): nothing real is bought, so no extra rules. */
export class MockModeGuard implements PurchaseGuard {
  readonly mode = "mock" as const;
  async checkSelection(): Promise<GuardResult> {
    return OK;
  }
  async checkSpend(): Promise<GuardResult> {
    return OK;
  }
  async checkInvoice(): Promise<GuardResult> {
    return OK;
  }
}

export interface LiveGuardDeps {
  db: Database;
  purchases: PurchaseRepository;
  logger: Logger;
}

/**
 * Real purchases (BITREFILL_MODE=live), limited by the hardcoded rules in live-purchase-rules.ts:
 * only the listed items, at most a few cents each, and never more than $5 in total.
 */
export class LiveModeGuard implements PurchaseGuard {
  readonly mode = "live" as const;

  constructor(private readonly deps: LiveGuardDeps) {}

  async checkSelection(input: SelectionInput): Promise<GuardResult> {
    const item = findLiveItem(input.productId, input.packageId);
    if (!item) {
      return refuse("Test mode: I can only buy a ₹10 Jio talktime top-up or a ₹50 Flipkart gift card right now.");
    }
    // The number was already cleaned up and validated as an Indian mobile number by the purchase service.
    if (item.operator && !input.phoneNumber) {
      return refuse(`The ${item.label} needs the ${item.operator} number to top up.`);
    }
    return OK;
  }

  async checkSpend(purchase: Purchase): Promise<GuardResult> {
    const item = findLiveItem(purchase.productId, purchase.packageId);
    if (!item) return refuse("This item is not allowed in test mode.");
    if (purchase.quotedMinor > item.maxPriceMinor) {
      return refuse(`The ${item.label} costs more than expected right now, so it was not bought.`);
    }
    return this.withinCeiling(purchase.id, purchase.quotedMinor);
  }

  async checkInvoice(invoice: BitrefillInvoice, purchase: Purchase): Promise<GuardResult> {
    const item = findLiveItem(purchase.productId, purchase.packageId);
    if (!item) return refuse("This item is not allowed in test mode.");

    const orders = invoice.orders ?? [];
    if (orders.length !== 1) return refuse("Bitrefill's invoice did not contain exactly one item, so it was not paid.");
    const order = orders[0]!;
    if (order.product?.id && order.product.id !== item.productId) {
      return refuse("Bitrefill's invoice is for a different product, so it was not paid.");
    }
    if (order.product?.value !== undefined && !item.orderValues.includes(String(order.product.value))) {
      return refuse("Bitrefill's invoice is for a different amount, so it was not paid.");
    }

    const currency = invoice.payment?.currency?.toUpperCase();
    const price = invoice.payment?.price;
    if (currency !== LIVE_CURRENCY || price === undefined) {
      return refuse(`Bitrefill's invoice is not priced in ${LIVE_CURRENCY}, so it was not paid.`);
    }
    const priceMinor = majorToMinorCeil(price);
    if (priceMinor > item.maxPriceMinor) {
      return refuse(
        `Bitrefill asked ${formatMoney(priceMinor, LIVE_CURRENCY)} for the ${item.label}, above the ${formatMoney(item.maxPriceMinor, LIVE_CURRENCY)} limit. Not paid.`,
      );
    }
    return this.withinCeiling(purchase.id, priceMinor);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Checks the deployment-wide ceiling while holding the global live-spend lock, so two purchases
   * in different circles can't both squeeze under the limit at the same time.
   */
  private async withinCeiling(purchaseId: number, amountMinor: number): Promise<GuardResult> {
    return this.deps.db.transaction(async () => {
      await this.deps.db.lockLiveSpend();
      const committed = await this.deps.purchases.liveCommittedTotal(purchaseId);
      if (committed + amountMinor > LIVE_TOTAL_SPEND_CEILING_MINOR) {
        this.deps.logger.warn({ purchaseId, committed, amountMinor }, "live spend ceiling reached");
        return refuse(
          `The ${formatMoney(LIVE_TOTAL_SPEND_CEILING_MINOR, LIVE_CURRENCY)} test budget for real purchases is used up (${formatMoney(committed, LIVE_CURRENCY)} spent).`,
        );
      }
      return OK;
    });
  }
}
