import { Composer, InputFile, type Context } from "grammy";
import QRCode from "qrcode";
import { zatToZecString, zecStringToZat } from "../../integrations/zcash/units.js";
import { MockZcashWallet } from "../../integrations/zcash/mock-wallet.js";
import { invalidInput } from "../../lib/errors.js";
import { args, type BotDeps, replyWithError } from "../deps.js";
import { esc, money, txLink } from "../format.js";

/** Zcash funding: /fund, /wallet, and /testdeposit (mock mode only). */
export function fundingHandlers(deps: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const zcash = deps.zcash;

  if (!zcash) {
    composer.command(["fund", "wallet"], (ctx) => ctx.reply("Zcash funding is not enabled on this bot."));
    return composer;
  }
  const { service, wallet, explorerTxUrl } = zcash;
  const networkLabel =
    wallet.network === "main" ? "mainnet ZEC, real money" : wallet.network === "test" ? "testnet TAZ" : "TEST MODE, simulated";

  composer.command("fund", async (ctx) => {
    if (!ctx.from) return;
    try {
      const [rawAmount] = args(ctx.match);
      let amountZat: number | null = null;
      if (rawAmount) {
        try {
          amountZat = zecStringToZat(rawAmount);
        } catch {
          throw invalidInput("Usage: /fund [amount in ZEC], e.g. /fund 0.5");
        }
        if (amountZat <= 0) throw invalidInput("Amount must be more than 0.");
      }

      const req = await service.createFundingRequest(ctx.from.id, amountZat);
      const qr = await QRCode.toBuffer(req.uri, { errorCorrectionLevel: "M", margin: 2, width: 512 });

      await ctx.replyWithPhoto(new InputFile(qr, "zcash-payment.png"), {
        caption: `Scan with a Zcash wallet (${networkLabel}) to fund ${req.circle.name}.`,
      });
      await ctx.reply(
        `💰 <b>Fund ${esc(req.circle.name)}</b> with shielded ZEC (${networkLabel})\n\n` +
          `Payment link:\n<code>${esc(req.uri)}</code>\n\n` +
          `Or send manually:\n` +
          `Address: <code>${esc(req.address)}</code>\n` +
          (req.amountZat ? `Amount: ${zatToZecString(req.amountZat)} ZEC\n` : "") +
          `Memo (optional): <code>${esc(req.memo)}</code>\n` +
          `\nThis shielded address belongs to your circle only, so anything sent to it is credited to ${esc(req.circle.name)}. ` +
          `The memo is just a backup. Send from a shielded wallet so the sender, amount and memo stay private.\n\n` +
          `Current balance: <b>${zatToZecString(req.balance.availableZat)} ZEC</b> (about ${money(req.balance.availableFiatMinor, req.circle.currency)})`,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  composer.command("wallet", async (ctx) => {
    if (!ctx.from) return;
    try {
      const { circle } = await deps.circleService.requireActiveMembership(ctx.from.id);
      const balance = await service.getBalance(circle.id);
      const deposits = await service.recentDeposits(circle.id);
      const lines = [
        `👛 <b>${esc(circle.name)}</b> wallet (${networkLabel})`,
        `Available: <b>${zatToZecString(balance.availableZat)} ZEC</b> (about ${money(balance.availableFiatMinor, circle.currency)})`,
      ];
      if (balance.pendingZat > 0) lines.push(`Waiting for confirmations: ${zatToZecString(balance.pendingZat)} ZEC`);
      if (deposits.length) {
        lines.push("", "<b>Recent deposits</b>");
        for (const d of deposits) {
          lines.push(`${d.status === "confirmed" ? "✅" : "⏳"} ${zatToZecString(d.amountZat)} ZEC · ${txLink(d.txid, explorerTxUrl, wallet.network)}`);
        }
      }
      lines.push("", "Top up with /fund");
      await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch (error) {
      await replyWithError(ctx, error, deps.logger);
    }
  });

  // Mock mode only: pretend someone paid the latest /fund request, so the flow can be tested offline.
  if (wallet instanceof MockZcashWallet) {
    composer.command("testdeposit", async (ctx) => {
      if (!ctx.from) return;
      try {
        const [rawAmount = "1"] = args(ctx.match);
        let amountZat: number;
        try {
          amountZat = zecStringToZat(rawAmount);
        } catch {
          throw invalidInput("Usage: /testdeposit [amount in ZEC], e.g. /testdeposit 0.5");
        }
        const req = await service.createFundingRequest(ctx.from.id, amountZat);
        // Pay the circle's own address with no memo, the way a real shielded wallet payment would arrive.
        wallet.simulateDeposit(amountZat, null, req.address);
        await ctx.reply(
          `🧪 TEST MODE: simulated a ${zatToZecString(amountZat)} ZEC deposit to the circle's address. ` +
            `It will show up on the next wallet sync.`,
          { parse_mode: "HTML" },
        );
      } catch (error) {
        await replyWithError(ctx, error, deps.logger);
      }
    });
  }

  return composer;
}
