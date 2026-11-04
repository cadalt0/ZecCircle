import type { Purchase } from "../../domain/types.js";
import { fiatMinorToZat } from "../../integrations/zcash/units.js";
import type { ZcashWallet } from "../../integrations/zcash/wallet.js";
import type { ZecPayment } from "../../repositories/zec.repository.js";
import type { Settlement } from "./funding-rail.js";
import type { PriceSource } from "./price-source.js";

export interface SettlementContext {
  purchase: Purchase;
  /** The reservation for this purchase (status "sending" while executing). */
  payment: ZecPayment;
  /** Tell the member what is happening during long steps. */
  progress(message: string): Promise<void>;
}

export interface SettlementResult {
  txid: string;
  amountZat: number;
  toAddress: string;
  swap?: Settlement["swap"];
}

/**
 * A settlement failed. `moneyMoved` says whether ZEC already left the wallet: if it did, the
 * payment must be recorded as sent (the circle's balance must not get that ZEC back by mistake).
 */
export class SettlementFailed extends Error {
  override name = "SettlementFailed";
  constructor(
    message: string,
    readonly moneyMoved: { txid: string; amountZat: number; toAddress: string } | null = null,
  ) {
    super(message);
  }
}

/** How a reserved purchase payment is turned into an on-chain payment. */
export interface SettlementStrategy {
  /** Recorded on receipts, e.g. "zcash-testnet" or "zec-usdc-swap". */
  readonly method: string;
  /** Where the reservation says the money goes (the real address may only be known later). */
  readonly reservationAddress: string;
  /** ZEC to set aside for this purchase. For swaps it is an upper bound; the real amount is recorded later. */
  estimateZat(purchase: Purchase): Promise<number>;
  execute(ctx: SettlementContext): Promise<SettlementResult>;
  /** Resume anything that was in flight when the bot stopped. */
  resume?(): Promise<void>;
}

/**
 * Testnet / mock: pays the purchase's ZEC equivalent to a fixed settlement address. It proves the
 * shielded payment works; real fulfilment money comes from the Bitrefill balance.
 */
export class SinkSettlement implements SettlementStrategy {
  readonly method: string;
  readonly reservationAddress: string;

  constructor(
    private readonly wallet: ZcashWallet,
    settlementAddress: string,
    private readonly price: PriceSource,
  ) {
    this.method = `zcash-${wallet.network === "mock" ? "mock" : "testnet"}`;
    this.reservationAddress = settlementAddress;
  }

  async estimateZat(purchase: Purchase): Promise<number> {
    return fiatMinorToZat(purchase.quotedMinor, await this.price.getPriceMinorPerZec());
  }

  async execute({ purchase, payment }: SettlementContext): Promise<SettlementResult> {
    await this.wallet.sync();
    const txid = await this.wallet.send(payment.toAddress, payment.amountZat, `ZecCircle purchase #${purchase.id}`);
    return { txid, amountZat: payment.amountZat, toAddress: payment.toAddress };
  }
}
