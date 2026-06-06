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
  type Approach,
  type DerivedInputs,
  type GatheredInputs,
} from "../_shared/weightProtocolMath";
import { buildRehydrationFallback } from "../_shared/rehydrationMath";

const GROQ_TIMEOUT_MS = 30_000;

// 150% replacement factor (sports-science vetted).
const REPLACEMENT_FACTOR = 1.5 as const;
// Safety cap: never exceed 200% of mass lost.
const SAFETY_CAP_FACTOR = 2.0;
// Minimum target regardless of how small the entered sweat loss is.
const MIN_LITRES = 1.0;
// Gastric-emptying ceiling — no single hour above this.
const MAX_ML_PER_HOUR = 1500;
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
}

interface RehydrationPayload {
  sweatLossKg: number;
  replacementFactor: 1.5;
  totalLitresTarget: number;
  gapHours: number;
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
  "Do not chug plain water — it dilutes blood sodium and risks hyponatremia.",
  "No heavy fat or fibre in the first few hours; it slows gastric emptying.",
  "Do not try new supplements or stimulants you have not used before.",
  "Do not overhydrate beyond your target — more is not better.",
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
  args: { campId: v.id("fight_camps"), sweatLossKg: v.number() },
  handler: async (
    ctx,
    { campId, sweatLossKg },
  ): Promise<{ id: Id<"weight_protocols">; payload: RehydrationPayload }> => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_PROTOCOL");
    return await runCore(ctx, { userId, campId, sweatLossKg });
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
};

async function runCore(
  ctx: { runQuery: any; runMutation: any },
  { userId, campId, sweatLossKg }: RunCoreArgs,
): Promise<{ id: Id<"weight_protocols">; payload: RehydrationPayload }> {
  // 1. Fetch inputs (profile + camp) — same single round-trip as before.
  const inputs: GatheredInputs = await ctx.runQuery(
    internal.weight_protocols_internal.gatherInputs,
    { userId, campId },
  );

  // 2. Derive gapHours from the camp the same way the prior code did:
  //    weigh-in → fight gap, default 24h when unknown / non-positive.
  const derived: DerivedInputs = computeDerived(inputs, "standard" as Approach);
  const gapHours = deriveGapHours(derived.weighInToFightHours);

  // 3. Core rule: 150% replacement, min 1.0 L, cap at 200% of sweat loss.
  const cleanSweatLossKg = Math.max(0, Number(sweatLossKg) || 0);
  const totalLitresTarget = computeTotalLitresTarget(cleanSweatLossKg);

  // 4. Carb target over the window: 10 g/kg if aggressive depletion else
  //    5 g/kg of bodyweight, both capped at 60 g/h across the window.
  const bodyWeightKg = derived.currentWeightKg || derived.targetWeightKg || 0;
  const depletionStrategy = inferDepletionStrategy(derived);
  const carbTargetGramsTotal = computeCarbTarget(
    bodyWeightKg,
    depletionStrategy,
    gapHours,
  );

  // 5. AI for the hour-by-hour curve + cues + meal placement. Fall back to
  //    the deterministic curve on any failure / invalid output.
  let hours: RehydrationHour[];
  try {
    hours = await generateHoursViaAI({
      sweatLossKg: cleanSweatLossKg,
      gapHours,
      totalLitresTarget,
      bodyWeightKg,
      sex: derived.sex,
      depletionStrategy,
    });
  } catch (err) {
    console.error("[generateRehydrationProtocol] AI failed, using fallback:", err);
    hours = buildFallbackHours(totalLitresTarget, gapHours);
  }

  // 6. Assemble persisted payload.
  const payload: RehydrationPayload = {
    sweatLossKg: cleanSweatLossKg,
    replacementFactor: REPLACEMENT_FACTOR,
    totalLitresTarget,
    gapHours,
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

/**
 * Heuristic depletion strategy. We don't have an explicit field, so treat a
 * deep cut (heavy/extreme category) as aggressive depletion → higher carb
 * target. Everything else is moderate.
 */
function inferDepletionStrategy(d: DerivedInputs): "aggressive" | "moderate" {
  return d.cutCategory === "heavy" || d.cutCategory === "extreme"
    ? "aggressive"
    : "moderate";
}

/** Carb target across the window: 10 (aggressive) or 5 g/kg, ≤60 g/h. */
function computeCarbTarget(
  bodyWeightKg: number,
  depletionStrategy: "aggressive" | "moderate",
  gapHours: number,
): number {
  const perKg = depletionStrategy === "aggressive" ? 10 : 5;
  const target = Math.round(perKg * Math.max(0, bodyWeightKg));
  const hourlyCeiling = Math.max(1, gapHours) * 60;
  return Math.min(target, hourlyCeiling);
}

function round1(n: number): number {
  return Number.isFinite(n) ? parseFloat(n.toFixed(1)) : 0;
}

// ───────────────────────────────────────────────────────────────────────
// AI path
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sports-science nutritionist generating an evidence-based post-weigh-in rapid rehydration plan for a combat-sports athlete. Output STRICT JSON only — no prose, no markdown, no emojis.
INPUTS: sweatLossKg, gapHours, athlete {weightKg, sex, depletionStrategy}.
RULES: 1) totalLitresTarget = round(sweatLossKg*1.5,1); min 1.0 L; never exceed sweatLossKg*2.0. 2) Distribute across EVERY hour H+0..H+gapHours: front-load 35–40% in first 2h; never >1500 ml in any hour; steady refeed daytime; overnight (~H+8..H+15 when gapHours>=20) minimal 50–150 ml/h; moderate top-up final 2–3h tapering the last 60–90 min; SUM of hourly liquidsMl within ±100 ml of totalLitresTarget*1000. 3) Round each liquidsMl to nearest 50 ml. 4) Place 2–3 meals, first carb meal within ~1h of weigh-in (isMeal=true those hours); carb target = (depletionStrategy=='aggressive'?10:5) g/kg over the window at <=60 g/h, low fat/fibre early. 5) Each hour: {hourOffset, liquidsMl, cumulativeMl, isMeal, mealLabel, cue}; cue imperative <=90 chars no emojis. 6) doNots array of safety strings (no plain-water chugging/hyponatremia, no heavy fat/fibre early, no new supplements, no overhydration). Return JSON shape {sweatLossKg,gapHours,totalLitresTarget,hours,carbTargetGramsTotal,doNots}. Validate: hours length==gapHours+1; sum within ±100 ml; no hour >1500 ml.`;

function buildUserPrompt(args: {
  sweatLossKg: number;
  gapHours: number;
  totalLitresTarget: number;
  bodyWeightKg: number;
  sex: string;
  depletionStrategy: "aggressive" | "moderate";
}): string {
  return JSON.stringify({
    sweatLossKg: args.sweatLossKg,
    gapHours: args.gapHours,
    totalLitresTarget: args.totalLitresTarget,
    athlete: {
      weightKg: args.bodyWeightKg,
      sex: args.sex,
      depletionStrategy: args.depletionStrategy,
    },
  });
}

/**
 * Call the model and parse + validate the hour curve. Throws on any failure
 * (network, parse, validation) so the caller swaps in the deterministic
 * fallback. Validation enforces: length == gapHours+1, sum within ±100 ml of
 * target, and no hour > 1500 ml.
 */
async function generateHoursViaAI(args: {
  sweatLossKg: number;
  gapHours: number;
  totalLitresTarget: number;
  bodyWeightKg: number;
  sex: string;
  depletionStrategy: "aggressive" | "moderate";
}): Promise<RehydrationHour[]> {
  const apiResponse = await callGroqRaw({
    model: PROTOCOL_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(args) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 3500,
    timeoutMs: GROQ_TIMEOUT_MS,
    providerRouting: CEREBRAS_ROUTING,
  });
  const rawContent = apiResponse.choices?.[0]?.message?.content ?? "{}";
  const rawJson = parseJSON(rawContent) as { hours?: unknown };

  const hours = normalizeAIHours(rawJson?.hours, args.gapHours);
  if (!validateHours(hours, args.gapHours, args.totalLitresTarget)) {
    throw new Error("AI hours failed validation");
  }
  return hours;
}

/**
 * Coerce the AI's `hours` array into our shape. Missing/garbage fields are
 * defaulted but NOT silently repaired — `validateHours` decides acceptance.
 */
function normalizeAIHours(raw: unknown, gapHours: number): RehydrationHour[] {
  if (!Array.isArray(raw)) return [];
  const byOffset = new Map<number, RehydrationHour>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const hourOffset = Number(o.hourOffset);
    if (!Number.isInteger(hourOffset) || hourOffset < 0 || hourOffset > gapHours) {
      continue;
    }
    const liquidsMl = Math.max(0, Math.round(Number(o.liquidsMl) || 0));
    byOffset.set(hourOffset, {
      hourOffset,
      liquidsMl,
      cumulativeMl: 0, // recomputed below
      isMeal: Boolean(o.isMeal),
      mealLabel:
        typeof o.mealLabel === "string" && o.mealLabel.trim().length > 0
          ? o.mealLabel.trim()
          : null,
      cue:
        typeof o.cue === "string" && o.cue.trim().length > 0
          ? o.cue.trim().slice(0, 90)
          : "Sip ORS steadily this hour",
    });
  }
  // Rebuild a contiguous 0..gapHours array and recompute cumulative.
  const out: RehydrationHour[] = [];
  let cum = 0;
  for (let h = 0; h <= gapHours; h++) {
    const found = byOffset.get(h);
    if (!found) return []; // missing hour → reject (length check will fail)
    cum += found.liquidsMl;
    out.push({ ...found, cumulativeMl: cum });
  }
  return out;
}

/** length == gapHours+1, sum within ±100 ml of target, no hour > 1500 ml. */
function validateHours(
  hours: RehydrationHour[],
  gapHours: number,
  totalLitresTarget: number,
): boolean {
  if (hours.length !== gapHours + 1) return false;
  let sum = 0;
  for (const h of hours) {
    if (h.liquidsMl > MAX_ML_PER_HOUR) return false;
    sum += h.liquidsMl;
  }
  const targetMl = totalLitresTarget * 1000;
  return Math.abs(sum - targetMl) <= 100;
}

// ───────────────────────────────────────────────────────────────────────
// Deterministic fallback path
// ───────────────────────────────────────────────────────────────────────

/**
 * Turn the numeric-only fallback curve from `rehydrationMath.ts` into full
 * RehydrationHour objects, synthesising cues + meal placement.
 *
 * Meals: first refeed hour, mid-window, and a pre-fight meal.
 */
function buildFallbackHours(
  totalLitresTarget: number,
  gapHours: number,
): RehydrationHour[] {
  const curve = buildRehydrationFallback(totalLitresTarget, gapHours);

  // Meal hours: first carb meal ~H+1, mid-window, pre-fight (~H-3).
  const firstMeal = Math.min(1, gapHours);
  const midMeal = Math.round(gapHours / 2);
  const preFightMeal = Math.max(0, gapHours - 3);
  const mealMap = new Map<number, string>();
  mealMap.set(firstMeal, "First refeed meal");
  if (!mealMap.has(midMeal)) mealMap.set(midMeal, "Mid-window meal");
  if (!mealMap.has(preFightMeal)) mealMap.set(preFightMeal, "Pre-fight meal");

  const hasOvernight = gapHours >= 20;

  return curve.map((c) => {
    const isMeal = mealMap.has(c.hourOffset);
    const mealLabel = isMeal ? (mealMap.get(c.hourOffset) ?? null) : null;
    return {
      hourOffset: c.hourOffset,
      liquidsMl: c.liquidsMl,
      cumulativeMl: c.cumulativeMl,
      isMeal,
      mealLabel,
      cue: synthesizeCue(c.hourOffset, c.liquidsMl, gapHours, hasOvernight, isMeal),
    };
  });
}

function synthesizeCue(
  hourOffset: number,
  liquidsMl: number,
  gapHours: number,
  hasOvernight: boolean,
  isMeal: boolean,
): string {
  const ml = liquidsMl;
  if (isMeal) {
    return `Eat now and sip ~${ml}ml ORS alongside it`;
  }
  if (hourOffset <= 1) {
    return `Front-load: sip ~${ml}ml ORS steadily, do not chug`;
  }
  if (hasOvernight && hourOffset >= 8 && hourOffset <= 15) {
    return `Overnight: small sips, ~${ml}ml ORS only`;
  }
  if (hourOffset >= gapHours - 2) {
    return `Top-up: ~${ml}ml ORS, taper into the last hour`;
  }
  return `Sip ~${ml}ml ORS steadily`;
}
