import { describe, expect, it } from "vitest";
import { evaluatePurchase } from "../src/domain/policy.js";
import type { Circle, Member } from "../src/domain/types.js";

const circle: Circle = {
  id: 1,
  name: "c",
  ownerTelegramId: 1,
  currency: "USD",
  monthlyLimitMinor: 1000,
  defaultPerPurchaseLimitMinor: 200,
  defaultMemberMonthlyLimitMinor: 500,
  paused: false,
  createdAt: "",
};

const member: Member = {
  id: 2,
  circleId: 1,
  telegramId: 2,
  displayName: "m",
  role: "member",
  status: "active",
  perPurchaseLimitMinor: 200,
  monthlyLimitMinor: 500,
  createdAt: "",
  updatedAt: "",
};

const none = { memberSpentMinor: 0, circleSpentMinor: 0 };

describe("evaluatePurchase", () => {
  it("allows a purchase within all limits", () => {
    expect(evaluatePurchase({ circle, member, amountMinor: 150, spent: none })).toEqual({ kind: "allow" });
  });

  it("allows exactly the per-purchase limit", () => {
    expect(evaluatePurchase({ circle, member, amountMinor: 200, spent: none }).kind).toBe("allow");
  });

  it("needs approval above the per-purchase limit", () => {
    const d = evaluatePurchase({ circle, member, amountMinor: 201, spent: none });
    expect(d).toEqual({ kind: "needs_approval", reasons: ["over your per-purchase limit"] });
  });

  it("needs approval when the monthly limit would be exceeded", () => {
    const d = evaluatePurchase({ circle, member, amountMinor: 150, spent: { memberSpentMinor: 400, circleSpentMinor: 400 } });
    expect(d).toEqual({ kind: "needs_approval", reasons: ["over your monthly limit"] });
  });

  it("allows an over-limit purchase once the owner approved it", () => {
    expect(evaluatePurchase({ circle, member, amountMinor: 300, spent: none, ownerApproved: true }).kind).toBe("allow");
  });

  it("denies anything over the circle cap, even with owner approval", () => {
    const d = evaluatePurchase({
      circle,
      member,
      amountMinor: 100,
      spent: { memberSpentMinor: 0, circleSpentMinor: 950 },
      ownerApproved: true,
    });
    expect(d.kind).toBe("deny");
  });

  it("applies the circle cap to the owner too", () => {
    const owner = { ...member, role: "owner" as const };
    expect(evaluatePurchase({ circle, member: owner, amountMinor: 900, spent: none }).kind).toBe("allow");
    expect(evaluatePurchase({ circle, member: owner, amountMinor: 1001, spent: none }).kind).toBe("deny");
  });

  it("denies when the circle is paused", () => {
    expect(evaluatePurchase({ circle: { ...circle, paused: true }, member, amountMinor: 1, spent: none }).kind).toBe("deny");
  });

  it("denies paused or removed members", () => {
    expect(evaluatePurchase({ circle, member: { ...member, status: "paused" }, amountMinor: 1, spent: none }).kind).toBe("deny");
    expect(evaluatePurchase({ circle, member: { ...member, status: "removed" }, amountMinor: 1, spent: none }).kind).toBe("deny");
  });

  it("denies non-positive or fractional amounts", () => {
    expect(evaluatePurchase({ circle, member, amountMinor: 0, spent: none }).kind).toBe("deny");
    expect(evaluatePurchase({ circle, member, amountMinor: 1.5, spent: none }).kind).toBe("deny");
  });

  it("denies a member from another circle", () => {
    expect(evaluatePurchase({ circle, member: { ...member, circleId: 99 }, amountMinor: 1, spent: none }).kind).toBe("deny");
  });
});
