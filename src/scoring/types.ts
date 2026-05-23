export type SubScoreKey =
  | "trainingLoad"
  | "sleep"
  | "weightCut"
  | "wellness"
  | "nutritionAdherence"
  | "recovery";

export type SubScore = { value: number; weight: number; reason: string };

/**
 * A single physiological signal read from HealthKit (or computed from
 * `daily_health_summary` + `health_baselines`).
 *
 * - `value`        : today's observed value, in the metric's canonical unit
 *                    (HRV ms, RHR bpm, sleep minutes, sleep efficiency %,
 *                     wrist-temp delta °C, VO2Max mL/kg/min). `null` when the
 *                    user has no sample for the target date.
 * - `baseline`     : the user's 14-day rolling mean for the same metric.
 *                    `null` when fewer than ~3 days of history exist.
 * - `deviationZ`   : (value - mean) / stddev, clipped to [-3, 3] so an
 *                    outlier sample (a single Whoop misread) can't blow up
 *                    the recovery score. `null` when either operand is null
 *                    or stddev is 0.
 * - `confidence`   : 0..1, how much we trust this signal. Drops when the
 *                    14-day window has few samples, when the source is
 *                    low-quality (phone-only RHR vs. watch HRV), or when
 *                    the metric is missing entirely (0).
 */
export interface HealthSignal {
  value: number | null;
  baseline: number | null;
  deviationZ: number | null;
  confidence: number;
}

/**
 * The full bundle of HealthKit-derived signals the recovery sub-score
 * consumes. Built by `convex/fightFormScore_internal.ts.fetchScoringInputs`
 * from `daily_health_summary` (today's values) and `health_baselines`
 * (rolling means/stddevs). Optional on `ScoringInputs` — when omitted the
 * engine falls back to the pre-existing self-report path.
 */
export interface HealthSignals {
  hrv: HealthSignal;
  restingHr: HealthSignal;
  sleepMinutes: HealthSignal;
  sleepEfficiency: HealthSignal;
  /** Already a deviation from the user's own baseline; baseline === 0. */
  wristTempDelta: HealthSignal;
  vo2Max: HealthSignal;
}

export type ScoringPhase = "build" | "peak" | "fightWeek";

export type FightFormState = "ok" | "calibrating" | "no_camp" | "paused";

export type FightFormLabel = "sharp" | "sharpening" | "off_pace" | "at_risk";

/**
 * Per-input provenance flag — which source the value the engine consumed
 * actually came from. Lets the UI render badges like "Sleep from Apple
 * Health" without re-querying the raw tables. `'healthkit'` means the
 * `daily_health_summary` row for that date contributed; `'manual'` means
 * the value came from `sleep_logs` / `weight_logs`. Per-date maps are
 * provided so callers can mark *individual* nights / weigh-ins, plus the
 * single-source flag for the headline value (latest weight / target-date
 * sleep) most consumed by the UI.
 */
export interface ScoringInputSources {
  sleepHoursByDate: Record<string, "healthkit" | "manual">;
  weightsByDate: Record<string, "healthkit" | "manual">;
  /** Source backing the most recent weight in `weights` (latest by date). */
  weightLatest: "healthkit" | "manual" | null;
  /** Source backing the sleep entry for the target date, if any. */
  sleepHoursTargetDate: "healthkit" | "manual" | null;
}

export type FightFormScore = {
  score: number;          // 0–100 displayed (EMA)
  rawScore: number;
  label: FightFormLabel;
  state: FightFormState;
  phase: ScoringPhase | null;
  campAge: { weeksAhead: number } | null;
  subScores: Record<SubScoreKey, SubScore>;
  topDriver: SubScoreKey;
  topLimiter: SubScoreKey;
  appliedCeiling: { ruleId: string; cap: number } | null;
  algorithmVersion: string;
  /**
   * How much HealthKit / self-report data backed today's recovery sub-score
   * (0..1). 1.0 means every weighted component was present; 0.0 means none
   * were (Tier 0, no data — recovery contributes nothing to the composite).
   * UI uses this to render a confidence chip next to the score.
   */
  recoveryConfidence: number;
  /**
   * Debug/UX field surfacing where each input the engine consumed came
   * from (Apple Health vs. manual log). Optional so unit tests and
   * callers that don't care about provenance can ignore it. Always
   * populated by `computeFightFormScore` — falls back to `'manual'` for
   * every entry when `inputs.sources` is absent.
   */
  inputSources?: ScoringInputSources;
};

export type ScoringInputs = {
  date: string;                  // ISO YYYY-MM-DD (user-local)
  fightDate: string | null;      // ISO; null if no camp
  campStartDate: string | null;
  startingWeightKg: number | null;
  goalWeightKg: number | null;
  currentWeightKg: number | null;
  isCampPaused?: boolean;
  isCampCompleted?: boolean;
  sessions: Array<{ date: string; rpe: number; durationMinutes: number }>;
  sleepHours: Array<{ date: string; hours: number }>;
  // Dates for which `sleepHours` contains a server-injected default (because
  // the user logged training that day but never entered sleep). Used by
  // `computeSleep` to surface "(assumed)" in the breakdown so users know the
  // score reflects a fallback, not real data.
  assumedSleepDates?: ReadonlyArray<string>;
  weights: Array<{ date: string; weightKg: number }>;
  hooperByDate: Array<{ date: string; hooper: number }>;
  meals: Array<{ date: string; calories: number; proteinG: number }>;
  targets: { calories: number | null; proteinG: number | null };
  priorRawScores: Array<{ date: string; rawScore: number }>; // for EMA
  /**
   * HealthKit-derived signals for the recovery sub-score. OPTIONAL — when
   * omitted (or set to null) the engine produces the exact same output as
   * before HealthKit existed: a passthrough `recovery` sub-score with
   * weight 0 and `recoveryConfidence` 0. When provided, recovery
   * contributes to the composite per `cfg.recovery.healthWeights`.
   */
  healthSignals?: HealthSignals | null;
  /**
   * Optional self-report soreness / energy on a 1–10 scale (e.g. from the
   * morning check-in). Augments — does not replace — the HealthKit
   * recovery components per spec §10.14.
   */
  selfReportRecovery?: { soreness: number | null; energy: number | null } | null;
  /**
   * Per-input provenance: marks each `sleepHours` / `weights` entry as
   * coming from HealthKit (`daily_health_summary`) or a manual log.
   * Populated by `fetchScoringInputs`; passed through to the engine
   * output's `inputSources` field. Optional so older test fixtures and
   * non-Convex callers don't have to provide it — missing entries are
   * treated as `'manual'` for back-compat.
   */
  sources?: ScoringInputSources;
};

export type ScoringConfig = {
  version: string;
  weights: Record<ScoringPhase, Record<SubScoreKey, number>>;
  phaseThresholdsDays: { fightWeek: number; peak: number };
  trainingLoad: {
    acwrSweetSpot: [number, number];
    acwrPenaltyEdges: [number, number];
    acwrFloor: number;
    acuteWindowDays: number;
    chronicWindowDays: number;
  };
  sleep: {
    targetHoursPerNight: number;
    debtPenaltyPerHour: number;
    /**
     * Per-night sleep-debt penalty used by `computeSleep` after switching to
     * the average-per-logged-night formula: `100 - debt * perHourPenalty`,
     * where `debt` is hours-short PER NIGHT (not weekly).
     * Default 30: 1h/night short → 70, 2h/night → 40, 3h+/night → ~10 floor.
     */
    perHourPenalty: number;
    // Hours to assume when the user has logged meaningful training on a day
    // but never entered sleep — rescues the score from a "forgot to log"
    // penalty without rewarding genuine sleep deprivation.
    defaultAssumedHours: number;
    // Minimum gym/calendar session duration (minutes) that qualifies a day
    // for the assumption above. Prevents 5-min mobility entries from
    // unlocking a free 7h.
    minTrainingDurationForAssumption: number;
  };
  weightCut: {
    sustainableRatePctPerWeek: [number, number];
    decayEdgePct: number;
    dangerEdgePct: number;
    onPaceMissPenalty: number;
  };
  wellness: { hooperFloor: number; hooperScalar: number };
  recovery: {
    /**
     * Component weights for the recovery sub-score (spec §7.2). Each is
     * applied only when its underlying signal is present; surviving weights
     * renormalise. The sum need not equal 1.0 — the engine renormalises.
     */
    healthWeights: {
      hrv: number;
      sleepDuration: number;
      sleepQuality: number;
      restingHr: number;
      wristTemp: number;
      soreness: number;
      energy: number;
    };
    /** Target nightly sleep used by the bell-curve sleep-duration score. */
    sleepDurationTargetMinutes: number;
    /** Standard deviation of the sleep-duration bell curve. */
    sleepDurationToleranceMinutes: number;
    /**
     * Slope factor for HRV / RHR deviation scoring: 50 + slope * (-z). The
     * default of 15 maps z=±1 to score ±15 (clipped to 0..100 at z=±3.3).
     */
    deviationSlope: number;
    /** Cap on wrist-temp penalty: 100 - perCelsius * |deltaC|. */
    wristTempPenaltyPerCelsius: number;
  };
  nutrition: {
    calorieToleranceFraction: number;
    proteinShortfallThresholdPct: number;
    proteinPenaltyPerDay: number;
  };
  ceilings: Array<{ id: string; cap: number }>;
  smoothing: { emaDays: number };
  coldStart: { minDaysOfDataIn7d: number };
  labelThresholds: { sharp: number; sharpening: number; offPace: number };
  campAge: { maxWeeksDisplay: number };
};
