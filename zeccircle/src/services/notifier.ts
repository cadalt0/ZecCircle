import type { RedemptionInfo } from "../integrations/bitrefill/schemas.js";
import type { Circle, Member, Purchase } from "../domain/types.js";
import type { FundingBalance, Settlement } from "./funding/funding-rail.js";
import type { ZcashNetwork } from "../integrations/zcash/wallet.js";

/**
 * Events the domain emits for humans. Services never talk to Telegram directly;
 * the bot layer implements Notifier and decides who sees what and how it is worded.
 */
export type CircleEvent =
  | { type: "member_joined"; circle: Circle; member: Member }
  | { type: "member_removed"; circle: Circle; member: Member }
  | { type: "member_left"; circle: Circle; member: Member }
  | { type: "purchase_needs_approval"; circle: Circle; member: Member; purchase: Purchase; reasons: string[] }
  | { type: "purchase_approved"; circle: Circle; member: Member; purchase: Purchase }
  | { type: "purchase_rejected"; circle: Circle; member: Member; purchase: Purchase }
  | { type: "purchase_failed"; circle: Circle; member: Member; purchase: Purchase; reason: string; settlement: Settlement | null }
  | { type: "purchase_delayed"; circle: Circle; member: Member; purchase: Purchase }
  /** A step of a long-running purchase (e.g. the mainnet swap), so the member isn't left waiting in silence. */
  | { type: "purchase_progress"; circle: Circle; member: Member; purchase: Purchase; message: string }
  | {
      type: "purchase_completed";
      circle: Circle;
      member: Member;
      purchase: Purchase;
      redemptions: RedemptionInfo[];
      settlement: Settlement | null;
    }
  | {
      type: "deposit_seen";
      circle: Circle;
      /** Who ran /fund for this memo code, if known. The sender is never known (shielded). */
      requesterTelegramId: number | null;
      amountZat: number;
      txid: string;
      network: ZcashNetwork;
    }
  | {
      type: "deposit_confirmed";
      circle: Circle;
      requesterTelegramId: number | null;
      amountZat: number;
      txid: string;
      network: ZcashNetwork;
      balance: FundingBalance;
    };

export interface Notifier {
  /** Must not throw: delivery failures are the notifier's problem to log. */
  notify(event: CircleEvent): Promise<void>;
}
