import type { User } from "grammy/types";
import type { Circle, Member, Purchase } from "../domain/types.js";
import type { RedemptionInfo } from "../integrations/bitrefill/schemas.js";
import { formatMoney } from "../lib/money.js";
import { humanStatus } from "../services/purchase.service.js";
import type { ZcashNetwork } from "../integrations/zcash/wallet.js";

/** Escapes text for Telegram's HTML parse mode. Use on every user- or API-supplied string. */
export function esc(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function displayNameOf(user: User): string {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return (full || user.username || `user ${user.id}`).slice(0, 64);
}

export const money = (minor: number, currency: string) => formatMoney(minor, currency);

export function memberLine(m: Member & { spentMinor?: number }, currency: string): string {
  const role = m.role === "owner" ? " 👑" : "";
  const limits =
    m.role === "owner"
      ? "circle cap only"
      : `${money(m.perPurchaseLimitMinor, currency)}/purchase · ${money(m.monthlyLimitMinor, currency)}/month`;
  const spent = m.spentMinor !== undefined ? ` · spent ${money(m.spentMinor, currency)}` : "";
  return `<b>#${m.id}</b> ${esc(m.displayName)}${role} — ${m.status}\n    ${limits}${spent}`;
}

export function purchaseSummary(p: Purchase): string {
  const lines = [
    `<b>${esc(p.productName)}</b>`,
    `Value: ${esc(p.value)}`,
    `Cost: <b>${money(p.paidMinor ?? p.quotedMinor, p.currency)}</b>`,
  ];
  if (p.phoneNumber) lines.push(`Phone: <code>${esc(p.phoneNumber)}</code>`);
  return lines.join("\n");
}

export function purchaseHistoryLine(p: Purchase, who?: string): string {
  const date = p.createdAt.slice(0, 10);
  const by = who ? ` · ${esc(who)}` : "";
  const invoice = p.invoiceId && p.fulfilmentMode === "live" ? ` · invoice ${esc(p.invoiceId.slice(0, 8))}` : "";
  return `#${p.id} ${date}${by} · ${esc(p.productName)} ${esc(p.value)} · ${money(p.paidMinor ?? p.quotedMinor, p.currency)} · ${humanStatus(p.status)}${invoice}`;
}

export function circleSummary(c: Circle, spentMinor: number): string {
  return [
    `<b>${esc(c.name)}</b>${c.paused ? " (paused)" : ""}`,
    `Monthly cap: ${money(c.monthlyLimitMinor, c.currency)} · spent this month: ${money(spentMinor, c.currency)}`,
    `New members get: ${money(c.defaultPerPurchaseLimitMinor, c.currency)}/purchase · ${money(c.defaultMemberMonthlyLimitMinor, c.currency)}/month`,
  ].join("\n");
}

/** A short, linked txid. Mock txids are not linked anywhere. */
export function txLink(txid: string, explorerTxUrl: string, network: ZcashNetwork): string {
  const short = `${txid.slice(0, 10)}…${txid.slice(-6)}`;
  if (network === "mock") return `<code>${esc(short)}</code> (simulated)`;
  return `<a href="${esc(explorerTxUrl.replace("{txid}", txid))}">${esc(short)}</a>`;
}

export function formatRedemption(info: RedemptionInfo): string {
  if (typeof info === "string") return esc(info);
  const parts: string[] = [];
  if (info.code) parts.push(`Code: <code>${esc(info.code)}</code>`);
  if (info.pin) parts.push(`PIN: <code>${esc(info.pin)}</code>`);
  if (info.link) parts.push(`Link: ${esc(info.link)}`);
  if (info.instructions) parts.push(esc(info.instructions));
  if (info.expiration_date) parts.push(`Expires: ${esc(info.expiration_date)}`);
  return parts.join("\n") || "Delivered.";
}
