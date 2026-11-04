import type { Database } from "../db/database.js";
import { nowIso } from "../lib/time.js";

export type AuditAction =
  | "circle.created"
  | "circle.limit_changed"
  | "circle.paused"
  | "circle.resumed"
  | "invite.created"
  | "invite.revoked"
  | "member.joined"
  | "member.removed"
  | "member.left"
  | "member.paused"
  | "member.resumed"
  | "member.limits_changed"
  | "purchase.proposed"
  | "purchase.confirmed"
  | "purchase.approval_requested"
  | "purchase.approved"
  | "purchase.rejected"
  | "purchase.cancelled"
  | "purchase.denied"
  | "purchase.invoice_created"
  | "purchase.paid"
  | "purchase.completed"
  | "purchase.failed"
  | "zec.deposit_confirmed"
  | "zec.payment_sent";

export interface AuditEntry {
  circleId: number | null;
  actorTelegramId: number | null;
  action: AuditAction;
  /** Must never contain secrets or redemption codes. */
  details?: Record<string, unknown>;
}

export class AuditRepository {
  constructor(
    private readonly db: Database,
    /** Called after each entry is stored (feeds the developer activity log). Must not throw. */
    private readonly onRecord?: (entry: AuditEntry) => void,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.query(
      "INSERT INTO audit_log (circle_id, actor_telegram_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        entry.circleId,
        entry.actorTelegramId,
        entry.action,
        entry.details ? JSON.stringify(entry.details) : null,
        nowIso(),
      ],
    );
    try {
      this.onRecord?.(entry);
    } catch {
      /* logging must never break the action being audited */
    }
  }
}
