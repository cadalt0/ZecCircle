import { pino, type Logger } from "pino";
import { redactSecrets } from "./redact.js";

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    // Never let secrets reach the logs, even if an object containing them is logged by mistake.
    redact: {
      paths: ["*.apiKey", "*.token", "*.authorization", "headers.authorization", "*.redemption"],
      censor: "[redacted]",
    },
    // Last line of defence: scrub tokens/passwords that end up inside error messages and URLs.
    hooks: { streamWrite: (line: string) => redactSecrets(line) },
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
      : {}),
  });
}
