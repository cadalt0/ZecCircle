import { Composer, type Context } from "grammy";
import { invalidInput } from "../../lib/errors.js";
import { parseAmountToMinor } from "../../lib/money.js";
import { args, type BotDeps, parseMemberId, replyWithError } from "../deps.js";
import { esc, memberLine, money } from "../format.js";
import { kickKeyboard } from "../keyboards.js";

/** Member management: list, limits, pause, kick, leave. */
export function memberHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { circleService } = deps;

  composer.command("members", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle } = await circleService.requireOwner(ctx.from.id);
      const members = await circleService.listMembers(ctx.from.id);
      const body = members.map((m) => memberLine(m, circle.currency)).join("\n\n");
      await ctx.reply(
        `<b>${esc(circle.name)}</b> — members\n\n${body}\n\n` +
          `Change limits: /setlimit &lt;id&gt; &lt;per-purchase&gt; &lt;monthly&gt;\nRemove: /kick &lt;id&gt;`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("setlimit", async (ctx) => {
    if (!ctx.from) return;
    try {
      const [rawId, rawPer, rawMonthly] = args(ctx.match);
      const memberId = parseMemberId(rawId);
      if (memberId === null || !rawPer || !rawMonthly) {
        throw invalidInput("Usage: /setlimit <member id> <per-purchase> <monthly>, e.g. /setlimit 3 2 5");
      }
      const { circle } = await circleService.requireOwner(ctx.from.id);
      const member = await circleService.setMemberLimits(
        ctx.from.id,
        memberId,
        parseAmountToMinor(rawPer),
        parseAmountToMinor(rawMonthly),
      );
      await ctx.reply(
        `✅ ${esc(member.displayName)}: ${money(member.perPurchaseLimitMinor, circle.currency)} per purchase, ` +
          `${money(member.monthlyLimitMinor, circle.currency)} per month.`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command(["pause", "resume"], async (ctx) => {
    if (!ctx.from) return;
    try {
      const pause = ctx.message?.text?.startsWith("/pause") ?? false;
      const memberId = parseMemberId(args(ctx.match)[0]);
      if (memberId === null) throw invalidInput(`Usage: /${pause ? "pause" : "resume"} <member id>. See /members.`);
      const member = await circleService.setMemberPaused(ctx.from.id, memberId, pause);
      await ctx.reply(`${pause ? "⏸ Paused" : "▶️ Resumed"} ${esc(member.displayName)}.`, { parse_mode: "HTML" });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("kick", async (ctx) => {
    if (!ctx.from) return;
    try {
      const memberId = parseMemberId(args(ctx.match)[0]);
      if (memberId === null) throw invalidInput("Usage: /kick <member id>. See /members.");
      const member = await circleService.getMemberForOwner(ctx.from.id, memberId);
      if (member.role === "owner") throw invalidInput("You can't remove yourself.");
      await ctx.reply(`Remove <b>${esc(member.displayName)}</b> from the circle? Their open requests will be cancelled.`, {
        parse_mode: "HTML",
        reply_markup: kickKeyboard(member.id),
      });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("leave", async (ctx) => {
    if (!ctx.from) return;
    try {
      const circle = await circleService.leave(ctx.from.id);
      deps.agent.reset(ctx.from.id);
      await ctx.reply(`You left <b>${esc(circle.name)}</b>.`, { parse_mode: "HTML" });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  return composer;
}
