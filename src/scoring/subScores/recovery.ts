import type {
  HealthSignals,
  HealthSignal,
  ScoringConfig,
  SubScore,
} from "../types";

/**
 * Result of the recovery sub-score. Extends the standard `SubScore` with a
 * `confidence` field (0..1) that reflects how many of the seven weighted
 * components were present. Surfaced on `FightFormScore.recoveryConfidence`.
 */
export type RecoverySubScore = SubScore & { confidence: number };

/** Optional self-report bundle from the morning check-in (1..10 scales). */
export type SelfReportRecovery = {
  soreness: number | null;
  energy: number | null;
} | null;

/** Component identifier used internally for weight bookkeeping. */
type ComponentKey =
  | "hrv"
  | "sleepDuration"
  | "sleepQuality"
  | "restingHr"
  | "wristTemp"
  | "soreness"
  | "energy";

type Component = {
  key: ComponentKey;
  score: number | null; // null => signal absent, no contribution
  weight: number;       // pulled from cfg.recovery.healthWeights
  reason: string;       // human-readable line for the breakdown
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const clipZ = (z: number | null): number | null =>
  z === null ? null : clamp(z, -3, 3);

/**
 * HRV deviation → score. Negative z = HRV is below baseline = bad, so we
 * invert: `50 + slope * (-z)`. With slope=15 and z clipped to [-3, 3], the
 * output is naturally bounded near [5, 95] before the final 0..100 clamp.
 */
function scoreHrv(signal: HealthSignal, slope: number): number | null {
  const z = clipZ(signal.deviationZ);
  if (z === null) return null;
  return clamp(50 + slope * -z, 0, 100);
}

/**
 * Resting-HR deviation → score. Same shape as HRV but the sign flips
 * (lower RHR = good = positive contribution). HealthSignal stores z as
 * (value - mean) / stddev, so positive z means RHR is *above* baseline
 * (worse), which should subtract: `50 + slope * (-z)`.
 */
function scoreRestingHr(signal: HealthSignal, slope: number): number | null {
  const z = clipZ(signal.deviationZ);
  if (z === null) return null;
  return clamp(50 + slope * -z, 0, 100);
}

/**
 * Sleep duration → bell curve around `targetMinutes` with stddev
 * `toleranceMinutes`. Peaks at 100 when within the tolerance window;
 * drops smoothly as duration deviates in either direction.
 */
function scoreSleepDuration(
  signal: HealthSignal,
  targetMinutes: number,
  toleranceMinutes: number,
): number | null {
  if (signal.value === null) return null;
  const delta = signal.value - targetMinutes;
  // Gaussian-shaped fall-off so e.g. 1 stddev off baseline ≈ score 60.
  const normalized = Math.exp(-(delta * delta) / (2 * toleranceMinutes * toleranceMinutes));
  return clamp(normalized * 100, 0, 100);
}

/**
 * Sleep efficiency → score. `value` is already a 0..100 percentage from
 * HealthKit, so we just clamp.
 */
function scoreSleepEfficiency(signal: HealthSignal): number | null {
  if (signal.value === null) return null;
  return clamp(signal.value, 0, 100);
}

/**
 * Wrist-temp delta (°C) → score. `value` IS the deviation from the user's
 * own baseline (Apple Health pre-computes a 30-day rolling baseline), so
 * we ignore `baseline` and apply a flat penalty: `100 - perCelsius * |delta|`.
 * A 2 °C swing → score 50 with the default penalty of 25.
 */
function scoreWristTemp(signal: HealthSignal, perCelsius: number): number | null {
  if (signal.value === null) return null;
  return clamp(100 - perCelsius * Math.abs(signal.value), 0, 100);
}

/** Soreness on 1..10 (higher = more sore = worse) → 0..100. */
function scoreSoreness(soreness: number | null): number | null {
  if (soreness === null) return null;
  return clamp((10 - soreness) * 10, 0, 100);
}

/** Energy on 1..10 (higher = better) → 0..100. */
function scoreEnergy(energy: number | null): number | null {
  if (energy === null) return null;
  return clamp(energy * 10, 0, 100);
}

/**
 * Pure function: compute the recovery sub-score with dynamic-weight
 * redistribution. Each of the seven components contributes only when its
 * underlying signal is present; absent components have their weight
 * dropped and the survivors renormalise. Confidence is the ratio of
 * present weight to total possible weight.
 *
 * Returns weight=0 when no components are present so the composite skips
 * recovery cleanly (the caller will assign a phase-aware weight only when
 * confidence > 0).
 */
export function computeRecovery(
  signals: HealthSignals | null,
  selfReport: SelfReportRecovery,
  cfg: ScoringConfig,
): RecoverySubScore {
  const w = cfg.recovery.healthWeights;

  const components: Component[] = signals === null
    ? [
        // Self-report-only path: still compute soreness/energy if present
        // so a Tier-0 user with a morning check-in gets *something*.
        { key: "soreness", score: scoreSoreness(selfReport?.soreness ?? null), weight: w.soreness, reason: "Self-report soreness" },
        { key: "energy",   score: scoreEnergy(selfReport?.energy ?? null),     weight: w.energy,   reason: "Self-report energy" },
      ]
    : [
        {
          key: "hrv",
          score: scoreHrv(signals.hrv, cfg.recovery.deviationSlope),
          weight: w.hrv,
          reason: describeDeviation("HRV", signals.hrv, "ms"),
        },
        {
          key: "sleepDuration",
          score: scoreSleepDuration(
            signals.sleepMinutes,
            cfg.recovery.sleepDurationTargetMinutes,
            cfg.recovery.sleepDurationToleranceMinutes,
          ),
          weight: w.sleepDuration,
          reason: signals.sleepMinutes.value !== null
            ? `Sleep duration ${(signals.sleepMinutes.value / 60).toFixed(1)}h`
            : "Sleep duration: no data",
        },
        {
          key: "sleepQuality",
          score: scoreSleepEfficiency(signals.sleepEfficiency),
          weight: w.sleepQuality,
          reason: signals.sleepEfficiency.value !== null
            ? `Sleep efficiency ${signals.sleepEfficiency.value.toFixed(0)}%`
            : "Sleep efficiency: no data",
        },
        {
          key: "restingHr",
          score: scoreRestingHr(signals.restingHr, cfg.recovery.deviationSlope),
          weight: w.restingHr,
          reason: describeDeviation("RHR", signals.restingHr, "bpm"),
        },
        {
          key: "wristTemp",
          score: scoreWristTemp(signals.wristTempDelta, cfg.recovery.wristTempPenaltyPerCelsius),
          weight: w.wristTemp,
          reason: signals.wristTempDelta.value !== null
            ? `Wrist temp Δ${signals.wristTempDelta.value.toFixed(2)}°C`
            : "Wrist temp: no data",
        },
        {
          key: "soreness",
          score: scoreSoreness(selfReport?.soreness ?? null),
          weight: w.soreness,
          reason: "Self-report soreness",
        },
        {
          key: "energy",
          score: scoreEnergy(selfReport?.energy ?? null),
          weight: w.energy,
          reason: "Self-report energy",
        },
      ];

  const totalPossibleWeight =
    w.hrv + w.sleepDuration + w.sleepQuality + w.restingHr + w.wristTemp + w.soreness + w.energy;

  const present = components.filter((c) => c.score !== null);
  const presentWeight = present.reduce((a, c) => a + c.weight, 0);

  if (presentWeight === 0 || totalPossibleWeight === 0) {
    return {
      value: 0,
      weight: 0,
      reason: "No recovery signals available",
      confidence: 0,
    };
  }

  const weightedSum = present.reduce((a, c) => a + (c.score as number) * c.weight, 0);
  const value = clamp(weightedSum / presentWeight, 0, 100);
  const confidence = presentWeight / totalPossibleWeight;

  const topContrib = [...present]
    .sort((a, b) => b.weight * (b.score as number) - a.weight * (a.score as number))
    .slice(0, 2)
    .map((c) => c.reason);

  return {
    value: Math.round(value),
    weight: 0, // caller assigns the phase-aware weight in compose.ts
    reason: topContrib.length > 0 ? topContrib.join("; ") : "Recovery score",
    confidence,
  };
}

/**
 * Render a signal's deviation as a short phrase: "HRV 48 ms (z=-1.2 vs 55)".
 * Handles every null permutation cleanly so the breakdown never reads as
 * "undefined ms (z=null)".
 */
function describeDeviation(label: string, signal: HealthSignal, unit: string): string {
  if (signal.value === null) return `${label}: no data`;
  const valueStr = `${label} ${signal.value.toFixed(unit === "ms" ? 0 : 1)} ${unit}`;
  if (signal.deviationZ === null || signal.baseline === null) {
    return `${valueStr} (no baseline yet)`;
  }
  return `${valueStr} (z=${signal.deviationZ.toFixed(2)} vs ${signal.baseline.toFixed(0)})`;
}
