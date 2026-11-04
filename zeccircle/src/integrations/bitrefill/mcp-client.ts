import { z } from "zod";
import type { Logger } from "../../lib/logger.js";

/*
 * Minimal client for Bitrefill's eCommerce MCP server (https://api.bitrefill.com/mcp), signed in
 * with the API key. We use it for one thing the REST API refuses on personal accounts: buying
 * "USD Store Credit" (product bitrefill-deposit-usd), i.e. topping up the Bitrefill balance with crypto.
 * Its invoices can then be read with the normal REST GET /invoices/{id}.
 */

export const STORE_CREDIT_PRODUCT_ID = "bitrefill-deposit-usd";

const storeCreditInvoiceSchema = z
  .object({
    invoice_id: z.string(),
    expiration_minutes: z.number().optional(),
    cart_items: z.array(z.object({ id: z.string(), value: z.string(), currency: z.string().optional() }).loose()),
    payment_info: z
      .object({
        address: z.string(),
        altcoinPrice: z.string(),
        /** Exact amount in the token's base units (USDC: 6 decimals). */
        altBasePrice: z.number(),
        contractAddress: z.string(),
        paymentUri: z.string(),
      })
      .loose(),
  })
  .loose();

export type StoreCreditInvoice = z.infer<typeof storeCreditInvoiceSchema>;

export class BitrefillMcpError extends Error {
  override name = "BitrefillMcpError";
}

export class BitrefillMcpClient {
  private readonly url = "https://api.bitrefill.com/mcp";

  constructor(private readonly options: { apiKey: string; logger: Logger }) {}

  /**
   * Creates an UNPAID invoice that adds `amountUsd` to the Bitrefill USD balance of `accountEmail`
   * when paid with `paymentMethod` (e.g. "usdc_base"). Nothing is charged by creating it.
   */
  async createStoreCreditInvoice(amountUsd: string, accountEmail: string, paymentMethod: string): Promise<StoreCreditInvoice> {
    const text = await this.callTool("buy-products", {
      cart_items: [{ product_id: STORE_CREDIT_PRODUCT_ID, package_value: amountUsd, refill_input: accountEmail }],
      payment_method: paymentMethod,
    });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BitrefillMcpError(`Bitrefill MCP returned an unexpected answer: ${text.slice(0, 200)}`);
    }
    const parsed = storeCreditInvoiceSchema.safeParse((json as { response?: unknown }).response);
    if (!parsed.success) {
      this.options.logger.error({ issues: parsed.error.issues.slice(0, 5) }, "unexpected Bitrefill MCP invoice");
      throw new BitrefillMcpError("Bitrefill MCP returned an invoice in an unexpected format.");
    }
    return parsed.data;
  }

  /** One short session per call: initialize, then call the tool (streamable HTTP transport). */
  private async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const init = await this.rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "zeccircle", version: "1" } },
    });
    const sessionId = init.sessionId;
    await this.rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
    const res = await this.rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, sessionId);
    const result = (res.json as { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: { message?: string } } | null) ?? null;
    if (result?.error) throw new BitrefillMcpError(`Bitrefill MCP: ${result.error.message ?? "error"}`);
    const text = result?.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
    if (result?.result?.isError) throw new BitrefillMcpError(`Bitrefill MCP ${name} failed: ${text.slice(0, 300)}`);
    return text;
  }

  private async rpc(body: unknown, sessionId?: string | null): Promise<{ json: unknown; sessionId: string | null }> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new BitrefillMcpError(`Bitrefill MCP HTTP ${res.status}`);
    const text = await res.text();
    // The server answers either with JSON or with a server-sent-events stream ("data: {...}").
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    let json: unknown = null;
    try {
      json = JSON.parse(dataLine ? dataLine.slice(5) : text);
    } catch {
      json = null; // notifications have no body
    }
    return { json, sessionId: res.headers.get("mcp-session-id") ?? sessionId ?? null };
  }
}
