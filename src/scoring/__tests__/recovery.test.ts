import { describe, it, expect } from "vitest";
import { computeRecovery } from "../subScores/recovery";
import { computeFightFormScore } from "../compose";
import { ScoringConfigV1 } from "../config/v1";
import type { HealthSignal, HealthSignals, ScoringInputs } from "../types";

const ABSENT_SIGNAL: HealthSignal = {
  value: null,
  baseline: null,
  deviationZ: null,
  confidence: 0,
};

const allNullSignals: HealthSignals = {
  hrv: ABSENT_SIGNAL,
  restingHr: ABSENT_SIGNAL,
  sleepMinutes: ABSENT_SIGNAL,
  sleepEfficiency: ABSENT_SIGNAL,
  wristTempDelta: ABSENT_SIGNAL,
  vo2Max: ABSENT_SIGNAL,
};

// Apple-Watch Tier 2 user: every component present at solid values.
const fullTier2Signals: HealthSignals = {
  hrv:             { value: 65, baseline: 55, deviationZ: 1.0,  confidence: 1.0 }, // HRV up = good
  restingHr:       { value: 52, baseline: 56, deviationZ: -0.8, confidence: 1.0 }, // RHR down = good
  sleepMinutes:    { value: 7.5 * 60, baseline: 7 * 60, deviationZ: 0.5, confidence: 1.0 },
  sleepEfficiency: { value: 92, baseline: 88, deviationZ: 0.7, confidence: 1.0 },
  wristTempDelta:  { value: 0.1, baseline: 0,  deviationZ: 0.1, confidence: 1.0 },
  vo2Max:          { value: 48, baseline: 47, deviationZ: 0.2, confidence: 1.0 },
};

// HRV-only signal bundle (e.g. brand-new Whoop user, no sleep yet).
const hrvOnlySignals: HealthSignals = {
  hrv:             { value: 60, baseline: 55, deviationZ: 0.5, confidence: 1.0 },
  restingHr:       ABSENT_SIGNAL,
  sleepMinutes:    ABSENT_SIGNAL,
  sleepEfficiency: ABSENT_SIGNAL,
  wristTempDelta:  ABSENT_SIGNAL,
  vo2Max:          ABSENT_SIGNAL,
};

const baseInputs = (overrides: Partial<ScoringInputs> = {}): ScoringInputs => ({
  date: "2026-05-01",
  fightDate: "2026-06-15",
  campStartDate: "2026-04-01",
  startingWeightKg: 80,
  goalWeightKg: 75,
  currentWeightKg: 77.5,
  sessions: Array.from({ length: 28 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), rpe: 7, durationMinutes: 45 };
  }),
  sleepHours: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), hours: 8 };
  }),
  weights: [
    { date: "2026-04-01", weightKg: 80 },
    { date: "2026-05-01", weightKg: 77.5 },
  ],
  hooperByDate: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), hooper: 8 };
  }),
  meals: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), calories: 2500, proteinG: 180 };
  }),
  targets: { calories: 2500, proteinG: 180 },
  priorRawScores: [],
  ...overrides,
});

describe("computeRecovery (pure)", () => {
  it("returns weight 0 + confidence 0 when every signal is null", () => {
    const r = computeRecovery(allNullSignals, null, ScoringConfigV1);
    expect(r.confidence).toBe(0);
    expect(r.weight).toBe(0);
    expect(r.value).toBe(0);
    expect(r.reason).toMatch(/no.*recovery signals/i);
  });

  it("hits 1.0 confidence when both HRV and RHR are present", () => {
    const r = computeRecovery(
      fullTier2Signals,
      { soreness: 3, energy: 8 },
      ScoringConfigV1,
    );
    // Simplified policy: HRV + RHR only → confidence = present/2 = 1.0.
    expect(r.confidence).toBe(1.0);
    // Sanity: a "great recovery day" should score well above 50.
    expect(r.value).toBeGreaterThan(60);
  });

  it("yields 0.5 confidence for HRV-only (one of two signals present)", () => {
    const r = computeRecovery(
      hrvOnlySignals,
      { soreness: 4, energy: null },
      ScoringConfigV1,
    );
    // present.length = 1 (HRV only) → confidence = 1/2 = 0.5.
    expect(r.confidence).toBe(0.5);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThanOrEqual(100);
  });

  it("RHR missing falls back to HRV alone with confidence 0.5", () => {
    // Cold-start variant: a healthkit feed with HRV+baseline but no RHR yet.
    const r = computeRecovery(
      hrvOnlySignals,
      null,
      ScoringConfigV1,
    );
    expect(r.confidence).toBe(0.5);
    expect(r.value).toBeGreaterThan(0);
  });

  it("uses literature fallbacks for HRV and RHR when baselines are missing", () => {
    // No baseline yet — engine should use FALLBACK_HRV_BASELINE_MS=50 and
    // FALLBACK_RHR_BASELINE_BPM=60 so a cold-start user still gets a score.
    // Both at fallback baseline values → delta=0 each → both score 50.
    const coldStart: HealthSignals = {
      hrv:             { value: 50, baseline: null, deviationZ: null, confidence: 1.0 },
      restingHr:       { value: 60, baseline: null, deviationZ: null, confidence: 1.0 },
      sleepMinutes:    ABSENT_SIGNAL,
      sleepEfficiency: ABSENT_SIGNAL,
      wristTempDelta:  ABSENT_SIGNAL,
      vo2Max:          ABSENT_SIGNAL,
    };
    const r = computeRecovery(coldStart, null, ScoringConfigV1);
    expect(r.confidence).toBe(1.0);
    expect(r.value).toBe(50);
  });

  it("self-report-only (signals === null) contributes nothing now", () => {
    // Recovery no longer consumes soreness/energy — that moved into the
    // wellness/Hooper sub-score. With no HealthKit signals, recovery returns
    // weight 0 + confidence 0 so the composite falls back to wellness.
    const r = computeRecovery(null, { soreness: 2, energy: 9 }, ScoringConfigV1);
    expect(r.confidence).toBe(0);
    expect(r.weight).toBe(0);
    expect(r.value).toBe(0);
  });

  it("clamps an outlier z-score effect to the [-3, 3] band", () => {
    // Z is already pre-clipped at the data layer per the HealthSignal
    // contract; verify the engine doesn't compound the slope into > 100.
    const extreme: HealthSignals = {
      ...allNullSignals,
      hrv: { value: 200, baseline: 50, deviationZ: -3, confidence: 1.0 },
    };
    const r = computeRecovery(extreme, null, ScoringConfigV1);
    expect(r.value).toBeLessThanOrEqual(100);
    expect(r.value).toBeGreaterThanOrEqual(0);
  });
});

describe("computeFightFormScore + healthSignals integration", () => {
  it("omitting healthSignals produces identical output to before HealthKit", () => {
    const without = computeFightFormScore(baseInputs(), ScoringConfigV1);
    // Explicit null is the documented "no HealthKit" path.
    const withNull = computeFightFormScore(
      baseInputs({ healthSignals: null, selfReportRecovery: null }),
      ScoringConfigV1,
    );
    expect(without.score).toBe(withNull.score);
    expect(without.rawScore).toBe(withNull.rawScore);
    expect(without.subScores.wellness.weight).toBe(withNull.subScores.wellness.weight);
    expect(without.subScores.recovery.weight).toBe(0);
    expect(withNull.subScores.recovery.weight).toBe(0);
    expect(without.recoveryConfidence).toBe(0);
    expect(withNull.recoveryConfidence).toBe(0);
  });

  it("with Tier 2 signals, recovery takes over wellness weight and recoveryConfidence > 0.9", () => {
    const r = computeFightFormScore(
      baseInputs({
        healthSignals: fullTier2Signals,
        selfReportRecovery: { soreness: 3, energy: 8 },
      }),
      ScoringConfigV1,
    );
    expect(r.recoveryConfidence).toBeGreaterThan(0.9);
    expect(r.subScores.recovery.weight).toBeGreaterThan(0);
    expect(r.subScores.wellness.weight).toBe(0); // weight handed over
  });

  it("with all-null signals AND null self-report, recovery contributes 0 and wellness keeps its weight", () => {
    const r = computeFightFormScore(
      baseInputs({
        healthSignals: allNullSignals,
        selfReportRecovery: null,
      }),
      ScoringConfigV1,
    );
    // confidence = 0 → recovery doesn't activate → wellness path is kept
    expect(r.recoveryConfidence).toBe(0);
    expect(r.subScores.recovery.weight).toBe(0);
    expect(r.subScores.wellness.weight).toBeGreaterThan(0);
  });
});
