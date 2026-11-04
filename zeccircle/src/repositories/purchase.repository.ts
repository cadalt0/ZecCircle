import type { Database } from "../db/database.js";
import { SPENDING_STATUSES, type FulfilmentMode, type Purchase, type PurchaseStatus } from "../domain/types.js";
import { nowIso } from "../lib/time.js";

interface PurchaseRow {
  id: number;
  circle_id: number;
  member_id: number;
  product_id: string;
  product_name: string;
  package_id: string | null;
  value: string;
  phone_number: string | null;
  quoted_minor: number;
  paid_minor: number | null;
  currency: string;
  status: PurchaseStatus;
  approved_by_telegram_id: number | null;
  invoice_id: string | null;
  failure_reason: string | null;
  fulfilment_mode: FulfilmentMode;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

const toPurchase = (r: PurchaseRow): Purchase => ({
  id: r.id,
  circleId: r.circle_id,
  memberId: r.member_id,
  productId: r.product_id,
  productName: r.product_name,
  packageId: r.package_id,
  value: r.value,
  phoneNumber: r.phone_number,
  quotedMinor: r.quoted_minor,
  paidMinor: r.paid_minor,
  currency: r.currency,
  status: r.status,
  approvedByTelegramId: r.approved_by_telegram_id,
  invoiceId: r.invoice_id,
  failureReason: r.failure_reason,
  fulfilmentMode: r.fulfilment_mode,
  paidAt: r.paid_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewPurchase {
  circleId: number;
  memberId: number;
  productId: string;
  productName: string;
  packageId: string | null;
  value: string;
  phoneNumber: string | null;
  quotedMinor: number;
  currency: string;
  fulfilmentMode: FulfilmentMode;
}

const SPENDING_IN = SPENDING_STATUSES.map((s) => `'${s}'`).join(", ");

export class PurchaseRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewPurchase): Promise<Purchase> {
    const now = nowIso();
    const { rows } = await this.db.query<PurchaseRow>(
      `INSERT INTO purchases (circle_id, member_id, product_id, product_name, package_id, value,
         phone_number, quoted_minor, currency, fulfilment_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?) RETURNING *`,
      [
        input.circleId,
        input.memberId,
        input.productId,
        input.productName,
        input.packageId,
        input.value,
        input.phoneNumber,
        input.quotedMinor,
        input.currency,
        input.fulfilmentMode,
        now,
        now,
      ],
    );
    return toPurchase(rows[0]!);
  }

  async findById(id: number): Promise<Purchase | null> {
    const { rows } = await this.db.query<PurchaseRow>("SELECT * FROM purchases WHERE id = ?", [id]);
    return rows[0] ? toPurchase(rows[0]) : null;
  }

  async listByStatus(status: PurchaseStatus): Promise<Purchase[]> {
    const { rows } = await this.db.query<PurchaseRow>("SELECT * FROM purchases WHERE status = ? ORDER BY id", [status]);
    return rows.map(toPurchase);
  }

  async listRecentByCircle(circleId: number, limit: number): Promise<Purchase[]> {
    const { rows } = await this.db.query<PurchaseRow>(
      "SELECT * FROM purchases WHERE circle_id = ? ORDER BY id DESC LIMIT ?",
      [circleId, limit],
    );
    return rows.map(toPurchase);
  }

  async listRecentByMember(memberId: number, limit: number): Promise<Purchase[]> {
    const { rows } = await this.db.query<PurchaseRow>(
      "SELECT * FROM purchases WHERE member_id = ? ORDER BY id DESC LIMIT ?",
      [memberId, limit],
    );
    return rows.map(toPurchase);
  }

  /** Sum of money committed (executing or completed) since `sinceIso`, using paid amount when known. */
  async spentByMemberSince(memberId: number, sinceIso: string): Promise<number> {
    const { rows } = await this.db.query<{ total: number }>(
      `SELECT COALESCE(SUM(COALESCE(paid_minor, quoted_minor)), 0) AS total FROM purchases
       WHERE member_id = ? AND created_at >= ? AND status IN (${SPENDING_IN})`,
      [memberId, sinceIso],
    );
    return rows[0]!.total;
  }

  async spentByCircleSince(circleId: number, sinceIso: string): Promise<number> {
    const { rows } = await this.db.query<{ total: number }>(
      `SELECT COALESCE(SUM(COALESCE(paid_minor, quoted_minor)), 0) AS total FROM purchases
       WHERE circle_id = ? AND created_at >= ? AND status IN (${SPENDING_IN})`,
      [circleId, sinceIso],
    );
    return rows[0]!.total;
  }

  /**
   * Compare-and-set status change. Returns false if the purchase was not in one of `from`
   * (another handler won the race, or it was already processed): callers must then stop.
   */
  async transition(
    id: number,
    from: PurchaseStatus[],
    to: PurchaseStatus,
    extra: { approvedByTelegramId?: number; failureReason?: string } = {},
  ): Promise<boolean> {
    const placeholders = from.map(() => "?").join(", ");
    const result = await this.db.query(
      `UPDATE purchases SET status = ?, updated_at = ?,
         approved_by_telegram_id = COALESCE(?, approved_by_telegram_id),
         failure_reason = COALESCE(?, failure_reason)
       WHERE id = ? AND status IN (${placeholders})`,
      [to, nowIso(), extra.approvedByTelegramId ?? null, extra.failureReason ?? null, id, ...from],
    );
    return result.rowCount === 1;
  }

  async setInvoice(id: number, invoiceId: string, paidMinor: number | null): Promise<void> {
    await this.db.query("UPDATE purchases SET invoice_id = ?, paid_minor = ?, updated_at = ? WHERE id = ?", [
      invoiceId,
      paidMinor,
      nowIso(),
      id,
    ]);
  }

  async markPaid(id: number): Promise<void> {
    await this.db.query("UPDATE purchases SET paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ?", [nowIso(), nowIso(), id]);
  }

  /**
   * Real money committed to Bitrefill across the whole deployment: live purchases that are being
   * executed, completed, or were paid (even if delivery later failed). Uses the paid amount when known.
   */
  async liveCommittedTotal(excludePurchaseId: number | null = null): Promise<number> {
    const { rows } = await this.db.query<{ total: number }>(
      `SELECT COALESCE(SUM(COALESCE(paid_minor, quoted_minor)), 0) AS total FROM purchases
       WHERE fulfilment_mode = 'live'
         AND (status IN ('executing', 'completed') OR paid_at IS NOT NULL)
         AND id <> ?`,
      [excludePurchaseId ?? -1],
    );
    return rows[0]!.total;
  }

  /** Marks purchases in `status` created before `olderThanIso` as expired. Returns how many changed. */
  async expireStale(status: "proposed" | "awaiting_approval", olderThanIso: string): Promise<number> {
    const result = await this.db.query(
      `UPDATE purchases SET status = 'expired', updated_at = ? WHERE status = ? AND created_at < ?`,
      [nowIso(), status, olderThanIso],
    );
    return result.rowCount;
  }
}
