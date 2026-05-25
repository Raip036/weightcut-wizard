import type { ScoringConfig } from "../types";

export const ScoringConfigV1: ScoringConfig = {
  version: "1.0.0",
  // `recovery` is held at 0 by default and stays 0 when no HealthKit
  // signals are supplied — preserves the pre-HealthKit composite exactly.
  // When the engine receives `healthSignals`, compose.ts transfers the
  // entire `wellness` weight onto `recovery` (which already folds soreness
  // / energy back in via `selfReportRecovery`). This keeps the total
  // weight invariant across both code paths.
  weights: {
    build:     { trainingLoad: 0.20, sleep: 0.20, weightCut: 0.25, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    peak:      { trainingLoad: 0.10, sleep: 0.25, weightCut: 0.30, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    fightWeek: { trainingLoad: 0.05, sleep: 0.25, weightCut: 0.40, wellness: 0.20, nutritionAdherence: 0.10, recovery: 0 },
  },
  phaseThresholdsDays: { fightWeek: 7, peak: 14 },
  trainingLoad: {
    acwrSweetSpot: [0.8, 1.3],
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
    { id: "weight_cut_dangerous", cap: 50 },
    { id: "sleep_debt", cap: 65 },
    { id: "training_spike", cap: 45 },
  ],
  smoothing: { emaDays: 3 },
  coldStart: { minDaysOfDataIn7d: 3 },
  labelThresholds: { sharp: 80, sharpening: 60, offPace: 40 },
  campAge: { maxWeeksDisplay: 4 },
};
