import { Composer, type Context } from "grammy";
import { type BotDeps, replyWithError } from "../deps.js";
import { displayNameOf, esc } from "../format.js";

export const INVITE_PAYLOAD_PREFIX = "j_";

const OWNER_HELP = `<b>Owner commands</b>
/invite [joins] – create an invite link (1 join by default, e.g. /invite 3)
/members – list members, limits and spend
/setlimit &lt;id&gt; &lt;per-purchase&gt; &lt;monthly&gt; – e.g. /setlimit 3 2 5
/circlelimit &lt;monthly&gt; – hard cap for the whole circle
/pause &lt;id&gt; · /resume &lt;id&gt; – pause a member
/kick &lt;id&gt; – remove a member
/pausecircle · /resumecircle – stop all spending
/revokeinvites – invalidate unused invite links
/circle – circle overview
/history – recent purchases`;

const MEMBER_HELP = `<b>Shopping</b>
Just write what you need, e.g.
• <i>recharge +91 98xxxxxx12 with ₹199 Jio</i>
• <i>buy a $5 Amazon India gift card</i>

/me – your limits and spend
/fund [amount] – add shielded ZEC to the circle wallet
/wallet – circle wallet balance
/history – your recent purchases
/reset – start a fresh conversation
/leave – leave the circle`;

export function startHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.match.trim();
    try {
      if (payload.startsWith(INVITE_PAYLOAD_PREFIX)) {
        const token = payload.slice(INVITE_PAYLOAD_PREFIX.length);
        // The welcome message (with the member's limits) is sent by the notifier.
        await deps.circleService.join({ telegramId: ctx.from.id, displayName: displayNameOf(ctx.from) }, token);
        return;
      }
      await ctx.reply(await welcomeText(deps, ctx.from.id), { parse_mode: "HTML" });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("help", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply(await welcomeText(deps, ctx.from.id), { parse_mode: "HTML" });
  });

  return composer;
}

async function welcomeText(deps: BotDeps, telegramId: number): Promise<string> {
  const membership = await deps.circleService.getMembership(telegramId);
  if (!membership) {
    return `👋 <b>Welcome to ZecCircle</b>

Share a spending budget with your family. Members ask for gift cards, mobile top-ups or eSIMs in chat; an AI agent finds them on Bitrefill and buys within the limits you set.

• To start a circle: /newcircle &lt;name&gt;
• To join one: open the invite link the owner sent you.`;
  }

  const { circle, member } = membership;
  const header = `You're in <b>${esc(circle.name)}</b>${member.role === "owner" ? " as the owner 👑" : ""}.`;
  return member.role === "owner" ? `${header}\n\n${MEMBER_HELP}\n\n${OWNER_HELP}` : `${header}\n\n${MEMBER_HELP}`;
}
