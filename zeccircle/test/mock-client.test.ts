import { describe, expect, it } from "vitest";
import { MockBitrefillClient } from "../src/integrations/bitrefill/mock-client.js";
import { quoteProduct } from "../src/integrations/bitrefill/pricing.js";

describe("MockBitrefillClient", () => {
  it("finds products by keyword and labels them as test products", async () => {
    const mock = new MockBitrefillClient("USD");
    const results = await mock.searchProducts("jio");
    expect(results.map((p) => p.id)).toEqual(["mock-jio-in"]);
    expect(results.every((p) => p.name.startsWith("[TEST]"))).toBe(true);
    expect(await mock.searchProducts("zzz")).toEqual([]);
  });

  it("quotes and invoices consistently so the price check passes", async () => {
    const mock = new MockBitrefillClient("USD");
    const jio = await mock.getProduct("mock-jio-in");
    const quote = quoteProduct(jio, { value: 199 }, "USD");
    const invoice = await mock.createBalanceInvoice({ productId: "mock-jio-in", value: 199, phoneNumber: "+919812345678" });
    expect(Math.round((invoice.payment?.price ?? 0) * 100)).toBeLessThanOrEqual(quote.costMinor);
  });

  it("gift cards deliver a clearly fake code; top-ups deliver none", async () => {
    const mock = new MockBitrefillClient("USD");
    const gift = await mock.createBalanceInvoice({ productId: "mock-steam-us", packageId: "mock-steam-us<&>5" });
    await mock.payInvoice(gift.id);
    const order = await mock.getOrder(gift.orders![0]!.id);
    expect(JSON.stringify(order.redemption_info)).toContain("TEST MODE");

    const topup = await mock.createBalanceInvoice({ productId: "mock-jio-in", value: 100, phoneNumber: "+919812345678" });
    await mock.payInvoice(topup.id);
    expect((await mock.getOrder(topup.orders![0]!.id)).redemption_info).toBeUndefined();
  });

  it("completes only after payment and a short delay", async () => {
    const mock = new MockBitrefillClient("USD");
    const inv = await mock.createBalanceInvoice({ productId: "mock-steam-us", packageId: "mock-steam-us<&>5" });
    expect((await mock.getInvoice(inv.id)).status).toBe("unpaid");
    await mock.payInvoice(inv.id);
    expect((await mock.getInvoice(inv.id)).status).toBe("pending");
  });
});
