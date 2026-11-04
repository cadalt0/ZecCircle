import type { Api, InlineKeyboard } from "grammy";
import type { Logger } from "../lib/logger.js";
import type { Purchase } from "../domain/types.js";
import { zatToZecString } from "../integrations/zcash/units.js";
import type { Settlement } from "../services/funding/funding-rail.js";
import type { CircleEvent, Notifier } from "../services/notifier.js";
import { esc, formatRedemption, money, purchaseSummary, txLink } from "./format.js";
import { approvePurchaseKeyboard } from "./keyboards.js";

/** Delivers domain events as Telegram messages. Never throws. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: Api,
    private readonly logger: Logger,
    private readonly explorerTxUrl: string,
  ) {}

  /** The order's own reference so members never have to ask for it: our order number and Bitrefill's invoice id. */
  private receiptLine(p: Purchase): string {
    const invoice = p.invoiceId ? ` · Bitrefill invoice <code>${esc(p.invoiceId)}</code>` : "";
    return `\nOrder #${p.id}${invoice}`;
  }

  private paidLine(s: Settlement | null): string {
    if (!s) return "";
    const net = s.network === "test" ? " (testnet)" : s.network === "main" ? " (mainnet)" : "";
    const swap = s.swap ? `\nSwapped via NEAR Intents → ${esc(s.swap.usdcAmount)} USDC → Bitrefill store credit (invoice <code>${esc(s.swap.bitrefillTopUpInvoiceId)}</code>)` : "";
    return `\nPaid ${zatToZecString(s.amountZat)} ZEC${net} · ${txLink(s.txid, this.explorerTxUrl, s.network)}${swap}`;
  }

  async notify(event: CircleEvent): Promise<void> {
    try {
      await this.dispatch(event);
    } catch (error) {
      this.logger.error({ err: error, event: event.type }, "failed to deliver notification");
    }
  }

  private async dispatch(event: CircleEvent): Promise<void> {
    const owner = event.circle.ownerTelegramId;
    switch (event.type) {
      case "member_joined":
        await this.send(
          event.member.telegramId,
          `🎉 You're in <b>${esc(event.circle.name)}</b>!\n\n` +
            `Your limits: ${money(event.member.perPurchaseLimitMinor, event.circle.currency)} per purchase, ` +
            `${money(event.member.monthlyLimitMinor, event.circle.currency)} per month.\n\n` +
            `Just tell me what you need, e.g. <i>"recharge my Jio number +91 98xxxxxx12 with ₹199"</i> or <i>"a $5 Amazon gift card"</i>.`,
        );
        return this.send(
          owner,
          `👋 <b>${esc(event.member.displayName)}</b> joined <b>${esc(event.circle.name)}</b> ` +
            `(member #${event.member.id}, ${money(event.member.perPurchaseLimitMinor, event.circle.currency)}/purchase, ` +
            `${money(event.member.monthlyLimitMinor, event.circle.currency)}/month). Change it with /setlimit ${event.member.id} &lt;per-purchase&gt; &lt;monthly&gt;.`,
        );

      case "member_removed":
        return this.send(event.member.telegramId, `You were removed from <b>${esc(event.circle.name)}</b>.`);

      case "member_left":
        return this.send(owner, `${esc(event.member.displayName)} left <b>${esc(event.circle.name)}</b>.`);

      case "purchase_needs_approval":
        await this.send(
          owner,
          `🛒 <b>${esc(event.member.displayName)}</b> wants to buy:\n\n${purchaseSummary(event.purchase)}\n\n` +
            `Needs your approval: ${esc(event.reasons.join(", "))}.`,
          approvePurchaseKeyboard(event.purchase.id),
        );
        return this.send(event.member.telegramId, `⏳ Sent to the circle owner for approval. I'll let you know.`);

      case "purchase_approved":
        return this.send(
          event.member.telegramId,
          `✅ The owner approved <b>${esc(event.purchase.productName)}</b>. Buying it now…`,
        );

      case "purchase_rejected":
        return this.send(
          event.member.telegramId,
          `❌ The owner declined <b>${esc(event.purchase.productName)}</b> (${esc(event.purchase.value)}).`,
        );

      case "purchase_failed":
        await this.send(
          event.member.telegramId,
          `⚠️ Couldn't complete <b>${esc(event.purchase.productName)}</b>: ${esc(event.reason)}` +
            (event.settlement ? `\n\nNote: the ZEC payment had already been sent.${this.paidLine(event.settlement)}` : ""),
        );
        if (event.member.telegramId !== owner) {
          await this.send(
            owner,
            `⚠️ Purchase #${event.purchase.id} for ${esc(event.member.displayName)} failed: ${esc(event.reason)}`,
          );
        }
        return;

      case "purchase_progress":
        return this.send(event.member.telegramId, esc(event.message));

      case "purchase_delayed":
        await this.send(
          event.member.telegramId,
          `⏳ Bitrefill is still processing <b>${esc(event.purchase.productName)}</b>. It's paid; I'll keep it on record.`,
        );
        if (event.member.telegramId === owner) return; // the owner already got the message above
        return this.send(
          owner,
          `⏳ Purchase #${event.purchase.id} is paid but not delivered yet. Bitrefill invoice: <code>${esc(event.purchase.invoiceId)}</code>`,
        );

      case "purchase_completed": {
        const details = event.redemptions.length
          ? event.redemptions.map(formatRedemption).join("\n\n")
          : event.purchase.phoneNumber
            ? `Top-up sent to <code>${esc(event.purchase.phoneNumber)}</code>.`
            : "Delivered.";
        // protect_content stops the code from being forwarded or saved from this chat.
        await this.send(
          event.member.telegramId,
          `🎁 <b>${esc(event.purchase.productName)}</b> is ready!\n\n${details}\n` +
            `${this.receiptLine(event.purchase)}${this.paidLine(event.settlement)}`,
          undefined,
          { protectContent: true },
        );
        if (event.member.telegramId !== owner) {
          await this.send(
            owner,
            `🧾 ${esc(event.member.displayName)} bought <b>${esc(event.purchase.productName)}</b> (${esc(event.purchase.value)}) ` +
              `for ${money(event.purchase.paidMinor ?? event.purchase.quotedMinor, event.purchase.currency)}.${this.paidLine(event.settlement)}`,
          );
        }
        return;
      }

      case "deposit_seen": {
        const text =
          `💰 Incoming ${zatToZecString(event.amountZat)} ZEC to <b>${esc(event.circle.name)}</b> ` +
          `(${txLink(event.txid, this.explorerTxUrl, event.network)}). Waiting for confirmations…`;
        if (event.requesterTelegramId !== null && event.requesterTelegramId !== owner) {
          await this.send(event.requesterTelegramId, text);
        }
        await this.send(owner, text);
        return;
      }

      case "deposit_confirmed": {
        const text =
          `✅ ${zatToZecString(event.amountZat)} ZEC confirmed for <b>${esc(event.circle.name)}</b> ` +
          `(${txLink(event.txid, this.explorerTxUrl, event.network)}).\n` +
          `Circle balance: <b>${zatToZecString(event.balance.availableZat)} ZEC</b> ` +
          `(about ${money(event.balance.availableFiatMinor, event.circle.currency)}).`;
        if (event.requesterTelegramId !== null && event.requesterTelegramId !== owner) {
          await this.send(event.requesterTelegramId, text);
        }
        await this.send(owner, text);
        return;
      }
    }
  }

  private async send(
    chatId: number,
    html: string,
    keyboard?: InlineKeyboard,
    opts: { protectContent?: boolean } = {},
  ): Promise<void> {
    await this.api.sendMessage(chatId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
      ...(opts.protectContent ? { protect_content: true } : {}),
    });
  }
}
