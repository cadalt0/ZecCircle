import type { Database } from "../../db/database.js";
import {
  BASE_CHAIN_ID,
  MAX_SWAP_OVERHEAD_PERCENT,
  MAX_SWAPS_TOTAL,
  MAX_ZEC_PER_SWAP_ZAT,
  MIN_INVOICE_MINUTES_LEFT,
  SWAP_BITREFILL_PAYMENT_METHOD,
  SWAP_DEADLINE_MINUTES,
  SWAP_POLL_INTERVAL_MS,
  SWAP_PURCHASE_WAIT_MINUTES,
  SWAP_SLOW_POLL_INTERVAL_MS,
  SWAP_SLIPPAGE_BPS,
  SWAP_USD_MINOR,
  USDC_BASE_CONTRACT,
} from "../../domain/mainnet-swap-rules.js";
import type { Purchase } from "../../domain/types.js";
import type { BitrefillApi } from "../../integrations/bitrefill/api.js";
import { STORE_CREDIT_PRODUCT_ID, type BitrefillMcpClient, type StoreCreditInvoice } from "../../integrations/bitrefill/mcp-client.js";
import { ONE_CLICK_USDC_BASE, ONE_CLICK_ZEC, type OneClickClient, type QuoteRequest, type QuoteResponse } from "../../integrations/near-intents/one-click-client.js";
import { fiatMinorToZat, zatToZecString } from "../../integrations/zcash/units.js";
import type { ZcashWallet } from "../../integrations/zcash/wallet.js";
import type { Logger } from "../../lib/logger.js";
import { sleep } from "../../lib/time.js";
import type { SwapRepository, ZecSwap } from "../../repositories/swap.repository.js";
import type { ActivityLog } from "../activity/activity-log.js";
import { deliveryState } from "../purchase.service.js";
import type { PriceSource } from "./price-source.js";
import { SettlementFailed, type SettlementContext, type SettlementResult, type SettlementStrategy } from "./settlement.js";

export interface SwapSettlementDeps {
  db: Database;
  wallet: ZcashWallet & { getTransparentAddress(): Promise<string> };
  oneClick: OneClickClient;
  bitrefillMcp: BitrefillMcpClient;
  bitrefill: BitrefillApi;
  swaps: SwapRepository;
  price: PriceSource;
  /** Bitrefill account whose USD balance the store credit goes to. */
  accountEmail: string;
  logger: Logger;
  activity: ActivityLog;
  /** Injectable for tests. */
  wait?: (ms: number) => Promise<void>;
}

const USDC_AMOUNT = (SWAP_USD_MINOR / 100).toFixed(2); // "2.00"
const USDC_BASE_UNITS = SWAP_USD_MINOR * 10_000; // 6 decimals: $2.00 -> 2_000_000
/** Room for the network fee on top of the swap input when reserving the circle's ZEC. */
const NETWORK_FEE_MARGIN_ZAT = 30_000;

/**
 * Mainnet: pays for a purchase by buying $2 of Bitrefill USD store credit with USDC on Base, funded
 * by swapping ZEC through NEAR Intents 1Click. Steps, each recorded before the next:
 *
 *   1. Bitrefill store-credit invoice (MCP)          -> must be exactly 2.00 USDC on Base, valid long enough
 *   2. 1Click dry quote, then real quote (EXACT_OUTPUT) -> must pay that exact amount to that exact address,
 *                                                         cost within the hard limits
 *   3. send the quoted ZEC to the 1Click deposit address (the only transparent payment the bot makes)
 *   4. wait for 1Click SUCCESS, then for Bitrefill to credit the balance
 *
 * Money safety: a step that fails before (3) moves nothing. After (3) nothing is ever re-sent; the
 * swap is watched to the end (also across restarts), and refunds go back to the bot's own address.
 */
export class SwapSettlement implements SettlementStrategy {
  readonly method = "zec-usdc-swap";
  readonly reservationAddress = "1click-deposit (set when quoted)";
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly deps: SwapSettlementDeps) {
    this.wait = deps.wait ?? sleep;
  }

  /** Upper bound to reserve: $2 plus the maximum allowed overhead at the live price, plus a fee margin. */
  async estimateZat(_purchase: Purchase): Promise<number> {
    const price = await this.deps.price.getPriceMinorPerZec();
    const withOverhead = Math.ceil((SWAP_USD_MINOR * (100 + MAX_SWAP_OVERHEAD_PERCENT)) / 100);
    return Math.min(fiatMinorToZat(withOverhead, price), MAX_ZEC_PER_SWAP_ZAT) + NETWORK_FEE_MARGIN_ZAT;
  }

  async execute(ctx: SettlementContext): Promise<SettlementResult> {
    const { purchase, payment } = ctx;
    const existing = await this.deps.swaps.findByPurchase(purchase.id);
    if (existing?.depositTxid) {
      // Already sent (e.g. before a restart): never send again, just follow it to the end.
      return this.finish(existing, ctx);
    }
    if (existing) {
      throw new SettlementFailed(`An earlier swap attempt for this purchase stopped at "${existing.status}". Not retrying automatically.`);
    }

    // 1. Bitrefill store credit invoice, checked field by field.
    const invoice = await this.deps.bitrefillMcp.createStoreCreditInvoice(USDC_AMOUNT.replace(/\.00$/, ""), this.deps.accountEmail, SWAP_BITREFILL_PAYMENT_METHOD);
    this.checkInvoice(invoice);
    const swap = await this.reserveSwapSlot(purchase, invoice);
    this.log("swap.invoice_created", purchase, {
      swap: swap.id,
      bitrefill_invoice: invoice.invoice_id,
      pay_to: invoice.payment_info.address,
      usdc: invoice.payment_info.altcoinPrice,
      valid_minutes: invoice.expiration_minutes,
    });

    try {
      // 2. Quotes: a dry run first (free, no deposit address), then the real one. Both must pass the limits.
      const refundTo = await this.deps.wallet.getTransparentAddress();
      const request = this.quoteRequest(invoice.payment_info.address, refundTo);
      const dry = await this.deps.oneClick.quote({ ...request, dry: true });
      this.checkQuote(dry, request, payment.amountZat, false);
      this.log("swap.dry_quote", purchase, { zec_in: dry.quote.amountInFormatted, usd_in: dry.quote.amountInUsd, usdc_out: dry.quote.amountOutFormatted, eta_s: dry.quote.timeEstimate });

      const real = await this.deps.oneClick.quote({ ...request, dry: false });
      this.checkQuote(real, request, payment.amountZat, true);
      const depositAddress = real.quote.depositAddress!;
      const amountInZat = Number(real.quote.amountIn);
      await this.deps.swaps.markQuoted(swap.id, {
        depositAddress,
        amountInZat,
        deadline: real.quote.deadline ?? request.deadline,
        quoteJson: JSON.stringify(real), // includes 1Click's signature, kept for disputes
      });
      this.log("swap.quoted", purchase, {
        swap: swap.id,
        deposit_address: depositAddress,
        zec_in: real.quote.amountInFormatted,
        zec_min_in: zatToZecString(Number(real.quote.minAmountIn)),
        usd_in: real.quote.amountInUsd,
        usdc_out: real.quote.amountOutFormatted,
        refund_to: refundTo,
        deadline: real.quote.deadline,
        eta_s: real.quote.timeEstimate,
      });

      // 3. Send the ZEC. From here on money has moved.
      await ctx.progress(
        `🔄 Paying with ZEC: swapping ${real.quote.amountInFormatted} ZEC → ${real.quote.amountOutFormatted} USDC for Bitrefill store credit. ` +
          `This usually takes about ${Math.ceil(real.quote.timeEstimate / 60)} minutes.`,
      );
      await this.deps.wallet.sync();
      let txid: string;
      try {
        txid = await this.deps.wallet.send(depositAddress, amountInZat, null, { allowTransparent: true });
      } catch (error) {
        await this.deps.swaps.setStatus(swap.id, "failed", { error: `send failed: ${(error as Error).message}`.slice(0, 500) });
        this.log("swap.send_failed", purchase, { swap: swap.id, error: (error as Error).message }, "warn");
        throw new SettlementFailed(
          `Sending the ZEC to the swap failed (${(error as Error).message}). Normally nothing leaves the wallet in that case; ` +
            `if the wallet shows the payment anyway, 1Click refunds it to the bot's address after the deadline.`,
        );
      }
      await this.deps.swaps.markDepositSent(swap.id, txid);
      this.log("swap.deposit_sent", purchase, { swap: swap.id, txid, zec: zatToZecString(amountInZat), to: depositAddress });
      try {
        await this.deps.oneClick.submitDeposit(txid, depositAddress);
      } catch (error) {
        this.log("swap.deposit_notify_failed", purchase, { swap: swap.id, error: (error as Error).message }, "warn");
      }

      // 4. Follow it to the end.
      return await this.finish({ ...swap, status: "deposit_sent", depositAddress, amountInZat, depositTxid: txid }, ctx);
    } catch (error) {
      const fresh = await this.deps.swaps.findByPurchase(purchase.id);
      if (fresh?.depositTxid) {
        if (error instanceof SettlementFailed && error.moneyMoved) throw error;
        // ZEC already left the wallet: report it as moved so the circle's ledger stays correct.
        throw new SettlementFailed(`The swap ran into a problem after the ZEC was sent: ${(error as Error).message}. It keeps being tracked.`, {
          txid: fresh.depositTxid,
          amountZat: fresh.amountInZat ?? 0,
          toAddress: fresh.depositAddress ?? "",
        });
      }
      // Nothing was sent: close the attempt so it doesn't count against the swap limit.
      if (fresh && fresh.status !== "failed") {
        await this.deps.swaps.setStatus(fresh.id, "failed", { error: (error as Error).message.slice(0, 500) });
        this.log("swap.failed_before_payment", purchase, { swap: fresh.id, error: (error as Error).message }, "warn");
      }
      if (error instanceof SettlementFailed) throw error;
      throw new SettlementFailed(`The swap could not start: ${(error as Error).message}. No ZEC was sent.`);
    }
  }

  /** After a restart: keep watching swaps whose ZEC was sent, so their store credit is never lost track of. */
  async resume(): Promise<void> {
    for (const swap of await this.deps.swaps.listInFlight()) {
      this.deps.activity.record({ event: "swap.resumed", circleId: swap.circleId, fields: { swap: swap.id, status: swap.status, txid: swap.depositTxid } });
      void this.follow(swap).catch((error) =>
        this.deps.activity.record({ event: "swap.resume_failed", level: "error", circleId: swap.circleId, fields: { swap: swap.id, error: (error as Error).message } }),
      );
    }
  }

  // ---------------------------------------------------------------- steps

  private async finish(swap: ZecSwap, ctx: SettlementContext): Promise<SettlementResult> {
    const moved = { txid: swap.depositTxid!, amountZat: swap.amountInZat!, toAddress: swap.depositAddress! };
    const outcome = await this.follow(swap, ctx, SWAP_PURCHASE_WAIT_MINUTES * 60_000);
    if (outcome === "timeout") {
      // Keep watching in the background until 1Click's own deadline so the credit is still recorded.
      const latest = (await this.deps.swaps.findByPurchase(swap.purchaseId)) ?? swap;
      void this.follow(latest).catch((error) =>
        this.deps.activity.record({ event: "swap.watch_failed", level: "error", circleId: swap.circleId, fields: { swap: swap.id, error: (error as Error).message } }),
      );
    }
    if (outcome !== "credited") {
      throw new SettlementFailed(
        outcome === "refunded"
          ? "The swap was refunded by 1Click: the ZEC goes back to the bot's wallet (minus 1Click's refund fee). Nothing was bought."
          : outcome === "failed"
            ? "The swap failed at 1Click. Any refund goes back to the bot's wallet. Nothing was bought."
            : "The swap is taking longer than expected. It keeps being watched; the store credit will still arrive in the Bitrefill account.",
        moved,
      );
    }
    await ctx.progress("✅ Swap done: Bitrefill store credit received. Buying now…");
    return {
      ...moved,
      swap: { usdcAmount: USDC_AMOUNT, bitrefillTopUpInvoiceId: swap.bitrefillInvoiceId, status: "credited" },
    };
  }

  /**
   * Polls 1Click, then Bitrefill, until the swap is credited, refunded, failed or out of time.
   * Without `maxWaitMs` it watches until 1Click's own deadline, checking slowly after the first 45 minutes.
   */
  private async follow(swap: ZecSwap, ctx?: SettlementContext, maxWaitMs?: number): Promise<"credited" | "refunded" | "failed" | "timeout"> {
    const started = Date.now();
    const quoteDeadline = (swap.quoteDeadline ? Date.parse(swap.quoteDeadline) : started + SWAP_DEADLINE_MINUTES * 60_000) + 15 * 60_000;
    const deadline = maxWaitMs === undefined ? quoteDeadline : Math.min(quoteDeadline, started + maxWaitMs);
    let last = swap.lastSwapStatus;
    let swapDone = swap.status === "swap_succeeded";

    while (Date.now() < deadline) {
      if (!swapDone) {
        const status = await this.deps.oneClick.status(swap.depositAddress!).catch(() => null);
        if (status && status.status !== last) {
          last = status.status;
          await this.deps.swaps.setLastSwapStatus(swap.id, last);
          this.deps.activity.record({ event: "swap.status", circleId: swap.circleId, fields: { swap: swap.id, status: last, usdc_out: status.swapDetails?.amountOutFormatted } });
        }
        if (last === "SUCCESS") {
          swapDone = true;
          await this.deps.swaps.setStatus(swap.id, "swap_succeeded", { lastSwapStatus: last });
          if (ctx) await ctx.progress("💱 Swap complete. Waiting for Bitrefill to credit the store credit…");
        } else if (last === "REFUNDED" || last === "FAILED") {
          const status = last === "REFUNDED" ? "refunded" : "failed";
          await this.deps.swaps.setStatus(swap.id, status, { lastSwapStatus: last });
          this.deps.activity.record({ event: `swap.${status}`, level: "error", circleId: swap.circleId, fields: { swap: swap.id, txid: swap.depositTxid } });
          return status;
        }
      }
      if (swapDone) {
        const invoice = await this.deps.bitrefill.getInvoice(swap.bitrefillInvoiceId).catch(() => null);
        if (invoice && (invoice.payment?.status === "complete" || deliveryState(invoice) === "delivered")) {
          await this.deps.swaps.setStatus(swap.id, "credited");
          this.deps.activity.record({ event: "swap.credited", circleId: swap.circleId, fields: { swap: swap.id, bitrefill_invoice: swap.bitrefillInvoiceId, usd: USDC_AMOUNT } });
          return "credited";
        }
      }
      const slow = Date.now() - Date.parse(swap.updatedAt || swap.createdAt) > SWAP_PURCHASE_WAIT_MINUTES * 60_000;
      await this.wait(slow ? SWAP_SLOW_POLL_INTERVAL_MS : SWAP_POLL_INTERVAL_MS);
    }
    this.deps.activity.record({ event: "swap.timeout", level: "warn", circleId: swap.circleId, fields: { swap: swap.id, last_status: last } });
    return "timeout";
  }

  // ---------------------------------------------------------------- checks (all must pass before any ZEC moves)

  private checkInvoice(invoice: StoreCreditInvoice): void {
    const item = invoice.cart_items[0];
    const pay = invoice.payment_info;
    const problems: string[] = [];
    if (invoice.cart_items.length !== 1 || item?.id !== STORE_CREDIT_PRODUCT_ID) problems.push("wrong product");
    if (Number(item?.value) * 100 !== SWAP_USD_MINOR) problems.push(`wrong amount ${item?.value}`);
    if (pay.altBasePrice !== USDC_BASE_UNITS) problems.push(`wrong USDC amount ${pay.altBasePrice}`);
    if (pay.contractAddress.toLowerCase() !== USDC_BASE_CONTRACT) problems.push("not USDC");
    if (!pay.paymentUri.includes(`@${BASE_CHAIN_ID}/`)) problems.push("not on Base");
    if (!/^0x[0-9a-fA-F]{40}$/.test(pay.address)) problems.push("bad pay-to address");
    if ((invoice.expiration_minutes ?? 0) < MIN_INVOICE_MINUTES_LEFT) problems.push("invoice expires too soon");
    if (problems.length) throw new SettlementFailed(`Bitrefill's store-credit invoice failed the safety checks (${problems.join(", ")}). No ZEC was sent.`);
  }

  private quoteRequest(payTo: string, refundTo: string): QuoteRequest {
    return {
      dry: true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: SWAP_SLIPPAGE_BPS,
      originAsset: ONE_CLICK_ZEC,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: ONE_CLICK_USDC_BASE,
      amount: String(USDC_BASE_UNITS),
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: payTo,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + SWAP_DEADLINE_MINUTES * 60_000).toISOString(),
    };
  }

  private checkQuote(res: QuoteResponse, req: QuoteRequest, reservedZat: number, real: boolean): void {
    const q = res.quote;
    const amountIn = Number(q.amountIn);
    const maxUsd = (SWAP_USD_MINOR * (100 + MAX_SWAP_OVERHEAD_PERCENT)) / 100 / 100;
    const problems: string[] = [];
    if (q.amountOut !== String(USDC_BASE_UNITS)) problems.push(`delivers ${q.amountOutFormatted} USDC, not ${USDC_AMOUNT}`);
    if (!Number.isSafeInteger(amountIn) || amountIn <= 0) problems.push("bad input amount");
    if (amountIn > MAX_ZEC_PER_SWAP_ZAT) problems.push(`needs ${q.amountInFormatted} ZEC, above the ${zatToZecString(MAX_ZEC_PER_SWAP_ZAT)} ZEC limit`);
    if (amountIn > reservedZat) problems.push(`needs more ZEC than was reserved for this purchase`);
    if (Number(q.amountInUsd) > maxUsd) problems.push(`costs $${Number(q.amountInUsd).toFixed(2)}, above the $${maxUsd.toFixed(2)} limit`);
    const echoed = res.quoteRequest as Record<string, unknown> | undefined;
    if (echoed && (echoed.recipient !== req.recipient || echoed.destinationAsset !== req.destinationAsset || echoed.refundTo !== req.refundTo)) {
      problems.push("1Click echoed a different recipient, asset or refund address");
    }
    if (real) {
      if (!q.depositAddress || !/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(q.depositAddress)) problems.push("deposit address is not a mainnet Zcash transparent address");
      if (q.depositMemo) problems.push("deposit needs a memo, which is not supported");
      if (!q.deadline || Date.parse(q.deadline) < Date.now() + 15 * 60_000) problems.push("quote deadline too short");
    }
    if (problems.length) throw new SettlementFailed(`The swap quote failed the safety checks (${problems.join("; ")}). No ZEC was sent.`);
  }

  /** Enforces the hard limit on the number of swaps and records the attempt, atomically. */
  private async reserveSwapSlot(purchase: Purchase, invoice: StoreCreditInvoice): Promise<ZecSwap> {
    return this.deps.db.transaction(async () => {
      await this.deps.db.lockLiveSpend();
      const used = await this.deps.swaps.countCommitted();
      if (used >= MAX_SWAPS_TOTAL) {
        throw new SettlementFailed(`The mainnet test limit of ${MAX_SWAPS_TOTAL} swaps has been reached. No ZEC was sent.`);
      }
      return this.deps.swaps.create({
        purchaseId: purchase.id,
        circleId: purchase.circleId,
        bitrefillInvoiceId: invoice.invoice_id,
        payToAddress: invoice.payment_info.address,
        usdcBaseUnits: USDC_BASE_UNITS,
      });
    });
  }

  private log(event: string, purchase: Purchase, fields: Record<string, unknown>, level: "info" | "warn" = "info"): void {
    this.deps.activity.record({ event, level, circleId: purchase.circleId, fields: { purchase: purchase.id, ...fields } });
    this.deps.logger[level]({ event, purchaseId: purchase.id, ...fields }, "swap");
  }
}
