import type { ScoringConfig } from "./types";

export type CeilingSignals = {
  weightCutDangerousDays: number;  // consecutive days >2.5%/wk (ceiling-specific threshold)
  sleepDebt7d: number;             // hours
  acwr: number;
  /**
   * Cold-start guards for the `training_spike` cap, mirroring the recovery
   * engine. Without these, a single logged session against an empty 28-day
   * baseline produces an artificially huge ACWR that wrongly caps the score.
   *
   * `training_spike` only fires when ALL hold:
   *   1. trainingDaysIn28d >= 14       (chronic baseline is meaningful)
   *   2. acuteLoad >= TRAINING_SPIKE_MIN_ACUTE_LOAD  (the spike is plausibly real)
   *   3. latestHooper isn't 16+        (body isn't objectively saying it feels fine)
   */
  trainingDaysIn28d: number;
  acuteLoad: number;
  latestHooper: number | null;
};

// Mirror the recovery-side `MIN_ACUTE_LOAD_FOR_SPIKE_WARNING` so both pages
// agree on what counts as "enough training this week to consider it a spike".
const TRAINING_SPIKE_MIN_ACUTE_LOAD = 500;
const TRAINING_SPIKE_MIN_TRAINING_DAYS = 14;
const WELLNESS_OK_HOOPER_THRESHOLD = 16;

export function applyCeilings(
  score: number,
  signals: CeilingSignals,
  cfg: ScoringConfig,
): { score: number; applied: { ruleId: string; cap: number } | null } {
  const caps: Array<{ ruleId: string; cap: number }> = [];
  for (const rule of cfg.ceilings) {
    let trigger = false;
    if (rule.id === "weight_cut_dangerous" && signals.weightCutDangerousDays >= 5) trigger = true;
    if (rule.id === "sleep_debt" && signals.sleepDebt7d > 10) trigger = true;
    if (rule.id === "training_spike" && signals.acwr > 2.0) {
      const haveBaseline = signals.trainingDaysIn28d >= TRAINING_SPIKE_MIN_TRAINING_DAYS;
      const haveAbsoluteLoad = signals.acuteLoad >= TRAINING_SPIKE_MIN_ACUTE_LOAD;
      const wellnessOk = signals.latestHooper != null && signals.latestHooper >= WELLNESS_OK_HOOPER_THRESHOLD;
      if (haveBaseline && haveAbsoluteLoad && !wellnessOk) trigger = true;
    }
    if (trigger) caps.push({ ruleId: rule.id, cap: rule.cap });
  }
  if (caps.length === 0) return { score, applied: null };
  const tightest = caps.reduce((min, c) => (c.cap < min.cap ? c : min), caps[0]);
  return { score: Math.min(score, tightest.cap), applied: tightest };
}

/** Maps each latchable ceiling rule to the pillar whose freshness governs it. */
const CEILING_PILLAR: Record<string, "sleep_debt" | "weight_cut_dangerous" | "training_spike"> = {
  sleep_debt: "sleep_debt",
  weight_cut_dangerous: "weight_cut_dangerous",
  training_spike: "training_spike",
};

export type LatchInputs = {
  asOfDate: string;
  priorCeilings: Array<{ date: string; ruleId: string; cap: number }>;
  /**
   * Days since the rule's governing pillar was last logged (null = never).
   * A rule whose pillar is fresh (staleDays within grace) is allowed to
   * release; a stale pillar keeps the cap latched.
   */
  staleDaysByRule: Record<"sleep_debt" | "weight_cut_dangerous" | "training_spike", number | null>;
};

/**
 * Latch a recently-fired ceiling that the live evaluation no longer triggers,
 * UNLESS the governing pillar has fresh data showing genuine recovery. This
 * closes the "stop logging to escape the cap" exploit: silence keeps the cap;
 * a fresh, recovered log lifts it.
 */
export function latchCeilings(
  live: { score: number; applied: { ruleId: string; cap: number } | null },
  inputs: LatchInputs,
  cfg: ScoringConfig,
): { score: number; applied: { ruleId: string; cap: number } | null } {
  if (live.applied) return live; // a live cap already governs; nothing to latch.
  const graceByRule = {
    sleep_debt: cfg.staleness.byPillar.sleep.graceDays,
    weight_cut_dangerous: cfg.staleness.byPillar.weightCut.graceDays,
    training_spike: cfg.staleness.byPillar.trainingLoad.graceDays,
  } as const;

  let latched: { ruleId: string; cap: number } | null = null;
  for (const pc of inputs.priorCeilings) {
    const rule = CEILING_PILLAR[pc.ruleId];
    if (!rule) continue;
    const ageDays = Math.max(0, Math.round(
      (new Date(inputs.asOfDate + "T00:00:00Z").getTime() - new Date(pc.date + "T00:00:00Z").getTime()) / 86400000,
    ));
    if (ageDays > cfg.confidence.ceilingCooldownDays) continue; // too old to latch
    const staleDays = inputs.staleDaysByRule[rule];
    const pillarFresh = staleDays !== null && staleDays <= graceByRule[rule];
    if (pillarFresh) continue; // fresh data + rule not live = genuine recovery → release
    // Stale pillar within cooldown → latch the tightest such cap.
    if (latched === null || pc.cap < latched.cap) latched = { ruleId: pc.ruleId, cap: pc.cap };
  }
  if (latched === null) return live;
  return { score: Math.min(live.score, latched.cap), applied: latched };
}
