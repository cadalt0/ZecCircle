import { Composer, type CallbackQueryContext, type Context } from "grammy";
import { type BotDeps, replyWithError } from "../deps.js";
import { esc } from "../format.js";
import { CallbackAction, callbackPattern, type CallbackActionCode } from "../keyboards.js";

type Handler = (ctx: CallbackQueryContext<Context>, id: number, actorId: number) => Promise<string>;

/**
 * Inline-button handlers. Each handler returns a short status line that replaces the buttons,
 * so a decision can't be pressed twice. Authorization is enforced in the services.
 */
export function callbackHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const { circleService, purchaseService } = deps;

  const on = (action: CallbackActionCode, handler: Handler) => {
    composer.callbackQuery(callbackPattern(action), async (ctx) => {
      const id = Number(ctx.match[1]);
      try {
        const status = await handler(ctx, id, ctx.from.id);
        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup().catch(() => undefined);
        await ctx.reply(status, { parse_mode: "HTML" });
      } catch (error) {
        await replyWithError(ctx, error, deps.logger);
      }
    });
  };

  on(CallbackAction.purchaseApprove, async (_ctx, purchaseId, actor) => {
    const outcome = await purchaseService.approve(purchaseId, actor);
    return outcome.kind === "executing" ? "✅ Approved. Buying it now." : `🚫 Could not approve: ${esc(outcome.kind === "denied" ? outcome.reason : "")}`;
  });

  on(CallbackAction.purchaseReject, async (_ctx, purchaseId, actor) => {
    await purchaseService.reject(purchaseId, actor);
    return "❌ Rejected. The member has been told.";
  });

  on(CallbackAction.kickConfirm, async (_ctx, memberId, actor) => {
    const member = await circleService.removeMember(actor, memberId);
    return `Removed ${esc(member.displayName)}.`;
  });

  on(CallbackAction.kickAbort, async () => "Kept.");

  // Stale or unknown buttons (e.g. from an older bot version).
  composer.on("callback_query:data", (ctx) => ctx.answerCallbackQuery({ text: "This button is no longer active." }));

  return composer;
}
