/**
 * Money is always handled as integer minor units (cents) to avoid float drift.
 * Every circle uses a single currency (see CIRCLE_CURRENCY), so amounts carry no currency field.
 */

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/** "2" -> 200, "1.5" -> 150, "0.05" -> 5. Throws on anything else. */
export function parseAmountToMinor(input: string): number {
  const value = input.trim();
  if (!AMOUNT_PATTERN.test(value)) {
    throw new Error(`"${input}" is not a valid amount (use e.g. 2 or 1.50)`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Converts a decimal major-unit number from an API (e.g. 1.234) to minor units, rounding up. */
export function majorToMinorCeil(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  // Round to 6 dp first so 1.1 * 100 = 110.00000000000001 does not become 111.
  return Math.ceil(Number((amount * 100).toFixed(6)));
}

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}
