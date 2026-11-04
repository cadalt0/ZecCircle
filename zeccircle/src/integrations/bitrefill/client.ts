import { z } from "zod";
import type { Logger } from "../../lib/logger.js";
import type { BitrefillApi, InvoiceProductInput } from "./api.js";
import {
  balanceSchema,
  envelope,
  invoiceSchema,
  orderSchema,
  productSchema,
  type BitrefillBalance,
  type BitrefillInvoice,
  type BitrefillOrder,
  type BitrefillProduct,
} from "./schemas.js";

export class BitrefillApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(message);
    this.name = "BitrefillApiError";
  }
}

export interface BitrefillClientOptions {
  apiKey: string;
  baseUrl: string;
  includeTestProducts: boolean;
  logger: Logger;
  timeoutMs?: number;
}

/**
 * Thin, typed client for the Bitrefill REST API v2 (Personal API, Bearer auth).
 * Every response is validated; any non-2xx becomes a BitrefillApiError.
 */
export class BitrefillClient implements BitrefillApi {
  private readonly timeoutMs: number;

  constructor(private readonly options: BitrefillClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async ping(): Promise<void> {
    await this.request("GET", "/ping", z.unknown());
  }

  async getBalance(): Promise<BitrefillBalance> {
    return this.request("GET", "/accounts/balance", envelope(balanceSchema)).then((r) => r.data);
  }

  async searchProducts(query: string, limit = 10): Promise<BitrefillProduct[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (this.options.includeTestProducts) params.set("include_test_products", "true");
    const res = await this.request("GET", `/products/search?${params}`, envelope(z.array(productSchema)));
    return res.data;
  }

  async getProduct(productId: string): Promise<BitrefillProduct> {
    const res = await this.request("GET", `/products/${encodeURIComponent(productId)}`, envelope(productSchema));
    return res.data;
  }

  /** Creates an unpaid invoice payable from the account balance. Pay it with `payInvoice`. */
  async createBalanceInvoice(product: InvoiceProductInput): Promise<BitrefillInvoice> {
    const item: Record<string, unknown> = { product_id: product.productId, quantity: 1 };
    if (product.packageId) item.package_id = product.packageId;
    else if (product.value !== undefined && product.value !== null) item.value = product.value;
    if (product.phoneNumber) item.phone_number = product.phoneNumber;

    const res = await this.request(
      "POST",
      "/invoices",
      envelope(invoiceSchema),
      { products: [item], payment_method: "balance", auto_pay: false },
    );
    return res.data;
  }

  async payInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    const res = await this.request("POST", `/invoices/${encodeURIComponent(invoiceId)}/pay`, envelope(invoiceSchema), {});
    return res.data;
  }

  async getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    const res = await this.request("GET", `/invoices/${encodeURIComponent(invoiceId)}`, envelope(invoiceSchema));
    return res.data;
  }

  async getOrder(orderId: string): Promise<BitrefillOrder> {
    const res = await this.request("GET", `/orders/${encodeURIComponent(orderId)}`, envelope(orderSchema));
    return res.data;
  }

  private async request<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>> {
    const url = `${this.options.baseUrl}${path}`;
    const started = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new BitrefillApiError(`Bitrefill request failed: ${(error as Error).message}`, 0, "network_error");
    }

    const text = await response.text();
    this.options.logger.debug(
      { method, path: path.split("?")[0], status: response.status, ms: Date.now() - started },
      "bitrefill request",
    );

    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      const errorBody = (json ?? {}) as { message?: string; error?: string; error_code?: string };
      throw new BitrefillApiError(
        errorBody.message ?? errorBody.error ?? `HTTP ${response.status}`,
        response.status,
        errorBody.error_code ?? null,
      );
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.options.logger.error({ path: path.split("?")[0], issues: parsed.error.issues }, "unexpected Bitrefill response");
      throw new BitrefillApiError("Unexpected response shape from Bitrefill", response.status, "invalid_response");
    }
    return parsed.data;
  }
}
