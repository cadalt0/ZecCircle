import { randomBytes } from "node:crypto";
import type { IncomingNote, ZcashWallet } from "./wallet.js";

/**
 * TEST MODE ONLY. In-memory stand-in for the Zcash wallet, so funding and payment flows can be
 * exercised without a synced wallet. Deposits are injected with `simulateDeposit`; every txid
 * starts with "mock" so it can never be mistaken for a real transaction.
 */
export class MockZcashWallet implements ZcashWallet {
  readonly network = "mock" as const;
  private height = 1_000;
  private readonly incoming: IncomingNote[] = [];
  readonly sent: Array<{ address: string; valueZat: number; memo: string | null; txid: string }> = [];

  async getTransparentAddress(): Promise<string> {
    return "t1MockRefundAddressxxxxxxxxxxxxxxxx";
  }

  async getAddress(): Promise<string> {
    return "utest1mockaddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  }

  async newAddress(): Promise<string> {
    return `utest1mock${randomBytes(24).toString("hex")}`;
  }

  /** Each sync "mines" a block, confirming anything waiting in the mempool. */
  async sync(): Promise<void> {
    this.height += 1;
    for (const note of this.incoming) {
      if (note.minedHeight === null) note.minedHeight = this.height;
    }
  }

  async listIncoming(): Promise<IncomingNote[]> {
    return this.incoming.map((n) => ({ ...n }));
  }

  async getChainHeight(): Promise<number | null> {
    return this.height;
  }

  async send(address: string, valueZat: number, memo: string | null, _options?: unknown): Promise<string> {
    const txid = `mock${randomBytes(30).toString("hex")}`;
    this.sent.push({ address, valueZat, memo, txid });
    return txid;
  }

  /** Simulates someone paying one of the wallet's addresses. It appears unmined until the next sync. */
  simulateDeposit(valueZat: number, memo: string | null, toAddress: string | null = null): string {
    const txid = `mock${randomBytes(30).toString("hex")}`;
    this.incoming.push({ txid, outputPool: 3, outputIndex: 0, valueZat, toAddress, memo, minedHeight: null });
    return txid;
  }
}
