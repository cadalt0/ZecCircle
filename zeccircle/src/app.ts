import Anthropic from "@anthropic-ai/sdk";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { ConversationStore } from "./agent/conversation-store.js";
import { ShoppingAgent } from "./agent/shopping-agent.js";
import { configureBot } from "./bot/bot.js";
import { TelegramLogChannel } from "./bot/log-channel.js";
import { TelegramNotifier } from "./bot/telegram-notifier.js";
import type { AppConfig } from "./config/env.js";
import { PgDatabase, type Database } from "./db/database.js";
import { liveMenuText } from "./domain/live-purchase-rules.js";
import type { BitrefillApi } from "./integrations/bitrefill/api.js";
import { BitrefillClient } from "./integrations/bitrefill/client.js";
import { BitrefillMcpClient } from "./integrations/bitrefill/mcp-client.js";
import { MockBitrefillClient } from "./integrations/bitrefill/mock-client.js";
import { OneClickClient } from "./integrations/near-intents/one-click-client.js";
import { DevtoolWallet } from "./integrations/zcash/devtool-wallet.js";
import { MockZcashWallet } from "./integrations/zcash/mock-wallet.js";
import { ensureDevtoolWallet } from "./integrations/zcash/wallet-bootstrap.js";
import type { ZcashNetwork, ZcashWallet } from "./integrations/zcash/wallet.js";
import type { Logger } from "./lib/logger.js";
import { SlidingWindowRateLimiter } from "./lib/rate-limiter.js";
import { AuditRepository } from "./repositories/audit.repository.js";
import { CircleRepository } from "./repositories/circle.repository.js";
import { InviteRepository } from "./repositories/invite.repository.js";
import { LogChannelRepository } from "./repositories/log-channel.repository.js";
import { MemberRepository } from "./repositories/member.repository.js";
import { PurchaseRepository } from "./repositories/purchase.repository.js";
import { SwapRepository } from "./repositories/swap.repository.js";
import { WalletSeedRepository } from "./repositories/wallet-seed.repository.js";
import { ZecRepository } from "./repositories/zec.repository.js";
import { CompositeActivityLog, type ActivityLog } from "./services/activity/activity-log.js";
import { CircleService } from "./services/circle.service.js";
import { NoFundingRail, type FundingRail } from "./services/funding/funding-rail.js";
import { FixedPrice, OneClickZecPrice, type PriceSource } from "./services/funding/price-source.js";
import { SinkSettlement, type SettlementStrategy } from "./services/funding/settlement.js";
import { SwapSettlement } from "./services/funding/swap-settlement.js";
import { ZcashFundingService } from "./services/funding/zcash-funding.service.js";
import { LiveModeGuard, MockModeGuard, type PurchaseGuard } from "./services/purchase-guard.js";
import { PurchaseService } from "./services/purchase.service.js";

export interface App {
  bot: Bot;
  db: Database;
  bitrefill: BitrefillApi;
  purchaseService: PurchaseService;
  activity: ActivityLog;
  logChannel: TelegramLogChannel;
  /** Null when ZCASH_MODE=off. */
  zcash: { service: ZcashFundingService; wallet: ZcashWallet; price: PriceSource } | null;
}

/** Which network's ZEC records this run reads and writes. */
const zecNetworkFor = (mode: AppConfig["zcash"]["mode"]): ZcashNetwork => (mode === "mainnet" ? "main" : mode === "mock" ? "mock" : "test");

/** Pino gets every activity entry too, so nothing depends on a Telegram log channel existing. */
const pinoActivity = (logger: Logger): ActivityLog => ({
  record: (e) => logger[e.level === "error" ? "error" : e.level === "warn" ? "warn" : "info"]({ event: e.event, circleId: e.circleId, ...e.fields }, "activity"),
});

async function createDevtoolWallet(config: AppConfig, logger: Logger, seeds: WalletSeedRepository, network: "test" | "main"): Promise<DevtoolWallet> {
  // Uses the wallet on disk, or rebuilds it from the seed stored in the database (e.g. on Heroku).
  const result = await ensureDevtoolWallet({
    network,
    binary: config.zcash.devtoolPath,
    walletDir: config.zcash.walletDir,
    identityFile: config.zcash.identityFile,
    server: config.zcash.server,
    connection: config.zcash.connection,
    seeds,
    logger: logger.child({ module: "zcash-bootstrap" }),
  });
  logger.info({ wallet: result, network }, "zcash wallet bootstrap done");
  const wallet = new DevtoolWallet({
    network,
    binary: config.zcash.devtoolPath,
    walletDir: config.zcash.walletDir,
    identityFile: config.zcash.identityFile,
    server: config.zcash.server,
    connection: config.zcash.connection,
    minConfirmations: config.zcash.minConfirmations,
    logger: logger.child({ module: "zcash-wallet" }),
  });
  wallet.assertReady();
  return wallet;
}

/** Composition root: builds every dependency once and wires them together. */
export async function createApp(config: AppConfig, logger: Logger): Promise<App> {
  const db = new PgDatabase(config.database.url, (error) => logger.error({ err: error }, "database pool error"));
  await db.migrate();

  const bot = new Bot(config.telegram.botToken);
  // Retry Telegram calls that fail on a flaky network or hit rate limits, instead of dropping replies.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 30 }));

  // Developer activity feed: pino + any Telegram groups/channels registered with /circlelogs.
  const logChannel = new TelegramLogChannel(bot.api, new LogChannelRepository(db), logger.child({ module: "log-channel" }));
  await logChannel.load();
  const activity: ActivityLog = new CompositeActivityLog([pinoActivity(logger.child({ module: "activity" })), logChannel]);

  const repos = {
    circles: new CircleRepository(db),
    members: new MemberRepository(db),
    invites: new InviteRepository(db),
    purchases: new PurchaseRepository(db),
    // Every audited action also goes to the activity feed.
    audit: new AuditRepository(db, (e) => activity.record({ event: e.action, circleId: e.circleId, fields: { actor: e.actorTelegramId, ...e.details } })),
    zec: new ZecRepository(db, zecNetworkFor(config.zcash.mode)),
    swaps: new SwapRepository(db),
  };

  const notifier = new TelegramNotifier(bot.api, logger.child({ module: "notifier" }), config.zcash.explorerTxUrl);

  const bitrefill: BitrefillApi =
    config.bitrefill.mode === "mock"
      ? new MockBitrefillClient(config.circle.currency)
      : new BitrefillClient({
          apiKey: config.bitrefill.apiKey,
          baseUrl: config.bitrefill.baseUrl,
          includeTestProducts: config.bitrefill.includeTestProducts,
          logger: logger.child({ module: "bitrefill" }),
        });

  const circleService = new CircleService({
    db,
    ...repos,
    notifier,
    logger: logger.child({ module: "circles" }),
    settings: {
      currency: config.circle.currency,
      defaultCircleMonthlyLimit: config.circle.defaultCircleMonthlyLimit,
      defaultMemberPerPurchaseLimit: config.circle.defaultMemberPerPurchaseLimit,
      defaultMemberMonthlyLimit: config.circle.defaultMemberMonthlyLimit,
      inviteTtlMs: config.circle.inviteTtlMs,
    },
  });

  // ---- Zcash: wallet, price and how purchases are settled, per mode
  const seeds = new WalletSeedRepository(db);
  let zcash: App["zcash"] = null;
  if (config.zcash.mode !== "off") {
    let wallet: ZcashWallet;
    let price: PriceSource;
    let settlement: SettlementStrategy;

    if (config.zcash.mode === "mainnet") {
      // PRODUCTION: real ZEC, live price, purchases funded by a ZEC -> USDC swap into Bitrefill store credit.
      const devtool = await createDevtoolWallet(config, logger, seeds, "main");
      const oneClick = new OneClickClient({ apiKey: config.zcash.oneClickApiKey ?? undefined, logger: logger.child({ module: "1click" }) });
      price = new OneClickZecPrice(oneClick);
      wallet = devtool;
      settlement = new SwapSettlement({
        db,
        wallet: devtool,
        oneClick,
        bitrefillMcp: new BitrefillMcpClient({ apiKey: config.bitrefill.apiKey, logger: logger.child({ module: "bitrefill-mcp" }) }),
        bitrefill,
        swaps: repos.swaps,
        price,
        accountEmail: config.zcash.bitrefillAccountEmail!,
        logger: logger.child({ module: "swap" }),
        activity,
      });
    } else {
      // TESTNET / MOCK: TAZ at a fixed test price, paid to a settlement address.
      wallet = config.zcash.mode === "mock" ? new MockZcashWallet() : await createDevtoolWallet(config, logger, seeds, "test");
      price = new FixedPrice(config.zcash.priceMinorPerZec);
      settlement = new SinkSettlement(wallet, config.zcash.settlementAddress, price);
    }

    const service = new ZcashFundingService({
      wallet,
      ...repos,
      circleService,
      notifier,
      price,
      settlement,
      activity,
      logger: logger.child({ module: "zcash" }),
      settings: { minConfirmations: config.zcash.minConfirmations, syncIntervalMs: config.zcash.syncIntervalMs },
    });
    zcash = { service, wallet, price };
  }
  const fundingRail: FundingRail = zcash?.service ?? new NoFundingRail();

  // Real purchases get the hardcoded live rules; fake ones don't need them.
  const guard: PurchaseGuard =
    config.bitrefill.mode === "live"
      ? new LiveModeGuard({ db, purchases: repos.purchases, logger: logger.child({ module: "live-guard" }) })
      : new MockModeGuard();

  const purchaseService = new PurchaseService({
    db,
    ...repos,
    circleService,
    bitrefill,
    fundingRail,
    guard,
    notifier,
    activity,
    logger: logger.child({ module: "purchases" }),
    settings: {
      currency: config.circle.currency,
      proposalTtlMs: config.circle.proposalTtlMs,
      approvalTtlMs: 24 * 60 * 60 * 1000,
      priceTolerancePercent: config.circle.priceTolerancePercent,
      invoicePollIntervalMs: 3_000,
      invoicePollTimeoutMs: 3 * 60 * 1000,
    },
  });

  const agent = new ShoppingAgent({
    client: new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 2, timeout: 60_000 }),
    model: config.anthropic.model,
    currency: config.circle.currency,
    liveMenu: config.bitrefill.mode === "live" ? liveMenuText() : null,
    conversations: new ConversationStore(),
    bitrefill,
    circleService,
    purchaseService,
    fundingRail,
    activity,
    logger: logger.child({ module: "agent" }),
  });

  configureBot(bot, {
    circleService,
    purchaseService,
    agent,
    agentRateLimiter: new SlidingWindowRateLimiter(config.agent.rateLimitPerMinute, 60_000),
    currency: config.circle.currency,
    zcash: zcash ? { service: zcash.service, wallet: zcash.wallet, explorerTxUrl: config.zcash.explorerTxUrl } : null,
    logs: { logChannel, activity, circleService, adminTelegramIds: config.adminTelegramIds, logger: logger.child({ module: "logs" }) },
    logger: logger.child({ module: "bot" }),
  });

  return { bot, db, bitrefill, purchaseService, activity, logChannel, zcash };
}
