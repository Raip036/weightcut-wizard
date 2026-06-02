/**
 * Pre-Session Green Light — fast Go / Modify / Bail verdict for a
 * planned training session (T15).
 *
 * Triggered when the user opens the app within ~2h of a calendared
 * session. The matching UI surface (T16) caches the result client-side
 * via `AIPersistence` keyed on (userId, sessionDateIso), so this action
 * has no server-side cache and no scheduled trigger — it runs purely
 * on-demand.
 *
 * Pro-gated under the existing `AI_RECOVERY_COACH` feature key (same
 * gate Camp Compass and the recovery-coach chat use), so the client's
 * `callWithProRecovery` wrapper turns a denial into a paywall prompt
 * without extra plumbing.
 *
 * Spec: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md §7.2
 */
"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { callGroqRaw } from "../../_shared/groq";
import { requireUserIdFromAction } from "../_helpers";
import { enforceFeatureGate } from "../../_shared/featureGates";
import { parseJSON } from "../../_shared/parseResponse";

// Per-provider model pick. Recovery features get OpenRouter models directly
// (not via the shared OPENROUTER_MODEL_MAP) so other features keep their
// current routing. Falls back to the canonical Groq model when LLM_PROVIDER
// is not openrouter.
//   - Pre-session brief → DeepSeek V3.5 (strong structured-output, ~5x
//     cheaper than Haiku 4.5). Latency is slightly higher than Haiku
//     (~1-2s vs ~500ms); acceptable for this surface since the user is
//     not blocked waiting.
//     Verify the exact OpenRouter model ID before deploy.
const MODEL =
  (typeof process !== "undefined" && process.env?.LLM_PROVIDER?.toLowerCase() === "openrouter")
    ? "deepseek/deepseek-chat"
    : "llama-3.1-8b-instant";
const GROQ_TIMEOUT_MS = 12_000;

export type GreenLightVerdict = "go" | "modify" | "bail";

export interface GreenLightResult {
  verdict: GreenLightVerdict;
  modification: string; // 1-2 sentences, specific
  rationale: string; // 1 sentence "why"
  cachedAt: number;
}

// ───────────────────────────────────────────────────────────────────────
// Public action
// ───────────────────────────────────────────────────────────────────────

/**
 * Generate a Pre-Session Green Light verdict for the calling user's
 * planned session. Returns the parsed verdict; the client caches it.
 *
 * `plannedSession.scheduledAtMs` should be a real epoch-ms timestamp —
 * the prompt converts to ISO so the model can reason about timing
 * (e.g. "your session starts in 90 min, post-meal glycogen still
 * topping off"). `durationMinutes` and `sessionType` give the model
 * enough context to scale its "modify" suggestions to the session
 * shape (sparring vs. lift vs. conditioning).
 */
export const generateBrief = action({
  args: {
    plannedSession: v.object({
      sessionType: v.string(),
      sessionTag: v.optional(v.string()),
      durationMinutes: v.number(),
      scheduledAtMs: v.number(),
    }),
  },
  handler: async (ctx, { plannedSession }): Promise<GreenLightResult> => {
    // 1. Auth → userId (action context, so resolve via internal query).
    const userId = await requireUserIdFromAction(ctx);

    // 2. Pro gate. Reuses AI_RECOVERY_COACH — same gate Camp Compass
    //    uses, since this is conceptually the same "recovery coach"
    //    feature surface. Throws PRO_FEATURE_REQUIRED:AI_RECOVERY_COACH
    //    on free users → client maps that to a paywall.
    await enforceFeatureGate(ctx, userId, "AI_RECOVERY_COACH");

    // 3. Single round-trip fetch of every input the prompt needs.
    const inputs = await ctx.runQuery(
      internal.recoveryReports.gatherGreenLightInputs,
      { userId },
    );

    // 4. Build the prompt.
    const prompt = buildGreenLightPrompt({ plannedSession, ...inputs });

    // 5. Call Groq with structured JSON output. Short max_tokens — the
    //    verdict is intentionally terse (one modification line, one
    //    rationale line).
    const response = await callGroqRaw({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 220,
      timeoutMs: GROQ_TIMEOUT_MS,
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Pre-Session Green Light: empty Groq response");
    }
    const json = parseJSON(rawContent) as Record<string, unknown>;

    // 6. Validate + normalize. A malformed verdict defaults to "modify"
    //    so the user never gets a "go" they didn't earn or a "bail"
    //    that wasn't justified.
    const verdict = normalizeVerdict(json.verdict);
    const modification = String(json.modification ?? "").slice(0, 280);
    const rationale = String(json.rationale ?? "").slice(0, 200);

    return { verdict, modification, rationale, cachedAt: Date.now() };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function normalizeVerdict(value: unknown): GreenLightVerdict {
  if (value === "go" || value === "modify" || value === "bail") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower.includes("go") || lower.includes("green")) return "go";
    if (
      lower.includes("bail") ||
      lower.includes("red") ||
      lower.includes("rest") ||
      lower.includes("skip")
    ) {
      return "bail";
    }
  }
  // Safe default — "modify" is the lowest-risk recommendation for a
  // malformed verdict (we don't green-light a session blindly nor do
  // we bail one without cause).
  return "modify";
}

// ───────────────────────────────────────────────────────────────────────
// Prompt construction
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a combat-sports recovery and session-planning coach. Output strict JSON.
Tone: direct, fight-culture native, no fluff. No emojis.
A "go" means the session is safe to do as planned. "modify" means do it but adjust intensity or volume. "bail" means skip or replace with rest / mobility.`;

interface GreenLightPromptInputs {
  plannedSession: {
    sessionType: string;
    sessionTag?: string;
    durationMinutes: number;
    scheduledAtMs: number;
  };
  wellness: {
    hooperIndex: number | null;
    sorenessLevel: number;
    fatigueLevel: number;
    stressLevel: number;
    sleepHours: number | null;
    readinessScore: number | null;
  } | null;
  lastSleepHours: number | null;
  last7dLoadSummary: { sessions: number; avgRPE: number; sorenessAvg: number };
  readinessScore: number | null;
}

function buildGreenLightPrompt(args: GreenLightPromptInputs): string {
  const when = new Date(args.plannedSession.scheduledAtMs).toISOString();
  const wellnessLine = args.wellness
    ? `Today's wellness: Hooper ${args.wellness.hooperIndex ?? "?"}/28, soreness ${args.wellness.sorenessLevel}/10, fatigue ${args.wellness.fatigueLevel}/10, stress ${args.wellness.stressLevel}/10`
    : "No wellness check-in today.";

  return [
    `Planned session: ${args.plannedSession.sessionType}${
      args.plannedSession.sessionTag ? ` (${args.plannedSession.sessionTag})` : ""
    }, ${args.plannedSession.durationMinutes} min, scheduled ${when}.`,
    "",
    "Body signals:",
    `- ${wellnessLine}`,
    `- Last night sleep: ${args.lastSleepHours ?? "unknown"} hours`,
    `- 7-day load: ${args.last7dLoadSummary.sessions} sessions, avg RPE ${args.last7dLoadSummary.avgRPE.toFixed(1)}, avg soreness ${args.last7dLoadSummary.sorenessAvg.toFixed(1)}/10`,
    `- Current readiness: ${args.readinessScore ?? "unknown"}/100`,
    "",
    "Return JSON:",
    "{",
    '  "verdict": "go" | "modify" | "bail",',
    '  "modification": "1-2 specific sentences. If \\"go\\", a short go-time prime. If \\"modify\\", specific change (e.g. cap rounds at 4, drop intensity to RPE 7). If \\"bail\\", what to do instead.",',
    '  "rationale": "one sentence explaining the call, citing the strongest signal"',
    "}",
    "No prose outside JSON. No emojis.",
  ].join("\n");
}
