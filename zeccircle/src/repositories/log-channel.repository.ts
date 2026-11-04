import type { Database } from "../db/database.js";
import { nowIso } from "../lib/time.js";

/** A chat registered to receive activity. `circleId` null = every circle (bot admins only). */
export interface LogRegistration {
  chatId: number;
  circleId: number | null;
  title: string | null;
  addedByTelegramId: number | null;
}

export class LogChannelRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<LogRegistration[]> {
    const { rows } = await this.db.query<{ chat_id: number; circle_id: number | null; title: string | null; added_by_telegram_id: number | null }>(
      "SELECT chat_id, circle_id, title, added_by_telegram_id FROM log_channels ORDER BY id",
    );
    return rows.map((r) => ({ chatId: r.chat_id, circleId: r.circle_id, title: r.title, addedByTelegramId: r.added_by_telegram_id }));
  }

  async add(chatId: number, circleId: number | null, title: string | null, addedBy: number | null): Promise<void> {
    await this.db.query(
      `INSERT INTO log_channels (chat_id, circle_id, title, added_by_telegram_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (chat_id, COALESCE(circle_id, 0)) DO UPDATE SET title = EXCLUDED.title`,
      [chatId, circleId, title, addedBy, nowIso()],
    );
  }

  /** Removes one registration; `circleId` undefined removes every registration of the chat. */
  async remove(chatId: number, circleId?: number | null): Promise<boolean> {
    const result =
      circleId === undefined
        ? await this.db.query("DELETE FROM log_channels WHERE chat_id = ?", [chatId])
        : circleId === null
          ? await this.db.query("DELETE FROM log_channels WHERE chat_id = ? AND circle_id IS NULL", [chatId])
          : await this.db.query("DELETE FROM log_channels WHERE chat_id = ? AND circle_id = ?", [chatId, circleId]);
    return result.rowCount > 0;
  }
}
