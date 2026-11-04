import type { Circle, Purchase } from "../../domain/types.js";
import type { ZcashNetwork } from "../../integrations/zcash/wallet.js";

/** Proof that a purchase was paid on-chain. */
export interface Settlement {
  /** "zcash-testnet" / "zcash-mock": sent to a test address. "zec-usdc-swap": real mainnet swap. */
  method: string;
  network: ZcashNetwork;
  amountZat: number;
  txid: string;
  toAddress: string;
  /** Mainnet swaps only: what the ZEC became. */
  swap?: {
    usdcAmount: string;
    bitrefillTopUpInvoiceId: string;
    status: string;
  };
}

export type ReserveResult = { ok: true } | { ok: false; reason: string };

export interface FundingBalance {
  availableZat: number;
  pendingZat: number;
  /** Value of availableZat in the circle currency (minor units), at the configured price. */
  availableFiatMinor: number;
}

/**
 * How a purchase is paid for, separate from Bitrefill fulfilment.
 *
 * Lifecycle per purchase: reserve (inside the same DB transaction that approves the purchase, while
 * the circle lock is held) -> settle (send the money) -> or release (purchase failed before money moved).
 */
export interface FundingRail {
  readonly enabled: boolean;
  /** Earmarks funds for the purchase or says why it can't be paid. Call inside a transaction holding the circle lock. */
  reserve(purchase: Purchase, circle: Circle): Promise<ReserveResult>;
  /** Moves the money. Idempotent: returns the existing settlement if already sent. */
  settle(purchaseId: number, progress?: (message: string) => Promise<void>): Promise<Settlement | null>;
  /** Frees a reservation that was never sent. No-op if money already moved. */
  release(purchaseId: number, reason: string): Promise<void>;
  getSettlement(purchaseId: number): Promise<Settlement | null>;
  getBalance(circleId: number): Promise<FundingBalance | null>;
}

/** Used when Zcash funding is off: purchases are paid from the Bitrefill balance only. */
export class NoFundingRail implements FundingRail {
  readonly enabled = false;
  async reserve(): Promise<ReserveResult> {
    return { ok: true };
  }
  async settle(): Promise<Settlement | null> {
    return null;
  }
  async release(): Promise<void> {}
  async getSettlement(): Promise<Settlement | null> {
    return null;
  }
  async getBalance(): Promise<FundingBalance | null> {
    return null;
  }
}
