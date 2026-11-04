import type { Database } from "../db/database.js";
import { nowIso } from "../lib/time.js";

export interface WalletSeed {
  network: string;
  mnemonic: string;
  birthdayHeight: number;
}

/**
 * TESTNET ONLY. Keeps the bot wallet's seed phrase in the database so the wallet can be rebuilt
 * from the chain on hosts with a throwaway disk. Never do this with real funds.
 */
export class WalletSeedRepository {
  constructor(private readonly db: Database) {}

  async get(network: string): Promise<WalletSeed | null> {
    const { rows } = await this.db.query<{ network: string; mnemonic: string; birthday_height: number }>(
      "SELECT network, mnemonic, birthday_height FROM wallet_seed WHERE network = ?",
      [network],
    );
    const r = rows[0];
    return r ? { network: r.network, mnemonic: r.mnemonic, birthdayHeight: r.birthday_height } : null;
  }

  /** Saves the seed unless one is already stored (the first one wins, so a wallet is never orphaned). */
  async saveIfAbsent(seed: WalletSeed): Promise<void> {
    await this.db.query(
      "INSERT INTO wallet_seed (network, mnemonic, birthday_height, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (network) DO NOTHING",
      [seed.network, seed.mnemonic, seed.birthdayHeight, nowIso()],
    );
  }
}
