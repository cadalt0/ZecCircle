import { GrammyError, type Api } from "grammy";
import type { Logger } from "../lib/logger.js";
import { redactSecrets } from "../lib/redact.js";
import type { LogChannelRepository } from "../repositories/log-channel.repository.js";
import type { ActivityEntry, ActivityLog } from "../services/activity/activity-log.js";
import { esc } from "./format.js";

export interface LogChannelOptions {
  /**
   * Gap between two messages to the same chat. Telegram allows about 20 messages a minute in a group,
   * so 3.2 s (~19/min) stays under it with room for the bot's other messages.
   */
  minIntervalMs?: number;
  /** Most messages waiting per chat; beyond it the oldest are dropped and the drop is reported. */
  maxQueue?: number;
}

interface ChatQueue {
  items: string[];
  dropped: number;
  timer: NodeJS.Timeout | null;
}

const ICONS: Record<string, string> = {
  purchase: "🛒",
  zec: "💰",
  swap: "💱",
  member: "👤",
  circle: "⭕",
  invite: "🔗",
  agent: "🤖",
  bot: "⚙️",
  bitrefill: "🧾",
  wallet: "👛",
};

const MAX_MESSAGE_CHARS = 1500;
const MAX_FIELD_CHARS = 300;

/**
 * Sends every activity entry, one small message each, to the registered log groups/channels.
 * Each chat has its own queue, drained at most one message per `minIntervalMs`, so a burst of
 * activity never trips Telegram's rate limits (the auto-retry plugin handles any 429 left over).
 */
export class TelegramLogChannel implements ActivityLog {
  /** chat id -> the circles it follows (null = all circles). */
  private readonly registrations = new Map<number, Set<number | null>>();
  private readonly queues = new Map<number, ChatQueue>();
  private readonly minIntervalMs: number;
  private readonly maxQueue: number;
  private stopped = false;

  constructor(
    private readonly api: Api,
    private readonly repo: LogChannelRepository,
    private readonly logger: Logger,
    options: LogChannelOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 3_200;
    this.maxQueue = options.maxQueue ?? 300;
  }

  async load(): Promise<void> {
    for (const c of await this.repo.list()) this.track(c.chatId, c.circleId);
  }

  get chatIds(): number[] {
    return [...this.registrations.keys()];
  }

  /** Turns activity on for a chat: one circle's, or (circleId null) every circle's. */
  async add(chatId: number, circleId: number | null, title: string | null, addedBy: number | null): Promise<void> {
    await this.repo.add(chatId, circleId, title, addedBy);
    this.track(chatId, circleId);
  }

  /** Turns it off: one circle's registration, or (circleId undefined) everything for the chat. */
  async remove(chatId: number, circleId?: number | null): Promise<boolean> {
    const scopes = this.registrations.get(chatId);
    if (scopes) {
      if (circleId === undefined) scopes.clear();
      else scopes.delete(circleId);
      if (scopes.size === 0) {
        this.registrations.delete(chatId);
        const q = this.queues.get(chatId);
        if (q?.timer) clearTimeout(q.timer);
        this.queues.delete(chatId);
      }
    }
    return this.repo.remove(chatId, circleId);
  }

  /**
   * Each entry goes only to chats following its circle, plus chats following everything. Entries that
   * belong to no circle (bot start/stop) go to the "everything" chats only. A chat gets an entry once.
   */
  record(entry: ActivityEntry): void {
    if (this.stopped || this.registrations.size === 0) return;
    const circleId = entry.circleId ?? null;
    let text: string | null = null;
    for (const [chatId, scopes] of this.registrations) {
      if (!scopes.has(null) && !(circleId !== null && scopes.has(circleId))) continue;
      text ??= formatEntry(entry);
      this.enqueue(chatId, text);
    }
  }

  private track(chatId: number, circleId: number | null): void {
    const scopes = this.registrations.get(chatId) ?? new Set<number | null>();
    scopes.add(circleId);
    this.registrations.set(chatId, scopes);
  }

  stop(): void {
    this.stopped = true;
    for (const q of this.queues.values()) if (q.timer) clearTimeout(q.timer);
  }

  // ---------------------------------------------------------------- queue

  private enqueue(chatId: number, text: string): void {
    let q = this.queues.get(chatId);
    if (!q) {
      q = { items: [], dropped: 0, timer: null };
      this.queues.set(chatId, q);
    }
    q.items.push(text);
    if (q.items.length > this.maxQueue) {
      q.items.shift();
      q.dropped++;
    }
    if (!q.timer) this.schedule(chatId, q, 0);
  }

  private schedule(chatId: number, q: ChatQueue, delayMs: number): void {
    q.timer = setTimeout(() => void this.sendNext(chatId, q), delayMs);
    q.timer.unref();
  }

  private async sendNext(chatId: number, q: ChatQueue): Promise<void> {
    q.timer = null;
    if (this.stopped || !this.registrations.has(chatId)) return;
    let text: string | undefined;
    if (q.dropped > 0) {
      text = `⚠️ ${q.dropped} log message(s) were skipped because too many happened at once.`;
      q.dropped = 0;
    } else {
      text = q.items.shift();
    }
    if (text === undefined) return; // queue empty: the next record() restarts it

    try {
      await this.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        disable_notification: true,
      });
    } catch (error) {
      // The bot was removed from the chat or lost permission: stop logging there.
      if (error instanceof GrammyError && (error.error_code === 403 || /chat not found|not enough rights/i.test(error.description))) {
        this.logger.warn({ chatId, reason: error.description }, "log channel unavailable; removing it");
        await this.remove(chatId).catch(() => undefined); // every registration of that chat
        return;
      }
      this.logger.warn({ err: error, chatId }, "could not send to log channel");
    }
    if (q.items.length > 0 || q.dropped > 0) this.schedule(chatId, q, this.minIntervalMs);
  }
}

// ---------------------------------------------------------------- formatting

/** One entry -> one short HTML message: header line, then one line per field. Secrets and phones masked. */
export function formatEntry(entry: ActivityEntry, now: Date = new Date()): string {
  const prefix = entry.event.split(".")[0] ?? "";
  const icon = entry.level === "error" ? "❌" : entry.level === "warn" ? "⚠️" : (ICONS[prefix] ?? "•");
  const time = now.toISOString().slice(11, 19);
  const lines = [`${icon} <b>${esc(entry.event)}</b> · ${time} UTC`];
  if (entry.circleId !== undefined && entry.circleId !== null) lines.push(`circle: #${entry.circleId}`);
  for (const [key, value] of Object.entries(entry.fields ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${esc(key)}: <code>${esc(formatValue(key, value))}</code>`);
  }
  const text = lines.join("\n");
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}

function formatValue(key: string, value: unknown): string {
  let text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : safeJson(value);
  if (/phone/i.test(key)) text = maskPhone(text);
  text = maskPhonesInText(redactSecrets(text));
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS)}…` : text;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** "919876543210" -> "91******3210" */
export function maskPhone(text: string): string {
  const digits = text.replace(/\D/g, "");
  if (digits.length < 8) return text;
  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

/** Masks Indian mobile numbers that appear inside free text (e.g. a member's chat message). */
function maskPhonesInText(text: string): string {
  // Word boundaries keep this from touching digit runs inside transaction ids or addresses.
  return text.replace(/(?<![0-9A-Za-z])(\+?91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})(?![0-9A-Za-z])/g, (_m, _cc, a: string, b: string) => `${a.slice(0, 1)}*****${b.slice(-4)}`);
}
