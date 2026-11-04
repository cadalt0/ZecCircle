/** 1 ZEC = 100,000,000 zatoshis. All on-chain amounts are handled as integer zatoshis. */
export const ZAT_PER_ZEC = 100_000_000;

/** 12345678 -> "0.12345678" (trailing zeros trimmed, at least 2 decimals kept). */
export function zatToZecString(zat: number): string {
  if (!Number.isSafeInteger(zat) || zat < 0) throw new Error(`Invalid zatoshi amount: ${zat}`);
  const whole = Math.floor(zat / ZAT_PER_ZEC);
  const frac = String(zat % ZAT_PER_ZEC).padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** "0.5" -> 50000000. Throws on anything that is not a plain decimal with at most 8 places. */
export function zecStringToZat(input: string): number {
  const value = input.trim();
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(value)) throw new Error(`"${input}" is not a valid ZEC amount`);
  const [whole = "0", frac = ""] = value.split(".");
  return Number(whole) * ZAT_PER_ZEC + Number(frac.padEnd(8, "0"));
}

/**
 * Converts a fiat amount (minor units, e.g. cents) to zatoshis at `pricePerZecMinor`
 * (fiat minor units per 1 ZEC), rounding up so a purchase is never under-funded.
 */
export function fiatMinorToZat(fiatMinor: number, pricePerZecMinor: number): number {
  if (pricePerZecMinor <= 0) throw new Error("ZEC price must be positive");
  return Math.ceil((fiatMinor * ZAT_PER_ZEC) / pricePerZecMinor);
}

/** Converts zatoshis to fiat minor units, rounding down (balances are never overstated). */
export function zatToFiatMinor(zat: number, pricePerZecMinor: number): number {
  return Math.floor((zat * pricePerZecMinor) / ZAT_PER_ZEC);
}
