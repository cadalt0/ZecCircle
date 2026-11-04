export type MemberRole = "owner" | "member";
export type MemberStatus = "active" | "paused" | "removed";

export type PurchaseStatus =
  | "proposed" // created by the agent, waiting for the member to confirm
  | "awaiting_approval" // over the member's limits, waiting for the owner
  | "executing" // invoice being created/paid/delivered at Bitrefill
  | "completed"
  | "rejected" // owner said no
  | "cancelled" // member said no
  | "failed"
  | "expired";

/** Statuses whose amount counts against spend caps. */
export const SPENDING_STATUSES: readonly PurchaseStatus[] = ["executing", "completed"];

export interface Circle {
  id: number;
  name: string;
  ownerTelegramId: number;
  currency: string;
  monthlyLimitMinor: number;
  defaultPerPurchaseLimitMinor: number;
  defaultMemberMonthlyLimitMinor: number;
  paused: boolean;
  createdAt: string;
}

export interface Member {
  id: number;
  circleId: number;
  telegramId: number;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
  perPurchaseLimitMinor: number;
  monthlyLimitMinor: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invite {
  token: string;
  circleId: number;
  createdByTelegramId: number;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revoked: boolean;
  createdAt: string;
}

export type FulfilmentMode = "mock" | "live";

export interface Purchase {
  id: number;
  circleId: number;
  memberId: number;
  productId: string;
  productName: string;
  packageId: string | null;
  value: string;
  phoneNumber: string | null;
  quotedMinor: number;
  paidMinor: number | null;
  currency: string;
  status: PurchaseStatus;
  approvedByTelegramId: number | null;
  invoiceId: string | null;
  failureReason: string | null;
  /** "live" = real Bitrefill order with real money. */
  fulfilmentMode: FulfilmentMode;
  /** When Bitrefill confirmed payment; null if it was never paid. */
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpendSummary {
  memberSpentMinor: number;
  circleSpentMinor: number;
}
