/** "main" = real ZEC, "test" = testnet TAZ, "mock" = simulated in memory. */
export type ZcashNetwork = "main" | "test" | "mock";

export interface SendOptions {
  /**
   * Allow a transparent (t-address) recipient. Only the mainnet swap uses this, to pay a 1Click
   * deposit address; every other payment must stay shielded.
   */
  allowTransparent?: boolean;
}

/** A shielded output received by the bot's wallet. */
export interface IncomingNote {
  /** Display-order transaction id (as shown by explorers). */
  txid: string;
  /** Pool code + output index uniquely identify the output within the transaction. */
  outputPool: number;
  outputIndex: number;
  valueZat: number;
  /** The wallet address that received it, when the wallet knows it (always, for addresses it generated). */
  toAddress: string | null;
  /** Text memo, if the sender attached one. */
  memo: string | null;
  /** Block height it was mined at; null while only in the mempool. */
  minedHeight: number | null;
}

/**
 * The bot's Zcash wallet. Implemented by a zcash-devtool-backed testnet wallet and by an
 * in-memory mock for testing. Keys never leave the implementation.
 */
export interface ZcashWallet {
  readonly network: ZcashNetwork;
  /** The wallet's default unified address (receives shielded funds). */
  getAddress(): Promise<string>;
  /** Generates a fresh shielded-only unified address controlled by this wallet (no transparent receiver). */
  newAddress(): Promise<string>;
  /** Fetches new blocks from the light-wallet server and scans them. */
  sync(): Promise<void>;
  /** All external (non-change) outputs received by the wallet. */
  listIncoming(): Promise<IncomingNote[]>;
  /** Height of the latest scanned block, or null before the first sync. */
  getChainHeight(): Promise<number | null>;
  /** Sends `valueZat` to `address`; returns the txid once broadcast. */
  send(address: string, valueZat: number, memo: string | null, options?: SendOptions): Promise<string>;
}
