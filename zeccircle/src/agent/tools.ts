import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Purchase } from "../domain/types.js";
import type { BitrefillApi } from "../integrations/bitrefill/api.js";
import { BitrefillApiError } from "../integrations/bitrefill/client.js";
import { packageIdOf } from "../integrations/bitrefill/pricing.js";
import type { BitrefillProduct } from "../integrations/bitrefill/schemas.js";
import { DomainError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { formatMoney } from "../lib/money.js";
import { normalizeIndianMobile } from "../lib/phone.js";
import type { CircleService } from "../services/circle.service.js";
import type { PurchaseService } from "../services/purchase.service.js";
import type { FundingRail } from "../services/funding/funding-rail.js";
import { zatToZecString } from "../integrations/zcash/units.js";

export interface ToolContext {
  telegramId: number;
  currency: string;
  /** Everything the member typed in this conversation, used to verify phone numbers. */
  memberTexts: string[];
  /** Proposals created during this agent turn; the bot submits them right after the agent replies. */
  proposals: Purchase[];
}

export interface ToolDeps {
  bitrefill: BitrefillApi;
  circleService: CircleService;
  purchaseService: PurchaseService;
  fundingRail: FundingRail;
  logger: Logger;
}

const MAX_PROPOSALS_PER_TURN = 3;

/** Builds the tool set for one agent turn, bound to the member who is chatting. */
export function buildTools(deps: ToolDeps, ctx: ToolContext) {
  const safe =
    (name: string, fn: () => Promise<string>) =>
    async (): Promise<string> => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof DomainError) return `Error: ${error.message}`;
        if (error instanceof BitrefillApiError) {
          deps.logger.warn({ tool: name, status: error.status, code: error.errorCode }, "bitrefill error in tool");
          return `Error from Bitrefill: ${error.message}`;
        }
        deps.logger.error({ err: error, tool: name }, "tool crashed");
        return "Error: something went wrong running this tool. Try again or ask the member to retry later.";
      }
    };

  const searchProducts = betaZodTool({
    name: "search_products",
    description:
      "Search Bitrefill's catalog of gift cards, mobile top-ups and eSIMs. Returns product ids with their country and denominations. Use short queries like 'amazon india', 'jio', 'airtel', 'swiggy', 'esim europe'.",
    inputSchema: z.object({
      query: z.string().min(1).max(80).describe("Search text: brand, operator or category, optionally with a country"),
    }),
    run: (input) =>
      safe("search_products", async () => {
        const products = await deps.bitrefill.searchProducts(input.query, 8);
        if (products.length === 0) return "No products found. Try a different or shorter query.";
        return JSON.stringify(products.map(summarizeProduct));
      })(),
  });

  const getProduct = betaZodTool({
    name: "get_product",
    description:
      "Get the exact purchase options for one product: fixed packages (with package_id and price) and/or a value range. Always call this before propose_purchase.",
    inputSchema: z.object({
      product_id: z.string().min(1).max(120).describe("Product id from search_products"),
    }),
    run: (input) =>
      safe("get_product", async () => {
        const product = await deps.bitrefill.getProduct(input.product_id);
        return JSON.stringify(describeProduct(product, ctx.currency));
      })(),
  });

  const getMyLimits = betaZodTool({
    name: "get_my_limits",
    description: "Get this member's spending limits and how much they and the whole circle have spent this month.",
    inputSchema: z.object({}),
    run: () =>
      safe("get_my_limits", async () => {
        const { circle, member } = await deps.circleService.requireActiveMembership(ctx.telegramId);
        const spent = await deps.circleService.getSpend(member);
        const fmt = (n: number) => formatMoney(n, circle.currency);
        return JSON.stringify({
          role: member.role,
          per_purchase_limit: member.role === "owner" ? "no per-purchase limit" : fmt(member.perPurchaseLimitMinor),
          monthly_limit: member.role === "owner" ? "circle cap only" : fmt(member.monthlyLimitMinor),
          spent_this_month: fmt(spent.memberSpentMinor),
          circle_monthly_cap: fmt(circle.monthlyLimitMinor),
          circle_spent_this_month: fmt(spent.circleSpentMinor),
          ...(await walletInfo(deps.fundingRail, circle.id, fmt)),
          note: "Purchases over the member's limits need owner approval; nothing can exceed the circle cap.",
        });
      })(),
  });

  const getMyOrders = betaZodTool({
    name: "get_my_orders",
    description:
      "Get this member's real recent orders with their true status, cost, Bitrefill invoice id and the ZEC payment (amount and transaction id). This is the ONLY reliable source about orders that were already placed: use it whenever the member asks about an order, a receipt, an id, where something was bought, or whether it went through. Gift card codes are never included; they are delivered privately.",
    inputSchema: z.object({}),
    run: () =>
      safe("get_my_orders", async () => {
        const { member } = await deps.circleService.requireActiveMembership(ctx.telegramId);
        const orders = await deps.purchaseService.recentForMember(member.id, 8);
        if (orders.length === 0) return "This member has no orders yet.";
        const rows = await Promise.all(
          orders.map(async (o) => {
            const settlement = await deps.fundingRail.getSettlement(o.id);
            return {
              order_number: o.id,
              product: o.productName,
              value: o.value,
              status: describeOrderStatus(o.status),
              cost: formatMoney(o.paidMinor ?? o.quotedMinor, o.currency),
              real_purchase: o.fulfilmentMode === "live",
              bitrefill_invoice_id: o.invoiceId,
              phone_number_ending: o.phoneNumber ? `...${o.phoneNumber.slice(-4)}` : null,
              zec_payment: settlement
                ? { amount_zec: zatToZecString(settlement.amountZat), network: settlement.network === "test" ? "testnet" : "simulated", transaction_id: settlement.txid }
                : null,
              failure_reason: o.failureReason,
              placed_at: o.createdAt,
            };
          }),
        );
        return JSON.stringify(rows);
      })(),
  });

  const proposePurchase = betaZodTool({
    name: "propose_purchase",
    description:
      "Place the member's order. Call it only when the member has clearly asked to buy and every detail is known. The system submits it right after your reply (bought immediately if within limits, otherwise sent to the circle owner for approval). Provide product_id and exactly one of package_id (for fixed packages) or value (for ranged products). Mobile top-ups also need phone_number as the member sent it (spaces are fine; the system cleans it up).",
    inputSchema: z.object({
      product_id: z.string().min(1).max(120),
      package_id: z.string().min(1).max(200).optional().describe("package_id from get_product"),
      value: z.number().positive().optional().describe("Face value in the product's currency, for ranged products"),
      phone_number: z
        .string()
        .min(6)
        .max(25)
        .optional()
        .describe("Recipient Indian mobile number from the member's message, e.g. \"+91 98765 43210\" or \"9876543210\"."),
    }),
    run: (input) =>
      safe("propose_purchase", async () => {
        if (ctx.proposals.length >= MAX_PROPOSALS_PER_TURN) {
          return `Error: at most ${MAX_PROPOSALS_PER_TURN} proposals per message.`;
        }
        if ((input.package_id ? 1 : 0) + (input.value !== undefined ? 1 : 0) !== 1) {
          return "Error: provide exactly one of package_id or value.";
        }
        let phone: string | null = null;
        if (input.phone_number) {
          // Remove gaps/dashes and add the 91 country code Bitrefill needs.
          phone = normalizeIndianMobile(input.phone_number);
          if (!phone) return "Error: that is not a valid Indian mobile number. Ask the member to send it again.";
          if (!phoneAppearsIn(phone, ctx.memberTexts)) {
            return "Error: that phone number does not appear in the member's messages. Ask the member to type the number.";
          }
        }

        const { purchase, preview } = await deps.purchaseService.propose(ctx.telegramId, {
          productId: input.product_id,
          packageId: input.package_id ?? null,
          value: input.value ?? null,
          phoneNumber: phone,
        });
        if (preview.kind === "deny") {
          // Not allowed under any circumstances (paused, circle cap...): don't queue it.
          await deps.purchaseService.cancel(purchase.id, ctx.telegramId);
          return `Error: this purchase is not allowed. ${preview.reason}`;
        }
        ctx.proposals.push(purchase);

        const nextStep =
          preview.kind === "allow"
            ? "Within limits: it will be bought right after your reply."
            : `Over the member's limits (${preview.reasons.join(", ")}): it will be sent to the circle owner for approval right after your reply.`;
        return JSON.stringify({
          proposal_id: purchase.id,
          product: purchase.productName,
          value: purchase.value,
          cost: formatMoney(purchase.quotedMinor, purchase.currency),
          phone_number: purchase.phoneNumber,
          next_step: nextStep,
          note: "Submitted automatically after your reply. Do not ask the member to confirm.",
        });
      })(),
  });

  return [searchProducts, getProduct, getMyLimits, getMyOrders, proposePurchase];
}

function describeOrderStatus(status: Purchase["status"]): string {
  switch (status) {
    case "completed":
      return "delivered";
    case "executing":
      return "being processed";
    case "awaiting_approval":
      return "waiting for the circle owner";
    default:
      return status;
  }
}

async function walletInfo(rail: FundingRail, circleId: number, fmt: (n: number) => string) {
  const balance = await rail.getBalance(circleId);
  if (!balance) return {};
  return {
    circle_wallet_balance: `${zatToZecString(balance.availableZat)} ZEC (about ${fmt(balance.availableFiatMinor)})`,
    wallet_note: "Purchases are paid from the circle's shielded ZEC wallet. If it is too low, members can top it up with /fund.",
  };
}

function summarizeProduct(p: BitrefillProduct) {
  const packages = p.packages ?? [];
  return {
    product_id: p.id,
    name: p.name,
    country: p.country_code ?? p.country_name ?? null,
    currency: p.currency ?? null,
    in_stock: p.in_stock ?? null,
    needs_phone_number: (p.recipient_type ?? "").toLowerCase().includes("phone"),
    denominations: p.range
      ? `range ${p.range.min}-${p.range.max}`
      : packages.length > 0
        ? packages.slice(0, 6).map((pkg) => String(pkg.value)).join(", ") + (packages.length > 6 ? ", ..." : "")
        : "see get_product",
  };
}

function describeProduct(p: BitrefillProduct, accountCurrency: string) {
  return {
    product_id: p.id,
    name: p.name,
    country: p.country_code ?? p.country_name ?? null,
    product_currency: p.currency ?? null,
    price_currency: accountCurrency,
    in_stock: p.in_stock ?? null,
    needs_phone_number: (p.recipient_type ?? "").toLowerCase().includes("phone"),
    packages: (p.packages ?? []).slice(0, 25).map((pkg) => ({
      package_id: packageIdOf(pkg),
      value: pkg.value,
      price: pkg.price ?? null,
    })),
    range: p.range
      ? {
          min: p.range.min,
          max: p.range.max,
          step: p.range.step ?? null,
          price_per_unit: p.range.price_rate ?? null,
        }
      : null,
  };
}

const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** The last 10 digits of the number must appear in something the member typed. */
export function phoneAppearsIn(phone: string, texts: string[]): boolean {
  const digits = digitsOnly(phone);
  if (digits.length < 6) return false;
  const tail = digits.slice(-10);
  return texts.some((t) => digitsOnly(t).includes(tail));
}
