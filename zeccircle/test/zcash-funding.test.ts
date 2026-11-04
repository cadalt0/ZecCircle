import { describe, expect, it } from "vitest";
import { DevtoolWallet, decodeMemo } from "../src/integrations/zcash/devtool-wallet.js";
import { loadConfig } from "../src/config/env.js";
import { MockZcashWallet } from "../src/integrations/zcash/mock-wallet.js";
import { ZecRepository } from "../src/repositories/zec.repository.js";
import { fiatMinorToZat, zatToFiatMinor, zatToZecString, zecStringToZat } from "../src/integrations/zcash/units.js";
import { buildPaymentUri, isShieldedAddress } from "../src/integrations/zcash/zip321.js";
import { ZcashFundingService } from "../src/services/funding/zcash-funding.service.js";
import { FixedPrice } from "../src/services/funding/price-source.js";
import { SinkSettlement } from "../src/services/funding/settlement.js";
import { buildTestServices, circleWithMember, MEMBER, OWNER, silentLogger } from "./helpers.js";

const SETTLEMENT = "utest1settlementaddressforteststxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

async function setup(minConfirmations = 2) {
  const wallet = new MockZcashWallet();
  let funding!: ZcashFundingService;
  const s = await buildTestServices({
    fundingRail: (deps) => {
      funding = new ZcashFundingService({
        wallet,
        ...deps.repos,
        circleService: deps.circleService,
        notifier: deps.notifier,
        price: new FixedPrice(4000),
        settlement: new SinkSettlement(wallet, SETTLEMENT, new FixedPrice(4000)),
        logger: silentLogger,
        settings: { minConfirmations, syncIntervalMs: 10 },
      });
      return funding;
    },
  });
  s.bitrefill.addProduct({
    id: "gift",
    name: "Gift",
    currency: "USD",
    in_stock: true,
    packages: [{ package_id: "gift<&>1", value: "1", price: 1 }],
  });
  return { ...s, wallet, funding };
}

async function fund(t: Awaited<ReturnType<typeof setup>>, telegramId: number, zec: string) {
  const req = await t.funding.createFundingRequest(telegramId, null);
  t.wallet.simulateDeposit(zecStringToZat(zec), req.memo);
  return req;
}

describe("units and ZIP-321", () => {
  it("converts between ZEC strings and zatoshis", () => {
    expect(zecStringToZat("0.5")).toBe(50_000_000);
    expect(zecStringToZat("1")).toBe(100_000_000);
    expect(zatToZecString(12_340_000)).toBe("0.1234");
    expect(zatToZecString(100_000_000)).toBe("1.00");
    expect(() => zecStringToZat("0.123456789")).toThrow();
  });

  it("converts fiat to zatoshis rounding up, and back rounding down", () => {
    // $1.00 at $40/ZEC = 0.025 ZEC
    expect(fiatMinorToZat(100, 4000)).toBe(2_500_000);
    expect(fiatMinorToZat(1, 3)).toBe(33_333_334);
    expect(zatToFiatMinor(2_500_000, 4000)).toBe(100);
  });

  it("builds a ZIP-321 URI with a base64url memo", () => {
    const uri = buildPaymentUri({ address: "utest1abc", amountZat: 50_000_000, memo: "ZecCircle ABCD2345" });
    expect(uri).toBe(`zcash:utest1abc?amount=0.50&memo=${Buffer.from("ZecCircle ABCD2345").toString("base64url")}`);
    expect(uri).not.toMatch(/[=+/]$/);
  });

  it("knows transparent addresses can't take memos", () => {
    expect(isShieldedAddress("tmXyz")).toBe(false);
    expect(isShieldedAddress("utest1abc")).toBe(true);
  });

  it("decodes ZIP-302 memos", () => {
    const text = new Uint8Array(512);
    text.set(Buffer.from("ZecCircle ABCD2345"));
    expect(decodeMemo(text)).toBe("ZecCircle ABCD2345");
    const empty = new Uint8Array(512);
    empty[0] = 0xf6;
    expect(decodeMemo(empty)).toBeNull();
    expect(decodeMemo(null)).toBeNull();
  });
});

describe("shielded-only rules", () => {
  it("the devtool wallet refuses to send to a transparent address, before running anything", async () => {
    const wallet = new DevtoolWallet({
      binary: "/nonexistent/zcash-devtool",
      walletDir: "/nonexistent",
      identityFile: "/nonexistent/id.txt",
      server: "zecrocks",
      connection: "direct",
      logger: silentLogger,
    });
    await expect(wallet.send("tmTransparentAddress1234567890", 1000, null)).rejects.toThrow(/only shielded/);
  });

  it("config rejects a transparent settlement address", () => {
    const base = { DATABASE_URL: "postgres://localhost/test", TELEGRAM_BOT_TOKEN: "x", ANTHROPIC_API_KEY: "x", BITREFILL_MODE: "mock", ZCASH_MODE: "testnet" };
    const saved = { ...process.env };
    try {
      Object.assign(process.env, base, { ZCASH_SETTLEMENT_ADDRESS: "tmTransparentAddress1234567890" });
      expect(() => loadConfig("/nonexistent")).toThrow(/shielded/);
      Object.assign(process.env, { ZCASH_SETTLEMENT_ADDRESS: "utest1shieldedaddress" });
      expect(loadConfig("/nonexistent").zcash.settlementAddress).toBe("utest1shieldedaddress");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("matching deposits to circles", () => {
  it("each circle gets its own stable shielded address", async () => {
    const t = await setup();
    const { circle } = await circleWithMember(t);
    const a = await t.funding.getCircleAddress(circle.id);
    expect(a).toMatch(/^utest1/);
    expect(await t.funding.getCircleAddress(circle.id)).toBe(a);

    // Concurrent first requests must not create two addresses.
    const other = (await t.circleService.createCircle({ telegramId: 7007, displayName: "Other" }, "Other Circle")).circle;
    const [x, y] = await Promise.all([t.funding.getCircleAddress(other.id), t.funding.getCircleAddress(other.id)]);
    expect(x).toBe(y);
    expect(x).not.toBe(a);
  });

  it("credits a deposit sent to the circle's address with no memo at all", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    const req = await t.funding.createFundingRequest(OWNER.telegramId, null);
    expect(req.address).toBe(await t.funding.getCircleAddress(circle.id));

    t.wallet.simulateDeposit(zecStringToZat("0.2"), null, req.address);
    await t.funding.tick();
    await t.funding.tick();
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(20_000_000);
  });

  it("keeps two circles' money apart", async () => {
    const t = await setup(1);
    const a = (await circleWithMember(t)).circle;
    const b = (await t.circleService.createCircle({ telegramId: 7007, displayName: "Other" }, "Other Circle")).circle;
    const addrA = await t.funding.getCircleAddress(a.id);
    const addrB = await t.funding.getCircleAddress(b.id);
    t.wallet.simulateDeposit(zecStringToZat("0.3"), null, addrA);
    t.wallet.simulateDeposit(zecStringToZat("0.1"), null, addrB);
    await t.funding.tick();
    await t.funding.tick();
    expect((await t.funding.getBalance(a.id)).availableZat).toBe(30_000_000);
    expect((await t.funding.getBalance(b.id)).availableZat).toBe(10_000_000);
  });

  it("still credits by memo code when someone pays the wallet's main address", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    const req = await t.funding.createFundingRequest(OWNER.telegramId, null);
    t.wallet.simulateDeposit(zecStringToZat("0.4"), req.memo, await t.wallet.getAddress());
    await t.funding.tick();
    await t.funding.tick();
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(40_000_000);
  });

  it("ignores money at an unknown address with no valid memo", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    t.wallet.simulateDeposit(zecStringToZat("0.5"), null, await t.wallet.getAddress());
    await t.funding.tick();
    await t.funding.tick();
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(0);
  });
});

describe("ZcashFundingService", () => {
  it("credits a deposit to the right circle only after enough confirmations", async () => {
    const t = await setup(2);
    const { circle } = await circleWithMember(t);
    await fund(t, MEMBER.telegramId, "0.5");

    await t.funding.tick(); // mined at the first sync -> 1 confirmation
    expect(t.notifier.types()).toContain("deposit_seen");
    expect((await t.funding.getBalance(circle.id))).toMatchObject({ availableZat: 0, pendingZat: 50_000_000 });

    await t.funding.tick(); // 2 confirmations
    expect((await t.funding.getBalance(circle.id))).toMatchObject({ availableZat: 50_000_000, pendingZat: 0, availableFiatMinor: 2000 });
    const confirmed = t.notifier.events.filter((e) => e.type === "deposit_confirmed");
    expect(confirmed).toHaveLength(1);

    await t.funding.tick(); // idempotent: no double credit
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(50_000_000);
    expect(t.notifier.events.filter((e) => e.type === "deposit_confirmed")).toHaveLength(1);
  });

  it("does not credit deposits without a known memo code", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    t.wallet.simulateDeposit(10_000_000, "hello");
    t.wallet.simulateDeposit(10_000_000, null);
    await t.funding.tick();
    await t.funding.tick();
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(0);
  });

  it("pays for a purchase from the circle wallet, then buys it", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    await fund(t, OWNER.telegramId, "0.1");
    await t.funding.tick();

    const { purchase } = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    expect((await t.purchaseService.confirm(purchase.id, MEMBER.telegramId)).kind).toBe("executing");
    await t.purchaseService.stop();

    // $1 at $40/ZEC = 0.025 ZEC sent to the settlement address with a memo naming the purchase.
    expect(t.wallet.sent).toEqual([
      expect.objectContaining({ address: SETTLEMENT, valueZat: 2_500_000, memo: `ZecCircle purchase #${purchase.id}` }),
    ]);
    expect(t.bitrefill.paidInvoices).toHaveLength(1);
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(10_000_000 - 2_500_000);

    const done = t.notifier.events.find((e) => e.type === "purchase_completed");
    expect(done?.type === "purchase_completed" && done.settlement).toMatchObject({ amountZat: 2_500_000, network: "mock" });
  });

  it("refuses a purchase the circle wallet can't cover, and moves nothing", async () => {
    const t = await setup(1);
    await circleWithMember(t);
    await fund(t, OWNER.telegramId, "0.01"); // $0.40 worth
    await t.funding.tick();

    const { purchase } = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    const outcome = await t.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    expect(outcome.kind).toBe("denied");
    expect(outcome.kind === "denied" && outcome.reason).toMatch(/\/fund/);
    await t.purchaseService.stop();
    expect(t.wallet.sent).toHaveLength(0);
    expect(t.bitrefill.paidInvoices).toHaveLength(0);
  });

  it("explains a not-yet-spendable wallet clearly, charges nothing and frees the funds", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    await fund(t, OWNER.telegramId, "0.1");
    await t.funding.tick();
    // The ledger credited the deposit, but the wallet still waits for confirmations to spend it.
    t.wallet.send = async () => {
      throw new Error("zcash-devtool send failed: Error: Insufficient balance (have 0, need 3010000 including fee)");
    };

    const { purchase } = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    await t.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await t.purchaseService.stop();

    const failed = await t.repos.purchases.findById(purchase.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toMatch(/not spendable yet.*try again in a few minutes/s);
    expect(failed?.failureReason).not.toMatch(/Insufficient balance|zcash-devtool/);
    expect(t.bitrefill.paidInvoices).toHaveLength(0);
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(10_000_000); // money is available again
  });

  it("releases the reservation when the purchase fails before money moves", async () => {
    const t = await setup(1);
    const { circle } = await circleWithMember(t);
    await fund(t, OWNER.telegramId, "0.1");
    await t.funding.tick();
    t.bitrefill.invoicePriceFactor = 2; // Bitrefill price jumps -> purchase fails at the price check

    const { purchase } = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    await t.purchaseService.confirm(purchase.id, MEMBER.telegramId);
    await t.purchaseService.stop();

    expect(t.wallet.sent).toHaveLength(0);
    expect((await t.funding.getBalance(circle.id)).availableZat).toBe(10_000_000);
    expect((await t.repos.zec.findPaymentByPurchase(purchase.id))?.status).toBe("released");
  });

  it("concurrent purchases can't spend the same funds twice", async () => {
    const t = await setup(1);
    await circleWithMember(t);
    await fund(t, OWNER.telegramId, "0.03"); // enough for one $1 purchase (0.025), not two
    await t.funding.tick();

    const a = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    const b = await t.purchaseService.propose(MEMBER.telegramId, { productId: "gift", packageId: "gift<&>1" });
    const outcomes = await Promise.all([
      t.purchaseService.confirm(a.purchase.id, MEMBER.telegramId),
      t.purchaseService.confirm(b.purchase.id, MEMBER.telegramId),
    ]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["denied", "executing"]);
    await t.purchaseService.stop();
    expect(t.wallet.sent).toHaveLength(1);
  });
});

describe("testnet and mainnet records never mix", () => {
  it("a circle's testnet balance and deposit address are invisible to the mainnet ledger", async () => {
    const { s } = await (async () => {
      const x = await setup();
      return { s: x };
    })();
    const { circle } = await circleWithMember(s);
    const test = new ZecRepository(s.db, "test");
    const main = new ZecRepository(s.db, "main");

    // Money and an address on testnet...
    await test.saveCircleAddress(circle.id, "utest1thisisatestnetaddress");
    await test.insertDeposit({ txid: "aa", outputPool: 3, outputIndex: 0, amountZat: 50_000_000, memo: null, fundingCode: null, circleId: circle.id, minedHeight: 1 });
    const [dep] = await test.listSeenDeposits();
    await test.confirmDeposit(dep!.id);
    expect(await test.confirmedDepositsZat(circle.id)).toBe(50_000_000);

    // ...are not there on mainnet.
    expect(await main.confirmedDepositsZat(circle.id)).toBe(0);
    expect(await main.findCircleAddress(circle.id)).toBeNull();
    expect(await main.findCircleByAddress("utest1thisisatestnetaddress")).toBeNull();
    expect(await main.listDepositsByCircle(circle.id, 5)).toHaveLength(0);
    expect(await main.listSeenDeposits()).toHaveLength(0);

    // A mainnet address for the same circle is separate, and the testnet one is untouched.
    await main.saveCircleAddress(circle.id, "u1thisisamainnetaddress");
    expect(await main.findCircleAddress(circle.id)).toBe("u1thisisamainnetaddress");
    expect(await test.findCircleAddress(circle.id)).toBe("utest1thisisatestnetaddress");
  });
});

