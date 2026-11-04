import { describe, expect, it } from "vitest";
import { LIVE_ITEMS, LIVE_TOTAL_SPEND_CEILING_MINOR } from "../src/domain/live-purchase-rules.js";
import { LiveModeGuard } from "../src/services/purchase-guard.js";
import { deliveryState } from "../src/services/purchase.service.js";
import { buildTestServices, circleWithMember, MEMBER, OWNER, silentLogger } from "./helpers.js";

const JIO = LIVE_ITEMS.find((i) => i.key === "jio-10")!;
const FLIPKART = LIVE_ITEMS.find((i) => i.key === "flipkart-50")!;
const JIO_NUMBER = "919876543210";

/** A circle in live mode, with the two real items (priced like the live catalogue) plus one forbidden item. */
async function liveSetup() {
  const s = await buildTestServices({
    guard: (d) => new LiveModeGuard({ db: d.db, purchases: d.repos.purchases, logger: silentLogger }),
  });
  s.bitrefill.addProduct({
    id: JIO.productId,
    name: "Jio Bundles India",
    currency: "INR",
    in_stock: true,
    recipient_type: "phone_number",
    packages: [
      { id: JIO.packageId, value: "₹7.47 Talktime Top-Up", price: 0.12 },
      { id: "reliance-jio-india-bundles<&>₹14.95 Talktime Top-Up", value: "₹14.95 Talktime Top-Up", price: 0.24 },
    ],
  });
  s.bitrefill.addProduct({
    id: FLIPKART.productId,
    name: "Flipkart India",
    currency: "INR",
    in_stock: true,
    recipient_type: "none",
    packages: [
      { id: FLIPKART.packageId, value: "50", price: 0.56 },
      { id: "flipkart-india<&>100", value: "100", price: 1.13 },
    ],
  });
  s.bitrefill.addProduct({ id: "amazon-in", name: "Amazon India", currency: "INR", in_stock: true, packages: [{ id: "amazon-in<&>10", value: "10", price: 0.12 }] });
  await circleWithMember(s);
  return s;
}

const buyFlipkart = (s: Awaited<ReturnType<typeof liveSetup>>, who = MEMBER.telegramId) =>
  s.purchaseService.propose(who, { productId: FLIPKART.productId, packageId: FLIPKART.packageId });

describe("live mode hard rules", () => {
  it("buys the ₹50 Flipkart card end to end and records it as live and paid", async () => {
    const s = await liveSetup();
    const { purchase } = await buyFlipkart(s);
    expect(purchase.fulfilmentMode).toBe("live");
    expect((await s.purchaseService.confirm(purchase.id, MEMBER.telegramId)).kind).toBe("executing");
    await s.purchaseService.stop();
    const done = await s.repos.purchases.findById(purchase.id);
    expect(done).toMatchObject({ status: "completed", paidMinor: 56 });
    expect(done?.paidAt).not.toBeNull();
    expect(s.bitrefill.paidInvoices).toHaveLength(1);
  });

  it("tops up a Jio number given with spaces, after removing the gaps", async () => {
    const s = await liveSetup();
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, {
      productId: JIO.productId,
      packageId: JIO.packageId,
      phoneNumber: "+91 98765 43210",
    });
    expect(purchase.phoneNumber).toBe(JIO_NUMBER);
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await s.purchaseService.stop();
    expect((await s.repos.purchases.findById(purchase.id))?.status).toBe("completed");
  });

  it("refuses any product or package that is not on the hardcoded list", async () => {
    const s = await liveSetup();
    await expect(s.purchaseService.propose(MEMBER.telegramId, { productId: "amazon-in", packageId: "amazon-in<&>10" })).rejects.toThrow(/Test mode/);
    await expect(s.purchaseService.propose(MEMBER.telegramId, { productId: FLIPKART.productId, packageId: "flipkart-india<&>100" })).rejects.toThrow(/Test mode/);
    await expect(
      s.purchaseService.propose(MEMBER.telegramId, { productId: JIO.productId, packageId: "reliance-jio-india-bundles<&>₹14.95 Talktime Top-Up", phoneNumber: JIO_NUMBER }),
    ).rejects.toThrow(/Test mode/);
    // The owner gets no exception either.
    await expect(s.purchaseService.propose(OWNER.telegramId, { productId: "amazon-in", packageId: "amazon-in<&>10" })).rejects.toThrow(/Test mode/);
  });

  it("tops up whatever valid Indian mobile number the member sends, no operator lookup", async () => {
    const s = await liveSetup();
    const jio = { productId: JIO.productId, packageId: JIO.packageId };
    for (const typed of ["98123 45678", "+91 70123-45678", "090000 00000"]) {
      const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { ...jio, phoneNumber: typed });
      expect(purchase.phoneNumber).toMatch(/^91[6-9]\d{9}$/);
    }
  });

  it("refuses a top-up without a number or with something that isn't a mobile number", async () => {
    const s = await liveSetup();
    const jio = { productId: JIO.productId, packageId: JIO.packageId };
    await expect(s.purchaseService.propose(MEMBER.telegramId, jio)).rejects.toThrow(/phone number/);
    await expect(s.purchaseService.propose(MEMBER.telegramId, { ...jio, phoneNumber: "12345" })).rejects.toThrow(/Indian mobile/);
    await expect(s.purchaseService.propose(MEMBER.telegramId, { ...jio, phoneNumber: "+1 415 555 0100" })).rejects.toThrow(/Indian mobile/);
  });

  it("does not pay when Bitrefill's price jumps above the per-item limit", async () => {
    const s = await liveSetup();
    s.bitrefill.invoicePriceFactor = 2; // invoice comes back at $1.12 for the ₹50 card (limit $1.00)
    const { purchase } = await buyFlipkart(s);
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await s.purchaseService.stop();
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
    expect((await s.repos.purchases.findById(purchase.id))?.status).toBe("failed");
  });

  it("never spends more than the hardcoded $5 in total, across circles", async () => {
    const s = await liveSetup();
    await s.circleService.setMemberLimits(OWNER.telegramId, (await s.circleService.getMembership(MEMBER.telegramId))!.member.id, 200, 1000);
    await s.circleService.setCircleMonthlyLimit(OWNER.telegramId, 100_00);

    const outcomes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { purchase } = await buyFlipkart(s);
      outcomes.push((await s.purchaseService.confirm(purchase.id, MEMBER.telegramId)).kind);
    }
    await s.purchaseService.stop();
    const executed = outcomes.filter((k) => k === "executing").length;
    expect(executed).toBe(Math.floor(LIVE_TOTAL_SPEND_CEILING_MINOR / 56)); // 8 x $0.56 = $4.48; a 9th would pass $5
    expect(outcomes.slice(executed)).toEqual(Array(10 - executed).fill("denied"));
    expect(await s.repos.purchases.liveCommittedTotal()).toBeLessThanOrEqual(LIVE_TOTAL_SPEND_CEILING_MINOR);
  });

  it("concurrent requests cannot overshoot the $5 ceiling", async () => {
    const s = await liveSetup();
    await s.circleService.setCircleMonthlyLimit(OWNER.telegramId, 100_00);
    const ownerProposals = await Promise.all(Array.from({ length: 12 }, () => buyFlipkart(s, OWNER.telegramId)));
    const outcomes = await Promise.all(ownerProposals.map(({ purchase }) => s.purchaseService.confirm(purchase.id, OWNER.telegramId)));
    await s.purchaseService.stop();
    expect(outcomes.filter((o) => o.kind === "executing").length).toBe(8);
    expect(await s.repos.purchases.liveCommittedTotal()).toBeLessThanOrEqual(LIVE_TOTAL_SPEND_CEILING_MINOR);
  });
});

describe("delivery status", () => {
  const inv = (status: string, orders: string[]) => ({ id: "i", status, orders: orders.map((o, n) => ({ id: String(n), status: o })) });

  it("treats Bitrefill's 'not_delivered' as still in progress, not a failure", () => {
    expect(deliveryState(inv("not_delivered", ["created"]))).toBe("pending");
    expect(deliveryState(inv("not_delivered", ["processing"]))).toBe("pending");
  });

  it("is delivered when the invoice completes or every order is delivered", () => {
    expect(deliveryState(inv("complete", ["delivered"]))).toBe("delivered");
    expect(deliveryState(inv("not_delivered", ["delivered"]))).toBe("delivered");
  });

  it("fails when an order fails or is refunded, or the invoice is rejected", () => {
    expect(deliveryState(inv("not_delivered", ["failed"]))).toBe("failed");
    expect(deliveryState(inv("not_delivered", ["refunded"]))).toBe("failed");
    expect(deliveryState(inv("denied", ["created"]))).toBe("failed");
  });
});
