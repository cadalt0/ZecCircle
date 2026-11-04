import { describe, expect, it } from "vitest";
import { buildTestServices, circleWithMember, MEMBER, OWNER, settle, STRANGER } from "./helpers.js";

function withCatalog(s: Awaited<ReturnType<typeof buildTestServices>>) {
  s.bitrefill.addProduct({
    id: "gift-small",
    name: "Gift Small",
    currency: "USD",
    in_stock: true,
    packages: [
      { package_id: "gift-small<&>1", value: "1", price: 1 },
      { package_id: "gift-small<&>3", value: "3", price: 3 },
    ],
  });
  return s;
}

describe("PurchaseService", () => {
  it("within limits: propose -> confirm -> paid -> delivered", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);

    const { purchase, preview } = await s.purchaseService.propose(MEMBER.telegramId, {
      productId: "gift-small",
      packageId: "gift-small<&>1",
    });
    expect(preview.kind).toBe("allow");
    expect(s.bitrefill.paidInvoices).toHaveLength(0); // proposing never pays

    const outcome = await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    expect(outcome.kind).toBe("executing");
    await settle(s.purchaseService);

    expect(s.bitrefill.paidInvoices).toHaveLength(1);
    expect((await s.repos.purchases.findById(purchase.id))).toMatchObject({ status: "completed", paidMinor: 100 });
    const done = s.notifier.events.find((e) => e.type === "purchase_completed");
    expect(done && done.type === "purchase_completed" && done.redemptions).toEqual([{ code: "CODE-ord_1" }]);
  });

  it("over the per-purchase limit: waits for the owner, then buys on approval", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);

    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>3" });
    const outcome = await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    expect(outcome.kind).toBe("awaiting_approval");
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
    expect(s.notifier.types()).toContain("purchase_needs_approval");

    await expect(s.purchaseService.approve(purchase.id, MEMBER.telegramId)).rejects.toThrow(/owner/);
    const approved = await s.purchaseService.approve(purchase.id, OWNER.telegramId);
    expect(approved.kind).toBe("executing");
    await settle(s.purchaseService);
    expect((await s.repos.purchases.findById(purchase.id))?.status).toBe("completed");
  });

  it("owner rejection: nothing is bought", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>3" });
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await s.purchaseService.reject(purchase.id, OWNER.telegramId);
    await settle(s.purchaseService);
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
    expect((await s.repos.purchases.findById(purchase.id))?.status).toBe("rejected");
  });

  it("only the requester can confirm, and a double confirm cannot spend twice", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });

    await expect(s.purchaseService.confirm(purchase.id, STRANGER.telegramId)).rejects.toThrow(/Only the person/);
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await expect(s.purchaseService.confirm(purchase.id, MEMBER.telegramId)).rejects.toThrow(/already/);
    await settle(s.purchaseService);
    expect(s.bitrefill.paidInvoices).toHaveLength(1);
  });

  it("the owner can shop too: no per-member limits or approval, only the circle cap", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);

    // $3 is over a member's $2 limit, but the owner needs no approval.
    const { purchase, preview } = await s.purchaseService.propose(OWNER.telegramId, { productId: "gift-small", packageId: "gift-small<&>3" });
    expect(preview.kind).toBe("allow");
    expect((await s.purchaseService.confirm(purchase.id, OWNER.telegramId)).kind).toBe("executing");
    await settle(s.purchaseService);
    expect((await s.repos.purchases.findById(purchase.id))?.status).toBe("completed");
    // No separate "someone bought" notice to the owner about their own purchase.
    expect(s.notifier.types().filter((t) => t === "purchase_completed")).toHaveLength(1);

    // The owner's spend counts toward the circle cap.
    await s.circleService.setCircleMonthlyLimit(OWNER.telegramId, 400);
    const { purchase: second } = await s.purchaseService.propose(OWNER.telegramId, { productId: "gift-small", packageId: "gift-small<&>3" });
    expect((await s.purchaseService.confirm(second.id, OWNER.telegramId)).kind).toBe("denied");
  });

  it("monthly limit counts earlier purchases", async () => {
    const s = withCatalog(await buildTestServices());
    const { member } = await circleWithMember(s);
    await s.circleService.setMemberLimits(OWNER.telegramId, member.id, 100, 200); // $1/purchase, $2/month

    for (let i = 0; i < 2; i++) {
      const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });
      expect((await s.purchaseService.confirm(purchase.id, MEMBER.telegramId)).kind).toBe("executing");
    }
    const { purchase: third } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });
    expect((await s.purchaseService.confirm(third.id, MEMBER.telegramId)).kind).toBe("awaiting_approval");
    await settle(s.purchaseService);
    expect(s.bitrefill.paidInvoices).toHaveLength(2);
  });

  it("refuses to pay if Bitrefill's price rose beyond the tolerance", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    s.bitrefill.invoicePriceFactor = 1.2;
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await settle(s.purchaseService);
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
    expect((await s.repos.purchases.findById(purchase.id))).toMatchObject({ status: "failed" });
  });

  it("reports a clear error when the Bitrefill balance is too low", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    s.bitrefill.balance = 0.5;
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });
    await s.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await settle(s.purchaseService);
    const p = (await s.repos.purchases.findById(purchase.id))!;
    expect(p.status).toBe("failed");
    expect(p.failureReason).toMatch(/balance is too low/);
  });

  it("paused circles cannot spend", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    const { purchase } = await s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" });
    await s.circleService.setCirclePaused(OWNER.telegramId, true);
    expect((await s.purchaseService.confirm(purchase.id, MEMBER.telegramId)).kind).toBe("denied");
    await settle(s.purchaseService);
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
  });

  it("rejects proposals for unknown products or packages", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    await expect(s.purchaseService.propose(MEMBER.telegramId, { productId: "nope", packageId: "x" })).rejects.toThrow(/does not exist/);
    await expect(s.purchaseService.propose(MEMBER.telegramId, { productId: "gift-small", packageId: "gift-small<&>99" })).rejects.toThrow(
      /does not exist/,
    );
  });

  it("non-members cannot propose", async () => {
    const s = withCatalog(await buildTestServices());
    await circleWithMember(s);
    await expect(s.purchaseService.propose(STRANGER.telegramId, { productId: "gift-small", packageId: "gift-small<&>1" })).rejects.toThrow(
      /not in a circle/,
    );
  });
});
