import { InlineKeyboard } from "grammy";

/**
 * Callback data is "<action>:<id>". Telegram caps it at 64 bytes; ids are integers so this is tiny.
 * Handlers re-check permissions on every press: callback data is user-controlled input.
 */
export const CallbackAction = {
  purchaseApprove: "pa",
  purchaseReject: "pr",
  kickConfirm: "kc",
  kickAbort: "ka",
} as const;

export type CallbackActionCode = (typeof CallbackAction)[keyof typeof CallbackAction];

export const callbackPattern = (action: CallbackActionCode) => new RegExp(`^${action}:(\\d{1,12})$`);

const data = (action: CallbackActionCode, id: number) => `${action}:${id}`;

export const approvePurchaseKeyboard = (purchaseId: number) =>
  new InlineKeyboard()
    .text("✅ Approve", data(CallbackAction.purchaseApprove, purchaseId))
    .text("❌ Reject", data(CallbackAction.purchaseReject, purchaseId));

export const kickKeyboard = (memberId: number) =>
  new InlineKeyboard()
    .text("Remove", data(CallbackAction.kickConfirm, memberId))
    .text("Keep", data(CallbackAction.kickAbort, memberId));
