import type { Database } from "../db/database.js";
import { nowIso } from "../lib/time.js";

export type SwapStatus = "invoice_created" | "quoted" | "deposit_sent" | "swap_succeeded" | "credited" | "refunded" | "failed";

export interface ZecSwap {
  id: number;
  purchaseId: number;
  circleId: number;
  status: SwapStatus;
  bitrefillInvoiceId: string;
  payToAddress: string;
  usdcBaseUnits: number;
  depositAddress: string | null;
  amountInZat: number | null;
  quoteDeadline: string | null;
  depositTxid: string | null;
  lastSwapStatus: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SwapRow {
  id: number;
  purchase_id: number;
  circle_id: number;
  status: SwapStatus;
  bitrefill_invoice_id: string;
  pay_to_address: string;
  usdc_base_units: number;
  deposit_address: string | null;
  amount_in_zat: number | null;
  quote_deadline: string | null;
  deposit_txid: string | null;
  last_swap_status: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const toSwap = (r: SwapRow): ZecSwap => ({
  id: r.id,
  purchaseId: r.purchase_id,
  circleId: r.circle_id,
  status: r.status,
  bitrefillInvoiceId: r.bitrefill_invoice_id,
  payToAddress: r.pay_to_address,
  usdcBaseUnits: r.usdc_base_units,
  depositAddress: r.deposit_address,
  amountInZat: r.amount_in_zat,
  quoteDeadline: r.quote_deadline,
  depositTxid: r.deposit_txid,
  lastSwapStatus: r.last_swap_status,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SwapRepository {
  constructor(private readonly db: Database) {}

  async create(s: { purchaseId: number; circleId: number; bitrefillInvoiceId: string; payToAddress: string; usdcBaseUnits: number }): Promise<ZecSwap> {
    const now = nowIso();
    const { rows } = await this.db.query<SwapRow>(
      `INSERT INTO zec_swaps (purchase_id, circle_id, status, bitrefill_invoice_id, pay_to_address, usdc_base_units, created_at, updated_at)
       VALUES (?, ?, 'invoice_created', ?, ?, ?, ?, ?) RETURNING *`,
      [s.purchaseId, s.circleId, s.bitrefillInvoiceId, s.payToAddress, s.usdcBaseUnits, now, now],
    );
    return toSwap(rows[0]!);
  }

  async findByPurchase(purchaseId: number): Promise<ZecSwap | null> {
    const { rows } = await this.db.query<SwapRow>("SELECT * FROM zec_swaps WHERE purchase_id = ?", [purchaseId]);
    return rows[0] ? toSwap(rows[0]) : null;
  }

  /**
   * Swaps that count against the hard limit: every attempt in progress or finished, plus failed ones
   * where ZEC had already been sent. Only attempts that failed before sending anything are free.
   */
  async countCommitted(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM zec_swaps WHERE status <> 'failed' OR deposit_txid IS NOT NULL",
    );
    return rows[0]!.n;
  }

  /** Swaps whose ZEC was sent but whose outcome is not final yet (resume watching them after a restart). */
  async listInFlight(): Promise<ZecSwap[]> {
    const { rows } = await this.db.query<SwapRow>(
      "SELECT * FROM zec_swaps WHERE status IN ('deposit_sent', 'swap_succeeded') ORDER BY id",
    );
    return rows.map(toSwap);
  }

  async markQuoted(id: number, q: { depositAddress: string; amountInZat: number; deadline: string; quoteJson: string }): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE zec_swaps SET status = 'quoted', deposit_address = ?, amount_in_zat = ?, quote_deadline = ?, quote_json = ?, updated_at = ?
       WHERE id = ? AND status = 'invoice_created'`,
      [q.depositAddress, q.amountInZat, q.deadline, q.quoteJson, nowIso(), id],
    );
    return r.rowCount === 1;
  }

  async markDepositSent(id: number, txid: string): Promise<void> {
    await this.db.query("UPDATE zec_swaps SET status = 'deposit_sent', deposit_txid = ?, updated_at = ? WHERE id = ?", [txid, nowIso(), id]);
  }

  async setStatus(id: number, status: SwapStatus, extra: { lastSwapStatus?: string; error?: string } = {}): Promise<void> {
    await this.db.query(
      `UPDATE zec_swaps SET status = ?, last_swap_status = COALESCE(?, last_swap_status), error = COALESCE(?, error), updated_at = ?
       WHERE id = ?`,
      [status, extra.lastSwapStatus ?? null, extra.error ?? null, nowIso(), id],
    );
  }

  async setLastSwapStatus(id: number, lastSwapStatus: string): Promise<void> {
    await this.db.query("UPDATE zec_swaps SET last_swap_status = ?, updated_at = ? WHERE id = ?", [lastSwapStatus, nowIso(), id]);
  }
}
