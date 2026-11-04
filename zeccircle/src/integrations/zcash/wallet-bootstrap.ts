import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../lib/logger.js";
import type { WalletSeedRepository } from "../../repositories/wallet-seed.repository.js";

export interface WalletBootstrapOptions {
  /** "test" or "main"; the seed is stored per network. */
  network: "test" | "main";
  binary: string;
  walletDir: string;
  identityFile: string;
  server: string;
  connection: string;
  seeds: WalletSeedRepository;
  logger: Logger;
}

export type BootstrapResult = "existing" | "created" | "restored";

const ACCOUNT_NAME = "zeccircle-bot";

/**
 * Makes sure a usable testnet wallet exists on disk before the bot starts.
 *
 * - Wallet folder present: use it (and, if the database has no seed yet, save the wallet's seed).
 * - Folder missing but a seed is in the database (a fresh Heroku dyno): rebuild it with
 *   `restore-mnemonic` from the stored seed and birth height; the chain is re-scanned from there.
 * - Neither: create a new wallet and save its seed.
 *
 * The seed phrase is stored in plain text in the database (the owner's explicit choice for this
 * hackathon). On mainnet that means anyone with database access can spend the bot's ZEC: keep only
 * small amounts in it.
 */
export async function ensureDevtoolWallet(o: WalletBootstrapOptions): Promise<BootstrapResult> {
  if (!existsSync(o.binary)) {
    throw new Error(`zcash-devtool not found at ${o.binary}. Build it first (scripts/zcash-setup.sh) or use the Docker image.`);
  }

  const dbFile = join(o.walletDir, "data.sqlite");
  const walletExists = existsSync(dbFile) && existsSync(o.identityFile);
  const stored = await o.seeds.get(o.network);
  const connection = ["-s", o.server, ...(o.connection !== "direct" ? ["--connection", o.connection] : [])];

  if (walletExists) {
    if (!stored) {
      await saveSeedFromWallet(o);
      o.logger.info("saved the existing wallet's seed to the database");
    }
    return "existing";
  }

  await mkdir(o.walletDir, { recursive: true });

  if (stored) {
    o.logger.info({ birthday: stored.birthdayHeight }, "wallet folder missing; restoring from the seed in the database");
    await runDevtool(
      o.binary,
      [
        "wallet", "-w", o.walletDir, "restore-mnemonic",
        "--name", ACCOUNT_NAME,
        "-i", o.identityFile,
        "-n", o.network,
        "--birthday", String(stored.birthdayHeight),
        ...connection,
      ],
      { input: `${stored.mnemonic}\n`, timeoutMs: 120_000 },
    );
    return "restored";
  }

  o.logger.info("no wallet and no stored seed; creating a new testnet wallet");
  // An empty line on stdin means "generate a new mnemonic". Birthday defaults to the current chain tip.
  await runDevtool(
    o.binary,
    ["wallet", "-w", o.walletDir, "init", "--name", ACCOUNT_NAME, "-i", o.identityFile, "-n", o.network, ...connection],
    { input: "\n", timeoutMs: 120_000 },
  );
  await saveSeedFromWallet(o);
  return "created";
}

/** Reads the seed phrase out of the wallet (never logged) and its birth height, and stores both. */
async function saveSeedFromWallet(o: WalletBootstrapOptions): Promise<void> {
  const out = await runDevtool(
    o.binary,
    ["wallet", "-w", o.walletDir, "display-mnemonic", "-i", o.identityFile, "--enable"],
    { timeoutMs: 60_000 },
  );
  const mnemonic = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);
  if (!mnemonic || !/^[a-z]+( [a-z]+){11,23}$/.test(mnemonic)) {
    throw new Error("Could not read the wallet's seed phrase from zcash-devtool");
  }

  const db = new DatabaseSync(join(o.walletDir, "data.sqlite"), { readOnly: true });
  let birthday: number;
  try {
    const row = db.prepare("SELECT birthday_height AS h FROM accounts ORDER BY id LIMIT 1").get() as { h: number } | undefined;
    if (!row) throw new Error("The wallet has no account");
    birthday = Number(row.h);
  } finally {
    db.close();
  }

  await o.seeds.saveIfAbsent({ network: o.network, mnemonic, birthdayHeight: birthday });
}

/** Runs the binary without a shell, optionally feeding stdin. Output is never logged (it can hold the seed). */
function runDevtool(binary: string, args: string[], opts: { input?: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, RUST_LOG: "warn" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`zcash-devtool ${args[3] ?? ""} timed out after ${opts.timeoutMs / 1000}s`));
    }, opts.timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const reason = stderr.trim().split("\n").at(-1) ?? `exit code ${code}`;
      reject(new Error(`zcash-devtool ${args[3] ?? ""} failed: ${reason}`));
    });

    child.stdin.on("error", () => undefined); // the tool may exit before reading stdin
    child.stdin.end(opts.input ?? "");
  });
}
