import { describe, it, expect } from "vitest";
import { computeFightFormScore } from "../compose";
import { ScoringConfigV1 } from "../config/v1";
import type { ScoringInputs } from "../types";

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
  // Hooper 4 is "fresh" under the new wellness curve (<=5 → 100). The base
  // fixture is supposed to model "strong signal in every domain"; the prior
  // value of 8 now lands on the new curve's 0 floor and would drag the
  // composite down for tests that assume all-strong.
  hooperByDate: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), hooper: 4 };
  }),
  meals: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), calories: 2500, proteinG: 180 };
  }),
  targets: { calories: 2500, proteinG: 180 },
  priorRawScores: [],
  ...overrides,
});

describe("computeFightFormScore", () => {
  it("returns ok state with score in 0–100", () => {
    const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
    expect(r.state).toBe("ok");
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.algorithmVersion).toBe("1.0.0");
  });
  it("returns no_camp when fightDate is null", () => {
    const r = computeFightFormScore(baseInputs({ fightDate: null, campStartDate: null }), ScoringConfigV1);
    expect(r.state).toBe("no_camp");
  });
  it("returns calibrating when data is sparse", () => {
    const r = computeFightFormScore(baseInputs({ sleepHours: [], weights: [], sessions: [], hooperByDate: [], meals: [] }), ScoringConfigV1);
    expect(r.state).toBe("calibrating");
  });
  it("applies EMA smoothing using priorRawScores", () => {
    const r = computeFightFormScore(baseInputs({ priorRawScores: [{ date: "2026-04-30", rawScore: 60 }, { date: "2026-04-29", rawScore: 50 }] }), ScoringConfigV1);
    expect(r.score).not.toBe(r.rawScore);
  });
  it("identifies topDriver and topLimiter", () => {
    const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
    expect(r.topDriver).toBeDefined();
    expect(r.topLimiter).toBeDefined();
  });

  describe("inputSources passthrough", () => {
    it("populates a 'manual'-everywhere fallback when inputs.sources is absent", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.inputSources).toBeDefined();
      // All sleep/weight entries in the base fixture should fall back to 'manual'.
      for (const v of Object.values(r.inputSources!.sleepHoursByDate)) {
        expect(v).toBe("manual");
      }
      for (const v of Object.values(r.inputSources!.weightsByDate)) {
        expect(v).toBe("manual");
      }
      expect(r.inputSources!.weightLatest).toBe("manual");
      expect(r.inputSources!.sleepHoursTargetDate).toBe("manual");
    });

    it("passes inputs.sources through to inputSources on the engine output", () => {
      const sources = {
        sleepHoursByDate: { "2026-05-01": "healthkit" as const },
        weightsByDate: { "2026-05-01": "healthkit" as const, "2026-04-01": "manual" as const },
        weightLatest: "healthkit" as const,
        sleepHoursTargetDate: "healthkit" as const,
      };
      const r = computeFightFormScore(baseInputs({ sources }), ScoringConfigV1);
      expect(r.inputSources).toEqual(sources);
    });
  });

  describe("Fix #1 — composite redistribution on missing data", () => {
    it("composite uses only present sub-scores (weight:0 entries excluded)", () => {
      // Strong signal in every domain EXCEPT meals (which is empty).
      // After fix #2, nutritionAdherence drops weight to 0 and the composite
      // should ignore it — score should be high, not dragged down to ~85.
      const r = computeFightFormScore(baseInputs({ meals: [] }), ScoringConfigV1);
      // With nutrition excluded and everything else strong, raw should still
      // be in the 90s. The old broken composite would have averaged in a 0.
      expect(r.subScores.nutritionAdherence.weight).toBe(0);
      expect(r.rawScore).toBeGreaterThanOrEqual(85);
    });

    it("composite divides by sum-of-present-weights, not all weights", () => {
      // Sanity: if every sub-score with data scores 100 and the rest drop
      // out, the composite is 100 (not 100 × presentWeight / totalWeight).
      const inputs = baseInputs({
        meals: [],          // nutrition → weight:0
        hooperByDate: [],   // wellness → weight:0
      });
      const r = computeFightFormScore(inputs, ScoringConfigV1);
      expect(r.subScores.nutritionAdherence.weight).toBe(0);
      expect(r.subScores.wellness.weight).toBe(0);
      // Other three sub-scores are at their max → composite should be ~100.
      expect(r.rawScore).toBeGreaterThanOrEqual(95);
    });
  });

  describe("Nutrition weight = 0 across all phases", () => {
    it("changing nutritionAdherence inputs does not move the composite score", () => {
      const onTarget = computeFightFormScore(baseInputs(), ScoringConfigV1);
      // Severely off-target meals (1000 kcal under 2500 target). With
      // nutrition weight pinned to 0, this must not budge the composite.
      const badMeals = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), calories: 1500, proteinG: 60 };
      });
      const offTarget = computeFightFormScore(
        baseInputs({ meals: badMeals }),
        ScoringConfigV1,
      );
      expect(offTarget.score).toBe(onTarget.score);
      expect(offTarget.rawScore).toBe(onTarget.rawScore);
      // Subscore weight is held at 0 even when data is present.
      expect(offTarget.subScores.nutritionAdherence.weight).toBe(0);
    });
  });

  describe("Fix #6 — post-fight returns paused", () => {
    it("returns state:'paused' when daysToFight < 0", () => {
      const r = computeFightFormScore(
        baseInputs({ date: "2026-07-01", fightDate: "2026-06-15" }),
        ScoringConfigV1,
      );
      expect(r.state).toBe("paused");
      expect(r.score).toBe(0);
    });

    it("returns state:'ok' on the day of the fight (daysToFight = 0)", () => {
      const r = computeFightFormScore(
        baseInputs({ date: "2026-06-15", fightDate: "2026-06-15" }),
        ScoringConfigV1,
      );
      expect(r.state).toBe("ok");
    });
  });
});
