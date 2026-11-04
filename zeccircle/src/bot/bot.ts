import { sequentialize } from "@grammyjs/runner";
import { Bot, HttpError, type Context } from "grammy";
import type { BotDeps } from "./deps.js";
import { callbackHandlers } from "./handlers/callback.handlers.js";
import { circleHandlers } from "./handlers/circle.handlers.js";
import { fundingHandlers } from "./handlers/funding.handlers.js";
import { logHandlers } from "./handlers/logs.handlers.js";
import { memberHandlers } from "./handlers/member.handlers.js";
import { shoppingHandlers } from "./handlers/shopping.handlers.js";
import { startHandlers } from "./handlers/start.handlers.js";

export const BOT_COMMANDS = [
  { command: "help", description: "What I can do" },
  { command: "me", description: "Your limits and spend" },
  { command: "history", description: "Recent purchases" },
  { command: "fund", description: "Add ZEC to the circle wallet" },
  { command: "wallet", description: "Circle wallet balance and deposits" },
  { command: "newcircle", description: "Create a circle (owner)" },
  { command: "invite", description: "Create an invite link (owner)" },
  { command: "members", description: "Members and limits (owner)" },
  { command: "setlimit", description: "Set a member's limits (owner)" },
  { command: "circlelimit", description: "Set the circle's monthly cap (owner)" },
  { command: "circle", description: "Circle overview (owner)" },
  { command: "reset", description: "Start a fresh conversation" },
  { command: "whoami", description: "Show your Telegram id" },
  { command: "leave", description: "Leave your circle" },
] as const;

/** Registers all middleware and handlers on an existing Bot instance. */
export function configureBot(bot: Bot<Context>, deps: BotDeps): void {
  // Updates from the same chat run in order; different chats run concurrently.
  bot.use(sequentialize((ctx: Context) => ctx.chat?.id.toString()));

  // This bot handles money: only private chats, never groups or channels.
  // /circlelogs and /whoami work in groups and channels (log channels), so they come first.
  if (deps.logs) bot.use(logHandlers(deps.logs));

  // Everything else is private-chat only. Other group/channel traffic is ignored silently, so a
  // log group full of messages doesn't make the bot reply to each one.
  bot.on(["message", "callback_query"], async (ctx, next) => {
    if (ctx.chat?.type === "private") return next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
  });

  bot.use(startHandlers(deps));
  bot.use(circleHandlers(deps));
  bot.use(memberHandlers(deps));
  bot.use(fundingHandlers(deps));
  bot.use(callbackHandlers(deps));
  // Must be last: it catches all remaining text messages.
  bot.use(shoppingHandlers(deps));

  bot.catch((err) => {
    if (err.error instanceof HttpError) {
      // Network trouble talking to Telegram (already retried). Not a bug: log one short line.
      deps.logger.warn({ update: err.ctx.update.update_id, reason: err.error.message }, "could not reach Telegram");
      return;
    }
    deps.logger.error({ err: err.error, update: err.ctx.update.update_id }, "unhandled bot error");
  });
}
