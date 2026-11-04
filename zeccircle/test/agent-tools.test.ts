import { describe, expect, it } from "vitest";
import { buildTools, type ToolContext } from "../src/agent/tools.js";
import type { BitrefillApi } from "../src/integrations/bitrefill/api.js";
import { buildTestServices, circleWithMember, MEMBER, OWNER, silentLogger } from "./helpers.js";

async function setup() {
  const s = await buildTestServices();
  s.bitrefill.addProduct({
    id: "gift",
    name: "Gift",
    currency: "USD",
    in_stock: true,
    packages: [
      { package_id: "gift<&>1", value: "1", price: 1 },
      { package_id: "gift<&>3", value: "3", price: 3 },
    ],
  });
  await circleWithMember(s);
  const ctx: ToolContext = { telegramId: MEMBER.telegramId, currency: "USD", memberTexts: ["buy a gift card"], proposals: [] };
  const tools = buildTools(
    { bitrefill: s.bitrefill as unknown as BitrefillApi, circleService: s.circleService, purchaseService: s.purchaseService, fundingRail: s.fundingRail, logger: silentLogger },
    ctx,
  );
  const tool = tools.find((t) => t.name === "propose_purchase")!;
  // The tools array is a union of differently-typed tools; call this one with loosely typed input.
  const propose = { run: (input: Record<string, unknown>) => (tool.run as (i: unknown) => Promise<unknown>)(input) };
  const orders = tools.find((x) => x.name === "get_my_orders")!;
  const getOrders = async () => String(await (orders.run as (i: unknown) => Promise<unknown>)({}));
  return { s, ctx, propose, getOrders };
}

describe("propose_purchase tool", () => {
  it("queues an in-limit order for automatic submission without spending", async () => {
    const { s, ctx, propose } = await setup();
    const result = await propose.run({ product_id: "gift", package_id: "gift<&>1" });
    expect(String(result)).toContain("bought right after your reply");
    expect(ctx.proposals).toHaveLength(1);
    expect(s.bitrefill.paidInvoices).toHaveLength(0);

    // What the bot does next: the member's request is the confirmation.
    const outcome = await s.purchaseService.confirm(ctx.proposals[0]!.id, MEMBER.telegramId);
    expect(outcome.kind).toBe("executing");
    await s.purchaseService.stop();
    expect(s.bitrefill.paidInvoices).toHaveLength(1);
  });

  it("routes an over-limit order to the owner instead of buying it", async () => {
    const { s, ctx, propose } = await setup();
    const result = await propose.run({ product_id: "gift", package_id: "gift<&>3" });
    expect(String(result)).toContain("sent to the circle owner for approval");
    const outcome = await s.purchaseService.confirm(ctx.proposals[0]!.id, MEMBER.telegramId);
    expect(outcome.kind).toBe("awaiting_approval");
    await s.purchaseService.stop();
    expect(s.bitrefill.paidInvoices).toHaveLength(0);
  });

  it("refuses up front, and queues nothing, when the circle is paused", async () => {
    const { s, ctx, propose } = await setup();
    await s.circleService.setCirclePaused(OWNER.telegramId, true);
    const result = await propose.run({ product_id: "gift", package_id: "gift<&>1" });
    expect(String(result)).toMatch(/^Error: .*paused/);
    expect(ctx.proposals).toHaveLength(0);
  });

  it("rejects a phone number the member never typed", async () => {
    const { ctx, propose } = await setup();
    const result = await propose.run({ product_id: "gift", package_id: "gift<&>1", phone_number: "+919812345678" });
    expect(String(result)).toMatch(/does not appear/);
    expect(ctx.proposals).toHaveLength(0);
  });
});

describe("get_my_orders tool (the agent's only source of truth about past orders)", () => {
  it("says there are no orders before anything was bought", async () => {
    const { getOrders } = await setup();
    expect(await getOrders()).toMatch(/no orders yet/i);
  });

  it("reports a completed order with its invoice id, and never includes a gift card code", async () => {
    const { s, ctx, propose, getOrders } = await setup();
    await propose.run({ product_id: "gift", package_id: "gift<&>1" });
    await s.purchaseService.confirm(ctx.proposals[0]!.id, MEMBER.telegramId);
    await s.purchaseService.stop();

    const orders = JSON.parse(await getOrders()) as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ product: "Gift", status: "delivered", cost: "$1.00", bitrefill_invoice_id: "inv_1" });
    expect(JSON.stringify(orders)).not.toMatch(/CODE-/); // FakeBitrefill's redemption code must never appear here
  });

  it("reports failed and waiting orders honestly", async () => {
    const { s, ctx, propose, getOrders } = await setup();
    await propose.run({ product_id: "gift", package_id: "gift<&>3" }); // over the member's $2 limit
    await s.purchaseService.confirm(ctx.proposals[0]!.id, MEMBER.telegramId);
    const orders = JSON.parse(await getOrders()) as Array<{ status: string }>;
    expect(orders[0]!.status).toBe("waiting for the circle owner");
  });
});

