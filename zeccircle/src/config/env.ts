import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { isShieldedAddress } from "../integrations/zcash/zip321.js";
import { parseAmountToMinor } from "../lib/money.js";

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/** A decimal amount like "2" or "1.50", converted to integer minor units (cents). */
const amountInMinorUnits = z
  .string()
  .transform((value, ctx) => {
    try {
      return parseAmountToMinor(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  })
  .pipe(z.number().int().positive());

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),

  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),

  /** "mock" uses a fake catalogue and fake purchases: nothing is bought. For testing only. */
  BITREFILL_MODE: z.enum(["live", "mock"]).default("live"),
  BITREFILL_API_KEY: z.string().optional(),
  BITREFILL_BASE_URL: z.url().default("https://api.bitrefill.com/v2"),
  BITREFILL_INCLUDE_TEST_PRODUCTS: booleanFromString.default(false),

  /**
   * Zcash funding. "off": purchases are paid from the Bitrefill balance only. "mock": in-memory
   * wallet for testing (/testdeposit simulates a payment). "testnet": real shielded TAZ via zcash-devtool.
   */
  ZCASH_MODE: z.enum(["off", "mock", "testnet", "mainnet"]).default("off"),
  ZCASH_DEVTOOL_PATH: z.string().min(1).default("../tools/bin/zcash-devtool"),
  /** Defaults to ./data/zcash-wallet (testnet) or ./data/zcash-mainnet-wallet (mainnet). */
  ZCASH_WALLET_DIR: z.string().min(1).optional(),
  /** age identity that decrypts the wallet mnemonic; defaults to <wallet dir>/identity.txt */
  ZCASH_IDENTITY_FILE: z.string().min(1).optional(),
  /** "zecrocks" (testnet.zec.rocks) or host:port */
  ZCASH_SERVER: z.string().min(1).default("zecrocks"),
  /** "direct", "tor" or "socks5://host:port" (e.g. a Nym SOCKS5 proxy, hides the bot's IP) */
  ZCASH_CONNECTION: z.string().min(1).default("direct"),
  /** Where purchase payments are sent on testnet. Later this becomes the swap deposit address. */
  ZCASH_SETTLEMENT_ADDRESS: z.string().optional(),
  /**
   * Confirmations before a deposit is credited. The wallet only spends money from other senders after
   * 10 confirmations (about 4 minutes on NU7 testnet), so the default matches that: crediting sooner
   * would show a balance the wallet cannot spend yet. Lower it only for quick demos (see send below).
   */
  ZCASH_MIN_CONFIRMATIONS: positiveInt.default(10),
  ZCASH_SYNC_INTERVAL_SECONDS: positiveInt.default(30),
  /** Test exchange rate: price of 1 ZEC in CIRCLE_CURRENCY (TAZ has no market price). */
  ZEC_PRICE: amountInMinorUnits.default(4000),
  /** Explorer link for txids; {txid} is replaced. */
  ZCASH_EXPLORER_TX_URL: z.string().optional(),

  /** Mainnet: the Bitrefill account email that receives the USD store credit bought with swapped ZEC. */
  BITREFILL_ACCOUNT_EMAIL: z.email().optional(),
  /** Optional 1Click partner key (without it 1Click charges a small extra fee). */
  ONE_CLICK_API_KEY: z.string().optional(),

  /** Telegram user ids allowed to turn on the developer log channel (/circlelogs), comma-separated. */
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)),

  /** Postgres connection string, e.g. from Neon: postgres://user:pass@host/db?sslmode=require */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (a Postgres connection string)"),

  CIRCLE_CURRENCY: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase())
    .default("USD"),
  DEFAULT_CIRCLE_MONTHLY_LIMIT: amountInMinorUnits.default(1000),
  DEFAULT_MEMBER_PER_PURCHASE_LIMIT: amountInMinorUnits.default(200),
  DEFAULT_MEMBER_MONTHLY_LIMIT: amountInMinorUnits.default(500),

  INVITE_TTL_HOURS: positiveInt.default(24),
  PROPOSAL_TTL_MINUTES: positiveInt.default(30),
  PRICE_TOLERANCE_PERCENT: z.coerce.number().min(0).max(50).default(5),
  AGENT_RATE_LIMIT_PER_MINUTE: positiveInt.default(8),
})
  .refine((e) => e.BITREFILL_MODE === "mock" || Boolean(e.BITREFILL_API_KEY), {
    path: ["BITREFILL_API_KEY"],
    message: "BITREFILL_API_KEY is required unless BITREFILL_MODE=mock",
  })
  .refine((e) => !e.ZCASH_SETTLEMENT_ADDRESS || isShieldedAddress(e.ZCASH_SETTLEMENT_ADDRESS), {
    path: ["ZCASH_SETTLEMENT_ADDRESS"],
    message: "ZCASH_SETTLEMENT_ADDRESS must be a shielded (unified or Sapling) address, not a transparent t-address",
  })
  .refine((e) => e.ZCASH_MODE !== "mainnet" || e.BITREFILL_MODE === "live", {
    path: ["BITREFILL_MODE"],
    message: "ZCASH_MODE=mainnet swaps real ZEC into Bitrefill credit, so BITREFILL_MODE must be live",
  })
  .refine((e) => e.ZCASH_MODE !== "mainnet" || Boolean(e.BITREFILL_ACCOUNT_EMAIL), {
    path: ["BITREFILL_ACCOUNT_EMAIL"],
    message: "BITREFILL_ACCOUNT_EMAIL is required with ZCASH_MODE=mainnet (the account the store credit goes to)",
  })
  .refine((e) => e.ZCASH_MODE !== "testnet" || Boolean(e.ZCASH_SETTLEMENT_ADDRESS), {
    path: ["ZCASH_SETTLEMENT_ADDRESS"],
    message: "ZCASH_SETTLEMENT_ADDRESS is required when ZCASH_MODE=testnet (the address test purchases are paid to)",
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env["NODE_ENV"];
  logLevel: Env["LOG_LEVEL"];
  telegram: { botToken: string };
  anthropic: { apiKey: string; model: string };
  bitrefill: { mode: "live" | "mock"; apiKey: string; baseUrl: string; includeTestProducts: boolean };
  zcash: {
    mode: "off" | "mock" | "testnet" | "mainnet";
    devtoolPath: string;
    walletDir: string;
    identityFile: string;
    server: string;
    connection: string;
    settlementAddress: string;
    minConfirmations: number;
    syncIntervalMs: number;
    /** Testnet/mock only: fixed price of 1 ZEC in cents. Mainnet uses the live 1Click price. */
    priceMinorPerZec: number;
    explorerTxUrl: string;
    bitrefillAccountEmail: string | null;
    oneClickApiKey: string | null;
  };
  database: { url: string };
  circle: {
    currency: string;
    defaultCircleMonthlyLimit: number;
    defaultMemberPerPurchaseLimit: number;
    defaultMemberMonthlyLimit: number;
    inviteTtlMs: number;
    proposalTtlMs: number;
    priceTolerancePercent: number;
  };
  agent: { rateLimitPerMinute: number };
  /** Telegram ids allowed to manage the developer log channel. */
  adminTelegramIds: number[];
}

/**
 * Loads `.env` (if present) into process.env, validates it, and returns a typed config.
 * Exits with a readable error listing every invalid variable.
 */
export function loadConfig(envFile = ".env"): AppConfig {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const e = parsed.data;
  const walletDir = e.ZCASH_WALLET_DIR ?? (e.ZCASH_MODE === "mainnet" ? "./data/zcash-mainnet-wallet" : "./data/zcash-wallet");
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    telegram: { botToken: e.TELEGRAM_BOT_TOKEN },
    anthropic: { apiKey: e.ANTHROPIC_API_KEY, model: e.ANTHROPIC_MODEL },
    bitrefill: {
      mode: e.BITREFILL_MODE,
      apiKey: e.BITREFILL_API_KEY ?? "",
      baseUrl: e.BITREFILL_BASE_URL.replace(/\/+$/, ""),
      includeTestProducts: e.BITREFILL_INCLUDE_TEST_PRODUCTS,
    },
    zcash: {
      mode: e.ZCASH_MODE,
      devtoolPath: resolve(e.ZCASH_DEVTOOL_PATH),
      walletDir: resolve(walletDir),
      identityFile: resolve(e.ZCASH_IDENTITY_FILE ?? join(walletDir, "identity.txt")),
      server: e.ZCASH_SERVER,
      connection: e.ZCASH_CONNECTION,
      settlementAddress:
        e.ZCASH_SETTLEMENT_ADDRESS ?? "utest1mocksettlementxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      minConfirmations: e.ZCASH_MIN_CONFIRMATIONS,
      syncIntervalMs: e.ZCASH_SYNC_INTERVAL_SECONDS * 1000,
      priceMinorPerZec: e.ZEC_PRICE,
      explorerTxUrl:
        e.ZCASH_EXPLORER_TX_URL ??
        (e.ZCASH_MODE === "mainnet" ? "https://mainnet.zcashexplorer.app/transactions/{txid}" : "https://testnet.zcashexplorer.app/transactions/{txid}"),
      bitrefillAccountEmail: e.BITREFILL_ACCOUNT_EMAIL ?? null,
      oneClickApiKey: e.ONE_CLICK_API_KEY ?? null,
    },
    database: { url: e.DATABASE_URL },
    circle: {
      currency: e.CIRCLE_CURRENCY,
      defaultCircleMonthlyLimit: e.DEFAULT_CIRCLE_MONTHLY_LIMIT,
      defaultMemberPerPurchaseLimit: e.DEFAULT_MEMBER_PER_PURCHASE_LIMIT,
      defaultMemberMonthlyLimit: e.DEFAULT_MEMBER_MONTHLY_LIMIT,
      inviteTtlMs: e.INVITE_TTL_HOURS * 60 * 60 * 1000,
      proposalTtlMs: e.PROPOSAL_TTL_MINUTES * 60 * 1000,
      priceTolerancePercent: e.PRICE_TOLERANCE_PERCENT,
    },
    agent: { rateLimitPerMinute: e.AGENT_RATE_LIMIT_PER_MINUTE },
    adminTelegramIds: e.ADMIN_TELEGRAM_IDS,
  };
}
