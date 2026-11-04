import type { Context } from "grammy";
import type { ShoppingAgent } from "../agent/shopping-agent.js";
import { DomainError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { SlidingWindowRateLimiter } from "../lib/rate-limiter.js";
import type { CircleService } from "../services/circle.service.js";
import type { PurchaseService } from "../services/purchase.service.js";
import type { ZcashFundingService } from "../services/funding/zcash-funding.service.js";
import type { ZcashWallet } from "../integrations/zcash/wallet.js";
import type { LogHandlerDeps } from "./handlers/logs.handlers.js";
import { esc } from "./format.js";

export interface BotDeps {
  circleService: CircleService;
  purchaseService: PurchaseService;
  agent: ShoppingAgent;
  agentRateLimiter: SlidingWindowRateLimiter;
  currency: string;
  /** Null when Zcash funding is off. */
  zcash: { service: ZcashFundingService; wallet: ZcashWallet; explorerTxUrl: string } | null;
  /** Developer log channel (/circlelogs). */
  logs?: LogHandlerDeps;
  logger: Logger;
}

/** Shows DomainError messages to the user; logs anything else and shows a generic message. */
export async function replyWithError(ctx: Context, error: unknown, logger: Logger): Promise<void> {
  const message =
    error instanceof DomainError ? error.message : "Something went wrong on our side. Please try again in a moment.";
  if (!(error instanceof DomainError)) {
    logger.error({ err: error, update: ctx.update.update_id }, "handler error");
  }

  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: message.slice(0, 190), show_alert: true }).catch(() => undefined);
    return;
  }
  await ctx.reply(`⚠️ ${esc(message)}`, { parse_mode: "HTML" }).catch(() => undefined);
}

/** Splits command arguments on whitespace. */
export const args = (match: string | RegExpMatchArray | undefined): string[] =>
  (typeof match === "string" ? match : "").trim().split(/\s+/).filter(Boolean);

/** Accepts "12" or "#12". */
export function parseMemberId(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^#?(\d{1,12})$/.exec(raw);
  return m ? Number(m[1]) : null;
}
