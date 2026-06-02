/**
 * Post-weigh-in rehydration protocol generator (WP-T7).
 *
 * Sibling to `generateFightPlan` (T6). Produces the hour-by-hour refuel +
 * rehydrate window between weigh-in and walkout: ORS recipe, per-hour
 * liquids/foods, do-nots, and feel-checks. Numerics come from the
 * deterministic skeleton in `weightProtocolMath.ts`; the AI fills in copy
 * and the (creative) ORS recipe.
 *
 * Two surfaces:
 *
 *   • `run`          – public action called from the UI. Pro-gated via
 *                       `enforceFeatureGate(... AI_WEIGHT_PROTOCOL)`.
 *
 *   • `runInternal`  – internalAction for programmatic regen. Currently
 *                       unused — rehydration has no auto-regen hook in v1,
 *                       but it's provided for symmetry with
 *                       `generateFightPlan` and to keep future schedulers
 *                       cheap to wire up.
 *
 * Idempotent via the `(userId, campId, kind="rehydration")` index on
 * `weight_protocols`.
 *
 * Provider-conditional model: Claude Opus 4.7 on OpenRouter (preferred)
 * with the canonical Groq fallback when `LLM_PROVIDER` is not openrouter.
 *
 * Numerics flow:
 *   1. Math module computes the deterministic per-hour anchors.
 *   2. AI fills copy (hour labels, liquidsComposition, foodCopy, notes,
 *      caution) PLUS the entirely-creative orsRecipe / doNots / feelChecks.
 *   3. Merge step OVERWRITES every numeric field on every hour from the
 *      skeleton (liquidsMl, foodGrams). The ORS recipe is trusted to the
 *      AI because there's no deterministic skeleton equivalent — it's a
 *      content artifact, not a dosing curve.
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
 *       §5.2 (action shape), §6.2–§6.3 (ORS recipe + hour-by-hour curves).
 *
 * Reference: convex/actions/generateFightPlan.ts (sibling — same patterns).
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
  RehydrationProtocolSchema,
  type RehydrationProtocol,
} from "../_shared/aiSchemas";
import {
  computeDerived,
  buildRehydrationSkeleton,
  type Approach,
  type DerivedInputs,
  type GatheredInputs,
  type RehydrationSkeleton,
} from "../_shared/weightProtocolMath";
import { REHYDRATION_RESEARCH } from "../_shared/protocolResearch";

const GROQ_TIMEOUT_MS = 30_000;

/**
 * Per-provider model pick. OpenRouter gets Opus 4.7; Groq fallback uses
 * the canonical heavy-reasoning model. Mirrors generateFightPlan so both
 * protocols sit on the same provider/model surface.
 */
// Swapped from Claude Opus 4.7 to DeepSeek V3.5 — ~55x cheaper, strong on
// structured-output tasks. Verify the exact model ID against the OpenRouter
// catalog before deploy.
function deepseekOrFallback(): string {
  const provider =
    typeof process !== "undefined" &&
    process.env?.LLM_PROVIDER?.toLowerCase() === "openrouter"
      ? "openrouter"
      : "groq";
  return provider === "openrouter"
    ? "deepseek/deepseek-chat"
    : "openai/gpt-oss-120b";
}

// ───────────────────────────────────────────────────────────────────────
// Public action — generate (or refresh) the user's rehydration protocol
// ───────────────────────────────────────────────────────────────────────

/**
 * Generate the post-weigh-in rehydration protocol for the calling user's
 * camp. Pro-gated. Idempotent — overwrites any existing `rehydration` row
 * for this (userId, campId). No approach selector — rehydration strategy
 * is the same regardless of how the cut was performed.
 */
export const run = action({
  args: { campId: v.id("fight_camps") },
  handler: async (
    ctx,
    { campId },
  ): Promise<{ id: Id<"weight_protocols">; payload: RehydrationProtocol }> => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_PROTOCOL");
    return await runCore(ctx, { userId, campId });
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal action — programmatic regen entry (symmetry with fight plan)
// ───────────────────────────────────────────────────────────────────────

/**
 * Internal entry. Currently unused — rehydration has no auto-regen hook in
 * v1 (no drift detector analogous to fight-plan weight drift). Provided
 * for symmetry with `generateFightPlan` so any future scheduler can call
 * this without re-plumbing.
 */
export const runInternal = internalAction({
  args: {
    userId: v.id("users"),
    campId: v.id("fight_camps"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"weight_protocols">; payload: RehydrationProtocol }> => {
    return await runCore(ctx, args);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Shared core — used by both public and internal entries
// ───────────────────────────────────────────────────────────────────────

type RunCoreArgs = {
  userId: Id<"users">;
  campId: Id<"fight_camps">;
};

async function runCore(
  ctx: { runQuery: any; runMutation: any },
  { userId, campId }: RunCoreArgs,
): Promise<{ id: Id<"weight_protocols">; payload: RehydrationProtocol }> {
  // 1. Single round-trip fetch of every input the prompt + math need.
  const inputs: GatheredInputs = await ctx.runQuery(
    internal.weight_protocols_internal.gatherInputs,
    { userId, campId },
  );

  // 2. Deterministic derivations. Rehydration uses 'standard' approach
  //    for derived because the cut approach doesn't affect refeed strategy
  //    — once you're off the scale, the playbook converges regardless of
  //    how you got there.
  const derived: DerivedInputs = computeDerived(inputs, "standard" as Approach);

  // 3. Build the deterministic per-hour skeleton.
  const skeleton: RehydrationSkeleton = buildRehydrationSkeleton(derived);

  // 4. Build prompt + call the AI for copy + ORS recipe.
  const userPrompt = buildUserPrompt(inputs, derived, skeleton);
  const apiResponse = await callGroqRaw({
    model: deepseekOrFallback(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 3500,
    timeoutMs: GROQ_TIMEOUT_MS,
  });
  const rawContent = apiResponse.choices?.[0]?.message?.content ?? "{}";
  const rawJson = parseJSON(rawContent);
  const validated = RehydrationProtocolSchema.parse(rawJson);

  // 5. Merge: skeleton numerics overwrite AI numerics on every hour.
  const merged = mergeRehydrationProtocol(skeleton, validated, campId);

  // 6. Persist (idempotent on userId+campId+kind=rehydration).
  const id: Id<"weight_protocols"> = await ctx.runMutation(
    internal.weight_protocols_internal.upsert,
    {
      userId,
      campId,
      kind: "rehydration",
      payload: merged,
      derivedSnapshot: derived,
      approach: undefined,
      model: deepseekOrFallback(),
    },
  );

  return { id, payload: merged };
}

// ───────────────────────────────────────────────────────────────────────
// Prompt construction
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class combat-sports nutrition coach with elite-level experience in post-weigh-in rehydration and refueling for combat athletes (MMA, boxing, BJJ, muay thai). You write hour-by-hour protocols athletes actually follow in the window between making weight and walking out.

Output strict JSON conforming to the provided schema. No emojis. No em-dashes. Second-person voice. No hedging.`;

function buildUserPrompt(
  inputs: GatheredInputs,
  derived: DerivedInputs,
  skeleton: RehydrationSkeleton,
): string {
  return `## KNOWLEDGE

${REHYDRATION_RESEARCH}

## INPUTS

ATHLETE: age ${inputs.profile.age}, sex ${inputs.profile.sex}, weigh-in target ${derived.targetWeightKg}kg
CUT DEPTH: ${derived.cutDepthKg.toFixed(1)}kg (${derived.cutDepthPct.toFixed(1)}% BW) — category ${derived.cutCategory}
GAP TO FIGHT: ${skeleton.weighInToFightGapHours}h between weigh-in and walkout
TOTAL FLUID TARGET: ${skeleton.totalFluidTargetMl} mL (150% of mass lost)
TOTAL CARB TARGET: ${skeleton.totalCarbTargetGrams} g over the window
TOTAL SODIUM TARGET: ${skeleton.totalSodiumTargetMg} mg

## DETERMINISTIC SKELETON (numerics — copy these values verbatim)

${JSON.stringify(skeleton, null, 2)}

## OUTPUT

Return JSON matching RehydrationProtocolSchema. Required:
- orsRecipe: per-litre ingredient list (combat-adapted WHO ORS — 30-50g glucose, 1.0-1.5g NaCl, 0.5g KCl, ½ lemon citrus). totalLitresTarget = 150% of cut depth in kg. diyShoppingList with home-accessible items. commercialEquivalents (LMNT, Liquid I.V., DripDrop, Pedialyte).
- For each hour: label ("Just off the scale" / "Mid-meal" / "Pre-fight final"), liquidsComposition (e.g. "500ml ORS, 250ml plain water"), foodCopy (e.g. "1 cup white rice, grilled chicken, ½ tsp salt"), notes, caution if applicable.
- doNots: 5-7 stark safety items (no chugging plain water, no heavy fat in first 4h, no alcohol, no fibre too early, no overhydrating >200%).
- feelChecks: at least urine_colour (pale straw target), weigh_back_kg (80-100% of cut depth), no_cramps.

Numerics will be replaced server-side from the skeleton. Focus on copy quality. Each *Copy / label / notes ≤140 chars.`;
}

// ───────────────────────────────────────────────────────────────────────
// Merge: skeleton numerics overwrite AI numerics
// ───────────────────────────────────────────────────────────────────────

/**
 * Reconcile AI output with the deterministic skeleton. Every per-hour
 * numeric field (liquidsMl, foodGrams) is taken from the skeleton — the
 * AI's numbers are ignored. Copy fields come from the AI when present,
 * fall back to safe defaults otherwise.
 *
 * The ORS recipe and the doNots / feelChecks arrays are trusted to the
 * AI as-is. There is no deterministic skeleton for those — the recipe is
 * a creative content artifact, and the safety/feel-check lists are
 * narrative guidance that doesn't have a numeric anchor to overwrite.
 */
function mergeRehydrationProtocol(
  skeleton: RehydrationSkeleton,
  ai: RehydrationProtocol,
  campId: Id<"fight_camps">,
): RehydrationProtocol {
  // Index AI hours by hourOffset for O(1) lookup during merge.
  const aiHoursByOffset = new Map<number, RehydrationProtocol["hours"][number]>();
  for (const h of ai.hours) aiHoursByOffset.set(h.hourOffset, h);

  const mergedHours: RehydrationProtocol["hours"] = skeleton.hours.map((sh) => {
    const ah =
      aiHoursByOffset.get(sh.hourOffset) ??
      ({} as Partial<RehydrationProtocol["hours"][number]>);
    return {
      // Numerics from skeleton (authoritative).
      hourOffset: sh.hourOffset,
      liquidsMl: sh.liquidsMl,
      foodGrams: sh.foodGrams,
      // Copy from AI (fallback to derived defaults).
      label: String(
        ah.label ?? labelForHour(sh.hourOffset, skeleton.weighInToFightGapHours),
      ),
      liquidsComposition: String(ah.liquidsComposition ?? ""),
      foodCopy: String(ah.foodCopy ?? ""),
      notes: String(ah.notes ?? ""),
      caution: ah.caution == null ? null : String(ah.caution),
    };
  });

  return {
    generatedAt: Date.now(),
    campId: String(campId),
    weighInWeightKg: skeleton.weighInWeightKg,
    fightWeightTargetKg: skeleton.fightWeightTargetKg,
    weighInToFightGapHours: skeleton.weighInToFightGapHours,
    // AI-only — no skeleton equivalent. The recipe is a creative content
    // artifact; doNots / feelChecks are narrative safety lists.
    orsRecipe: ai.orsRecipe,
    hours: mergedHours,
    doNots: ai.doNots,
    feelChecks: ai.feelChecks,
  };
}

/**
 * Deterministic fallback labels for the per-hour timeline, used when the
 * AI omits the `label` field for a given hour. Mirrors the spec's narrative
 * phases (rapid rehydration → main refeed → maintenance → walkout).
 */
function labelForHour(h: number, gap: number): string {
  if (h === 0) return "Just off the scale";
  if (h === gap) return "Walkout";
  if (h === gap - 1) return "Pre-fight final hour";
  if (h <= 4) return `H+${h} — front-load phase`;
  if (h <= 12) return `H+${h} — main refeed`;
  return `H+${h} — maintenance`;
}
