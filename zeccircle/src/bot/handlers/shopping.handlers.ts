import { Composer, type Context } from "grammy";
import { type BotDeps, replyWithError } from "../deps.js";
import { esc, money, purchaseHistoryLine, purchaseSummary } from "../format.js";

/** Free-text shopping via the agent, plus /me, /history and /reset. */
export function shoppingHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { circleService, purchaseService, agent } = deps;

  composer.command("me", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle, member } = await circleService.requireActiveMembership(ctx.from.id);
      const spent = await circleService.getSpend(member);
      const c = circle.currency;
      const lines =
        member.role === "owner"
          ? [`You're the owner of <b>${esc(circle.name)}</b>.`, `Circle cap: ${money(circle.monthlyLimitMinor, c)}/month`]
          : [
              `Circle: <b>${esc(circle.name)}</b>`,
              `Per purchase: ${money(member.perPurchaseLimitMinor, c)}`,
              `Monthly: ${money(member.monthlyLimitMinor, c)} (spent ${money(spent.memberSpentMinor, c)})`,
            ];
      lines.push(`Circle spent this month: ${money(spent.circleSpentMinor, c)} of ${money(circle.monthlyLimitMinor, c)}`);
      if (circle.paused) lines.push("⏸ The circle is paused.");
      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("history", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle, member } = await circleService.requireActiveMembership(ctx.from.id);
      if (member.role === "owner") {
        const names = new Map((await circleService.listMembers(ctx.from.id)).map((m) => [m.id, m.displayName]));
        const items = await purchaseService.recentForCircle(circle.id);
        await ctx.reply(
          items.length
            ? `<b>Recent purchases</b>\n\n${items.map((p) => purchaseHistoryLine(p, names.get(p.memberId) ?? `#${p.memberId}`)).join("\n")}`
            : "No purchases yet.",
          { parse_mode: "HTML" },
        );
        return;
      }
      const items = await purchaseService.recentForMember(member.id);
      await ctx.reply(
        items.length ? `<b>Your recent purchases</b>\n\n${items.map((p) => purchaseHistoryLine(p)).join("\n")}` : "No purchases yet.",
        { parse_mode: "HTML" },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("reset", async (ctx) => {
    if (!ctx.from) return;
    agent.reset(ctx.from.id);
    await ctx.reply("Started a fresh conversation.");
  });

  // Any other text message (not a command) goes to the shopping agent.
  composer.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. See /help.");
      return;
    }

    try {
      await circleService.requireActiveMembership(ctx.from.id);
      if (!deps.agentRateLimiter.tryAcquire(String(ctx.from.id))) {
        await ctx.reply("You're sending messages quickly — give me a few seconds.");
        return;
      }

      await ctx.replyWithChatAction("typing");
      const typing = setInterval(() => void ctx.replyWithChatAction("typing").catch(() => undefined), 4_500);
      let reply;
      try {
        reply = await agent.handle(ctx.from.id, text.slice(0, 2000));
      } finally {
        clearInterval(typing);
      }

      await ctx.reply(reply.text, { link_preview_options: { is_disabled: true } });
      // The member's request is the confirmation: submit what the agent proposed. Over-limit orders
      // go to the owner (the notifier tells both sides); within-limit orders start buying.
      for (const purchase of reply.proposals) {
        const outcome = await purchaseService.confirm(purchase.id, ctx.from.id);
        if (outcome.kind === "executing") {
          await ctx.reply(`🛒 Buying now:\n\n${purchaseSummary(purchase)}\n\nI'll send it here when it's delivered.`, {
            parse_mode: "HTML",
          });
        } else if (outcome.kind === "denied") {
          await ctx.reply(`🚫 Not allowed: ${esc(outcome.reason)}`, { parse_mode: "HTML" });
        }
      }
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  return composer;
}
