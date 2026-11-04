import { run } from "@grammyjs/runner";
import { createApp, type App } from "./app.js";
import { BOT_COMMANDS } from "./bot/bot.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { redactConsole } from "./lib/redact.js";
import { LIVE_ITEMS, LIVE_TOTAL_SPEND_CEILING_MINOR } from "./domain/live-purchase-rules.js";
import { formatMoney } from "./lib/money.js";
import { MAX_SWAPS_TOTAL, MAX_ZEC_PER_SWAP_ZAT, SWAP_USD_MINOR } from "./domain/mainnet-swap-rules.js";
import { zatToZecString } from "./integrations/zcash/units.js";

/** Fails fast on bad Bitrefill credentials, and warns if limits and Bitrefill use different currencies. */
async function checkBitrefill(app: App, config: AppConfig, logger: Logger): Promise<void> {
  try {
    const balance = await app.bitrefill.getBalance();
    // Bitrefill reports this balance in minor units (cents) although product prices come in major units.
    logger.info({ balanceMinor: balance.balance, currency: balance.currency }, "bitrefill connected");
    if (balance.currency.toUpperCase() !== config.circle.currency) {
      logger.warn(
        { accountCurrency: balance.currency, circleCurrency: config.circle.currency },
        "Bitrefill account currency differs from CIRCLE_CURRENCY; invoices in another currency will be refused. Set CIRCLE_CURRENCY to match.",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "could not reach Bitrefill; check BITREFILL_API_KEY");
    throw error;
  }
}

async function main(): Promise<void> {
  redactConsole();
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.env === "development");
  const app = await createApp(config, logger);

  if (config.bitrefill.mode === "mock") {
    logger.warn("BITREFILL_MODE=mock: fake catalogue, fake purchases. NOTHING WILL BE BOUGHT. Set BITREFILL_MODE=live for real orders.");
  } else {
    await checkBitrefill(app, config, logger);
    logger.warn(
      {
        allowed: LIVE_ITEMS.map((i) => i.label),
        totalCeiling: formatMoney(LIVE_TOTAL_SPEND_CEILING_MINOR, "USD"),
      },
      "BITREFILL_MODE=live: REAL purchases on, limited by the hardcoded rules",
    );
  }

  await app.bot.init();
  await app.bot.api.setMyCommands(BOT_COMMANDS.map((c) => ({ ...c })));
  if (app.zcash) {
    const address = await app.zcash.wallet.getAddress();
    logger.info({ network: app.zcash.wallet.network, address }, "zcash wallet ready");
    if (app.zcash.wallet.network === "mock") {
      logger.warn("ZCASH_MODE=mock: simulated Zcash wallet. Use /testdeposit to fake a deposit.");
    }
    if (app.zcash.wallet.network === "main") {
      const price = await app.zcash.price.getPriceMinorPerZec();
      logger.warn(
        {
          zecPriceUsd: (price / 100).toFixed(2),
          swapUsd: formatMoney(SWAP_USD_MINOR, "USD"),
          maxZecPerSwap: zatToZecString(MAX_ZEC_PER_SWAP_ZAT),
          maxSwaps: MAX_SWAPS_TOTAL,
        },
        "ZCASH_MODE=mainnet: REAL ZEC. Purchases are funded by swapping ZEC -> USDC -> Bitrefill store credit, within the hardcoded limits",
      );
    }
    app.zcash.service.start();
  }
  await app.purchaseService.start();

  // channel_post lets /circlelogs work in channels.
  const runner = run(app.bot, { runner: { fetch: { allowed_updates: ["message", "callback_query", "channel_post"] } } });
  logger.info({ username: app.bot.botInfo.username, logChannels: app.logChannel.chatIds.length }, "bot started");
  app.activity.record({
    event: "bot.started",
    fields: { bot: `@${app.bot.botInfo.username}`, bitrefill: config.bitrefill.mode, zcash: config.zcash.mode },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    app.activity.record({ event: "bot.stopping", fields: { signal } });
    if (runner.isRunning()) await runner.stop();
    await app.purchaseService.stop();
    await app.zcash?.service.stop();
    app.logChannel.stop();
    await app.db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
