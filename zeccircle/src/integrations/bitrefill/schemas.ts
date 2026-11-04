import { z } from "zod";

/*
 * Response schemas for Bitrefill REST API v2 (https://docs.bitrefill.com).
 * The public docs are inconsistent in places (e.g. `id` vs `package_id` on packages,
 * `redemption_info` as string vs object), so schemas accept both shapes and keep unknown fields.
 */

const numeric = z.union([z.number(), z.string()]);

export const packageSchema = z
  .object({
    id: z.string().optional(),
    package_id: z.string().optional(),
    value: numeric,
    /** Price in the account's currency. */
    price: z.number().optional(),
  })
  .loose();

export const rangeSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    /** Multiplier from product currency to the account's currency. */
    price_rate: z.number().optional(),
  })
  .loose();

export const productSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    country_code: z.string().optional().nullable(),
    country_name: z.string().optional().nullable(),
    currency: z.string().optional().nullable(),
    recipient_type: z.string().optional().nullable(),
    in_stock: z.boolean().optional().nullable(),
    type: z.string().optional().nullable(),
    packages: z.array(packageSchema).optional().nullable(),
    range: rangeSchema.optional().nullable(),
  })
  .loose();

export const invoiceOrderSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    product: z
      .object({ id: z.string().optional(), value: z.union([z.string(), z.number()]).optional() })
      .loose()
      .optional()
      .nullable(),
  })
  .loose();

export const invoiceSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    payment: z
      .object({
        method: z.string().optional(),
        currency: z.string().optional(),
        price: z.number().optional(),
        status: z.string().optional(),
      })
      .loose()
      .optional()
      .nullable(),
    orders: z.array(invoiceOrderSchema).optional().nullable(),
  })
  .loose();

export const redemptionInfoSchema = z.union([
  z.string(),
  z
    .object({
      code: z.string().optional().nullable(),
      pin: z.string().optional().nullable(),
      link: z.string().optional().nullable(),
      instructions: z.string().optional().nullable(),
      expiration_date: z.string().optional().nullable(),
    })
    .loose(),
]);

export const orderSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    product: z.object({ id: z.string().optional(), name: z.string().optional() }).loose().optional().nullable(),
    redemption_info: redemptionInfoSchema.optional().nullable(),
  })
  .loose();

export const balanceSchema = z.object({ balance: z.number(), currency: z.string() }).loose();

export const envelope = <T extends z.ZodType>(data: T) => z.object({ data }).loose();

export type BitrefillPackage = z.infer<typeof packageSchema>;
export type BitrefillRange = z.infer<typeof rangeSchema>;
export type BitrefillProduct = z.infer<typeof productSchema>;
export type BitrefillInvoice = z.infer<typeof invoiceSchema>;
export type BitrefillOrder = z.infer<typeof orderSchema>;
export type RedemptionInfo = z.infer<typeof redemptionInfoSchema>;
export type BitrefillBalance = z.infer<typeof balanceSchema>;

/*
 * Statuses. Bitrefill's docs list "unpaid" as the first invoice status, but the live API reports a
 * fresh unpaid invoice as "not_delivered" (with payment.status "unpaid"), and keeps that status
 * while a paid order is still being fulfilled. So "not_delivered" means "not done yet", not failure.
 * Delivery is decided per order; 5.txt: "Paid is not the same as delivered."
 */
export const INVOICE_SUCCESS_STATUSES = new Set(["complete"]);
export const INVOICE_FAILURE_STATUSES = new Set(["blocked", "denied", "payment_error", "expired"]);
export const ORDER_SUCCESS_STATUSES = new Set(["delivered"]);
export const ORDER_FAILURE_STATUSES = new Set(["failed", "refunded"]);
