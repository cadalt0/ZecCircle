import type { Database } from "../db/database.js";
import type { Invite } from "../domain/types.js";
import { nowIso } from "../lib/time.js";

interface InviteRow {
  token: string;
  circle_id: number;
  created_by_telegram_id: number;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked: number;
  created_at: string;
}

const toInvite = (r: InviteRow): Invite => ({
  token: r.token,
  circleId: r.circle_id,
  createdByTelegramId: r.created_by_telegram_id,
  expiresAt: r.expires_at,
  maxUses: r.max_uses,
  useCount: r.use_count,
  revoked: r.revoked === 1,
  createdAt: r.created_at,
});

export class InviteRepository {
  constructor(private readonly db: Database) {}

  async create(token: string, circleId: number, createdByTelegramId: number, expiresAt: Date, maxUses: number): Promise<Invite> {
    const { rows } = await this.db.query<InviteRow>(
      `INSERT INTO invites (token, circle_id, created_by_telegram_id, expires_at, max_uses, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [token, circleId, createdByTelegramId, expiresAt.toISOString(), maxUses, nowIso()],
    );
    return toInvite(rows[0]!);
  }

  async findByToken(token: string): Promise<Invite | null> {
    const { rows } = await this.db.query<InviteRow>("SELECT * FROM invites WHERE token = ?", [token]);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  /** Atomically uses one slot of a valid invite. Returns false if it was revoked, expired or used up. */
  async claim(token: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE invites SET use_count = use_count + 1
       WHERE token = ? AND revoked = 0 AND expires_at > ? AND use_count < max_uses`,
      [token, nowIso()],
    );
    return result.rowCount === 1;
  }

  /** Revokes every invite that can still be used. */
  async revokeAllForCircle(circleId: number): Promise<number> {
    const result = await this.db.query(
      "UPDATE invites SET revoked = 1 WHERE circle_id = ? AND revoked = 0 AND use_count < max_uses AND expires_at > ?",
      [circleId, nowIso()],
    );
    return result.rowCount;
  }
}
