export type SubScoreKey =
  | "trainingLoad"
  | "sleep"
  | "weightCut"
  | "wellness"
  | "nutritionAdherence";

export type SubScore = {
  value: number;
  weight: number;
  reason: string;
  /**
   * Optional sub-score-specific metadata for UI rendering. Sub-scores may
   * populate this with surfaced numbers (e.g. weightCut surfaces the
   * current/target/delta kg so the bottom sheet doesn't recompute them).
   * Always optional — most sub-scores don't need it.
   */
  meta?: Record<string, number | string>;
  /**
   * 0..1 freshness/completeness of the data backing this sub-score, derived
   * from how recently it was logged (1 = logged today, 0 = stale beyond the
   * pillar's horizon or never logged). Optional so callers/tests that don't
   * set it are unaffected; `computeFightFormScore` always populates it.
   */
  completeness?: number;
};

export type ScoringPhase = "build" | "peak" | "fightWeek";

export type FightFormState = "ok" | "calibrating" | "no_camp" | "paused" | "stale";

export type FightFormLabel = "sharp" | "sharpening" | "off_pace" | "at_risk";

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
   * 0..1 — how much of the (phase-weighted) composite was backed by fresh
   * data today. 1.0 = every contributing pillar logged today; lower means
   * the number rests partly on stale/partial inputs. UI dims the ring and
   * caps the label when this is low. Always populated.
   */
  dataConfidence: number;
  /** Largest staleness gap (days since last log) across contributing pillars. */
  dataAgeDays: number;
  /** Count of pillars currently contributing (weight > 0). */
  activePillars: number;
  /** Total pillars considered for the current phase (weight defined > 0). */
  totalPillars: number;
  /**
   * 0..maxBonus points added to the raw composite this run as a consistency
   * reward (0 when not earned). Surfaced so the UI can show "form building"
   * feedback. Always populated.
   */
  formMomentum: number;
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
  /**
   * Dates (YYYY-MM-DD) the user has explicitly marked as rest in
   * fight_camp_calendar. Used by the trainingLoad sub-score to distinguish
   * planned 0-load days from missing data. Does NOT affect ACWR math —
   * rest days contribute zero load by definition; their only role is to
   * relax the cold-start gate and enrich the reason string.
   */
  restDays?: ReadonlyArray<string>;
  /**
   * Dates the user explicitly marked as skipped, per pillar (sleep/weight/
   * nutrition/wellness). A skip counts as recency for that pillar — staleness
   * decay is paused (the gap is intentional, not forgotten) — but it does not
   * fabricate a value. Optional; absent in legacy callers.
   */
  markedSkips?: ReadonlyArray<{ date: string; pillar: SubScoreKey }>;
  sleepHours: Array<{ date: string; hours: number }>;
  // Dates for which `sleepHours` contains a server-injected default (because
  // the user logged training that day but never entered sleep). Used by
  // `computeSleep` to surface "(assumed)" in the breakdown so users know the
  // score reflects a fallback, not real data.
  assumedSleepDates?: ReadonlyArray<string>;
  weights: Array<{ date: string; weightKg: number }>;
  /**
   * Parsed `profiles.cutPlanJson` — the AI-generated weight-cut plan
   * containing `weeklyPlan[]` rows with `{ week, targetWeight }`. Used
   * by the `weightCut` sub-score to grade adherence to THIS WEEK'S target
   * weight (replaces the legacy rate-of-loss formula). Optional: when
   * absent, the sub-score falls back to a linear interp between
   * `startingWeightKg` and `goalWeightKg`; when neither is available, it
   * returns weight 0 and is excluded from the composite.
   */
  cutPlanJson?: unknown;
  hooperByDate: Array<{ date: string; hooper: number }>;
  meals: Array<{ date: string; calories: number; proteinG: number }>;
  targets: { calories: number | null; proteinG: number | null };
  priorRawScores: Array<{ date: string; rawScore: number }>; // for EMA
  /**
   * Recently-applied ceilings (most recent ~5 days), used to LATCH a fired
   * safety cap so it can't be escaped by simply not logging. Optional — when
   * absent the engine applies ceilings exactly as before (no latching).
   */
  priorCeilings?: Array<{ date: string; ruleId: string; cap: number }>;
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
    /**
     * Stricter weekly-loss threshold (% of starting weight per week) used
     * exclusively by the `weight_cut_dangerous` ceiling in `compose.ts`.
     * Sub-score math in `weightCut.ts` continues to grade against
     * `dangerEdgePct` — this only gates the hard cap.
     */
    dangerCeilingPct: number;
    onPaceMissPenalty: number;
  };
  wellness: { hooperFloor: number; hooperScalar: number };
  nutrition: {
    /** v1 — kept for type/back-compat, unread after the v2 rewrite. */
    calorieToleranceFraction: number;
    /** v1 — kept for type/back-compat, unread after the v2 rewrite. */
    proteinShortfallThresholdPct: number;
    /** v1 — kept for type/back-compat, unread after the v2 rewrite. */
    proteinPenaltyPerDay: number;
    /** v2 — drift below this earns full 100-point day credit. Default 0.10. */
    calorieFullCreditFraction?: number;
    /** v2 — drift at/above this earns 0 day credit. Default 0.40. */
    calorieZeroCreditFraction?: number;
    /** v2 — minimum (logged kcal / target kcal) for a day to count as
     *  fully logged. Days below this are skipped as "partial logs"
     *  rather than penalised as under-eating. Default 0.30. */
    minLoggedKcalFraction?: number;
  };
  ceilings: Array<{ id: string; cap: number }>;
  smoothing: { emaDays: number };
  coldStart: { minDaysOfDataIn7d: number };
  /**
   * Per-pillar staleness handling. `graceDays` = days a pillar may go
   * unlogged before anything changes. `horizonDays` = days at which the
   * pillar is fully decayed/zero-confidence. `dMax` = max decay fraction
   * toward neutral (so a stale pillar eases toward 50, never erases).
   */
  staleness: {
    neutral: number;
    byPillar: Record<SubScoreKey, { graceDays: number; horizonDays: number; dMax: number }>;
  };
  /**
   * `labelCapThreshold` — when `dataConfidence` is below this, the label is
   * capped at "sharpening" and state is "stale". `ceilingCooldownDays` — how
   * long a fired ceiling stays latched while its pillar is stale.
   */
  confidence: { labelCapThreshold: number; ceilingCooldownDays: number };
  /**
   * Consistency reward ("form momentum"). A small additive bonus on the raw
   * composite for users who sustain strong, fully-logged performance. Gated so
   * it rewards consistency of GOOD data, not just logging: requires all
   * eligible pillars present AND a strong recent mean. `maxBonus` points,
   * scaled 0→1 as the mean of the last `lookbackDays` raw scores moves from
   * `minRawForBonus` to `fullBonusMean`, multiplied by data confidence.
   */
  consistency: {
    maxBonus: number;
    lookbackDays: number;
    minRawForBonus: number;
    fullBonusMean: number;
  };
  labelThresholds: { sharp: number; sharpening: number; offPace: number };
  campAge: { maxWeeksDisplay: number };
};
