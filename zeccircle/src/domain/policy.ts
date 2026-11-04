import type { Circle, Member, SpendSummary } from "./types.js";

/**
 * The spending policy. Pure and deterministic: no I/O, no LLM. This is the only gate between
 * an agent's proposal and money moving, so every rule lives here and is unit-tested.
 *
 * Rules, in order:
 *  1. Circle paused, or member not active             -> deny
 *  2. Purchase would exceed the circle's monthly cap  -> deny (hard ceiling; owner must raise it)
 *  3. Owner buying for themselves                      -> allow
 *  4. Over member's per-purchase or monthly limit      -> needs owner approval (unless already approved)
 *  5. Otherwise                                        -> allow
 */

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "needs_approval"; reasons: string[] }
  | { kind: "deny"; reason: string };

export interface PolicyInput {
  circle: Circle;
  member: Member;
  amountMinor: number;
  spent: SpendSummary;
  /** True when the owner has already approved this specific purchase. */
  ownerApproved?: boolean;
}

export function evaluatePurchase(input: PolicyInput): PolicyDecision {
  const { circle, member, amountMinor, spent, ownerApproved = false } = input;

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { kind: "deny", reason: "Amount must be positive." };
  }
  if (member.circleId !== circle.id) {
    return { kind: "deny", reason: "Member does not belong to this circle." };
  }
  if (circle.paused) {
    return { kind: "deny", reason: "This circle is paused by the owner." };
  }
  if (member.status !== "active") {
    return { kind: "deny", reason: `Your membership is ${member.status}.` };
  }
  if (spent.circleSpentMinor + amountMinor > circle.monthlyLimitMinor) {
    return {
      kind: "deny",
      reason: "This would exceed the circle's monthly spending cap. The owner must raise it first.",
    };
  }
  if (member.role === "owner") {
    return { kind: "allow" };
  }

  const reasons: string[] = [];
  if (amountMinor > member.perPurchaseLimitMinor) {
    reasons.push("over your per-purchase limit");
  }
  if (spent.memberSpentMinor + amountMinor > member.monthlyLimitMinor) {
    reasons.push("over your monthly limit");
  }

  if (reasons.length === 0 || ownerApproved) {
    return { kind: "allow" };
  }
  return { kind: "needs_approval", reasons };
}
