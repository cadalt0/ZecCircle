import { zatToZecString } from "./units.js";

/**
 * Builds a ZIP-321 payment request URI, e.g.
 *   zcash:utest1...?amount=0.5&memo=WmVjQ2lyY2xl...
 * The memo is base64url-encoded UTF-8 without padding, as ZIP-321 requires.
 * Memos only work for shielded recipients (unified / Sapling addresses).
 */
export function buildPaymentUri(params: { address: string; amountZat?: number; memo?: string; label?: string }): string {
  const query: string[] = [];
  if (params.amountZat !== undefined && params.amountZat > 0) {
    query.push(`amount=${zatToZecString(params.amountZat)}`);
  }
  if (params.memo) {
    if (Buffer.byteLength(params.memo, "utf8") > 512) throw new Error("Memo is longer than 512 bytes");
    query.push(`memo=${Buffer.from(params.memo, "utf8").toString("base64url")}`);
  }
  if (params.label) {
    query.push(`label=${encodeURIComponent(params.label)}`);
  }
  return `zcash:${params.address}${query.length ? `?${query.join("&")}` : ""}`;
}

/** Transparent addresses (t...) cannot carry memos. */
export const isShieldedAddress = (address: string): boolean => !/^t[a-zA-Z0-9]/.test(address);
