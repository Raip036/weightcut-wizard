import type { ScoringConfig } from "../types";

export const ScoringConfigV1: ScoringConfig = {
  version: "1.0.0",
  // `recovery` is held at 0 by default and stays 0 when no HealthKit
  // signals are supplied — preserves the pre-HealthKit composite exactly.
  // When the engine receives `healthSignals`, compose.ts transfers the
  // entire `wellness` weight onto `recovery` (which already folds soreness
  // / energy back in via `selfReportRecovery`). This keeps the total
  // weight invariant across both code paths.
  // `nutritionAdherence` now carries real weight (0.15) so logging meals
  // on-target actually raises the fight score. Each phase sums to 1.0.
  weights: {
    build:     { trainingLoad: 0.20, sleep: 0.20, weightCut: 0.25, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    peak:      { trainingLoad: 0.20, sleep: 0.20, weightCut: 0.25, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    fightWeek: { trainingLoad: 0.15, sleep: 0.25, weightCut: 0.30, wellness: 0.15, nutritionAdherence: 0.15, recovery: 0 },
  },
  phaseThresholdsDays: { fightWeek: 7, peak: 14 },
  trainingLoad: {
    acwrSweetSpot: [0.7, 1.4],
    acwrPenaltyEdges: [0.5, 1.5],
    acwrFloor: 20,
    acuteWindowDays: 7,
    chronicWindowDays: 28,
  },
  sleep: {
    targetHoursPerNight: 8,
    // Legacy weekly-debt penalty — retained for back-compat; the active
    // formula is `perHourPenalty` applied to per-night debt.
    debtPenaltyPerHour: 8,
    perHourPenalty: 30,
    defaultAssumedHours: 7,
    minTrainingDurationForAssumption: 20,
  },
  weightCut: {
    sustainableRatePctPerWeek: [0.3, 1.0],
    decayEdgePct: 1.5,
    dangerEdgePct: 2.0,
    // Stricter threshold (%/wk) reserved for the `weight_cut_dangerous`
    // ceiling. Sub-score math (weightCut.ts) still uses `dangerEdgePct`
    // for grading; this only gates the hard score-cap.
    dangerCeilingPct: 2.5,
    onPaceMissPenalty: 10,
  },
  wellness: { hooperFloor: 4, hooperScalar: 4.2 },
  recovery: {
    // Spec §7.2 component weights (sum = 1.00 when every signal is present;
    // the engine renormalises whenever any are missing).
    healthWeights: {
      hrv: 0.40,
      sleepDuration: 0.20,
      sleepQuality: 0.10,
      restingHr: 0.10,
      wristTemp: 0.05,
      soreness: 0.10,
      energy: 0.05,
    },
    sleepDurationTargetMinutes: 7.5 * 60,
    sleepDurationToleranceMinutes: 60,
    deviationSlope: 15,
    wristTempPenaltyPerCelsius: 25,
  },
  nutrition: {
    // v1 thresholds — retained for back-compat with downstream callers
    // that may still inspect the shape. The active scoring path (v2)
    // ignores these and reads the soft-falloff fields below instead.
    calorieToleranceFraction: 0.10,
    proteinShortfallThresholdPct: 80,
    proteinPenaltyPerDay: 5,
    // v2 — soft-falloff calorie adherence. See nutritionAdherence.ts
    // for the gradient curve these anchor.
    calorieFullCreditFraction: 0.10,
    calorieZeroCreditFraction: 0.40,
    minLoggedKcalFraction: 0.30,
  },
  ceilings: [
    { id: "weight_cut_dangerous", cap: 65 },
    { id: "sleep_debt", cap: 65 },
    { id: "training_spike", cap: 60 },
  ],
  smoothing: { emaDays: 3 },
  coldStart: { minDaysOfDataIn7d: 3 },
  staleness: {
    neutral: 50,
    byPillar: {
      sleep:              { graceDays: 2, horizonDays: 9,  dMax: 0.7 },
      weightCut:          { graceDays: 4, horizonDays: 14, dMax: 0.7 },
      wellness:           { graceDays: 7, horizonDays: 14, dMax: 0.7 },
      nutritionAdherence: { graceDays: 3, horizonDays: 10, dMax: 0.7 },
      trainingLoad:       { graceDays: 5, horizonDays: 21, dMax: 0.7 },
      recovery:           { graceDays: 3, horizonDays: 10, dMax: 0.7 },
    },
  },
  confidence: { labelCapThreshold: 0.5, ceilingCooldownDays: 5 },
  consistency: { maxBonus: 5, lookbackDays: 5, minRawForBonus: 75, fullBonusMean: 92 },
  labelThresholds: { sharp: 80, sharpening: 60, offPace: 40 },
  campAge: { maxWeeksDisplay: 4 },
};
