import { z } from "zod";
import type { Logger } from "../../lib/logger.js";

/*
 * NEAR Intents 1Click API (https://1click.chaindefuser.com, OpenAPI at /docs/v0/openapi.yaml).
 * Used for the mainnet swap ZEC -> USDC. Only the calls we need: token prices, quote, deposit
 * notification and status.
 */

export const ONE_CLICK_ZEC = "nep141:zec.omft.near";
export const ONE_CLICK_USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

const tokenSchema = z
  .object({ assetId: z.string(), symbol: z.string(), blockchain: z.string(), decimals: z.number(), price: z.number(), priceUpdatedAt: z.string() })
  .loose();
export type OneClickToken = z.infer<typeof tokenSchema>;

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  /** Base units of the input (EXACT_INPUT) or output (EXACT_OUTPUT) asset. */
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  /** ISO time after which an unfinished swap is refunded. */
  deadline: string;
}

const quoteSchema = z
  .object({
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    amountIn: z.string(),
    amountInFormatted: z.string(),
    amountInUsd: z.string(),
    minAmountIn: z.string(),
    amountOut: z.string(),
    amountOutFormatted: z.string(),
    amountOutUsd: z.string(),
    minAmountOut: z.string(),
    deadline: z.string().optional(),
    timeEstimate: z.number(),
    refundFee: z.string().optional(),
  })
  .loose();

const quoteResponseSchema = z
  .object({
    correlationId: z.string().optional(),
    timestamp: z.string().optional(),
    signature: z.string().optional(),
    quoteRequest: z.record(z.string(), z.unknown()).optional(),
    quote: quoteSchema,
  })
  .loose();
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

const statusSchema = z
  .object({
    status: z.string(),
    updatedAt: z.string().optional(),
    swapDetails: z
      // 1Click sends null for these until the swap has an output (e.g. while PENDING_DEPOSIT / PROCESSING).
      .object({
        amountOut: z.string().nullish(),
        amountOutFormatted: z.string().nullish(),
        refundedAmount: z.string().nullish(),
      })
      .loose()
      .optional()
      .nullable(),
  })
  .loose();
export type StatusResponse = z.infer<typeof statusSchema>;

export class OneClickClient {
  private readonly base = "https://1click.chaindefuser.com/v0";

  constructor(
    private readonly options: { apiKey?: string; logger: Logger; timeoutMs?: number },
  ) {}

  async getTokens(): Promise<OneClickToken[]> {
    return this.request("GET", "/tokens", z.array(tokenSchema));
  }

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    return this.request("POST", "/quote", quoteResponseSchema, request);
  }

  /** Optional: tells 1Click about our deposit so it is picked up faster. */
  async submitDeposit(txHash: string, depositAddress: string): Promise<void> {
    await this.request("POST", "/deposit/submit", z.unknown(), { txHash, depositAddress });
  }

  async status(depositAddress: string): Promise<StatusResponse> {
    return this.request("GET", `/status?depositAddress=${encodeURIComponent(depositAddress)}`, statusSchema);
  }

  private async request<T extends z.ZodType>(method: "GET" | "POST", path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.apiKey) headers["X-API-Key"] = this.options.apiKey;

    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new OneClickError(`1Click request failed: ${(error as Error).message}`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
      throw new OneClickError(`1Click: ${message}`, res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.options.logger.error({ path: path.split("?")[0], issues: parsed.error.issues.slice(0, 5) }, "unexpected 1Click response");
      throw new OneClickError("Unexpected response from 1Click", res.status);
    }
    return parsed.data;
  }
}
