/**
 * Post-weigh-in rehydration protocol generator (WP-T7) — sweat-loss driven.
 *
 * Sibling to `generateFightPlan` (T6). Produces the hour-by-hour rehydrate +
 * refuel window between weigh-in and walkout, driven by a single
 * fighter-entered number: how much sweat (mass) they lost in the cut.
 *
 * CORE RULE (sports-science vetted):
 *   totalLitresTarget = round(sweatLossKg * 1.5, 1)   // 150% replacement
 *   minimum 1.0 L; never exceed sweatLossKg * 2.0 L (safety cap).
 *
 * Two surfaces:
 *
 *   • `run`          – public action called from the UI. Pro-gated via
 *                       `enforceFeatureGate(... AI_WEIGHT_PROTOCOL)`.
 *                       Args: { campId, sweatLossKg } (sweatLossKg REQUIRED).
 *
 *   • `runInternal`  – internalAction for programmatic regen. Same args +
 *                       userId. Symmetry with `generateFightPlan`.
 *
 * Idempotent via the `(userId, campId, kind="rehydration")` index on
 * `weight_protocols` — same `upsert` path as before.
 *
 * Model: gpt-oss-120b served by Cerebras on OpenRouter (pinned via provider
 * routing), with the same model running natively on Groq when `LLM_PROVIDER`
 * is not openrouter. The AI fills hour-by-hour copy + the per-hour litres curve;
 * if it fails or returns invalid JSON we fall back to the deterministic
 * `buildRehydrationFallback` curve from `_shared/rehydrationMath.ts`.
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
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
  computeDerived,
  buildRehydrationHourlyPlan,
  type Approach,
  type DerivedInputs,
  type GatheredInputs,
  type RehydrationPlanHour,
} from "../_shared/weightProtocolMath";

const GROQ_TIMEOUT_MS = 30_000;

// 150% replacement factor (sports-science vetted).
const REPLACEMENT_FACTOR = 1.5 as const;
// Safety cap: never exceed 200% of mass lost.
const SAFETY_CAP_FACTOR = 2.0;
// Minimum target regardless of how small the entered sweat loss is.
const MIN_LITRES = 1.0;
// Default weigh-in→fight gap when the camp doesn't tell us.
const DEFAULT_GAP_HOURS = 24;

// ───────────────────────────────────────────────────────────────────────
// Persisted payload shape (what the frontend now reads)
// ───────────────────────────────────────────────────────────────────────

interface OrsIngredient {
  ingredient: string;
  amount: number;
  unit: string;
  note: string;
}

interface RehydrationHour {
  hourOffset: number;
  liquidsMl: number;
  cumulativeMl: number;
  isMeal: boolean;
  mealLabel: string | null;
  cue: string;
  // ── Hourly rehydrate/refeed additions (2026-06-19). Deterministic numerics;
  //    only `cue` / `mealLabel` are AI-authorable. ──
  sodiumMg: number;
  carbG: number;
  isSleep: boolean;
  phase: string;
}

interface RehydrationPayload {
  sweatLossKg: number;
  replacementFactor: 1.5;
  totalLitresTarget: number;
  gapHours: number;
  /** Sleep window the plan honoured (hour-of-day), echoed for the UI. */
  sleepStartHour: number | null;
  sleepEndHour: number | null;
  /** Set when the deficit can't be safely replaced in the waking hours. */
  deficitTooLarge: boolean;
  orsRecipe: {
    perLitre: OrsIngredient[];
    totalLitresTarget: number;
    diyShoppingList: string[];
    commercialEquivalents: string[];
  };
  hours: RehydrationHour[];
  carbTargetGramsTotal: number;
  doNots: string[];
  derivedSnapshot: {
    sweatLossKg: number;
    replacementFactor: 1.5;
    totalLitresTarget: number;
    gapHours: number;
  };
}

// ───────────────────────────────────────────────────────────────────────
// Hardcoded ORS recipe (Na ~60 mmol/L, glucose ~1:1 SGLT1, K ~20 mmol/L)
// ───────────────────────────────────────────────────────────────────────

const ORS_PER_LITRE: OrsIngredient[] = [
  {
    ingredient: "Glucose / dextrose",
    amount: 40,
    unit: "g",
    note: "≈3 tbsp; energy + sodium co-transport",
  },
  {
    ingredient: "Table salt (NaCl)",
    amount: 2.5,
    unit: "g",
    note: "≈½ tsp",
  },
  {
    ingredient: "Sodium citrate",
    amount: 1.0,
    unit: "g",
    note: "buffer + taste",
  },
  {
    ingredient: "Potassium chloride (Lite salt)",
    amount: 1.5,
    unit: "g",
    note: "≈20 mmol K+",
  },
];

const ORS_DIY_SHOPPING_LIST = [
  "Dextrose powder",
  "Table salt",
  "Sodium citrate",
  "Lite salt (KCl)",
  "Bottled water",
];

const ORS_COMMERCIAL_EQUIVALENTS = ["LMNT", "Liquid I.V.", "DripDrop", "Pedialyte"];

const DEFAULT_DO_NOTS = [
  "Do not chug plain water. It dilutes blood sodium and risks hyponatremia.",
  "No heavy fat or fibre in the first few hours; it slows gastric emptying.",
  "Do not try new supplements or stimulants you have not used before.",
  "Do not overhydrate beyond your target. More is not better.",
  "Stop and seek help if you feel dizzy, confused, or get a worsening headache.",
];

// ───────────────────────────────────────────────────────────────────────
// Model selection — gpt-oss-120b served by Cerebras
// ───────────────────────────────────────────────────────────────────────

// Same model on both providers: Groq runs gpt-oss-120b natively (default),
// and on OpenRouter we pin the call to Cerebras via CEREBRAS_ROUTING for its
// very high throughput on this model. Was DeepSeek V3.5 on OpenRouter.
const PROTOCOL_MODEL = "openai/gpt-oss-120b" as const;

// OpenRouter provider-routing override: prefer Cerebras for gpt-oss-120b,
// falling back automatically if it's unavailable. No-op on the Groq path.
const CEREBRAS_ROUTING = { order: ["cerebras"], allow_fallbacks: true };

// ───────────────────────────────────────────────────────────────────────
// Public action
// ───────────────────────────────────────────────────────────────────────

/**
 * Generate (or refresh) the calling user's rehydration protocol for a camp,
 * driven by a fighter-entered sweat-loss number. Pro-gated. Idempotent.
 */
export const run = action({
  args: {
    campId: v.id("fight_camps"),
    sweatLossKg: v.number(),
    // ── Hourly rehydrate/refeed args (2026-06-19). Optional/back-compat: when
    //    omitted the action falls back to the camp-derived gap and no sleep
    //    window (same behaviour as before). ──
    hoursUntilFight: v.optional(v.number()),
    sleepStartHour: v.optional(v.number()),
    sleepEndHour: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { campId, sweatLossKg, hoursUntilFight, sleepStartHour, sleepEndHour },
  ): Promise<{ id: Id<"weight_protocols">; payload: RehydrationPayload }> => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_PROTOCOL");
    return await runCore(ctx, {
      userId,
      campId,
      sweatLossKg,
      hoursUntilFight,
      sleepStartHour,
      sleepEndHour,
    });
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal action — programmatic regen entry (symmetry with fight plan)
// ───────────────────────────────────────────────────────────────────────

export const runInternal = internalAction({
  args: {
    userId: v.id("users"),
    campId: v.id("fight_camps"),
    sweatLossKg: v.number(),
    hoursUntilFight: v.optional(v.number()),
    sleepStartHour: v.optional(v.number()),
    sleepEndHour: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"weight_protocols">; payload: RehydrationPayload }> => {
    return await runCore(ctx, args);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Shared core
// ───────────────────────────────────────────────────────────────────────

type RunCoreArgs = {
  userId: Id<"users">;
  campId: Id<"fight_camps">;
  sweatLossKg: number;
  hoursUntilFight?: number;
  sleepStartHour?: number;
  sleepEndHour?: number;
};

async function runCore(
  ctx: { runQuery: any; runMutation: any },
  {
    userId,
    campId,
    sweatLossKg,
    hoursUntilFight,
    sleepStartHour,
    sleepEndHour,
  }: RunCoreArgs,
): Promise<{ id: Id<"weight_protocols">; payload: RehydrationPayload }> {
  // 1. Fetch inputs (profile + camp) — same single round-trip as before.
  const inputs: GatheredInputs = await ctx.runQuery(
    internal.weight_protocols_internal.gatherInputs,
    { userId, campId },
  );

  // 2. Resolve gapHours. The user-entered `hoursUntilFight` (prefilled from the
  //    camp's weigh-in→fight gap, but editable) wins; otherwise fall back to
  //    the camp-derived gap, default 24h when unknown / non-positive.
  const derived: DerivedInputs = computeDerived(inputs, "standard" as Approach);
  const gapHours =
    hoursUntilFight != null && Number.isFinite(hoursUntilFight)
      ? deriveGapHours(hoursUntilFight)
      : deriveGapHours(derived.weighInToFightHours);

  // 3. Core rule: ~150% replacement, min 1.0 L, cap at 200% of sweat loss. The
  //    hourly plan ingests 140% of the deficit; this hero figure stays ~1.5×.
  const cleanSweatLossKg = Math.max(0, Number(sweatLossKg) || 0);
  const totalLitresTarget = computeTotalLitresTarget(cleanSweatLossKg);

  // 4. Body mass for carb scaling — prefer the weigh-in target (their mass at
  //    the scale), else current weight.
  const bodyWeightKg = derived.targetWeightKg || derived.currentWeightKg || 0;

  // 5. Deterministic hour-by-hour plan (fluid + electrolytes + carbs + sleep).
  //    This is server-authoritative — the AI only re-authors cue / meal copy.
  const plan = buildRehydrationHourlyPlan({
    deficitLitres: cleanSweatLossKg,
    hoursUntilFight: gapHours,
    sleepStartHour: sleepStartHour ?? null,
    sleepEndHour: sleepEndHour ?? null,
    bodyMassKg: bodyWeightKg,
  });
  const carbTargetGramsTotal = plan.totalCarbScheduled;

  // 6. Convert the deterministic plan into persisted RehydrationHour rows. Then
  //    ask the AI to re-author ONLY the cue / mealLabel copy (numerics stay
  //    authoritative); fall back to the deterministic copy on any failure.
  let hours: RehydrationHour[] = planToHours(plan.hours);
  try {
    hours = await authorCopyViaAI(hours, {
      sweatLossKg: cleanSweatLossKg,
      gapHours,
      totalLitresTarget,
      bodyWeightKg,
      sex: derived.sex,
    });
  } catch (err) {
    console.error(
      "[generateRehydrationProtocol] AI copy failed, using deterministic copy:",
      err,
    );
    // hours already holds the deterministic copy — nothing else to do.
  }

  // 7. Assemble persisted payload.
  const payload: RehydrationPayload = {
    sweatLossKg: cleanSweatLossKg,
    replacementFactor: REPLACEMENT_FACTOR,
    totalLitresTarget,
    gapHours,
    sleepStartHour: plan.hasSleep ? sleepStartHour ?? null : null,
    sleepEndHour: plan.hasSleep ? sleepEndHour ?? null : null,
    deficitTooLarge: plan.deficitTooLarge,
    orsRecipe: {
      perLitre: ORS_PER_LITRE,
      totalLitresTarget,
      diyShoppingList: ORS_DIY_SHOPPING_LIST,
      commercialEquivalents: ORS_COMMERCIAL_EQUIVALENTS,
    },
    hours,
    carbTargetGramsTotal,
    doNots: DEFAULT_DO_NOTS,
    derivedSnapshot: {
      sweatLossKg: cleanSweatLossKg,
      replacementFactor: REPLACEMENT_FACTOR,
      totalLitresTarget,
      gapHours,
    },
  };

  // 7. Persist via the same idempotent upsert helper.
  const id: Id<"weight_protocols"> = await ctx.runMutation(
    internal.weight_protocols_internal.upsert,
    {
      userId,
      campId,
      kind: "rehydration",
      payload,
      derivedSnapshot: payload.derivedSnapshot,
      approach: undefined,
      model: PROTOCOL_MODEL,
    },
  );

  return { id, payload };
}

// ───────────────────────────────────────────────────────────────────────
// Pure derivations
// ───────────────────────────────────────────────────────────────────────

/** Whole-hour weigh-in→fight gap; default 24 when unknown/non-positive. */
function deriveGapHours(weighInToFightHours: number): number {
  const raw = Number(weighInToFightHours);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_GAP_HOURS;
  return Math.max(1, Math.round(raw));
}

/** 150% replacement, min 1.0 L, hard cap at 200% of mass lost. Rounded 0.1. */
function computeTotalLitresTarget(sweatLossKg: number): number {
  const target = round1(sweatLossKg * REPLACEMENT_FACTOR);
  const cap = sweatLossKg * SAFETY_CAP_FACTOR;
  const capped = cap > 0 ? Math.min(target, cap) : target;
  return Math.max(MIN_LITRES, round1(capped));
}

function round1(n: number): number {
  return Number.isFinite(n) ? parseFloat(n.toFixed(1)) : 0;
}

// ───────────────────────────────────────────────────────────────────────
// Deterministic plan → persisted rows
// ───────────────────────────────────────────────────────────────────────

/**
 * Convert the deterministic `buildRehydrationHourlyPlan` output into the
 * persisted `RehydrationHour[]` shape, computing the running cumulative ml.
 * Sleep hours carry the deterministic "Sleep — no intake" cue from the plan.
 */
function planToHours(planHours: RehydrationPlanHour[]): RehydrationHour[] {
  const out: RehydrationHour[] = [];
  let cum = 0;
  for (const ph of planHours) {
    cum += ph.liquidsMl;
    out.push({
      hourOffset: ph.hourOffset,
      liquidsMl: ph.liquidsMl,
      cumulativeMl: cum,
      isMeal: ph.isMeal,
      mealLabel: ph.mealLabel,
      cue: ph.cue,
      sodiumMg: ph.sodiumMg,
      carbG: ph.carbG,
      isSleep: ph.isSleep,
      phase: ph.phase,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// AI copy path — numerics are authoritative; the model only re-authors the
// per-hour cue + meal name (like the fight plan). On any failure the caller
// keeps the deterministic copy already present on the rows.
// ───────────────────────────────────────────────────────────────────────

const COPY_SYSTEM_PROMPT = `You are a sports-science nutrition coach writing SHORT per-hour cue copy for a post-weigh-in rehydration + refeed plan. The numbers (fluid ml, sodium mg, carbs g, sleep blocks) are already FIXED and correct. Do NOT change, recompute, or mention different numbers. Only write motivating, practical imperative copy.
INPUT: an array of hours, each {hourOffset, liquidsMl, sodiumMg, carbG, isSleep, isMeal, phase}.
RULES: 1) For EACH input hour return {hourOffset, cue, mealLabel}. 2) cue: imperative, <=90 chars, no emojis, no markdown, and NEVER use an em dash (the "—" character) anywhere; use commas, colons or full stops instead. 3) For isSleep hours cue MUST be exactly "Sleep, no intake" and mealLabel null. 4) For phase "pre-fight" the cue MUST tell the fighter to take fast-digesting sugar right before walkout (e.g. gummy bears, honey, or a gel), no fluid bolus. 5) MEALS ARE GENERIC TIMING MARKERS, so do NOT invent or prescribe a specific dish/food. The app shows separate meal IDEAS elsewhere. For isMeal hours the mealLabel must be a short neutral timing label ONLY (e.g. "Fuel up", "Top up before bed"), <=60 chars, naming no specific food; for non-meal hours mealLabel null. Cues for meal hours should say something like "fuel up, see meal ideas", never a prescribed dish. 6) Keep the same hourOffset values; do not add or drop hours. 7) Output STRICT JSON: {"hours":[{hourOffset,cue,mealLabel}]}. No prose outside JSON.`;

/**
 * Ask the model to author cue + mealLabel ONLY. Returns the same numeric rows
 * with copy overlaid by hourOffset. Throws on network/parse failure so the
 * caller keeps the deterministic copy.
 */
async function authorCopyViaAI(
  hours: RehydrationHour[],
  meta: {
    sweatLossKg: number;
    gapHours: number;
    totalLitresTarget: number;
    bodyWeightKg: number;
    sex: string;
  },
): Promise<RehydrationHour[]> {
  const userPayload = {
    meta,
    hours: hours.map((h) => ({
      hourOffset: h.hourOffset,
      liquidsMl: h.liquidsMl,
      sodiumMg: h.sodiumMg,
      carbG: h.carbG,
      isSleep: h.isSleep,
      isMeal: h.isMeal,
      phase: h.phase,
    })),
  };

  const apiResponse = await callGroqRaw({
    model: PROTOCOL_MODEL,
    messages: [
      { role: "system", content: COPY_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_tokens: 3500,
    timeoutMs: GROQ_TIMEOUT_MS,
    providerRouting: CEREBRAS_ROUTING,
  });
  const rawContent = apiResponse.choices?.[0]?.message?.content ?? "{}";
  const rawJson = parseJSON(rawContent) as { hours?: unknown };

  const copyByOffset = parseCopyHours(rawJson?.hours);
  // Overlay copy — numerics untouched. Sleep + pre-fight rows keep their
  // deterministic copy regardless of what the model returned.
  return hours.map((h) => {
    if (h.isSleep) return h; // never let the model overwrite sleep copy
    const c = copyByOffset.get(h.hourOffset);
    if (!c) return h;
    return {
      ...h,
      cue: c.cue ?? h.cue,
      mealLabel: h.isMeal ? c.mealLabel ?? h.mealLabel : null,
    };
  });
}

/** Belt-and-braces: strip em/en dashes from model copy. The prompt bans them,
 *  but never trust the model — " — " becomes ", " and a bare dash is dropped. */
function stripEmDash(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Parse the model's copy-only hours into a hourOffset → {cue, mealLabel} map. */
function parseCopyHours(
  raw: unknown,
): Map<number, { cue: string | null; mealLabel: string | null }> {
  const map = new Map<number, { cue: string | null; mealLabel: string | null }>();
  if (!Array.isArray(raw)) return map;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const hourOffset = Number(o.hourOffset);
    if (!Number.isInteger(hourOffset) || hourOffset < 0) continue;
    const cue =
      typeof o.cue === "string" && o.cue.trim().length > 0
        ? stripEmDash(o.cue).slice(0, 90)
        : null;
    const mealLabel =
      typeof o.mealLabel === "string" && o.mealLabel.trim().length > 0
        ? stripEmDash(o.mealLabel).slice(0, 60)
        : null;
    map.set(hourOffset, { cue, mealLabel });
  }
  return map;
}
