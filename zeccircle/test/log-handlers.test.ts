import { Bot } from "grammy";
import type { Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { describe, expect, it } from "vitest";
import { logHandlers } from "../src/bot/handlers/logs.handlers.js";
import { TelegramLogChannel } from "../src/bot/log-channel.js";
import { LogChannelRepository } from "../src/repositories/log-channel.repository.js";
import { buildTestServices, circleWithMember, MEMBER, OWNER, silentLogger, STRANGER } from "./helpers.js";

/** Runs the real /circlelogs handlers with fake Telegram updates and records what the bot says. */
async function setup() {
  const s = await buildTestServices();
  const { circle } = await circleWithMember(s);
  const sentToLogs: Array<{ chatId: number; text: string }> = [];
  const logApi = { sendMessage: async (chatId: number, text: string) => void sentToLogs.push({ chatId, text }) } as unknown as Api;
  const logChannel = new TelegramLogChannel(logApi, new LogChannelRepository(s.db), silentLogger, { minIntervalMs: 5 });

  const bot = new Bot("123:TEST", {
    botInfo: { id: 1, is_bot: true, first_name: "t", username: "tbot", can_join_groups: true, can_read_all_group_messages: false } as UserFromGetMe,
  });
  const replies: Array<{ chatId: number; text: string }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage") replies.push({ chatId: (payload as { chat_id: number }).chat_id, text: (payload as { text: string }).text });
    return { ok: true, result: true } as never;
  });
  bot.use(logHandlers({ logChannel, activity: { record: () => undefined }, circleService: s.circleService, adminTelegramIds: [], logger: silentLogger }));

  let updateId = 1;
  const command = (text: string) => ({ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]!.length });
  const say = async (chat: { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string }, text: string, from?: number) => {
    const base = { message_id: updateId, date: 0, chat, text, entities: [command(text)] };
    const update =
      chat.type === "channel"
        ? { update_id: updateId++, channel_post: base }
        : { update_id: updateId++, message: { ...base, from: { id: from ?? chat.id, is_bot: false, first_name: "u" } } };
    await bot.handleUpdate(update as never);
  };
  const lastReply = (chatId: number) => replies.filter((r) => r.chatId === chatId).at(-1)?.text ?? "";
  return { s, circle, logChannel, sentToLogs, say, lastReply };
}

const PRIVATE = (id: number) => ({ id, type: "private" as const });
const GROUP = { id: -100, type: "group" as const, title: "Dev logs" };
const CHANNEL = { id: -200, type: "channel" as const, title: "Dev channel" };
const settle = () => new Promise((r) => setTimeout(r, 60));

describe("/circlelogs", () => {
  it("the circle owner turns logs on in a group, and gets only that circle's activity", async () => {
    const t = await setup();
    await t.say(GROUP, "/circlelogs", OWNER.telegramId);
    expect(t.lastReply(GROUP.id)).toMatch(/Activity logs are on for .*Test Family/s);
    expect(t.logChannel.chatIds).toEqual([GROUP.id]);

    t.logChannel.record({ event: "purchase.proposed", circleId: t.circle.id, fields: { n: "mine" } });
    t.logChannel.record({ event: "purchase.proposed", circleId: t.circle.id + 99, fields: { n: "someone-elses" } });
    await settle();
    const text = t.sentToLogs.map((m) => m.text).join("|");
    expect(text).toContain("mine");
    expect(text).not.toContain("someone-elses");
    t.logChannel.stop();
  });

  it("someone who is not a circle owner can't turn logs on", async () => {
    const t = await setup();
    await t.say(GROUP, "/circlelogs", MEMBER.telegramId); // a plain member
    expect(t.lastReply(GROUP.id)).toMatch(/Only a circle owner/);
    await t.say(GROUP, "/circlelogs", STRANGER.telegramId); // not in any circle
    expect(t.logChannel.chatIds).toEqual([]);
  });

  it("a channel needs a code from the owner's private chat", async () => {
    const t = await setup();
    await t.say(CHANNEL, "/circlelogs"); // bare command in a channel: can't tell who wrote it
    expect(t.lastReply(CHANNEL.id)).toMatch(/get a code first/);
    expect(t.logChannel.chatIds).toEqual([]);

    await t.say(PRIVATE(MEMBER.telegramId), "/circlelogs"); // a member can't get one
    expect(t.lastReply(MEMBER.telegramId)).toMatch(/Only a circle owner/);

    await t.say(PRIVATE(OWNER.telegramId), "/circlelogs");
    const code = /\/circlelogs ([A-Z0-9]{8})/.exec(t.lastReply(OWNER.telegramId))?.[1];
    expect(code, `owner's private reply was: ${t.lastReply(OWNER.telegramId)}`).toBeDefined();

    await t.say(CHANNEL, "/circlelogs WRONGCODE");
    expect(t.logChannel.chatIds).toEqual([]);
    await t.say(CHANNEL, `/circlelogs ${code}`);
    expect(t.logChannel.chatIds).toEqual([CHANNEL.id]);

    await t.say(CHANNEL, `/circlelogs ${code}`); // a code works once
    expect(t.lastReply(CHANNEL.id)).toMatch(/invalid or expired/);
    t.logChannel.stop();
  });

  it("/circlelogs off stops it", async () => {
    const t = await setup();
    await t.say(GROUP, "/circlelogs", OWNER.telegramId);
    await t.say(GROUP, "/circlelogs off", OWNER.telegramId);
    expect(t.logChannel.chatIds).toEqual([]);
    t.logChannel.record({ event: "purchase.paid", circleId: t.circle.id });
    await settle();
    expect(t.sentToLogs).toHaveLength(0);
  });

  it("only bot admins can follow every circle", async () => {
    const t = await setup();
    await t.say(GROUP, "/circlelogs all", OWNER.telegramId);
    expect(t.lastReply(GROUP.id)).toMatch(/Only bot admins/);
    await t.say(PRIVATE(OWNER.telegramId), "/circlelogs all");
    expect(t.lastReply(OWNER.telegramId)).toMatch(/Only bot admins/);
    expect(t.logChannel.chatIds).toEqual([]);
  });
});
