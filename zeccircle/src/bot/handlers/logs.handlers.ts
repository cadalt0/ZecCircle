import { randomInt } from "node:crypto";
import { Composer, type Context } from "grammy";
import type { Logger } from "../../lib/logger.js";
import type { ActivityLog } from "../../services/activity/activity-log.js";
import type { CircleService } from "../../services/circle.service.js";
import { esc } from "../format.js";
import type { TelegramLogChannel } from "../log-channel.js";

export interface LogHandlerDeps {
  logChannel: TelegramLogChannel;
  activity: ActivityLog;
  circleService: CircleService;
  /** Bot admins may also follow every circle (`/circlelogs all`). Optional. */
  adminTelegramIds: number[];
  logger: Logger;
}

/** What a pairing code turns on: one circle, or (null) every circle. */
interface PendingCode {
  userId: number;
  circleId: number | null;
  expiresAt: number;
}

const CODE_TTL_MS = 10 * 60_000;

/**
 * Activity log for a circle, sent to a group or channel of the owner's choice.
 *
 *   /circlelogs            in a GROUP     the circle owner turns on that circle's logs for the group
 *   /circlelogs            in a PRIVATE chat    the owner gets a one-time code (use it for a CHANNEL)
 *   /circlelogs CODE       in a channel/group   turns it on using the code
 *   /circlelogs off        in a group/channel   turns this circle's logs off there
 *
 * Any circle owner can do this for their own circle, and a chat only ever receives the circle(s) it was
 * registered for. Bot admins (ADMIN_TELEGRAM_IDS) can additionally use "/circlelogs all" for every circle.
 * Channels need the code because channel posts don't say who wrote them.
 */
export function logHandlers(deps: LogHandlerDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const codes = new Map<string, PendingCode>();
  const isAdmin = (id: number | undefined) => id !== undefined && deps.adminTelegramIds.includes(id);

  /** The circle this user owns, or null. */
  const ownedCircle = async (userId: number | undefined) => {
    if (userId === undefined) return null;
    const membership = await deps.circleService.getMembership(userId);
    return membership?.member.role === "owner" ? membership.circle : null;
  };

  composer.command("whoami", async (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    await ctx.reply(`Your Telegram id is <code>${ctx.from.id}</code>.`, { parse_mode: "HTML" });
  });

  composer.command("circlelogs", async (ctx) => {
    const chat = ctx.chat;
    if (!chat) return;
    const arg = (typeof ctx.match === "string" ? ctx.match : "").trim();
    const word = arg.toLowerCase();
    const reply = (text: string, html = false) => ctx.reply(text, html ? { parse_mode: "HTML" } : {}).catch(() => undefined);

    // ---------------------------------------------------------------- private chat: hand out a code
    if (chat.type === "private") {
      const wantsAll = word === "all";
      if (wantsAll && !isAdmin(ctx.from?.id)) return void (await reply("Only bot admins can follow every circle."));
      const circle = wantsAll ? null : await ownedCircle(ctx.from?.id);
      if (!wantsAll && !circle) {
        return void (await reply("Only a circle owner can turn on activity logs, and only for their own circle. Create one with /newcircle first."));
      }
      const code = newCode();
      codes.set(code, { userId: ctx.from!.id, circleId: circle?.id ?? null, expiresAt: Date.now() + CODE_TTL_MS });
      await reply(
        `Post this in the group or channel that should receive ${circle ? `<b>${esc(circle.name)}</b>'s` : "every circle's"} activity (valid 10 minutes):\n\n` +
          `<code>/circlelogs ${code}</code>\n\nThe bot must be a member of that chat and allowed to post. ` +
          `In a group you can skip the code and just send /circlelogs there yourself.`,
        true,
      );
      return;
    }

    // ---------------------------------------------------------------- group / channel
    const title = "title" in chat ? (chat.title ?? null) : null;

    if (word === "off" || word === "off all") {
      // Channel posts have no sender (only channel admins can post), so they may switch it off.
      if (chat.type === "channel") {
        await deps.logChannel.remove(chat.id);
        return void (await reply("🛑 Activity logs stopped for this channel."));
      }
      if (word === "off all") {
        if (!isAdmin(ctx.from?.id)) return;
        await deps.logChannel.remove(chat.id, null);
        return void (await reply("🛑 The all-circles feed is off for this chat."));
      }
      const circle = await ownedCircle(ctx.from?.id);
      if (!circle) return void (await reply("Only the circle's owner can turn its logs off."));
      const removed = await deps.logChannel.remove(chat.id, circle.id);
      await reply(removed ? `🛑 ${circle.name}'s activity logs are off for this chat.` : "Logs were not on for your circle here.");
      return;
    }

    let circleId: number | null;
    let circleName: string | null = null;
    let addedBy: number | null;

    if (arg && word !== "all") {
      const code = arg.toUpperCase();
      const pending = codes.get(code);
      codes.delete(code);
      if (!pending || pending.expiresAt < Date.now()) {
        return void (await reply("That code is invalid or expired. Get a new one with /circlelogs in a private chat with the bot."));
      }
      circleId = pending.circleId;
      addedBy = pending.userId;
      circleName = circleId === null ? null : ((await deps.circleService.getMembership(pending.userId))?.circle.name ?? null);
    } else if (word === "all") {
      if (chat.type === "channel" || !isAdmin(ctx.from?.id)) return void (await reply("Only bot admins can follow every circle."));
      circleId = null;
      addedBy = ctx.from!.id;
    } else if (chat.type !== "channel") {
      const circle = await ownedCircle(ctx.from?.id);
      if (!circle) return void (await reply("Only a circle owner can turn on activity logs, for their own circle."));
      circleId = circle.id;
      circleName = circle.name;
      addedBy = ctx.from!.id;
    } else {
      // A bare /circlelogs in a channel: we can't tell who posted it.
      return void (await reply("In a channel, get a code first: send /circlelogs to the bot in a private chat, then post the code here."));
    }

    await deps.logChannel.add(chat.id, circleId, title, addedBy);
    deps.logger.info({ chatId: chat.id, chatType: chat.type, circleId, addedBy }, "log channel added");
    await reply(
      `📡 Activity logs are on for ${circleId === null ? "every circle" : `<b>${esc(circleName ?? `circle #${circleId}`)}</b>`} in this ${esc(chat.type)}. ` +
        `Every action will appear here as a short message (paced to stay within Telegram's limits). ` +
        `Gift card codes and keys are never logged; phone numbers are masked.\n\nStop with <code>/circlelogs off</code>.`,
      true,
    );
    deps.activity.record({ event: "bot.log_channel_added", circleId, fields: { chat: `${chat.type} ${title ?? chat.id}`, by: addedBy } });
  });

  return composer;
}

function newCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[randomInt(alphabet.length)];
  return code;
}
