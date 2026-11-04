/**
 * Developer activity feed: a detailed, structured record of everything the bot does (purchases,
 * payments, swaps, deposits, agent turns). Services call `record()`; sinks decide where it goes
 * (pino logs, Telegram log channels). Recording never throws and never blocks the caller.
 *
 * Never put secrets in `fields`: no gift card codes, seed phrases or API keys. Phone numbers are
 * masked by the sinks.
 */
export type ActivityLevel = "info" | "warn" | "error";

export interface ActivityEntry {
  /** Dotted name, e.g. "swap.deposit_sent". */
  event: string;
  level?: ActivityLevel;
  circleId?: number | null;
  fields?: Record<string, unknown>;
}

export interface ActivityLog {
  record(entry: ActivityEntry): void;
}

export const noActivityLog: ActivityLog = { record: () => undefined };

/** Fans one entry out to several sinks. */
export class CompositeActivityLog implements ActivityLog {
  constructor(private readonly sinks: ActivityLog[]) {}
  record(entry: ActivityEntry): void {
    for (const sink of this.sinks) {
      try {
        sink.record(entry);
      } catch {
        /* a broken sink must never break the bot */
      }
    }
  }
}
