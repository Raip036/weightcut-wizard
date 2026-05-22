import type { ScoringConfig, SubScore } from "../types";

type Input = {
  weights: Array<{ date: string; weightKg: number }>;
  startingWeightKg: number | null;
  goalWeightKg: number | null;
  campStartDate: string | null;
  fightDate: string | null;
};

function daysBetween(a: string, b: string): number {
  return (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24);
}

export function computeWeightCut(input: Input, asOfDate: string, cfg: ScoringConfig): SubScore {
  const { weights, startingWeightKg, goalWeightKg, campStartDate, fightDate } = input;
  if (!startingWeightKg || !goalWeightKg || !campStartDate) {
    return { value: 50, weight: 0, reason: "Camp data incomplete" };
  }
  if (weights.length === 0) {
    return { value: 50, weight: 0, reason: "No weight logs yet" };
  }
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1];
  // Floor `daysElapsed` at 7 (not 1): two same-day weigh-ins shouldn't yield
  // a 7×-blown weekly rate. A week is the minimum window where a "%/wk"
  // figure makes physiological sense.
  const daysElapsed = Math.max(7, daysBetween(campStartDate, current.date));
  const weeksElapsed = daysElapsed / 7;
  const kgLost = startingWeightKg - current.weightKg;
  const ratePctPerWeek = (kgLost / startingWeightKg / weeksElapsed) * 100;

  const c = cfg.weightCut;
  const [lo, hi] = c.sustainableRatePctPerWeek;
  // Dead-band: ±0.05%/wk counts as "flat" so day-to-day weigh-in noise
  // doesn't bounce the user between gaining/plateau/cutting states.
  const PLATEAU_BAND = 0.05;
  let value: number;
  if (ratePctPerWeek > PLATEAU_BAND && ratePctPerWeek < lo) {
    // Slow-but-positive cut: interpolate 50 → 100 across [PLATEAU_BAND, lo]
    // so there's no discontinuity at the boundary between "flat" and the
    // legacy `60 + (rate/lo)*40` ramp (which jumped from 30 to 60).
    const t = (ratePctPerWeek - PLATEAU_BAND) / (lo - PLATEAU_BAND);
    value = 50 + t * 50;
  } else if (ratePctPerWeek > PLATEAU_BAND) {
    // ratePctPerWeek >= lo — sustainable, decay, or danger band.
    if (ratePctPerWeek <= hi) {
      value = 100;
    } else if (ratePctPerWeek <= c.decayEdgePct) {
      value = 100 - ((ratePctPerWeek - hi) / (c.decayEdgePct - hi)) * 50;
    } else if (ratePctPerWeek <= c.dangerEdgePct) {
      value = 50 - ((ratePctPerWeek - c.decayEdgePct) / (c.dangerEdgePct - c.decayEdgePct)) * 30;
    } else {
      value = 20;
    }
  } else if (ratePctPerWeek >= -PLATEAU_BAND) {
    // Within the dead-band on either side of 0 — effectively flat.
    value = 50;
  } else {
    // Gaining (more than 0.05%/wk in the wrong direction).
    value = 30;
  }

  // On-pace check: if we won't hit goalWeight by fightDate at current rate, deduct.
  if (fightDate) {
    const daysToFight = daysBetween(asOfDate, fightDate);
    const kgRemaining = current.weightKg - goalWeightKg;
    if (kgRemaining > 0 && daysToFight > 0) {
      const requiredKgPerDay = kgRemaining / daysToFight;
      const observedKgPerDay = kgLost / daysElapsed;
      if (observedKgPerDay < requiredKgPerDay * 0.7) {
        value -= c.onPaceMissPenalty;
      }
    }
  }

  value = Math.max(0, Math.min(100, value));
  return {
    value: Math.round(value),
    weight: 0,
    reason: `${ratePctPerWeek.toFixed(2)}%/wk (target ${lo}–${hi}%)`,
  };
}
