import type { Database } from "../db/database.js";
import type { Circle } from "../domain/types.js";
import { nowIso } from "../lib/time.js";

interface CircleRow {
  id: number;
  name: string;
  owner_telegram_id: number;
  currency: string;
  monthly_limit_minor: number;
  default_per_purchase_limit_minor: number;
  default_member_monthly_limit_minor: number;
  paused: number;
  created_at: string;
}

const toCircle = (r: CircleRow): Circle => ({
  id: r.id,
  name: r.name,
  ownerTelegramId: r.owner_telegram_id,
  currency: r.currency,
  monthlyLimitMinor: r.monthly_limit_minor,
  defaultPerPurchaseLimitMinor: r.default_per_purchase_limit_minor,
  defaultMemberMonthlyLimitMinor: r.default_member_monthly_limit_minor,
  paused: r.paused === 1,
  createdAt: r.created_at,
});

export interface NewCircle {
  name: string;
  ownerTelegramId: number;
  currency: string;
  monthlyLimitMinor: number;
  defaultPerPurchaseLimitMinor: number;
  defaultMemberMonthlyLimitMinor: number;
}

export class CircleRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewCircle): Promise<Circle> {
    const { rows } = await this.db.query<CircleRow>(
      `INSERT INTO circles (name, owner_telegram_id, currency, monthly_limit_minor,
         default_per_purchase_limit_minor, default_member_monthly_limit_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        input.name,
        input.ownerTelegramId,
        input.currency,
        input.monthlyLimitMinor,
        input.defaultPerPurchaseLimitMinor,
        input.defaultMemberMonthlyLimitMinor,
        nowIso(),
      ],
    );
    return toCircle(rows[0]!);
  }

  async findById(id: number): Promise<Circle | null> {
    const { rows } = await this.db.query<CircleRow>("SELECT * FROM circles WHERE id = ?", [id]);
    return rows[0] ? toCircle(rows[0]) : null;
  }

  async setMonthlyLimit(id: number, monthlyLimitMinor: number): Promise<void> {
    await this.db.query("UPDATE circles SET monthly_limit_minor = ? WHERE id = ?", [monthlyLimitMinor, id]);
  }

  async setPaused(id: number, paused: boolean): Promise<void> {
    await this.db.query("UPDATE circles SET paused = ? WHERE id = ?", [paused ? 1 : 0, id]);
  }
}
