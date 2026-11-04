import { majorToMinorCeil } from "../../lib/money.js";
import type { BitrefillPackage, BitrefillProduct } from "./schemas.js";

export interface Selection {
  packageId?: string | null;
  value?: number | null;
}

export interface Quote {
  /** Package id to send to Bitrefill, or null for a ranged value. */
  packageId: string | null;
  /** The face value as Bitrefill knows it (e.g. "10", "1GB, 7 Days"). */
  value: string;
  /** Number to send as `value` for ranged products; null for packages. */
  rangedValue: number | null;
  /** Cost in the account currency, minor units, rounded up. */
  costMinor: number;
}

export class QuoteError extends Error {
  override name = "QuoteError";
}

export const packageIdOf = (p: BitrefillPackage): string | null => p.package_id ?? p.id ?? null;

/**
 * Works out exactly what will be bought and what it costs in the account currency.
 * Throws QuoteError with a message suitable for the agent/user when the selection is invalid.
 */
export function quoteProduct(product: BitrefillProduct, selection: Selection, accountCurrency: string): Quote {
  if (product.in_stock === false) {
    throw new QuoteError(`${product.name} is out of stock.`);
  }

  if (selection.packageId) {
    const pkg = (product.packages ?? []).find((p) => packageIdOf(p) === selection.packageId);
    if (!pkg) {
      throw new QuoteError(`Package "${selection.packageId}" does not exist for ${product.name}.`);
    }
    if (pkg.price === undefined) {
      throw new QuoteError(`Bitrefill did not return a price for this package; pick another option.`);
    }
    return {
      packageId: selection.packageId,
      value: String(pkg.value),
      rangedValue: null,
      costMinor: majorToMinorCeil(pkg.price),
    };
  }

  if (selection.value !== undefined && selection.value !== null) {
    const range = product.range;
    if (!range) {
      throw new QuoteError(`${product.name} only comes in fixed packages; choose a package_id.`);
    }
    const value = selection.value;
    if (value < range.min || value > range.max) {
      throw new QuoteError(`Value must be between ${range.min} and ${range.max} ${product.currency ?? ""}.`.trim());
    }
    if (range.step && range.step > 0) {
      const steps = (value - range.min) / range.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) {
        throw new QuoteError(`Value must be ${range.min} plus a multiple of ${range.step}.`);
      }
    }
    let rate = range.price_rate;
    if (rate === undefined && product.currency && product.currency.toUpperCase() === accountCurrency.toUpperCase()) {
      rate = 1;
    }
    if (rate === undefined) {
      throw new QuoteError(`Bitrefill did not return a price rate for ${product.name}; cannot quote safely.`);
    }
    return {
      packageId: null,
      value: String(value),
      rangedValue: value,
      costMinor: majorToMinorCeil(value * rate),
    };
  }

  throw new QuoteError("Choose either a package_id or a value.");
}

/** True when the product needs a phone number (mobile top-ups). */
export function requiresPhoneNumber(product: BitrefillProduct): boolean {
  const t = (product.recipient_type ?? "").toLowerCase();
  return t.includes("phone");
}
