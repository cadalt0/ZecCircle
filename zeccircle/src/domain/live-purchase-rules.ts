/**
 * HARD LIMITS FOR REAL (LIVE) BITREFILL PURCHASES.
 *
 * These are constants in the source on purpose: not settings, not database rows, not prompt text.
 * Neither the AI agent nor anyone using the bot can change them; only a code change can. They apply
 * only when BITREFILL_MODE=live, on top of the circle's own limits.
 *
 * Checked against Bitrefill's live catalogue on 4 Nov 2026 (USD account):
 *   - Jio "₹7.47 Talktime Top-Up" (you pay ₹10)  ~ $0.12
 *   - Flipkart India ₹50 gift card               ~ $0.56
 */

export interface LiveItem {
  /** Short name used in logs and messages. */
  key: string;
  label: string;
  productId: string;
  /** Exact package id from Bitrefill (copied, never retyped: it contains ₹ and is case-sensitive). */
  packageId: string;
  /** Values Bitrefill may echo back on the order for this package. */
  orderValues: readonly string[];
  /** Highest price we will ever pay for one of these, in US cents. */
  maxPriceMinor: number;
  /**
   * Top-ups need the member's phone number. The member's word that it's on this operator is enough:
   * we don't look it up, because Bitrefill's operator lookup is a guess that changes between calls.
   */
  operator: string | null;
}

export const LIVE_ITEMS: readonly LiveItem[] = [
  {
    key: "jio-10",
    label: "₹10 Jio talktime top-up",
    productId: "reliance-jio-india-bundles",
    packageId: "reliance-jio-india-bundles<&>₹7.47 Talktime Top-Up",
    orderValues: ["₹7.47 Talktime Top-Up", "10"],
    maxPriceMinor: 50,
    operator: "Jio",
  },
  {
    key: "flipkart-50",
    label: "₹50 Flipkart gift card",
    productId: "flipkart-india",
    packageId: "flipkart-india<&>50",
    orderValues: ["50"],
    maxPriceMinor: 100,
    operator: null,
  },
];

/** The most real money this deployment may ever spend on Bitrefill, in US cents ($5.00). */
export const LIVE_TOTAL_SPEND_CEILING_MINOR = 500;

/** Live invoices must be priced in this currency. */
export const LIVE_CURRENCY = "USD";

export function findLiveItem(productId: string, packageId: string | null): LiveItem | null {
  return LIVE_ITEMS.find((i) => i.productId === productId && i.packageId === packageId) ?? null;
}

export function liveMenuText(): string {
  return LIVE_ITEMS.map((i) => `- ${i.label}: product_id "${i.productId}", package_id "${i.packageId}"`).join("\n");
}
