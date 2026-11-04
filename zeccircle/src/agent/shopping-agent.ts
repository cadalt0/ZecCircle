import Anthropic from "@anthropic-ai/sdk";
import type { Purchase } from "../domain/types.js";
import type { ActivityLog } from "../services/activity/activity-log.js";
import type { Logger } from "../lib/logger.js";
import type { ConversationStore } from "./conversation-store.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { buildTools, type ToolDeps } from "./tools.js";

export interface AgentReply {
  text: string;
  proposals: Purchase[];
}

export interface ShoppingAgentOptions extends ToolDeps {
  client: Anthropic;
  model: string;
  currency: string;
  /** Present when real purchases are on: the only items that may be offered. */
  liveMenu?: string | null;
  conversations: ConversationStore;
  /** Developer activity feed (optional). */
  activity?: ActivityLog;
  logger: Logger;
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_CAPABLE_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

const MAX_TOOL_ITERATIONS = 8;
const MAX_REPLY_CHARS = 3500;

/**
 * Turns a member's chat message into a reply and (optionally) purchase proposals.
 * The agent has read-only catalog tools plus propose_purchase; it has no way to pay.
 */
export class ShoppingAgent {
  private readonly systemPrompt: string;

  constructor(private readonly options: ShoppingAgentOptions) {
    this.systemPrompt = buildSystemPrompt(options.currency, options.liveMenu ?? null);
  }

  async handle(telegramId: number, userText: string): Promise<AgentReply> {
    const history = this.options.conversations.get(telegramId);
    const memberTexts = [...history.filter((t) => t.role === "user").map((t) => t.text), userText];
    const proposals: Purchase[] = [];

    const tools = buildTools(this.options, {
      telegramId,
      currency: this.options.currency,
      memberTexts,
      proposals,
    });

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: userText },
    ];

    const useFallbacks = FALLBACK_CAPABLE_MODELS.has(this.options.model);
    const finalMessage = await this.options.client.beta.messages.toolRunner({
      model: this.options.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages,
      tools,
      max_iterations: MAX_TOOL_ITERATIONS,
      output_config: { effort: "medium" },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    let text: string;
    if (finalMessage.stop_reason === "refusal") {
      this.options.logger.warn({ category: finalMessage.stop_details?.category }, "agent refused");
      text = "Sorry, I can't help with that request.";
    } else {
      text = finalMessage.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!text) {
        text = proposals.length > 0 ? "On it." : "Sorry, I couldn't work that out. Could you rephrase?";
      }
    }
    if (text.length > MAX_REPLY_CHARS) text = `${text.slice(0, MAX_REPLY_CHARS)}…`;

    this.options.conversations.append(telegramId, { role: "user", text: userText }, { role: "assistant", text });
    this.options.logger.info(
      { telegramId, proposals: proposals.map((p) => p.id), stop: finalMessage.stop_reason, usage: finalMessage.usage },
      "agent turn",
    );
    const toolsUsed = finalMessage.content.filter((b) => b.type === "tool_use").length;
    const circleId = (await this.options.circleService.getMembership(telegramId))?.circle.id ?? null;
    this.options.activity?.record({
      event: "agent.turn",
      circleId,
      fields: {
        member_tg: telegramId,
        said: userText.slice(0, 200),
        replied: text.slice(0, 200),
        proposals: proposals.map((p) => `#${p.id} ${p.productName} ${p.value}`).join(", ") || "none",
        stop: finalMessage.stop_reason,
        tokens_in: finalMessage.usage.input_tokens,
        tokens_out: finalMessage.usage.output_tokens,
        tools_in_last_step: toolsUsed,
      },
    });
    return { text, proposals };
  }

  reset(telegramId: number): void {
    this.options.conversations.clear(telegramId);
  }
}
