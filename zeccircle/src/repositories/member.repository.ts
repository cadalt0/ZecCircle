import type { Database } from "../db/database.js";
import type { Member, MemberRole, MemberStatus } from "../domain/types.js";
import { nowIso } from "../lib/time.js";

interface MemberRow {
  id: number;
  circle_id: number;
  telegram_id: number;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
  per_purchase_limit_minor: number;
  monthly_limit_minor: number;
  created_at: string;
  updated_at: string;
}

const toMember = (r: MemberRow): Member => ({
  id: r.id,
  circleId: r.circle_id,
  telegramId: r.telegram_id,
  displayName: r.display_name,
  role: r.role,
  status: r.status,
  perPurchaseLimitMinor: r.per_purchase_limit_minor,
  monthlyLimitMinor: r.monthly_limit_minor,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NewMember {
  circleId: number;
  telegramId: number;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
  perPurchaseLimitMinor: number;
  monthlyLimitMinor: number;
}

export class MemberRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewMember): Promise<Member> {
    const now = nowIso();
    const { rows } = await this.db.query<MemberRow>(
      `INSERT INTO members (circle_id, telegram_id, display_name, role, status,
         per_purchase_limit_minor, monthly_limit_minor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        input.circleId,
        input.telegramId,
        input.displayName,
        input.role,
        input.status,
        input.perPurchaseLimitMinor,
        input.monthlyLimitMinor,
        now,
        now,
      ],
    );
    return toMember(rows[0]!);
  }

  async findById(id: number): Promise<Member | null> {
    const { rows } = await this.db.query<MemberRow>("SELECT * FROM members WHERE id = ?", [id]);
    return rows[0] ? toMember(rows[0]) : null;
  }

  /** The user's current (non-removed) membership, if any. */
  async findLiveByTelegramId(telegramId: number): Promise<Member | null> {
    const { rows } = await this.db.query<MemberRow>(
      "SELECT * FROM members WHERE telegram_id = ? AND status <> 'removed'",
      [telegramId],
    );
    return rows[0] ? toMember(rows[0]) : null;
  }

  async listByCircle(circleId: number, includeRemoved = false): Promise<Member[]> {
    const sql = includeRemoved
      ? "SELECT * FROM members WHERE circle_id = ? ORDER BY id"
      : "SELECT * FROM members WHERE circle_id = ? AND status <> 'removed' ORDER BY id";
    const { rows } = await this.db.query<MemberRow>(sql, [circleId]);
    return rows.map(toMember);
  }

  /**
   * Moves a member from one status to another only if it is currently `from`.
   * Returns false if someone else changed it first (e.g. a double-tapped button).
   */
  async transitionStatus(id: number, from: MemberStatus[], to: MemberStatus): Promise<boolean> {
    const placeholders = from.map(() => "?").join(", ");
    const result = await this.db.query(
      `UPDATE members SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
      [to, nowIso(), id, ...from],
    );
    return result.rowCount === 1;
  }

  async setLimits(id: number, perPurchaseLimitMinor: number, monthlyLimitMinor: number): Promise<void> {
    await this.db.query(
      "UPDATE members SET per_purchase_limit_minor = ?, monthly_limit_minor = ?, updated_at = ? WHERE id = ?",
      [perPurchaseLimitMinor, monthlyLimitMinor, nowIso(), id],
    );
  }

  async updateDisplayName(id: number, displayName: string): Promise<void> {
    await this.db.query("UPDATE members SET display_name = ?, updated_at = ? WHERE id = ?", [displayName, nowIso(), id]);
  }
}
