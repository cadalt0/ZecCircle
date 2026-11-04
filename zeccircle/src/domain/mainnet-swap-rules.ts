/**
 * HARD LIMITS FOR MAINNET (REAL ZEC) SWAPS.
 *
 * Constants in the source on purpose: no setting, database row or prompt can change them.
 *
 * How a mainnet purchase is paid: the bot buys Bitrefill "USD Store Credit" with USDC on Base,
 * and pays for that USDC by swapping the circle's ZEC through NEAR Intents 1Click (EXACT_OUTPUT, so
 * Bitrefill receives exactly the invoiced amount). The purchase is then paid from the USD balance.
 * Whatever store credit the purchase doesn't use stays in the Bitrefill account; it is not lost.
 *
 * Measured on 4 Nov 2026 with dry-run quotes: 1Click's minimum for ZEC -> USDC is about 1.74 USDC,
 * so $1 swaps are impossible; $2.00 costs about 0.00154 ZEC (~$2.04) and takes ~7.5 minutes.
 */

/** Exact USDC the swap delivers to Bitrefill (and the store credit bought), in US cents. */
export const SWAP_USD_MINOR = 200;

/** Bitrefill payment method and the matching 1Click asset: USDC on Base (cheapest withdrawal fee). */
export const SWAP_BITREFILL_PAYMENT_METHOD = "usdc_base";
/** USDC contract on Base (chain id 8453), as Bitrefill's invoice must name it. */
export const USDC_BASE_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const BASE_CHAIN_ID = "8453";

/** Never send more ZEC than this for one swap (0.0025 ZEC; a $2 swap needs ~0.0016). */
export const MAX_ZEC_PER_SWAP_ZAT = 250_000;

/** Refuse quotes costing more than this much over the USDC delivered (fees + slippage buffer). */
export const MAX_SWAP_OVERHEAD_PERCENT = 8;

/** Slippage buffer for EXACT_OUTPUT (bps). Any ZEC not needed is refunded to our address by 1Click. */
export const SWAP_SLIPPAGE_BPS = 100;

/** Never do more than this many swaps in total: 2 x $2 stays within the $5 the owner allowed. */
export const MAX_SWAPS_TOTAL = 2;

/** 1Click refunds if the swap isn't done by then. Bitrefill invoices live 60 minutes, so 30 leaves room. */
export const SWAP_DEADLINE_MINUTES = 30;

/** The Bitrefill invoice must still be valid this long when we commit, or we don't pay it. */
export const MIN_INVOICE_MINUTES_LEFT = 40;

/** How often to check progress while waiting for the swap and the Bitrefill credit. */
export const SWAP_POLL_INTERVAL_MS = 15_000;

/**
 * How long a purchase waits for its swap. 1Click's own deadline can be days away (it returned +3 days
 * in testing), so the purchase gives up waiting after this; the swap is still watched in the background
 * (every SWAP_SLOW_POLL_INTERVAL_MS) until 1Click's deadline, so a late credit is still recorded.
 */
export const SWAP_PURCHASE_WAIT_MINUTES = 45;
export const SWAP_SLOW_POLL_INTERVAL_MS = 5 * 60_000;
