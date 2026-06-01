/**
 * Fight-week protocol generator (WP-T6).
 *
 * Flagship AI action for the weight-protocol redesign. Produces a 7-14 day
 * fight-week plan (carb taper, water load + restriction, sodium curve,
 * fibre reduction, training taper, sleep targets) grounded in the
 * deterministic skeleton from `weightProtocolMath.ts` and the research
 * block from `protocolResearch.ts`.
 *
 * Two surfaces:
 *
 *   • `run`           – public action called from the UI. Pro-gated via
 *                       `enforceFeatureGate(... AI_WEIGHT_PROTOCOL)`.
 *
 *   • `runInternal`   – internalAction wired from
 *                       `weight_protocols_internal.maybeRegen` (drift-
 *                       triggered auto-regen). Same core logic, but
 *                       bypasses the public auth check because the
 *                       scheduler has no caller identity.
 *
 * Idempotent via the `(userId, campId, kind="fight_plan")` index on
 * `weight_protocols` — calling either entry point overwrites the prior row
 * rather than accumulating duplicates.
 *
 * Provider-conditional model: Claude Opus 4.7 on OpenRouter (preferred,
 * superior numerics + adherence) with the canonical Groq fallback when
 * `LLM_PROVIDER` is not set to openrouter.
 *
 * Numerics flow:
 *   1. Math module computes the deterministic per-day anchors.
 *   2. AI fills in copy (≤140 char per *Copy field, imperative keyAction).
 *   3. Merge step OVERWRITES every numeric field on every day from the
 *      skeleton so the model can't hallucinate dosages. Safety warnings
 *      are force-injected from `buildSafetyWarnings`. If any safety
 *      warning is `critical`, the effective approach is clamped to
 *      `gradual` before building the skeleton.
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
 *       §5.1 (action shape), §3.6 (prompt), §5.4 (regen path).
 *
 * Reference: convex/actions/recovery/campCompass.ts (canonical pattern for
 *            auth + Groq client + upsert).
 */
"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callGroqRaw } from "../_shared/groq";
import { requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { parseJSON } from "../_shared/parseResponse";
import { FightPlanSchema, type FightPlan } from "../_shared/aiSchemas";
import {
  computeDerived,
  buildSafetyWarnings,
  buildFightPlanSkeleton,
  type Approach,
  type DerivedInputs,
  type FightPlanSkeleton,
  type GatheredInputs,
  type SafetyWarning,
} from "../_shared/weightProtocolMath";
import { FIGHT_PLAN_RESEARCH } from "../_shared/protocolResearch";

const GROQ_TIMEOUT_MS = 30_000;

/**
 * Per-provider model pick. OpenRouter gets Opus 4.7 directly (low volume,
 * flagship feature — the quality lift on numeric adherence + copy
 * justifies the cost). Groq fallback uses the canonical heavy-reasoning
 * model so the feature still works when LLM_PROVIDER is unset.
 */
// Swapped from Claude Opus 4.7 to DeepSeek V3.5 — ~55x cheaper, strong on
// structured-output tasks. Verify the exact model ID against the OpenRouter
// catalog before deploy; alternate IDs are deepseek/deepseek-v3.2-exp and
// deepseek/deepseek-chat (which tracks the latest V3 series).
function deepseekOrFallback(): string {
  const provider =
    typeof process !== "undefined" &&
    process.env?.LLM_PROVIDER?.toLowerCase() === "openrouter"
      ? "openrouter"
      : "groq";
  return provider === "openrouter"
    ? "deepseek/deepseek-chat-v3.5"
    : "openai/gpt-oss-120b";
}

// ───────────────────────────────────────────────────────────────────────
// Public action — generate (or refresh) the user's fight plan
// ───────────────────────────────────────────────────────────────────────

/**
 * Generate the fight-week protocol for the calling user's camp. Pro-gated.
 * Idempotent — overwrites any existing `fight_plan` row for this
 * (userId, campId).
 *
 * `approach` is the athlete's chosen aggressiveness. Server may clamp it
 * to `gradual` when safety warnings flag the plan as critical (see the
 * merge step inside `runCore`).
 */
export const run = action({
  args: {
    campId: v.id("fight_camps"),
    approach: v.union(
      v.literal("gradual"),
      v.literal("standard"),
      v.literal("aggressive"),
    ),
  },
  handler: async (
    ctx,
    { campId, approach },
  ): Promise<{ id: Id<"weight_protocols">; payload: FightPlan }> => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_PROTOCOL");
    // NOTE: spec §5.1 calls for a 1×/UTC-day manual regen cap. The
    // existing rate-limit infrastructure doesn't have a generic
    // (userId, key) per-day counter we can lean on without new schema, so
    // the cap is intentionally deferred — flagged as a follow-up.
    return await runCore(ctx, { userId, campId, approach });
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal action — auto-regen path (called from maybeRegen scheduler)
// ───────────────────────────────────────────────────────────────────────

/**
 * Auto-regen entry. Invoked by `weight_protocols_internal.maybeRegen`
 * when a weight log drifts >0.5 kg from today's planned target. Bypasses
 * the daily cap because regen is system-initiated (the athlete didn't
 * press anything).
 */
export const runInternal = internalAction({
  args: {
    userId: v.id("users"),
    campId: v.id("fight_camps"),
    approach: v.union(
      v.literal("gradual"),
      v.literal("standard"),
      v.literal("aggressive"),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"weight_protocols">; payload: FightPlan }> => {
    return await runCore(ctx, args);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Shared core — used by both public and internal entries
// ───────────────────────────────────────────────────────────────────────

type RunCoreArgs = {
  userId: Id<"users">;
  campId: Id<"fight_camps">;
  approach: Approach;
};

async function runCore(
  ctx: { runQuery: any; runMutation: any },
  { userId, campId, approach }: RunCoreArgs,
): Promise<{ id: Id<"weight_protocols">; payload: FightPlan }> {
  // 1. Single round-trip fetch of every input the prompt + math need.
  const inputs: GatheredInputs = await ctx.runQuery(
    internal.weight_protocols_internal.gatherInputs,
    { userId, campId },
  );

  // 2. Deterministic derivations + safety warnings.
  const derived: DerivedInputs = computeDerived(inputs, approach);
  const safety: SafetyWarning[] = buildSafetyWarnings(derived, inputs.priorCamps);
  // Critical warnings clamp the approach to `gradual` regardless of
  // user choice — protects against e.g. a first-time cutter requesting
  // an aggressive 7% cut.
  const hasCritical = safety.some((w) => w.severity === "critical");
  const effectiveApproach: Approach = hasCritical ? "gradual" : approach;

  // 3. Build the deterministic per-day skeleton (numerics are
  //    server-authoritative — the AI never invents these).
  const skeleton = buildFightPlanSkeleton(derived, effectiveApproach);

  // 4. Build prompt + call the AI for copy.
  const userPrompt = buildUserPrompt(inputs, derived, skeleton, safety);
  const apiResponse = await callGroqRaw({
    model: deepseekOrFallback(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 4096,
    timeoutMs: GROQ_TIMEOUT_MS,
  });
  const rawContent = apiResponse.choices?.[0]?.message?.content ?? "{}";
  const rawJson = parseJSON(rawContent);
  const validated = FightPlanSchema.parse(rawJson);

  // 5. Merge: skeleton numerics overwrite AI numerics; safety re-injected.
  const merged = mergeFightPlan(
    skeleton,
    validated,
    safety,
    effectiveApproach,
    derived,
    campId,
  );

  // 6. Persist (idempotent on userId+campId+kind).
  const id: Id<"weight_protocols"> = await ctx.runMutation(
    internal.weight_protocols_internal.upsert,
    {
      userId,
      campId,
      kind: "fight_plan",
      payload: merged,
      derivedSnapshot: derived,
      approach: effectiveApproach,
      model: deepseekOrFallback(),
    },
  );

  return { id, payload: merged };
}

// ───────────────────────────────────────────────────────────────────────
// Prompt construction
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class combat-sports nutrition coach with elite-level experience in MMA, boxing, BJJ, and muay thai weight management. You write protocols athletes actually follow on fight week.

Output strict JSON conforming to the provided schema. No emojis. No em-dashes. Second-person voice. No hedging.`;

function buildUserPrompt(
  inputs: GatheredInputs,
  derived: DerivedInputs,
  skeleton: FightPlanSkeleton,
  safety: SafetyWarning[],
): string {
  const reboundLine =
    derived.historicalReboundKg != null
      ? `${derived.historicalReboundKg.toFixed(1)}kg avg from ${inputs.priorCamps.length} prior camps`
      : "no prior camps (first-time cutter)";

  return `## KNOWLEDGE

${FIGHT_PLAN_RESEARCH}

## INPUTS

ATHLETE: age ${inputs.profile.age}, sex ${inputs.profile.sex}, height ${inputs.profile.heightCm}cm, current ${derived.currentWeightKg}kg, lean mass est ${derived.leanBodyMassKg.toFixed(1)}kg
CUT: ${derived.cutDepthKg.toFixed(1)}kg (${derived.cutDepthPct.toFixed(1)}% BW) — category ${derived.cutCategory}
TIMELINE: ${derived.daysToWeighIn} days to weigh-in; ${derived.weighInToFightHours}h weigh-in→fight gap
RECENT LOAD: training index ${derived.trainingLoadIndex7d.toFixed(0)} over 7d; avg sleep ${derived.avgSleepHours7d.toFixed(1)}h
READINESS: ${derived.recoveryReadinessToday ?? "n/a"}
HISTORICAL REBOUND: ${reboundLine}

## DETERMINISTIC SKELETON (numerics — copy these values verbatim)

${JSON.stringify(skeleton, null, 2)}

## SAFETY (mandatory — include each in safetyWarnings[])

${JSON.stringify(safety, null, 2)}

## OUTPUT

Return JSON matching FightPlanSchema. For each day:
- carbsCopy, waterCopy, sodiumCopy, fibreCopy: ≤140 chars, single sentence, second-person, no emojis
- keyAction: imperative, ≤80 chars
- cautions: max 3, each ≤80 chars
- trainingRecommendation: 1-2 sentences

Numerics will be replaced server-side from the skeleton — focus on copy quality.`;
}

// ───────────────────────────────────────────────────────────────────────
// Merge: skeleton numerics overwrite AI numerics; safety re-injected
// ───────────────────────────────────────────────────────────────────────

/**
 * Reconcile AI output with the deterministic skeleton. Every numeric
 * field on every day is taken from the skeleton (the AI's numbers are
 * ignored). Copy fields come from the AI when present, fall back to safe
 * defaults otherwise. Safety warnings are force-injected — the AI cannot
 * drop or downgrade them.
 */
function mergeFightPlan(
  skeleton: FightPlanSkeleton,
  ai: FightPlan,
  safety: SafetyWarning[],
  effectiveApproach: Approach,
  derived: DerivedInputs,
  campId: Id<"fight_camps">,
): FightPlan {
  // Index AI days by dayIso for O(1) lookup during merge.
  const aiDaysByIso = new Map<string, FightPlan["days"][number]>();
  for (const d of ai.days) aiDaysByIso.set(d.dayIso, d);

  const mergedDays: FightPlan["days"] = skeleton.days.map((sd) => {
    const ad = aiDaysByIso.get(sd.dayIso) ?? ({} as Partial<FightPlan["days"][number]>);
    return {
      // Numerics from skeleton (authoritative).
      dayIso: sd.dayIso,
      dayLabel: sd.dayLabel,
      daysToWeighIn: sd.daysToWeighIn,
      targetWeightKg: sd.targetWeightKg,
      carbsGrams: sd.carbsGrams,
      waterLitres: sd.waterLitres,
      sodiumMg: sd.sodiumMg,
      fibreNote: sd.fibreNote,
      sleepTargetHours: sd.sleepTargetHours,
      // Copy from AI (fallback to empty / skeleton training rec).
      carbsCopy: String(ad.carbsCopy ?? ""),
      waterCopy: String(ad.waterCopy ?? ""),
      sodiumCopy: String(ad.sodiumCopy ?? ""),
      fibreCopy: String(ad.fibreCopy ?? ""),
      trainingRecommendation: String(
        ad.trainingRecommendation ?? sd.trainingRecommendation,
      ),
      keyAction: String(ad.keyAction ?? ""),
      cautions: Array.isArray(ad.cautions)
        ? ad.cautions.slice(0, 3).map(String)
        : [],
    };
  });

  // Rolling summary fallback — derived purely from skeleton numerics so
  // the page can highlight the protocol's pivot days even if the AI
  // omits the field. Picks the first day in chronological order that
  // satisfies the condition (skeleton iterates dtw=horizon..0, so the
  // first match is the EARLIEST such day).
  const peakWaterDay =
    mergedDays.find(
      (d) =>
        d.waterLitres ===
        Math.max(...mergedDays.map((x) => x.waterLitres)),
    )?.dayLabel ?? "T-6";
  const sodiumCliffDay =
    mergedDays.find((d) => d.sodiumMg < 500)?.dayLabel ?? "T-2";
  const glycogenFloorDay =
    mergedDays.find((d) => d.carbsGrams < 50)?.dayLabel ?? "T-1";

  return {
    generatedAt: Date.now(),
    campId: String(campId),
    approach: effectiveApproach,
    cutDepthKg: derived.cutDepthKg,
    cutDepthPct: derived.cutDepthPct,
    cutCategory: derived.cutCategory,
    // Force-injected — AI cannot drop or downgrade these.
    safetyWarnings: safety,
    // From skeleton (server-authoritative).
    expectedWeightLossKg: skeleton.expectedWeightLossKg,
    days: mergedDays,
    rolling: ai.rolling ?? {
      peakWaterDay,
      sodiumCliffDay,
      glycogenFloorDay,
    },
  };
}
