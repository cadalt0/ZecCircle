import { describe, expect, it } from "vitest";
import { MAX_SWAPS_TOTAL, MAX_ZEC_PER_SWAP_ZAT } from "../src/domain/mainnet-swap-rules.js";
import type { BitrefillApi } from "../src/integrations/bitrefill/api.js";
import type { BitrefillMcpClient, StoreCreditInvoice } from "../src/integrations/bitrefill/mcp-client.js";
import type { OneClickClient, QuoteRequest, QuoteResponse } from "../src/integrations/near-intents/one-click-client.js";
import { MockZcashWallet } from "../src/integrations/zcash/mock-wallet.js";
import type { ZecPayment } from "../src/repositories/zec.repository.js";
import { SwapRepository } from "../src/repositories/swap.repository.js";
import { noActivityLog } from "../src/services/activity/activity-log.js";
import { FixedPrice } from "../src/services/funding/price-source.js";
import { SettlementFailed } from "../src/services/funding/settlement.js";
import { SwapSettlement } from "../src/services/funding/swap-settlement.js";
import { buildTestServices, circleWithMember, MEMBER, silentLogger } from "./helpers.js";

const PAY_TO = "0x6e1D3bA105730FfA5837472aAADB0A1C4b46721c";
const DEPOSIT = "t1Ze5xQ3bVsP1aCqRkdX9mW7nTgY2hJ4LfE"; // 35 chars, valid-looking mainnet t-address
const REFUND = "t1MockRefundAddressxxxxxxxxxxxxxxxx";

function storeCreditInvoice(overrides: Partial<StoreCreditInvoice["payment_info"]> = {}, minutes = 60): StoreCreditInvoice {
  return {
    invoice_id: "inv-credit-1",
    expiration_minutes: minutes,
    cart_items: [{ id: "bitrefill-deposit-usd", value: "2", currency: "USDC" }],
    payment_info: {
      address: PAY_TO,
      altcoinPrice: "2.0",
      altBasePrice: 2_000_000,
      contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      paymentUri: `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=${PAY_TO}&uint256=2e6`,
      ...overrides,
    },
  };
}

function quote(req: QuoteRequest, overrides: Partial<QuoteResponse["quote"]> = {}, echo: Partial<QuoteRequest> = {}): QuoteResponse {
  return {
    correlationId: "c",
    signature: "sig",
    quoteRequest: { ...req, ...echo } as unknown as Record<string, unknown>,
    quote: {
      ...(req.dry ? {} : { depositAddress: DEPOSIT, deadline: new Date(Date.now() + 30 * 60_000).toISOString() }),
      amountIn: "154343",
      amountInFormatted: "0.00154343",
      amountInUsd: "2.0358",
      minAmountIn: "152799",
      amountOut: "2000000",
      amountOutFormatted: "2",
      amountOutUsd: "1.99",
      minAmountOut: "2000000",
      timeEstimate: 459,
      ...overrides,
    },
  };
}

async function setup(opts: { invoice?: StoreCreditInvoice; quoteOverrides?: Partial<QuoteResponse["quote"]>; echo?: Partial<QuoteRequest>; statuses?: string[] } = {}) {
  const s = await buildTestServices();
  s.bitrefill.addProduct({ id: "gift", name: "Gift", currency: "USD", in_stock: true, packages: [{ package_id: "gift<&>1", value: "1", price: 1 }] });
  await circleWithMember(s);
  const wallet = new MockZcashWallet();
  const statuses = [...(opts.statuses ?? ["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"])];
  const calls = { mcp: [] as unknown[][], quotes: [] as QuoteRequest[], submitted: [] as string[] };

  const oneClick = {
    quote: async (req: QuoteRequest) => {
      calls.quotes.push(req);
      return quote(req, opts.quoteOverrides, opts.echo);
    },
    submitDeposit: async (txid: string) => void calls.submitted.push(txid),
    status: async () => ({ status: statuses.length > 1 ? statuses.shift()! : statuses[0]! }),
  } as unknown as OneClickClient;
  const bitrefillMcp = {
    createStoreCreditInvoice: async (...args: unknown[]) => {
      calls.mcp.push(args);
      return opts.invoice ?? storeCreditInvoice();
    },
  } as unknown as BitrefillMcpClient;
  const bitrefill = {
    getInvoice: async (id: string) => ({ id, status: "all_delivered", payment: { status: "complete" }, orders: [{ id: "o", status: "delivered" }] }),
  } as unknown as BitrefillApi;

  const swaps = new SwapRepository(s.db);
  const settlement = new SwapSettlement({
    db: s.db,
    wallet,
    oneClick,
    bitrefillMcp,
    bitrefill,
    swaps,
    price: new FixedPrice(132_129), // $1321.29 per ZEC
    accountEmail: "owner@example.com",
    logger: silentLogger,
    activity: noActivityLog,
    wait: async () => undefined,
  });

  const newPurchase = async () => (await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" })).purchase;
  const payment = (purchaseId: number): ZecPayment => ({
    id: 1, purchaseId, circleId: 1, amountZat: MAX_ZEC_PER_SWAP_ZAT + 30_000, priceMinorPerZec: 132_129,
    toAddress: "1click", status: "sending", txid: null, error: null, createdAt: "", updatedAt: "",
  });
  const progress: string[] = [];
  const run = async (purchaseId: number) => {
    const purchase = (await s.repos.purchases.findById(purchaseId))!;
    return settlement.execute({ purchase, payment: payment(purchaseId), progress: async (m) => void progress.push(m) });
  };
  return { s, wallet, swaps, settlement, calls, newPurchase, run, progress };
}

describe("mainnet swap settlement", () => {
  it("swaps exactly the quoted ZEC to 1Click, waits for success and the Bitrefill credit", async () => {
    const t = await setup();
    const purchase = await t.newPurchase();
    const result = await t.run(purchase.id);

    expect(t.calls.mcp).toEqual([["2", "owner@example.com", "usdc_base"]]);
    expect(t.calls.quotes.map((q) => q.dry)).toEqual([true, false]); // dry run first, then the real quote
    expect(t.calls.quotes[1]).toMatchObject({ swapType: "EXACT_OUTPUT", amount: "2000000", recipient: PAY_TO, refundTo: REFUND });
    expect(t.wallet.sent).toEqual([expect.objectContaining({ address: DEPOSIT, valueZat: 154_343, memo: null })]);
    expect(t.calls.submitted).toEqual([t.wallet.sent[0]!.txid]);
    expect(result).toMatchObject({ txid: t.wallet.sent[0]!.txid, amountZat: 154_343, toAddress: DEPOSIT, swap: { usdcAmount: "2.00", status: "credited" } });
    expect((await t.swaps.findByPurchase(purchase.id))?.status).toBe("credited");
    expect(t.progress.some((m) => m.includes("swapping 0.00154343 ZEC"))).toBe(true);
  });

  it("reserves at most the hard cap, based on the live price", async () => {
    const t = await setup();
    // $2.16 (2 + 8%) at $1321.29 = 0.001634766 ZEC, rounded up, plus a 30,000 zat fee margin
    expect(await t.settlement.estimateZat(await t.newPurchase())).toBe(163_477 + 30_000);
  });

  for (const [name, invoice] of [
    ["the wrong USDC amount", storeCreditInvoice({ altBasePrice: 1_990_000 })],
    ["a token that isn't USDC", storeCreditInvoice({ contractAddress: "0x0000000000000000000000000000000000000001" })],
    ["another chain", storeCreditInvoice({ paymentUri: `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@1/transfer` })],
    ["an invoice about to expire", storeCreditInvoice({}, 10)],
  ] as const) {
    it(`sends nothing when Bitrefill's invoice has ${name}`, async () => {
      const t = await setup({ invoice });
      const purchase = await t.newPurchase();
      await expect(t.run(purchase.id)).rejects.toThrow(/safety checks.*No ZEC was sent/);
      expect(t.wallet.sent).toHaveLength(0);
    });
  }

  for (const [name, overrides, echo] of [
    ["needs more ZEC than the hard cap", { amountIn: "300000", amountInFormatted: "0.003" }, {}],
    ["costs too many dollars", { amountInUsd: "2.40" }, {}],
    ["delivers the wrong USDC amount", { amountOut: "1990000", amountOutFormatted: "1.99" }, {}],
    ["was made for another recipient", {}, { recipient: "0x000000000000000000000000000000000000dEaD" }],
    ["asks for a memo", { depositMemo: "123" }, {}],
  ] as const) {
    it(`sends nothing when the quote ${name}`, async () => {
      const t = await setup({ quoteOverrides: overrides, echo });
      const purchase = await t.newPurchase();
      await expect(t.run(purchase.id)).rejects.toThrow(/No ZEC was sent/);
      expect(t.wallet.sent).toHaveLength(0);
      // A swap that failed before sending doesn't use up the swap limit.
      expect(await t.swaps.countCommitted()).toBe(0);
    });
  }

  it("a refunded swap is reported as money moved (so the circle ledger stays correct) and marked refunded", async () => {
    const t = await setup({ statuses: ["PROCESSING", "REFUNDED"] });
    const purchase = await t.newPurchase();
    const error = await t.run(purchase.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SettlementFailed);
    expect((error as SettlementFailed).message).toMatch(/refunded/);
    expect((error as SettlementFailed).moneyMoved).toMatchObject({ amountZat: 154_343, toAddress: DEPOSIT });
    expect((await t.swaps.findByPurchase(purchase.id))?.status).toBe("refunded");
  });

  it(`never does more than ${MAX_SWAPS_TOTAL} swaps in total`, async () => {
    const t = await setup();
    for (let i = 0; i < MAX_SWAPS_TOTAL; i++) await t.run((await t.newPurchase()).id);
    await expect(t.run((await t.newPurchase()).id)).rejects.toThrow(/limit of 2 swaps/);
    expect(t.wallet.sent).toHaveLength(MAX_SWAPS_TOTAL);
  });

  it("after a restart it follows an already-sent swap and never sends again", async () => {
    const t = await setup();
    const purchase = await t.newPurchase();
    await t.run(purchase.id);
    const again = await t.run(purchase.id); // e.g. the purchase is retried after a crash
    expect(t.wallet.sent).toHaveLength(1);
    expect(again.txid).toBe(t.wallet.sent[0]!.txid);
  });
});
