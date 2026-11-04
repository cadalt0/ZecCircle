import type { OneClickClient } from "../../integrations/near-intents/one-click-client.js";
import { ONE_CLICK_ZEC } from "../../integrations/near-intents/one-click-client.js";

/** Price of 1 ZEC in the circle currency's minor units (US cents). */
export interface PriceSource {
  readonly live: boolean;
  getPriceMinorPerZec(): Promise<number>;
}

/** Testnet / mock: TAZ has no market price, so a fixed configured rate is used. */
export class FixedPrice implements PriceSource {
  readonly live = false;
  constructor(private readonly priceMinorPerZec: number) {}
  async getPriceMinorPerZec(): Promise<number> {
    return this.priceMinorPerZec;
  }
}

/**
 * Mainnet: the live ZEC price from 1Click's token list (the same service that does the swap, so the
 * numbers agree). Cached briefly; refuses to use a price older than `maxAgeMs`.
 */
export class OneClickZecPrice implements PriceSource {
  readonly live = true;
  private cached: { value: number; at: number } | null = null;

  constructor(
    private readonly oneClick: OneClickClient,
    private readonly cacheMs = 60_000,
    private readonly maxAgeMs = 15 * 60_000,
  ) {}

  async getPriceMinorPerZec(): Promise<number> {
    if (this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.value;
    const zec = (await this.oneClick.getTokens()).find((t) => t.assetId === ONE_CLICK_ZEC);
    if (!zec || !(zec.price > 0)) throw new Error("1Click did not return a ZEC price");
    if (Date.now() - Date.parse(zec.priceUpdatedAt) > this.maxAgeMs) throw new Error("1Click's ZEC price is out of date");
    const value = Math.round(zec.price * 100);
    this.cached = { value, at: Date.now() };
    return value;
  }
}
