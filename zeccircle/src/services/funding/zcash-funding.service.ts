import { randomInt } from "node:crypto";
import type { Circle, Purchase } from "../../domain/types.js";
import { buildPaymentUri } from "../../integrations/zcash/zip321.js";
import { fiatMinorToZat, zatToFiatMinor, zatToZecString } from "../../integrations/zcash/units.js";
import type { IncomingNote, ZcashNetwork, ZcashWallet } from "../../integrations/zcash/wallet.js";
import type { Logger } from "../../lib/logger.js";
import { sleep } from "../../lib/time.js";
import type { AuditRepository } from "../../repositories/audit.repository.js";
import type { CircleRepository } from "../../repositories/circle.repository.js";
import type { MemberRepository } from "../../repositories/member.repository.js";
import type { ZecDeposit, ZecRepository } from "../../repositories/zec.repository.js";
import type { CircleService } from "../circle.service.js";
import type { Notifier } from "../notifier.js";
import type { PurchaseRepository } from "../../repositories/purchase.repository.js";
import type { SwapRepository } from "../../repositories/swap.repository.js";
import { noActivityLog, type ActivityLog } from "../activity/activity-log.js";
import type { FundingBalance, FundingRail, ReserveResult, Settlement } from "./funding-rail.js";
import type { PriceSource } from "./price-source.js";
import { SettlementFailed, type SettlementStrategy } from "./settlement.js";

export interface ZcashFundingSettings {
  minConfirmations: number;
  syncIntervalMs: number;
}

export interface ZcashFundingDeps {
  wallet: ZcashWallet;
  zec: ZecRepository;
  circles: CircleRepository;
  members: MemberRepository;
  audit: AuditRepository;
  purchases: PurchaseRepository;
  /** Mainnet only: lets receipts show what the ZEC was swapped into. */
  swaps?: SwapRepository;
  circleService: CircleService;
  notifier: Notifier;
  /** Fixed test rate on testnet, live 1Click price on mainnet. */
  price: PriceSource;
  /** Testnet: pay a settlement address. Mainnet: swap ZEC -> USDC -> Bitrefill store credit. */
  settlement: SettlementStrategy;
  activity?: ActivityLog;
  logger: Logger;
  settings: ZcashFundingSettings;
}

export interface FundingInstructions {
  circle: Circle;
  address: string;
  memo: string;
  uri: string;
  amountZat: number | null;
  balance: FundingBalance;
}

const MEMO_PREFIX = "ZecCircle";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L: easy to read aloud
const CODE_PATTERN = /\b([A-HJ-NP-Z2-9]{8})\b/;

/**
 * Funds circles with shielded ZEC and pays for purchases from those funds.
 *
 * In:  /fund gives a ZIP-321 link to the bot's unified address with "ZecCircle <code>" as memo.
 *      A watcher syncs the wallet, matches memos to circles, and credits deposits once confirmed.
 * Out: when a purchase is approved its ZEC cost is reserved; before Bitrefill is paid, the settlement
 *      strategy moves it (testnet: to a settlement address; mainnet: a swap into Bitrefill store credit).
 *
 * The bot holds one wallet for all circles (custodial); per-circle balances are accounting.
 */
export class ZcashFundingService implements FundingRail {
  readonly enabled = true;
  private running = false;
  private loop: Promise<void> | null = null;
  private readonly addressLocks = new Map<number, Promise<string>>();

  private readonly activity: ActivityLog;

  constructor(private readonly deps: ZcashFundingDeps) {
    this.activity = deps.activity ?? noActivityLog;
  }

  get network(): ZcashNetwork {
    return this.deps.wallet.network;
  }

  // ---------------------------------------------------------------- funding (in)

  async createFundingRequest(telegramId: number, amountZat: number | null): Promise<FundingInstructions> {
    const { circle } = await this.deps.circleService.requireActiveMembership(telegramId);
    const code = await this.newCode();
    await this.deps.zec.createFundingRequest(code, circle.id, telegramId);

    // Each circle has its own shielded address, so deposits are matched by the address they arrive at.
    // The memo is a backup for wallets/senders that pay the main address instead.
    const address = await this.getCircleAddress(circle.id);
    const memo = `${MEMO_PREFIX} ${code}`;
    return {
      circle,
      address,
      memo,
      uri: buildPaymentUri({ address, amountZat: amountZat ?? undefined, memo }),
      amountZat,
      balance: await this.getBalance(circle.id),
    };
  }

  /** The circle's own shielded deposit address, created on first use. */
  getCircleAddress(circleId: number): Promise<string> {
    const pending = this.addressLocks.get(circleId);
    if (pending) return pending;
    const task = (async () => {
      const existing = await this.deps.zec.findCircleAddress(circleId);
      if (existing) return existing;
      return this.deps.zec.saveCircleAddress(circleId, await this.deps.wallet.newAddress());
    })().finally(() => this.addressLocks.delete(circleId));
    this.addressLocks.set(circleId, task);
    return task;
  }

  async getBalance(circleId: number): Promise<FundingBalance> {
    const [confirmed, committed, pendingZat] = await Promise.all([
      this.deps.zec.confirmedDepositsZat(circleId),
      this.deps.zec.committedPaymentsZat(circleId),
      this.deps.zec.pendingDepositsZat(circleId),
    ]);
    const availableZat = Math.max(0, confirmed - committed);
    let priceMinorPerZec = 0;
    try {
      priceMinorPerZec = await this.deps.price.getPriceMinorPerZec();
    } catch (error) {
      this.deps.logger.warn({ err: error }, "ZEC price unavailable; showing the balance without a dollar value");
    }
    return { availableZat, pendingZat, availableFiatMinor: zatToFiatMinor(availableZat, priceMinorPerZec) };
  }

  recentDeposits(circleId: number, limit = 5): Promise<ZecDeposit[]> {
    return this.deps.zec.listDepositsByCircle(circleId, limit);
  }

  // ---------------------------------------------------------------- watcher

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.watch();
    void this.deps.settlement.resume?.().catch((error) => this.deps.logger.error({ err: error }, "could not resume in-flight settlements"));
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async watch(): Promise<void> {
    let failures = 0;
    while (this.running) {
      try {
        await this.tick();
        failures = 0;
      } catch (error) {
        failures++;
        this.deps.logger.warn({ err: error, failures }, "zcash sync failed");
      }
      // Back off up to 5 minutes while the server or wallet is unhappy.
      const delay = Math.min(this.deps.settings.syncIntervalMs * 2 ** Math.min(failures, 4), 5 * 60_000);
      for (let waited = 0; this.running && waited < delay; waited += 500) await sleep(500);
    }
  }

  /** One sync + reconcile pass. Public for tests. */
  async tick(): Promise<void> {
    await this.deps.wallet.sync();
    const [notes, tip] = await Promise.all([this.deps.wallet.listIncoming(), this.deps.wallet.getChainHeight()]);
    await this.recordNewDeposits(notes);
    await this.confirmDeposits(notes, tip);
  }

  private async recordNewDeposits(notes: IncomingNote[]): Promise<void> {
    for (const note of notes) {
      // 1) By address: the circle's own deposit address. 2) Fallback: the memo code from /fund.
      const circleByAddress = note.toAddress ? await this.deps.zec.findCircleByAddress(note.toAddress) : null;
      const code = note.memo ? CODE_PATTERN.exec(note.memo.toUpperCase())?.[1] ?? null : null;
      const request = code ? await this.deps.zec.findFundingRequest(code) : null;
      const circleId = circleByAddress ?? request?.circleId ?? null;

      const deposit = await this.deps.zec.insertDeposit({
        txid: note.txid,
        outputPool: note.outputPool,
        outputIndex: note.outputIndex,
        amountZat: note.valueZat,
        memo: note.memo,
        fundingCode: request?.code ?? null,
        circleId,
        minedHeight: note.minedHeight,
      });
      if (!deposit) continue; // already known

      const circle = circleId === null ? null : await this.deps.circles.findById(circleId);
      if (!circle) {
        this.deps.logger.warn({ txid: note.txid, zat: note.valueZat }, "deposit matches no circle (unknown address and no valid memo); not credited");
        continue;
      }
      this.deps.logger.info({ circleId: circle.id, txid: note.txid, zat: note.valueZat, matchedBy: circleByAddress ? "address" : "memo" }, "deposit seen");
      await this.deps.notifier.notify({
        type: "deposit_seen",
        circle,
        requesterTelegramId: request && request.circleId === circle.id ? request.requestedByTelegramId : null,
        amountZat: deposit.amountZat,
        txid: deposit.txid,
        network: this.network,
      });
    }
  }

  private async confirmDeposits(notes: IncomingNote[], tip: number | null): Promise<void> {
    const byKey = new Map(notes.map((n) => [`${n.txid}:${n.outputPool}:${n.outputIndex}`, n]));
    for (const deposit of await this.deps.zec.listSeenDeposits()) {
      const note = byKey.get(`${deposit.txid}:${deposit.outputPool}:${deposit.outputIndex}`);
      if (!note) continue;
      if (note.minedHeight !== deposit.minedHeight) await this.deps.zec.updateDepositHeight(deposit.id, note.minedHeight);
      if (note.minedHeight === null || tip === null) continue;

      const confirmations = tip - note.minedHeight + 1;
      if (confirmations < this.deps.settings.minConfirmations) continue;
      if (!(await this.deps.zec.confirmDeposit(deposit.id))) continue;
      if (deposit.circleId === null) continue;

      const circle = await this.deps.circles.findById(deposit.circleId);
      if (!circle) continue;
      const request = deposit.fundingCode ? await this.deps.zec.findFundingRequest(deposit.fundingCode) : null;
      await this.deps.audit.record({
        circleId: circle.id,
        actorTelegramId: null,
        action: "zec.deposit_confirmed",
        details: { txid: deposit.txid, amountZat: deposit.amountZat },
      });
      this.deps.logger.info({ circleId: circle.id, txid: deposit.txid, zat: deposit.amountZat }, "deposit confirmed");
      await this.deps.notifier.notify({
        type: "deposit_confirmed",
        circle,
        requesterTelegramId: request?.requestedByTelegramId ?? null,
        amountZat: deposit.amountZat,
        txid: deposit.txid,
        network: this.network,
        balance: await this.getBalance(circle.id),
      });
    }
  }

  // ---------------------------------------------------------------- paying (out)

  async reserve(purchase: Purchase, circle: Circle): Promise<ReserveResult> {
    const existing = await this.deps.zec.findPaymentByPurchase(purchase.id);
    if (existing && existing.status !== "released" && existing.status !== "failed") return { ok: true };

    const priceMinorPerZec = await this.deps.price.getPriceMinorPerZec();
    const amountZat = await this.deps.settlement.estimateZat(purchase);
    const balance = await this.getBalance(circle.id);
    if (balance.availableZat < amountZat) {
      return {
        ok: false,
        reason:
          `The circle wallet has ${zatToZecString(balance.availableZat)} ZEC but this needs ${zatToZecString(amountZat)} ZEC. ` +
          `Anyone in the circle can top it up with /fund.`,
      };
    }
    if (existing) {
      // A previous attempt was released; re-reserve by reusing the row would break UNIQUE, so refuse.
      return { ok: false, reason: "This purchase already had a payment attempt. Please ask again." };
    }
    await this.deps.zec.createPayment({
      purchaseId: purchase.id,
      circleId: circle.id,
      amountZat,
      priceMinorPerZec,
      toAddress: this.deps.settlement.reservationAddress,
    });
    return { ok: true };
  }

  async settle(purchaseId: number, progress: (message: string) => Promise<void> = async () => undefined): Promise<Settlement | null> {
    const payment = await this.deps.zec.findPaymentByPurchase(purchaseId);
    if (!payment) throw new Error("No ZEC reservation for this purchase.");
    if (payment.status === "sent") return this.getSettlement(purchaseId);
    const purchase = await this.deps.purchases.findById(purchaseId);
    if (!purchase) throw new Error("Purchase not found.");
    if (!(await this.deps.zec.transitionPayment(payment.id, ["reserved"], "sending"))) {
      throw new Error(`ZEC payment is ${payment.status}; not sending again.`);
    }
    this.activity.record({
      event: "zec.payment_started",
      circleId: payment.circleId,
      fields: { purchase: purchaseId, method: this.deps.settlement.method, reserved_zec: zatToZecString(payment.amountZat), network: this.network },
    });

    try {
      const result = await this.deps.settlement.execute({ purchase, payment: { ...payment, status: "sending" }, progress });
      await this.deps.zec.completePayment(payment.id, result);
      await this.deps.audit.record({
        circleId: payment.circleId,
        actorTelegramId: null,
        action: "zec.payment_sent",
        details: { purchaseId, txid: result.txid, amountZat: result.amountZat, to: result.toAddress, method: this.deps.settlement.method },
      });
      this.deps.logger.info({ purchaseId, txid: result.txid, zat: result.amountZat }, "zec payment sent");
      return { ...this.toSettlement(result.amountZat, result.txid, result.toAddress), ...(result.swap ? { swap: result.swap } : {}) };
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof SettlementFailed && error.moneyMoved) {
        // ZEC left the wallet: record it as spent so the circle's balance stays truthful.
        await this.deps.zec.completePayment(payment.id, error.moneyMoved);
        this.activity.record({ event: "zec.payment_moved_but_failed", level: "error", circleId: payment.circleId, fields: { purchase: purchaseId, txid: error.moneyMoved.txid, reason: message } });
        throw new Error(message);
      }
      await this.deps.zec.transitionPayment(payment.id, ["sending"], "failed", { error: message.slice(0, 500) });
      this.deps.logger.warn({ purchaseId, error: message }, "zec payment failed");
      this.activity.record({ event: "zec.payment_failed", level: "warn", circleId: payment.circleId, fields: { purchase: purchaseId, reason: message } });
      // The wallet has the money but is still waiting for confirmations before it will spend it.
      if (/insufficient balance/i.test(message)) {
        throw new Error(
          `The circle's ZEC has arrived but is not spendable yet: the wallet waits for about 10 confirmations (${this.network === "main" ? "roughly 12 minutes on mainnet" : "roughly 4 minutes on testnet"}). Nothing was charged. Please try again in a few minutes.`,
        );
      }
      if (error instanceof SettlementFailed) throw new Error(message);
      throw new Error(`Zcash payment failed: ${message}`);
    }
  }

  async release(purchaseId: number, reason: string): Promise<void> {
    const payment = await this.deps.zec.findPaymentByPurchase(purchaseId);
    if (payment && (await this.deps.zec.transitionPayment(payment.id, ["reserved"], "released", { error: reason.slice(0, 500) }))) {
      this.deps.logger.info({ purchaseId }, "zec reservation released");
    }
  }

  async getSettlement(purchaseId: number): Promise<Settlement | null> {
    const p = await this.deps.zec.findPaymentByPurchase(purchaseId);
    if (!(p?.status === "sent" && p.txid)) return null;
    const settlement = this.toSettlement(p.amountZat, p.txid, p.toAddress);
    const swap = await this.deps.swaps?.findByPurchase(purchaseId);
    if (swap) {
      settlement.swap = { usdcAmount: (swap.usdcBaseUnits / 1e6).toFixed(2), bitrefillTopUpInvoiceId: swap.bitrefillInvoiceId, status: swap.status };
    }
    return settlement;
  }

  // ---------------------------------------------------------------- helpers

  private toSettlement(amountZat: number, txid: string, toAddress: string): Settlement {
    return { method: this.deps.settlement.method, network: this.network, amountZat, txid, toAddress };
  }

  private async newCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = "";
      for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!(await this.deps.zec.findFundingRequest(code))) return code;
    }
    throw new Error("Could not generate a unique funding code");
  }
}
