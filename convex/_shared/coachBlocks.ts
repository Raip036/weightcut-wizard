/**
 * Deterministic block computation for the Fight Camp Coach (Phase 1).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §3.1 (backend flow), §4 (CoachMessage schema), §5 Phase 1, §7.
 *
 * These are PURE functions: no Convex ctx, no LLM, no I/O. They take the
 * shape returned by `actions_internal.fetchFightWeekData` and return typed
 * `CoachBlock`s with SERVER-AUTHORITATIVE numbers. The LLM never emits the
 * numbers in weight_target / chart / metric_row — the action merges these
 * in so the model can only ever hallucinate prose, never figures.
 *
 * Why a separate file: keeps `fightCampCoach.ts` under 500 lines and makes
 * the deterministic math independently testable (TDD London — these are the
 * mockable seam between the action and the data layer).
 */

import type { CoachBlock, DomainId } from "./aiSchemas";
import type { DomainBundle } from "./coachDomains/types";
import {
  buildTrainingLoadCards,
  summarizeTrainingLoad,
} from "./coachDomains/trainingLoad";
import {
  buildNutritionCards,
  summarizeNutrition,
} from "./coachDomains/nutrition";
import {
  buildFightScoreCards,
  summarizeFightScore,
} from "./coachDomains/fightScore";
import {
  buildRecoveryCards,
  summarizeRecovery,
  buildSleepCards,
  summarizeSleep,
} from "./coachDomains/recovery";

// ── Input shape (subset of fetchFightWeekData) ──────────────────────────
// Spelled out structurally rather than imported from the generated API to
// avoid a TS circular-reference chain (same reason _helpers.ts inlines
// SnapshotProfile). Keep in sync with actions_internal.fetchFightWeekData.

export interface CoachFightWeekData {
  profile: {
    current_weight_kg?: number | null;
    goal_weight_kg?: number | null;
    fight_week_target_kg?: number | null;
    sex?: string | null;
    age?: number | null;
    height_cm?: number | null;
    athlete_type?: string | null;
  } | null;
  upcomingCamp: {
    id: string;
    name: string;
    fight_date: string;
    starting_weight_kg?: number | null;
    weigh_in_timing?: string | null;
  } | null;
  fightWeekLogs: Array<{
    log_date: string;
    weight_kg?: number | null;
    fluid_intake_ml?: number | null;
    carbs_g?: number | null;
    sweat_session_min?: number | null;
    notes?: string | null;
  }>;
  weight14d: Array<{ date: string; weight_kg: number }>;
  hydration7d: Array<{ date: string; amount_ml: number; sodium_mg?: number | null }>;
}

/** Bundle of the deterministic facts the action injects into the prompt and
 *  merges back into the final blocks[]. `facts` is a compact human-readable
 *  string for the system prompt ("DETERMINISTIC FACTS"). */
export interface CoachDeterministicBundle {
  blocks: CoachBlock[];
  facts: string;
  /** Derived scalars the intent gate / prompt may reference. */
  derived: {
    currentKg: number | null;
    targetKg: number | null;
    deltaKg: number | null;
    daysOut: number | null;
    onTrack: boolean | null;
  };
}

// ── Small pure helpers ──────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const MS_PER_DAY = 86_400_000;
const todayMs = (): number => Date.parse(new Date().toISOString().slice(0, 10));

/** Days from today (UTC date floor) to an ISO date string. Negative if past. */
function daysUntil(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - todayMs()) / MS_PER_DAY);
}

/** Latest logged weight: fight-week logs take priority (they're the live
 *  cut), then the 14-day weight log series, then the profile. */
function latestWeight(data: CoachFightWeekData): number | null {
  const fwWithWeight = data.fightWeekLogs.find(
    (l) => typeof l.weight_kg === "number" && Number.isFinite(l.weight_kg),
  );
  if (fwWithWeight && typeof fwWithWeight.weight_kg === "number") {
    return fwWithWeight.weight_kg;
  }
  // weight14d is ordered desc by the query, so [0] is the most recent.
  const w = data.weight14d.find((x) => Number.isFinite(x.weight_kg));
  if (w) return w.weight_kg;
  const pw = data.profile?.current_weight_kg;
  return typeof pw === "number" && Number.isFinite(pw) ? pw : null;
}

/** The weight the cut is aiming at: fight-week target wins, then the camp
 *  starting weight is NOT a target so we fall back to goal weight. */
function targetWeight(data: CoachFightWeekData): number | null {
  const fwt = data.profile?.fight_week_target_kg;
  if (typeof fwt === "number" && Number.isFinite(fwt)) return fwt;
  const goal = data.profile?.goal_weight_kg;
  return typeof goal === "number" && Number.isFinite(goal) ? goal : null;
}

// ── Deterministic blocks ────────────────────────────────────────────────

/**
 * `weight_target` block. `on_track` compares the latest actual weight to the
 * implied SAFE glide path between today and weigh-in: if you still need to
 * lose weight, you're on track when actual ≤ a linear glide allowance
 * (here: within the remaining delta, i.e. not already behind the line). A
 * tiny tolerance avoids false "behind" flags from normal daily noise.
 */
export function buildWeightTargetBlock(
  data: CoachFightWeekData,
): { block: CoachBlock | null; current: number | null; target: number | null; delta: number | null; days: number | null; onTrack: boolean | null } {
  const current = latestWeight(data);
  const target = targetWeight(data);
  const days =
    data.upcomingCamp != null ? daysUntil(data.upcomingCamp.fight_date) : null;

  if (current == null || target == null) {
    return { block: null, current, target, delta: null, days, onTrack: null };
  }

  const delta = round1(current - target);
  // Glide path: with N days left you may still be carrying delta; you're
  // "on track" if you're at or under the straight-line allowance for the
  // days elapsed. With no date or already at weight, on_track = delta<=tol.
  const tol = Math.max(0.2, current * 0.004); // ~0.3kg for an 80kg athlete
  let onTrack: boolean;
  if (delta <= tol) {
    onTrack = true;
  } else if (days == null || days <= 0) {
    onTrack = false; // weigh-in here / past and still over target
  } else {
    // Behind only if the remaining drop demands an unsafe pace
    // (>1.5% bodyweight per week is the safetyBounds ceiling). Otherwise
    // there is still runway, so treat as on track.
    const perWeek = (delta / Math.max(1, days)) * 7;
    onTrack = perWeek <= current * 0.015;
  }

  const note =
    delta <= tol
      ? "At or under target."
      : days != null && days > 0
        ? `${delta} kg to go, ${days} day${days === 1 ? "" : "s"} out.`
        : `${delta} kg over target.`;

  const block: CoachBlock = {
    type: "weight_target",
    current_kg: round1(current),
    target_kg: round1(target),
    delta_kg: delta,
    days_out: days ?? 0,
    on_track: onTrack,
    note: note.slice(0, 80),
  };
  return { block, current, target, delta, days, onTrack };
}

/**
 * `chart` block, kind "weight_trend". Series is the real last ~14 weight
 * logs (oldest→newest for left-to-right plotting). targetLine = target.
 * Returns null when there aren't enough points to draw a meaningful trend.
 */
export function buildWeightChartBlock(
  data: CoachFightWeekData,
  target: number | null,
): CoachBlock | null {
  // weight14d is desc; reverse to chronological for the chart.
  const points = [...data.weight14d]
    .filter((w) => Number.isFinite(w.weight_kg))
    .reverse()
    .slice(-14)
    .map((w) => ({ x: w.date.slice(5), y: round1(w.weight_kg) })); // x = MM-DD
  if (points.length < 2) return null;

  const block: CoachBlock = {
    type: "chart",
    title: "Weight trend",
    kind: "weight_trend",
    series: points,
    ...(target != null ? { targetLine: round1(target) } : {}),
  };
  return block;
}

/**
 * `metric_row` block — objective stats only (no advice). Avg fluid over the
 * logged window, days to fight, and kg/week pace implied by the remaining
 * cut. Each metric carries an optional tone for the renderer.
 */
export function buildMetricRowBlock(
  data: CoachFightWeekData,
  delta: number | null,
  days: number | null,
): CoachBlock | null {
  const metrics: { label: string; value: string; tone?: "good" | "warn" | "bad" }[] = [];

  // Avg daily fluid from the richer of the two sources.
  const fluids = [
    ...data.fightWeekLogs
      .map((l) => l.fluid_intake_ml)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
  ];
  const hydration = data.hydration7d
    .map((h) => h.amount_ml)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const fluidSource = fluids.length >= hydration.length ? fluids : hydration;
  if (fluidSource.length > 0) {
    const avg = Math.round(
      fluidSource.reduce((a, b) => a + b, 0) / fluidSource.length,
    );
    metrics.push({
      label: "Avg fluid",
      value: `${(avg / 1000).toFixed(1)} L`,
    });
  }

  if (days != null) {
    metrics.push({
      label: "Days to fight",
      value: `${Math.max(0, days)}`,
      tone: days <= 2 ? "warn" : undefined,
    });
  }

  if (delta != null && delta > 0 && days != null && days > 0) {
    const perWeek = round1((delta / days) * 7);
    const cur = latestWeight(data) ?? 0;
    const tone: "good" | "warn" | "bad" | undefined =
      cur > 0
        ? perWeek > cur * 0.015
          ? "bad"
          : perWeek > cur * 0.01
            ? "warn"
            : "good"
        : undefined;
    metrics.push({
      label: "Pace",
      value: `${perWeek} kg/wk`,
      ...(tone ? { tone } : {}),
    });
  }

  if (metrics.length === 0) return null;
  return { type: "metric_row", metrics: metrics.slice(0, 4) };
}

// Safety is now the FULL deterministic guardrail in `coachSafety.ts`
// (evaluateSafety / summarizeSafety), hydrated by `coachSafety_internal`. The
// Phase-1 rate-of-loss-only stub that lived here has been retired — the action
// calls evaluateSafety(safetyInput) instead.

// ── Orchestrator ────────────────────────────────────────────────────────

/**
 * Compute every deterministic block + the prompt facts string in one pass.
 * The action injects `facts` into the system prompt and merges `blocks`
 * (server numbers win) with the LLM's narrative blocks.
 */
export function computeDeterministicBundle(
  data: CoachFightWeekData,
): CoachDeterministicBundle {
  const wt = buildWeightTargetBlock(data);
  const chart = buildWeightChartBlock(data, wt.target);
  const metrics = buildMetricRowBlock(data, wt.delta, wt.days);

  const blocks: CoachBlock[] = [];
  if (wt.block) blocks.push(wt.block);
  if (chart) blocks.push(chart);
  if (metrics) blocks.push(metrics);

  const factLines: string[] = [];
  if (wt.current != null) factLines.push(`Current weight: ${round1(wt.current)} kg`);
  if (wt.target != null) factLines.push(`Target weight: ${round1(wt.target)} kg`);
  if (wt.delta != null) factLines.push(`Delta to target: ${wt.delta} kg`);
  if (wt.days != null) factLines.push(`Days to fight: ${wt.days}`);
  if (wt.onTrack != null) factLines.push(`On track: ${wt.onTrack ? "yes" : "no"}`);
  if (data.upcomingCamp) {
    factLines.push(
      `Upcoming fight: ${data.upcomingCamp.fight_date} (${data.upcomingCamp.name})`,
    );
    if (data.upcomingCamp.weigh_in_timing) {
      factLines.push(`Weigh-in timing: ${data.upcomingCamp.weigh_in_timing}`);
    }
  } else {
    factLines.push("No upcoming fight scheduled.");
  }

  return {
    blocks,
    facts: factLines.join("\n"),
    derived: {
      currentKg: wt.current,
      targetKg: wt.target,
      deltaKg: wt.delta,
      daysOut: wt.days,
      onTrack: wt.onTrack,
    },
  };
}

// ── Intent gate (cheap keyword heuristic — v1) ──────────────────────────

/**
 * Classify the latest user turn. "planny" turns (plan / checklist /
 * timeline / "what do I do") get the heavy structured model; everything
 * else (feelings, quick yes/no, casual) gets the fast prose-only model.
 *
 * v1 heuristic (documented, intentionally simple): keyword match on the
 * latest user message. False negatives just mean a planny question gets a
 * prose answer with the server blocks still attached — acceptable. False
 * positives cost a slightly heavier call. Upgrade to a tiny classifier
 * model later if the keyword list proves too blunt.
 */
const PLANNY_PATTERNS: RegExp[] = [
  /\bplan\b/i,
  /\bchecklist\b/i,
  /\btimeline\b/i,
  /\bschedule\b/i,
  /\bsteps?\b/i,
  /\bprotocol\b/i,
  /\bwhat (should|do) i\b/i,
  /\bwhat('?s| is) (my|the) (next|plan)\b/i,
  /\bhow (do|should) i\b/i,
  /\bbreak ?down\b/i,
  /\bday by day\b/i,
  /\bwalk me through\b/i,
  /\bcut plan\b/i,
  /\bwater ?load/i,
  /\brefuel\b/i,
  /\brehydrat/i,
];

export type CoachIntent = "planny" | "casual";

export function classifyIntent(latestUserMessage: string | undefined): CoachIntent {
  if (!latestUserMessage) return "casual";
  return PLANNY_PATTERNS.some((re) => re.test(latestUserMessage))
    ? "planny"
    : "casual";
}

// ── Phase-3 intent helpers (cheap keyword heuristics) ────────────────────

/** The user is explicitly asking about a past/previous camp, rebound, or
 *  comparison — the trigger for surfacing the cross-camp-history CARD (the
 *  summary is always injected into the prompt regardless). */
const CAMP_HISTORY_PATTERNS =
  /last camp|past camp|previous|rebound|history|compared/i;

export function asksAboutCampHistory(
  latestUserMessage: string | undefined,
): boolean {
  return !!latestUserMessage && CAMP_HISTORY_PATTERNS.test(latestUserMessage);
}

/** The user is asking about fight week / weigh-in (forces loading the daily
 *  cornerman even when the loader's `hasPlan` gate would otherwise apply via
 *  fight-week context). */
const FIGHT_WEEK_PATTERNS =
  /fight ?week|weigh ?in|water ?load|cut day|rehydrat|refuel/i;

export function asksAboutFightWeek(
  latestUserMessage: string | undefined,
): boolean {
  return !!latestUserMessage && FIGHT_WEEK_PATTERNS.test(latestUserMessage);
}

// ── Block merge ─────────────────────────────────────────────────────────

/**
 * Merge server deterministic blocks with the LLM's narrative blocks.
 * Server numeric blocks (weight_target / chart / metric_row) take priority
 * and are kept verbatim; LLM blocks of those types are dropped (the model
 * is told not to emit them, this is belt-and-braces). Final list is capped
 * at 4 (schema max), server blocks first.
 */
const SERVER_OWNED_TYPES = new Set<CoachBlock["type"]>([
  "weight_target",
  "chart",
  "metric_row",
]);

export function mergeBlocks(
  serverBlocks: CoachBlock[],
  llmBlocks: CoachBlock[] | undefined,
  safetyCallout: CoachBlock | null,
): CoachBlock[] {
  const merged: CoachBlock[] = [];
  // 1. Safety callout always first (never dropped by the cap below until
  //    after it is included — see slice handling in the action).
  if (safetyCallout) merged.push(safetyCallout);
  // 2. Server numeric blocks.
  for (const b of serverBlocks) merged.push(b);
  // 3. LLM blocks that the server does not own.
  for (const b of llmBlocks ?? []) {
    if (!SERVER_OWNED_TYPES.has(b.type)) merged.push(b);
  }
  return merged.slice(0, 4);
}

// ── Domain-aware cards (2026-06-04) ─────────────────────────────────────
// Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
//
// The hybrid router (keyword scorer + LLM arbiter) picks up to 3 relevant
// data domains for the turn. `weight` / `fight_week` are the "spine" domains
// — their numbers come from the existing deterministic compute above, so they
// are NOT loaded by getDomainData and have NO entry in the builder map. Every
// other selected domain is hydrated as a DomainBundle slice and mapped onto
// generic CoachBlock primitives by its builder here.

/** The two spine domains served by the deterministic weight/fight-week compute
 *  rather than the DomainBundle loader. */
export const SPINE_DOMAINS: ReadonlySet<DomainId> = new Set<DomainId>([
  "weight",
  "fight_week",
]);

/** Result of building cards for one selected domain. */
interface DomainOutput {
  cards: CoachBlock[];
  summary: string | null;
}

/**
 * Map a single NON-SPINE domain id + the hydrated bundle to its cards and a
 * one-line prompt summary. Spine domains (weight/fight_week) return no cards
 * here (they come from `computeDeterministicBundle`). A domain with no slice
 * loaded (missing data) yields empty cards / null summary — never throws.
 */
function buildOneDomain(domain: DomainId, bundle: DomainBundle): DomainOutput {
  switch (domain) {
    case "training_load":
      return bundle.trainingLoad
        ? {
            cards: buildTrainingLoadCards(bundle.trainingLoad),
            summary: summarizeTrainingLoad(bundle.trainingLoad),
          }
        : { cards: [], summary: null };
    case "nutrition":
      return bundle.nutrition
        ? {
            cards: buildNutritionCards(bundle.nutrition),
            summary: summarizeNutrition(bundle.nutrition),
          }
        : { cards: [], summary: null };
    case "fight_score":
      return bundle.fightScore
        ? {
            cards: buildFightScoreCards(bundle.fightScore),
            summary: summarizeFightScore(bundle.fightScore),
          }
        : { cards: [], summary: null };
    case "recovery":
      return bundle.recovery
        ? {
            cards: buildRecoveryCards(bundle.recovery),
            summary: summarizeRecovery(bundle.recovery),
          }
        : { cards: [], summary: null };
    case "sleep":
      return bundle.sleep
        ? {
            cards: buildSleepCards(bundle.sleep),
            summary: summarizeSleep(bundle.sleep),
          }
        : { cards: [], summary: null };
    // Spine domains: deterministic compute owns these, no DomainBundle slice.
    case "weight":
    case "fight_week":
    default:
      return { cards: [], summary: null };
  }
}

/**
 * Build domain cards + prompt summaries for the selected NON-SPINE domains,
 * in `selected` order (directly-asked first, per selectDomains). Spine domains
 * are skipped — their cards come from the deterministic bundle, their facts
 * from `bundle.facts`. Returns ordered, de-spined output.
 */
export function buildDomainOutputs(
  selected: DomainId[],
  bundle: DomainBundle,
): { cards: CoachBlock[]; summaries: string[] } {
  const cards: CoachBlock[] = [];
  const summaries: string[] = [];
  for (const domain of selected) {
    if (SPINE_DOMAINS.has(domain)) continue;
    const out = buildOneDomain(domain, bundle);
    cards.push(...out.cards);
    if (out.summary) summaries.push(out.summary);
  }
  return { cards, summaries };
}

/**
 * Final block merge + cap for the Phase-3/4 cornerman coach. Priority order
 * (spec §5 Phase 3 + Phase 4 + §7):
 *   1. safety callout (ALWAYS first, never dropped, free)
 *   2. daily fight-week cornerman cards (just under safety)
 *   2b. off-season Camp Architect cards (Phase 4) — only ever populated when
 *       there is NO upcoming camp, so in-camp this slot is empty and the
 *       existing in-camp order is unchanged. Sits just under the cornerman
 *       (which is itself empty off-season unless the user asked about fight
 *       week), making architect cards the primary off-season cards.
 *   3. directly-asked domain cards (already in `selected` order)
 *   4. weight/fight-week spine cards (deterministic numeric blocks)
 *   5. camp-history card (only when the user asked about past/history/rebound)
 *   6. LLM narrative blocks (checklist / callout / timeline / action)
 * Server-owned numeric types are dropped from the LLM set; duplicate blocks
 * (by deep value) are removed so a cornerman callout and an identical LLM
 * callout don't both render. Caps at `max` (6). The safety callout is
 * force-kept at the front by reference even if the cap would trim it, and any
 * value-equal copy elsewhere is removed.
 */
export function mergeDomainBlocks(opts: {
  safetyCallout: CoachBlock | null;
  cornermanCards?: CoachBlock[];
  architectCards?: CoachBlock[];
  domainCards: CoachBlock[];
  spineBlocks: CoachBlock[];
  campHistoryCards?: CoachBlock[];
  llmBlocks: CoachBlock[] | undefined;
  max?: number;
}): CoachBlock[] {
  const max = opts.max ?? 6;
  const ordered: CoachBlock[] = [];

  // 2 → 2b → 3 → 4 → 5 → 6 (safety handled below so it can never be trimmed).
  for (const b of opts.cornermanCards ?? []) ordered.push(b);
  for (const b of opts.architectCards ?? []) ordered.push(b);
  for (const b of opts.domainCards) ordered.push(b);
  for (const b of opts.spineBlocks) ordered.push(b);
  for (const b of opts.campHistoryCards ?? []) ordered.push(b);
  for (const b of opts.llmBlocks ?? []) {
    if (!SERVER_OWNED_TYPES.has(b.type)) ordered.push(b);
  }

  const deduped = dedupeBlocks(ordered);

  if (!opts.safetyCallout) return deduped.slice(0, max);

  // Drop any value-equal copy of the safety callout from the body, then pin
  // the real safety callout at the front so the cap can never trim it.
  const safetyKey = blockKey(opts.safetyCallout);
  const body = deduped.filter((b) => blockKey(b) !== safetyKey);
  return [opts.safetyCallout, ...body].slice(0, max);
}

/** Stable structural key for a block (order-insensitive within an object). */
function blockKey(block: CoachBlock): string {
  return JSON.stringify(block, Object.keys(block).sort());
}

/** Remove value-equal duplicate blocks, keeping first occurrence (priority). */
function dedupeBlocks(blocks: CoachBlock[]): CoachBlock[] {
  const seen = new Set<string>();
  const out: CoachBlock[] = [];
  for (const b of blocks) {
    const key = blockKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}
