import type { BitrefillBalance, BitrefillInvoice, BitrefillOrder, BitrefillProduct } from "./schemas.js";

export interface InvoiceProductInput {
  productId: string;
  packageId?: string | null;
  value?: number | string | null;
  phoneNumber?: string | null;
}

/**
 * What the rest of the app needs from Bitrefill. Implemented by the real REST client and by the
 * mock client used for testing without spending anything.
 */
export interface BitrefillApi {
  getBalance(): Promise<BitrefillBalance>;
  searchProducts(query: string, limit?: number): Promise<BitrefillProduct[]>;
  getProduct(productId: string): Promise<BitrefillProduct>;
  /** Creates an unpaid invoice payable from the account balance. */
  createBalanceInvoice(product: InvoiceProductInput): Promise<BitrefillInvoice>;
  payInvoice(invoiceId: string): Promise<BitrefillInvoice>;
  getInvoice(invoiceId: string): Promise<BitrefillInvoice>;
  getOrder(orderId: string): Promise<BitrefillOrder>;
}
