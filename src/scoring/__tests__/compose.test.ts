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
});
