import type { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { formatEntry, maskPhone, TelegramLogChannel } from "../src/bot/log-channel.js";
import { LogChannelRepository } from "../src/repositories/log-channel.repository.js";
import { freshDatabase } from "./pglite-database.js";
import { silentLogger } from "./helpers.js";

const TXID = "b53b2cd5e2ac91877090443098765432101234567890abcdef1234567890abcd";

describe("log message format", () => {
  it("is one short message with a header and one line per field", () => {
    const text = formatEntry({ event: "swap.deposit_sent", circleId: 3, fields: { swap: 7, zec: "0.00154", txid: TXID } }, new Date("2026-11-04T15:00:00Z"));
    expect(text.split("\n")).toEqual([
      "💱 <b>swap.deposit_sent</b> · 15:00:00 UTC",
      "circle: #3",
      "swap: <code>7</code>",
      "zec: <code>0.00154</code>",
      `txid: <code>${TXID}</code>`, // digit runs inside txids are left alone
    ]);
  });

  it("masks phone numbers and secrets, and escapes HTML", () => {
    const text = formatEntry({
      event: "agent.turn",
      fields: { phone_number: "919876543210", said: "recharge +91 98765 43210 <b>now</b>", token: "bot123456789:AAFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0" },
    });
    expect(text).toContain("phone_number: <code>91******3210</code>");
    expect(text).not.toMatch(/98765 ?43210/);
    expect(text).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(text).not.toContain("AAG3pV0Z");
    expect(maskPhone("+91 98765 43210")).toBe("91******3210");
  });

  it("marks warnings and errors", () => {
    expect(formatEntry({ event: "swap.refunded", level: "error" })).toMatch(/^❌/);
    expect(formatEntry({ event: "zec.payment_failed", level: "warn" })).toMatch(/^⚠️/);
  });
});

describe("TelegramLogChannel", () => {
  function fakeApi() {
    const sent: Array<{ chatId: number; text: string; at: number }> = [];
    const api = { sendMessage: async (chatId: number, text: string) => void sent.push({ chatId, text, at: Date.now() }) } as unknown as Api;
    return { api, sent };
  }
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("sends each entry as its own message, in order, spaced out per chat", async () => {
    const { api, sent } = fakeApi();
    const channel = new TelegramLogChannel(api, new LogChannelRepository(await freshDatabase()), silentLogger, { minIntervalMs: 40 });
    await channel.add(-100, null, "logs", 1);
    for (let i = 1; i <= 4; i++) channel.record({ event: `purchase.step${i}` });
    await settle(250);
    channel.stop();
    expect(sent.map((m) => m.text.match(/purchase\.step\d/)![0])).toEqual(["purchase.step1", "purchase.step2", "purchase.step3", "purchase.step4"]);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(35);
  });

  it("drops the oldest entries when flooded, and says so instead of exceeding Telegram's limits", async () => {
    const { api, sent } = fakeApi();
    const channel = new TelegramLogChannel(api, new LogChannelRepository(await freshDatabase()), silentLogger, { minIntervalMs: 20, maxQueue: 3 });
    await channel.add(-100, null, "logs", 1);
    for (let i = 1; i <= 10; i++) channel.record({ event: `bot.e${i}` });
    await settle(300);
    channel.stop();
    expect(sent.some((m) => /log message\(s\) were skipped/.test(m.text))).toBe(true);
    expect(sent.at(-1)!.text).toContain("bot.e10"); // the newest survive
    expect(sent.length).toBeLessThan(10);
  });

  it("sends nothing when no chat is registered, and stops after /circlelogs off", async () => {
    const { api, sent } = fakeApi();
    const channel = new TelegramLogChannel(api, new LogChannelRepository(await freshDatabase()), silentLogger, { minIntervalMs: 10 });
    channel.record({ event: "bot.ignored" });
    await channel.add(-100, null, "logs", 1);
    await channel.remove(-100, null);
    channel.record({ event: "bot.also_ignored" });
    await settle(60);
    expect(sent).toHaveLength(0);
  });

  it("each circle's chat receives only that circle's activity", async () => {
    const { api, sent } = fakeApi();
    const channel = new TelegramLogChannel(api, new LogChannelRepository(await freshDatabase()), silentLogger, { minIntervalMs: 10 });
    // The repository needs real circles for the foreign key, so register through two circles.
    const db = await freshDatabase();
    const repo = new LogChannelRepository(db);
    for (const id of [1, 2]) {
      await db.query(
        "INSERT INTO circles (id, name, owner_telegram_id, currency, monthly_limit_minor, default_per_purchase_limit_minor, default_member_monthly_limit_minor, created_at) VALUES (?, ?, ?, 'USD', 1000, 200, 500, now())",
        [id, `Circle ${id}`, 100 + id],
      );
    }
    const scoped = new TelegramLogChannel(api, repo, silentLogger, { minIntervalMs: 10 });
    await scoped.add(-1, 1, "circle one chat", 101);
    await scoped.add(-2, 2, "circle two chat", 102);
    channel.stop();

    scoped.record({ event: "purchase.proposed", circleId: 1, fields: { n: "for-circle-1" } });
    scoped.record({ event: "purchase.proposed", circleId: 2, fields: { n: "for-circle-2" } });
    scoped.record({ event: "bot.started" }); // belongs to no circle
    await settle(150);
    scoped.stop();

    expect(sent.filter((m) => m.chatId === -1).map((m) => m.text).join("|")).toContain("for-circle-1");
    expect(sent.filter((m) => m.chatId === -1).map((m) => m.text).join("|")).not.toContain("for-circle-2");
    expect(sent.filter((m) => m.chatId === -2).map((m) => m.text).join("|")).toContain("for-circle-2");
    expect(sent.filter((m) => m.chatId === -2).map((m) => m.text).join("|")).not.toContain("for-circle-1");
    expect(sent.some((m) => m.text.includes("bot.started"))).toBe(false); // global events never reach circle chats
  });

  it("an all-circles chat gets everything once, even if it also follows one circle", async () => {
    const { api, sent } = fakeApi();
    const db = await freshDatabase();
    await db.query(
      "INSERT INTO circles (id, name, owner_telegram_id, currency, monthly_limit_minor, default_per_purchase_limit_minor, default_member_monthly_limit_minor, created_at) VALUES (1, 'C', 101, 'USD', 1000, 200, 500, now())",
    );
    const channel = new TelegramLogChannel(api, new LogChannelRepository(db), silentLogger, { minIntervalMs: 10 });
    await channel.add(-9, null, "admin chat", 1);
    await channel.add(-9, 1, "admin chat", 1);
    channel.record({ event: "purchase.paid", circleId: 1 });
    channel.record({ event: "bot.started" });
    await settle(120);
    channel.stop();
    expect(sent.map((m) => m.text.match(/purchase\.paid|bot\.started/)![0]).sort()).toEqual(["bot.started", "purchase.paid"]);
  });

  it("registrations survive a restart", async () => {
    const { api } = fakeApi();
    const db = await freshDatabase();
    await db.query(
      "INSERT INTO circles (id, name, owner_telegram_id, currency, monthly_limit_minor, default_per_purchase_limit_minor, default_member_monthly_limit_minor, created_at) VALUES (1, 'C', 101, 'USD', 1000, 200, 500, now())",
    );
    const first = new TelegramLogChannel(api, new LogChannelRepository(db), silentLogger);
    await first.add(-5, 1, "chat", 101);
    first.stop();
    const second = new TelegramLogChannel(api, new LogChannelRepository(db), silentLogger);
    await second.load();
    expect(second.chatIds).toEqual([-5]);
    second.stop();
  });
});
