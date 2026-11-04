import { inspect } from "node:util";

/**
 * Removes secrets from any text before it is logged:
 * - Telegram bot tokens (they appear inside API URLs in network errors)
 * - passwords in database connection strings
 * - Anthropic API keys
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot<redacted>")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/g, "$1<redacted>@")
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-<redacted>");
}

/**
 * Libraries sometimes print errors straight to the console (e.g. the grammY runner's
 * "Error while fetching updates"). Route those through the same redaction.
 */
export function redactConsole(): void {
  for (const level of ["error", "warn", "log"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) =>
      original(...args.map((a) => redactSecrets(typeof a === "string" ? a : inspect(a, { depth: 4 }))));
  }
}
