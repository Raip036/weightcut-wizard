/**
 * Feel-check AI feedback — one short actionable line per logged check.
 *
 * gpt-oss-120b at low reasoning effort — served by Cerebras on OpenRouter
 * (pinned via provider routing for speed), native on Groq. Fires on every
 * feel-check value change.
 *
 * The mutation `recordFeelCheck` clears the stored `aiFeedback` field when
 * a new value lands; the client triggers this action right after, and the
 * action writes the result back via `setFeelCheckFeedback`.
 */
"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { callGroqRaw } from "../_shared/groq";
import { enforceFeatureGate } from "../_shared/featureGates";
import { requireUserIdFromAction } from "./_helpers";

// gpt-oss-120b on both providers; on OpenRouter we pin the call to Cerebras
// via CEREBRAS_ROUTING for its very high throughput. reasoning_effort "low"
// (set at the call site) keeps this short single-line output snappy.
const FAST_MODEL = "openai/gpt-oss-120b" as const;
const CEREBRAS_ROUTING = { order: ["cerebras"], allow_fallbacks: true };

const FEEL_CHECK_LABELS: Record<string, string> = {
  urine_colour: "urine colour (1=clear, 8=dark amber)",
  weigh_back_kg: "post-weigh-in body weight rebound (kg)",
  energy_1to10: "subjective energy level (1=crashed, 10=peak)",
  headache: "headache (no / mild / severe)",
  no_cramps: "cramping (none / calf / thigh / back / other)",
};

export const generate = action({
  args: {
    campId: v.id("fight_camps"),
    metric: v.union(
      v.literal("urine_colour"),
      v.literal("weigh_back_kg"),
      v.literal("energy_1to10"),
      v.literal("headache"),
      v.literal("no_cramps"),
    ),
    value: v.string(),
  },
  handler: async (ctx, { campId, metric, value }): Promise<{ feedback: string }> => {
    // Server-side Pro gate — feel-check coaching is part of the weight-protocol
    // (Pro) surface. Fail-closed BEFORE spending the Groq call so a direct
    // client call can't get free AI.
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_PROTOCOL");

    const label = FEEL_CHECK_LABELS[metric] ?? metric;
    const systemPrompt = `You are a combat-sports rehydration coach. Give one short actionable instruction (≤120 chars) about what the athlete should do right now based on their feel-check value. Second person. No emojis. No hedging. If the value is alarming, tell them to stop and contact their corner.`;
    const userPrompt = `Metric: ${label}\nLogged value: ${value}\nReturn ONLY the single-line instruction. No preamble. No quotes.`;

    let feedback = "";
    try {
      const res = await callGroqRaw({
        model: FAST_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        // Headroom for gpt-oss-120b's hidden reasoning tokens (kept minimal
        // by reasoning_effort "low") plus the ≤120-char instruction itself.
        max_tokens: 256,
        reasoning_effort: "low",
        timeoutMs: 8_000,
        providerRouting: CEREBRAS_ROUTING,
      });
      feedback = String(res.choices?.[0]?.message?.content ?? "").trim();
      // Strip any wrapping quotes the model loves to add.
      feedback = feedback.replace(/^["']+|["']+$/g, "").slice(0, 200);
    } catch (err) {
      console.error("feelCheckFeedback failed", err);
      feedback = "";
    }

    if (feedback) {
      await ctx.runMutation(api.weightProtocols.setFeelCheckFeedback, {
        campId,
        metric,
        aiFeedback: feedback,
      });
    }
    return { feedback };
  },
});
