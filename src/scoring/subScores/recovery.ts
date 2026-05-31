import type {
  HealthSignals,
  HealthSignal,
  ScoringConfig,
  SubScore,
} from "../types";

/**
 * Result of the recovery sub-score. Extends the standard `SubScore` with a
 * `confidence` field (0..1) that reflects whether HRV / RHR were available.
 * Surfaced on `FightFormScore.recoveryConfidence`.
 */
export type RecoverySubScore = SubScore & { confidence: number };

/** Self-report bundle from the morning check-in. No longer consumed by
 *  recovery (soreness / energy live inside the Hooper wellness sub-score),
 *  but the type is kept so callers don't need a coordinated change. */
export type SelfReportRecovery = {
  soreness: number | null;
  energy: number | null;
} | null;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// TODO: fall back to user-specific 30d rolling baselines once the recovery
// pipeline can pass them in directly. For now, when HealthKit reports a value
// without a baseline (cold-start days), use these literature-derived defaults
// so we still produce a usable score instead of skipping the signal.
const FALLBACK_HRV_BASELINE_MS = 50;
const FALLBACK_RHR_BASELINE_BPM = 60;

/**
 * Map a relative delta (signed fraction, e.g. +0.08 = 8 % above baseline) to a
 * 0..100 score centered at baseline = 50. Slope of 250 means ±20 % from
 * baseline saturates the scale, matching the spec's HRV / RHR sensitivity.
 */
function deltaToScore(delta: number): number {
  return clamp(50 + delta * 250, 0, 100);
}

/** Resolve the baseline to score against: prefer the HealthSignal's own
 *  rolling mean, else fall back to a literature default. Returns `null` only
 *  when the signal itself is absent. */
function resolveBaseline(signal: HealthSignal, fallback: number): number | null {
  if (signal.value === null) return null;
  if (signal.baseline !== null && signal.baseline > 0) return signal.baseline;
  return fallback;
}

/**
 * Compute the recovery sub-score from HealthKit signals.
 *
 * Simplified policy: blend ONLY HRV and RHR against the user's personal
 * baseline (or a fixed fallback if no baseline has been built yet).
 * Soreness, energy, sleep, and wrist temp are no longer consumed here —
 * sleep has its own sub-score and the Hooper wellness sub-score covers
 * soreness / energy.
 *
 * When neither HRV nor RHR is present, recovery returns `weight: 0` and the
 * caller (`compose.ts`) lets the wellness Hooper path keep its slot.
 */
export function computeRecovery(
  signals: HealthSignals | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _selfReport: SelfReportRecovery,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cfg: ScoringConfig,
): RecoverySubScore {
  if (signals === null) {
    return {
      value: 0,
      weight: 0,
      reason: "No HealthKit recovery signals available",
      confidence: 0,
    };
  }

  const hrvBaseline = resolveBaseline(signals.hrv, FALLBACK_HRV_BASELINE_MS);
  const rhrBaseline = resolveBaseline(signals.restingHr, FALLBACK_RHR_BASELINE_BPM);

  // HRV: higher than baseline = more recovered.
  const hrvScore =
    signals.hrv.value !== null && hrvBaseline !== null
      ? deltaToScore((signals.hrv.value - hrvBaseline) / hrvBaseline)
      : null;

  // RHR: lower than baseline = more recovered (sign flipped vs. HRV).
  const rhrScore =
    signals.restingHr.value !== null && rhrBaseline !== null
      ? deltaToScore((rhrBaseline - signals.restingHr.value) / rhrBaseline)
      : null;

  const present: Array<{ name: "HRV" | "RHR"; score: number }> = [];
  if (hrvScore !== null) present.push({ name: "HRV", score: hrvScore });
  if (rhrScore !== null) present.push({ name: "RHR", score: rhrScore });

  if (present.length === 0) {
    return {
      value: 0,
      weight: 0,
      reason: "No HealthKit recovery signals available",
      confidence: 0,
    };
  }

  const value = clamp(
    present.reduce((a, c) => a + c.score, 0) / present.length,
    0,
    100,
  );

  // Confidence: 1.0 only when both signals contribute; 0.5 when one drops out.
  const confidence = present.length / 2;

  const qualitative =
    value >= 70 ? "strong" : value >= 40 ? "okay" : "low";
  const parts = present
    .map((c) => `${c.name} ${c.score.toFixed(0)}`)
    .join(", ");
  const reason = `Recovery ${qualitative} (${parts})`;

  return {
    value: Math.round(value),
    weight: 0, // caller assigns the phase-aware weight in compose.ts
    reason,
    confidence,
  };
}
