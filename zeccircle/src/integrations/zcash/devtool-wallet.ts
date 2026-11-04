import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { Logger } from "../../lib/logger.js";
import { isShieldedAddress } from "./zip321.js";
import type { IncomingNote, SendOptions, ZcashNetwork, ZcashWallet } from "./wallet.js";

const execFileAsync = promisify(execFile);

export interface DevtoolWalletOptions {
  /** "test" (default) or "main". Must match how the wallet was created. */
  network?: Exclude<ZcashNetwork, "mock">;
  /** Path to the zcash-devtool binary. */
  binary: string;
  /** Wallet directory created with `zcash-devtool wallet -w <dir> init ... -n test`. */
  walletDir: string;
  /** age identity file that decrypts the wallet's mnemonic (needed to send). */
  identityFile: string;
  /** Light-wallet server: "zecrocks" (testnet.zec.rocks) or host:port. */
  server: string;
  /** "direct", "tor" or "socks5://host:port" (e.g. a Nym SOCKS5 proxy). */
  connection: string;
  /**
   * Confirmations required before received notes can be spent. At 10 or more the wallet's default
   * policy (3 for its own change, 10 for deposits) is used. Below 10 it is lowered for faster demos.
   */
  minConfirmations?: number;
  logger: Logger;
}

/**
 * Testnet wallet backed by zcash-devtool (https://github.com/zcash/zcash-devtool).
 *
 * - Commands (sync, send, list-addresses) run the binary with an argument array (no shell).
 * - Received notes are read straight from the wallet's SQLite database through
 *   zcash_client_sqlite's public views (v_transactions / v_tx_outputs), opened read-only.
 * - All commands are serialized: the tool's database does not tolerate concurrent writers.
 *
 * zcash-devtool is explicitly a prototyping tool, not for production. Fine for testnet.
 */
export class DevtoolWallet implements ZcashWallet {
  readonly network: Exclude<ZcashNetwork, "mock">;
  private queue: Promise<unknown> = Promise.resolve();
  private address: string | null = null;

  constructor(private readonly options: DevtoolWalletOptions) {
    this.network = options.network ?? "test";
  }

  /** Checks the binary and wallet exist; call once at startup for a readable error. */
  assertReady(): void {
    if (!existsSync(this.options.binary)) {
      throw new Error(`zcash-devtool not found at ${this.options.binary}. Build it first (see scripts/zcash-setup.sh).`);
    }
    if (!existsSync(this.dbPath)) {
      throw new Error(`No Zcash wallet in ${this.options.walletDir}. Create it first (see scripts/zcash-setup.sh).`);
    }
    if (!existsSync(this.options.identityFile)) {
      throw new Error(`Wallet identity file not found at ${this.options.identityFile}.`);
    }
  }

  /** The wallet's own transparent address: where 1Click sends refunds of a failed mainnet swap. */
  async getTransparentAddress(): Promise<string> {
    const out = await this.run(["list-addresses", "--receiver", "transparent"], 60_000);
    const address = /Receiver\(transparent\):\s*(t[13][1-9A-HJ-NP-Za-km-z]{33})/.exec(out)?.[1];
    if (!address) throw new Error("Could not read the wallet's transparent address");
    return address;
  }

  async getAddress(): Promise<string> {
    if (this.address) return this.address;
    const out = await this.run(["list-addresses"], 60_000);
    const match = /Default Address:\s*(\S+)/.exec(out);
    if (!match?.[1]) throw new Error("Could not read the wallet address from zcash-devtool output");
    this.address = match[1];
    return this.address;
  }

  async newAddress(): Promise<string> {
    // No --pool flags: the address carries a receiver for each shielded pool the account supports
    // and never a transparent one.
    const out = await this.run(["generate-address"], 60_000);
    const address = /^\s*Address:\s*(\S+)/m.exec(out)?.[1];
    if (!address) throw new Error("Could not read the new address from zcash-devtool output");
    if (!isShieldedAddress(address)) throw new Error("zcash-devtool returned a non-shielded address; refusing to use it");
    return address;
  }

  async sync(): Promise<void> {
    await this.run(["sync", ...this.connectionArgs()], 10 * 60_000);
  }

  async send(address: string, valueZat: number, memo: string | null, options: SendOptions = {}): Promise<string> {
    if (!Number.isSafeInteger(valueZat) || valueZat <= 0) throw new Error(`Invalid amount: ${valueZat}`);
    // Payments are shielded-only. The single exception is the mainnet swap paying a 1Click deposit
    // address, which is transparent by design; it must ask for it explicitly.
    if (!isShieldedAddress(address)) {
      if (!(options.allowTransparent && this.network === "main")) {
        throw new Error("Refusing to send to a transparent address: only shielded payments are allowed.");
      }
      if (memo) throw new Error("Transparent addresses cannot receive memos.");
    }
    const args = ["send", "-i", this.options.identityFile, "--address", address, "--value", String(valueZat)];
    if (memo) args.push("--memo", memo);
    args.push(...this.connectionArgs());
    const { minConfirmations } = this.options;
    if (minConfirmations !== undefined && minConfirmations < 10) args.push("--min-confirmations", String(minConfirmations));

    const out = await this.run(args, 5 * 60_000);
    const txid = out.match(/^[0-9a-f]{64}$/m)?.[0];
    if (!txid) throw new Error(`zcash-devtool did not report a txid. Output: ${out.slice(-300)}`);
    return txid;
  }

  async listIncoming(): Promise<IncomingNote[]> {
    return this.withReadOnlyDb((db) => {
      const rows = db
        .prepare(
          `SELECT o.txid AS txid, o.output_pool AS output_pool, o.output_index AS output_index,
                  o.value AS value, o.to_address AS to_address, o.memo AS memo, t.mined_height AS mined_height
           FROM v_tx_outputs o
           JOIN v_transactions t ON t.txid = o.txid AND t.account_uuid = o.to_account_uuid
           WHERE o.to_account_uuid IS NOT NULL
             AND o.from_account_uuid IS NULL
             AND o.is_change = 0`,
        )
        .all() as Array<{
        txid: Uint8Array;
        output_pool: number;
        output_index: number;
        value: number;
        to_address: string | null;
        memo: Uint8Array | null;
        mined_height: number | null;
      }>;

      return rows.map((r) => ({
        txid: Buffer.from(r.txid).reverse().toString("hex"),
        outputPool: Number(r.output_pool),
        outputIndex: Number(r.output_index),
        valueZat: Number(r.value),
        toAddress: r.to_address,
        memo: decodeMemo(r.memo),
        minedHeight: r.mined_height === null ? null : Number(r.mined_height),
      }));
    });
  }

  async getChainHeight(): Promise<number | null> {
    return this.withReadOnlyDb((db) => {
      const row = db.prepare("SELECT MAX(height) AS h FROM blocks").get() as { h: number | null } | undefined;
      return row?.h ?? null;
    });
  }

  // ---------------------------------------------------------------- internals

  private get dbPath(): string {
    return join(this.options.walletDir, "data.sqlite");
  }

  private connectionArgs(): string[] {
    return ["-s", this.options.server, "--connection", this.options.connection];
  }

  private withReadOnlyDb<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  /** Runs `zcash-devtool wallet -w <dir> <args...>`, one command at a time. */
  private run(args: string[], timeoutMs: number): Promise<string> {
    const task = this.queue.then(async () => {
      const started = Date.now();
      const command = args[0];
      try {
        const { stdout } = await execFileAsync(this.options.binary, ["wallet", "-w", this.options.walletDir, ...args], {
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "warn" },
        });
        this.options.logger.debug({ command, ms: Date.now() - started }, "zcash-devtool ok");
        return stdout;
      } catch (error) {
        const e = error as { stderr?: string; message: string };
        // Never log full args: they contain the identity file path, but never secrets themselves.
        this.options.logger.warn({ command, ms: Date.now() - started, stderr: e.stderr?.slice(-500) }, "zcash-devtool failed");
        throw new Error(`zcash-devtool ${command} failed: ${(e.stderr ?? e.message).trim().split("\n").slice(-1)[0]}`);
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}

/**
 * Decodes a 512-byte Zcash memo (ZIP-302): a first byte <= 0xF4 means UTF-8 text padded with zeros;
 * 0xF6 means "no memo"; anything else is binary we ignore.
 */
export function decodeMemo(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  const first = bytes[0]!;
  if (first > 0xf4) return null;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const text = Buffer.from(bytes.subarray(0, end)).toString("utf8").trim();
  return text || null;
}
