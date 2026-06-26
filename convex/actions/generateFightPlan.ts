/**
 * Fight-week protocol generator (WP-T6).
 *
 * Flagship AI action for the weight-protocol redesign. Produces a fight-week
 * plan covering STRICTLY the final 7 days up to weigh-in (D-7 .. weigh-in =
 * 8 days, always the full window). Covers carb taper, water load +
 * restriction, sodium curve, fibre reduction, training taper, and sleep
 * targets — grounded in the
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
 * Model: gpt-oss-120b served by Cerebras on OpenRouter (pinned via provider
 * routing for high throughput) with the same model running natively on Groq
 * when `LLM_PROVIDER` is not set to openrouter.
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
import {
  AiFightPlanResponseSchema,
  type AiFightPlanResponse,
  type FightPlan,
} from "../_shared/aiSchemas";
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
 * Weight-cut protocol model: gpt-oss-120b served by Cerebras.
 *
 * Same model on both providers — Groq runs gpt-oss-120b natively (default
 * when LLM_PROVIDER is unset); on OpenRouter we pin the call to Cerebras via
 * `CEREBRAS_ROUTING` for its very high throughput on this model. Was
 * DeepSeek V3.5 on OpenRouter / gpt-oss-120b on Groq.
 */
const PROTOCOL_MODEL = "openai/gpt-oss-120b" as const;

// OpenRouter provider-routing override: prefer Cerebras for gpt-oss-120b,
// falling back automatically if it's unavailable. No-op on the Groq path.
const CEREBRAS_ROUTING = { order: ["cerebras"], allow_fallbacks: true };

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
    // Regeneration is intentionally UNLIMITED — there is no per-day cap.
    // (The earlier spec called for a 1x/UTC-day manual regen cap; it was
    // never implemented and is deliberately not enforced. Pro gating above
    // is the only guard. The doc references to "bypassing the daily cap"
    // in weight_protocols_internal.ts are historical and refer to a cap
    // that does not exist.)
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

  // 1b. Resolve weigh-in timing SERVER-SIDE (not a client arg). Read from
  //     the profile (set during onboarding); fall back to the camp's
  //     free-form `weighInTiming` strategy string. Canonical "day_before"
  //     means weigh-in is the DAY BEFORE the fight (full taper allowed).
  //     ANY other value (including "same_day" / "morning_of") means the
  //     weigh-in is the SAME DAY as the fight → NO carb depletion. Legacy
  //     rows with neither field default to "day_before".
  const weighInTimingRaw =
    inputs.profile.weighInTiming ?? inputs.camp.weighInTime ?? "day_before";
  const weighInSameDay = weighInTimingRaw !== "day_before";

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
  const skeleton = buildFightPlanSkeleton(
    derived,
    effectiveApproach,
    weighInSameDay,
  );

  // 4. Build prompt + call the AI for copy.
  const userPrompt = buildUserPrompt(
    inputs,
    derived,
    skeleton,
    safety,
    weighInSameDay,
  );
  const apiResponse = await callGroqRaw({
    model: PROTOCOL_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 4096,
    timeoutMs: GROQ_TIMEOUT_MS,
    providerRouting: CEREBRAS_ROUTING,
  });
  const rawContent = apiResponse.choices?.[0]?.message?.content ?? "{}";
  const rawJson = parseJSON(rawContent);
  // Parse with the lenient AI-response schema — every field the merge
  // step overwrites is optional here, so the AI is free to emit only the
  // copy fields it was asked for. The strict FightPlanSchema applies to
  // the merged plan that the merge function returns, not the raw AI JSON.
  const validated = AiFightPlanResponseSchema.parse(rawJson);

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
      model: PROTOCOL_MODEL,
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
  weighInSameDay: boolean,
): string {
  const reboundLine =
    derived.historicalReboundKg != null
      ? `${derived.historicalReboundKg.toFixed(1)}kg avg from ${inputs.priorCamps.length} prior camps`
      : "no prior camps (first-time cutter)";

  // Weigh-in timing rule. Same-day weigh-in means the athlete fights with
  // no rehydration window, so glycogen MUST stay loaded — no carb cut.
  const carbRule = weighInSameDay
    ? `WEIGH-IN TIMING: SAME DAY as the fight. Do NOT reduce carbohydrate at any point. Hold carbs at maintenance every day so glycogen stays full for the bout. Make weight with a gentle sodium taper and fibre (low-residue) manipulation only, keeping water NEAR NORMAL — no water-loading, no flush, no sauna. Never instruct the athlete to deplete carbs or cut water.`
    : `WEIGH-IN TIMING: DAY BEFORE the fight. Run the normal full taper: reduce carbohydrate to deplete glycogen as weigh-in approaches, alongside water-loading then a flush, a sodium taper, and fibre manipulation. The post-weigh-in window refuels carbs before the bout.`;

  return `## KNOWLEDGE

${FIGHT_PLAN_RESEARCH}

## INPUTS

ATHLETE: age ${inputs.profile.age}, sex ${inputs.profile.sex}, height ${inputs.profile.heightCm}cm, current ${derived.currentWeightKg}kg, lean mass est ${derived.leanBodyMassKg.toFixed(1)}kg
CUT: ${derived.cutDepthKg.toFixed(1)}kg (${derived.cutDepthPct.toFixed(1)}% BW) — category ${derived.cutCategory}
TIMELINE: ${derived.daysToWeighIn} days to weigh-in; ${derived.weighInToFightHours}h weigh-in to fight gap
RECENT LOAD: training index ${derived.trainingLoadIndex7d.toFixed(0)} over 7d; avg sleep ${derived.avgSleepHours7d.toFixed(1)}h
READINESS: ${derived.recoveryReadinessToday ?? "n/a"}
HISTORICAL REBOUND: ${reboundLine}

## CARB RULE (mandatory)

${carbRule}

## DETERMINISTIC SKELETON (numerics — copy these values verbatim)

${JSON.stringify(skeleton, null, 2)}

## SAFETY (mandatory — include each in safetyWarnings[])

${JSON.stringify(safety, null, 2)}

## OUTPUT

Return JSON matching FightPlanSchema. For each day:
- carbsCopy, waterCopy, sodiumCopy, fibreCopy: ≤140 chars, single sentence, second-person, no emojis
- fibreCopy must MATCH the day's fibre plan: keep fibre NORMAL until about 4 days out, then taper over the final days to empty the gut — reduce ~3 days out, low-residue ~2 days out, minimal the day before, none the morning of weigh-in. (The numeric fibre target is set server-side; do not invent your own.)
- keyAction: imperative, ≤80 chars
- cautions: max 3, each ≤80 chars
- trainingRecommendation: 1-2 sentences

Also return one top-level field:
- fiberStrategy: a single line, ≤200 chars. Say fibre stays normal until about 4 days out, then tapers over the final 2-3 days to empty the gut, minimal the day before and none the morning of weigh-in. No em-dashes.

Honour the CARB RULE above exactly. ALL numerics — carbs, water, sodium, weight AND fibre grams — are set server-side from the skeleton; you author only the copy. No emojis, no em-dashes.`;
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
  ai: AiFightPlanResponse,
  safety: SafetyWarning[],
  effectiveApproach: Approach,
  derived: DerivedInputs,
  campId: Id<"fight_camps">,
): FightPlan {
  // Match AI copy to skeleton days. `ai.days` is optional on the lenient
  // response schema — fall back to an empty list so a model that omits the
  // array still yields a valid (copy-empty) plan.
  //
  // Resolution is iso-first, index-fallback: prefer an exact dayIso match
  // (handles a model that reorders days but echoes the key), otherwise fall
  // back to positional index. Skeleton.days and ai.days are produced in the
  // same dtw-descending order, so index i lines up when the model omits or
  // garbles dayIso — which is the common case, since the prompt never asks
  // for dayIso. Only non-empty iso strings are indexed (skeleton dayIso can
  // itself be "" when weighInIso is unset, so iso alone is unreliable).
  const aiDays = ai.days ?? [];
  const aiDaysByIso = new Map<string, NonNullable<AiFightPlanResponse["days"]>[number]>();
  for (const d of aiDays) {
    if (typeof d.dayIso === "string" && d.dayIso.length > 0) {
      aiDaysByIso.set(d.dayIso, d);
    }
  }

  const mergedDays: FightPlan["days"] = skeleton.days.map((sd, i) => {
    const ad =
      (sd.dayIso ? aiDaysByIso.get(sd.dayIso) : undefined) ??
      aiDays[i] ??
      ({} as Partial<FightPlan["days"][number]>);
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
      // Fibre target in grams — DETERMINISTIC from the skeleton (research-backed
      // late taper). Was previously AI-supplied + optional, which is why every
      // day rendered "None" whenever the model omitted it. Now always present.
      fiberGrams: sd.fiberGrams,
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
    // Optional top-level fibre callout from the AI — carried through when
    // present (≤200 chars enforced by the schema on persist).
    ...(typeof ai.fiberStrategy === "string" && ai.fiberStrategy.length > 0
      ? { fiberStrategy: ai.fiberStrategy }
      : {}),
    rolling: ai.rolling ?? {
      peakWaterDay,
      sodiumCliffDay,
      glycogenFloorDay,
    },
  };
}
