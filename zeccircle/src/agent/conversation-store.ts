export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Short-lived, in-memory chat history per user. Only plain text turns are kept (no tool calls),
 * which keeps context small and lets old conversations simply expire.
 */
export class ConversationStore {
  private readonly conversations = new Map<number, { turns: Turn[]; touchedAt: number }>();

  constructor(
    private readonly maxTurns = 12,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  get(userId: number): Turn[] {
    const entry = this.conversations.get(userId);
    if (!entry) return [];
    if (this.now() - entry.touchedAt > this.ttlMs) {
      this.conversations.delete(userId);
      return [];
    }
    return [...entry.turns];
  }

  append(userId: number, ...turns: Turn[]): void {
    const existing = this.get(userId);
    const next = [...existing, ...turns].slice(-this.maxTurns);
    // The API requires the first message to be from the user.
    while (next.length > 0 && next[0]!.role !== "user") next.shift();
    this.conversations.set(userId, { turns: next, touchedAt: this.now() });
  }

  clear(userId: number): void {
    this.conversations.delete(userId);
  }
}
