import { Composer, type Context } from "grammy";
import { invalidInput } from "../../lib/errors.js";
import { parseAmountToMinor } from "../../lib/money.js";
import { startOfMonthUtcIso } from "../../lib/time.js";
import { args, type BotDeps, replyWithError } from "../deps.js";
import { circleSummary, displayNameOf, esc, money } from "../format.js";
import { INVITE_PAYLOAD_PREFIX } from "./start.handlers.js";

/** Circle-level owner commands: create, invite, caps, pause. */
export function circleHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { circleService } = deps;

  composer.command("newcircle", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle } = await circleService.createCircle(
        { telegramId: ctx.from.id, displayName: displayNameOf(ctx.from) },
        ctx.match,
      );
      await ctx.reply(
        `✅ Circle <b>${esc(circle.name)}</b> created. You're the owner.\n\n` +
          `Monthly cap for the whole circle: <b>${money(circle.monthlyLimitMinor, circle.currency)}</b> (change with /circlelimit).\n` +
          `New members get ${money(circle.defaultPerPurchaseLimitMinor, circle.currency)} per purchase and ` +
          `${money(circle.defaultMemberMonthlyLimitMinor, circle.currency)} per month.\n\n` +
          `Next: /invite to add someone.`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("invite", async (ctx) => {
    if (!ctx.from) return;
    try {
      const [rawUses] = args(ctx.match);
      let maxUses = 1;
      if (rawUses !== undefined) {
        if (!/^\d{1,3}$/.test(rawUses)) throw invalidInput("Usage: /invite [number of joins], e.g. /invite 3");
        maxUses = Number(rawUses);
      }
      const invite = await circleService.createInvite(ctx.from.id, maxUses);
      const link = `https://t.me/${ctx.me.username}?start=${INVITE_PAYLOAD_PREFIX}${invite.token}`;
      const hours = Math.round((invite.expiresAt.getTime() - Date.now()) / 3_600_000);
      await ctx.reply(
        `🔗 Invite link (${invite.maxUses === 1 ? "1 join" : `${invite.maxUses} joins`}, expires in ${hours}h):\n\n${esc(link)}\n\n` +
          `Anyone who opens it joins right away with the default limits. Need more people? Run /invite again with a bigger number. ` +
          `Cancel unused links with /revokeinvites.`,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("revokeinvites", async (ctx) => {
    if (!ctx.from) return;
    try {
      const count = await circleService.revokeInvites(ctx.from.id);
      await ctx.reply(count > 0 ? `Revoked ${count} unused invite link(s).` : "There were no unused invite links.");
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("circle", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle, member } = await circleService.requireOwner(ctx.from.id);
      const spent = (await circleService.getSpend(member)).circleSpentMinor;
      const members = await circleService.listMembers(ctx.from.id);
      await ctx.reply(
        `${circleSummary(circle, spent)}\nMembers: ${members.length}\n` +
          `Month started: ${startOfMonthUtcIso().slice(0, 10)} (UTC)`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("circlelimit", async (ctx) => {
    if (!ctx.from) return;
    try {
      const [raw] = args(ctx.match);
      if (!raw) throw invalidInput("Usage: /circlelimit <monthly amount>, e.g. /circlelimit 10");
      const circle = await circleService.setCircleMonthlyLimit(ctx.from.id, parseAmountToMinor(raw));
      await ctx.reply(`✅ Circle monthly cap is now <b>${money(circle.monthlyLimitMinor, circle.currency)}</b>.`, {
        parse_mode: "HTML",
      });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command(["pausecircle", "resumecircle"], async (ctx) => {
    if (!ctx.from) return;
    try {
      const pause = ctx.message?.text?.startsWith("/pausecircle") ?? false;
      const circle = await circleService.setCirclePaused(ctx.from.id, pause);
      await ctx.reply(
        circle.paused
          ? "⏸ Circle paused. No purchases can go through until you /resumecircle."
          : "▶️ Circle resumed. Purchases are allowed again.",
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  return composer;
}
