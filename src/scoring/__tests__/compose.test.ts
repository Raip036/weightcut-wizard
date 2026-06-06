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
  // Hooper 28 is the freshest a check-in can be (sleep 7 + calm/fresh/no-soreness
  // each contributing 7). Under the wellness curve (`(hooper-4)*4.2`) that maps
  // to 100, so the base fixture models "strong signal in every domain".
  hooperByDate: Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), hooper: 28 };
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

  describe("Nutrition now contributes to the composite", () => {
    it("nutritionAdherence carries a non-zero weight when meals are logged", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.nutritionAdherence.weight).toBeGreaterThan(0);
    });

    it("severely off-target eating lowers the composite vs on-target", () => {
      const onTarget = computeFightFormScore(baseInputs(), ScoringConfigV1);
      const badMeals = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), calories: 1200, proteinG: 50 };
      });
      const offTarget = computeFightFormScore(baseInputs({ meals: badMeals }), ScoringConfigV1);
      expect(offTarget.rawScore).toBeLessThan(onTarget.rawScore);
    });
  });

  describe("label-cap on low data confidence", () => {
    it("caps the label at 'sharpening' and sets state 'stale' when confidence is low", () => {
      // Only the sleep pillar present, logged 8 days ago (within horizon 9 so
      // still present) → low completeness drags dataConfidence below 0.5.
      const staleSleep = Array.from({ length: 4 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(
        baseInputs({ sessions: [], weights: [], hooperByDate: [], meals: [], sleepHours: staleSleep }),
        ScoringConfigV1,
      );
      expect(r.dataConfidence).toBeLessThan(0.5);
      expect(r.state).toBe("stale");
      expect(r.label).not.toBe("sharp");
    });

    it("does not cap the label when confidence is healthy", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.state).toBe("ok");
    });
  });

  describe("ceiling latching integration (anti-gaming)", () => {
    it("keeps the sleep_debt cap when the user stops logging sleep after tripping it", () => {
      // sleep_debt fired yesterday; today the user logged nothing new for sleep
      // (sleepHours ends 6 days ago → stale, beyond grace 2), so the live
      // sleepDebt7d is 0 and the rule wouldn't fire — but latching holds it.
      const staleSleep = Array.from({ length: 3 }, (_, i) => {
        const d = new Date("2026-04-25"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: staleSleep,
          priorCeilings: [{ date: "2026-04-30", ruleId: "sleep_debt", cap: 65 }],
        }),
        ScoringConfigV1,
      );
      expect(r.appliedCeiling?.ruleId).toBe("sleep_debt");
      expect(r.rawScore).toBeLessThanOrEqual(65);
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

    it("does not return state:'paused' on the day of the fight (daysToFight = 0)", () => {
      // The base fixture's data is 45 days old when date = fight day, so
      // dataConfidence will be low → state is 'stale', not 'ok'. The key
      // guard here is that fight-day is still active (not 'paused').
      const r = computeFightFormScore(
        baseInputs({ date: "2026-06-15", fightDate: "2026-06-15" }),
        ScoringConfigV1,
      );
      expect(r.state).not.toBe("paused");
    });
  });

  describe("confidence + staleness output fields", () => {
    it("populates dataConfidence, dataAgeDays, activePillars, totalPillars", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.dataConfidence).toBeGreaterThan(0);
      expect(r.dataConfidence).toBeLessThanOrEqual(1);
      expect(r.dataAgeDays).toBe(0); // base fixture logs everything up to `date`
      expect(r.activePillars).toBeGreaterThanOrEqual(3);
      expect(r.totalPillars).toBeGreaterThanOrEqual(3);
    });

    it("populates per-pillar completeness for contributing pillars", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.sleep.completeness).toBe(1); // logged on `date`
    });

    it("eases a stale pillar's contribution toward neutral but does not erase it", () => {
      // Sleep logged strong (8h) but 8 days ago → past grace(2), below horizon(9).
      const staleSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i); // ends 8 days before 2026-05-01
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const fresh = computeFightFormScore(baseInputs(), ScoringConfigV1);
      const stale = computeFightFormScore(baseInputs({ sleepHours: staleSleep }), ScoringConfigV1);
      expect(stale.subScores.sleep.weight).toBeGreaterThan(0);
      expect(stale.subScores.sleep.value).toBeLessThan(fresh.subScores.sleep.value);
      expect(stale.subScores.sleep.value).toBeGreaterThan(50); // eased toward, not past, neutral
      expect(stale.subScores.sleep.completeness).toBeLessThan(1);
      expect(stale.dataAgeDays).toBeGreaterThanOrEqual(8);
    });

    it("does not decay within the grace window (fresh fixture unchanged)", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.sleep.value).toBeGreaterThanOrEqual(99); // 8h logged today → ~100
    });

    it("drops a pillar once it is stale beyond its horizon (uniform across pillars)", () => {
      // Sleep last logged ~12 days before `date` (horizon is 9) → excluded.
      const ancientSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-04-19"); d.setDate(d.getDate() - i); // latest 2026-04-19, 12d before 05-01
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(baseInputs({ sleepHours: ancientSleep }), ScoringConfigV1);
      expect(r.subScores.sleep.weight).toBe(0);
      expect(r.subScores.sleep.completeness).toBe(0);
    });
  });

  describe("formMomentum output field", () => {
    it("is 0 for a user without enough history (priorRawScores empty)", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.formMomentum).toBe(0);
    });
  });

  describe("form momentum integration", () => {
    const strongPriors = Array.from({ length: 6 }, (_, i) => {
      const d = new Date("2026-04-30"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), rawScore: 92 };
    });

    it("awards a bonus to a sustained, fully-logged strong user", () => {
      const withHistory = computeFightFormScore(baseInputs({ priorRawScores: strongPriors }), ScoringConfigV1);
      expect(withHistory.formMomentum).toBeGreaterThan(0);
    });

    it("does not let momentum override a safety ceiling", () => {
      const shortSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 3 }; // heavy sleep debt
      });
      const r = computeFightFormScore(
        baseInputs({ sleepHours: shortSleep, priorRawScores: strongPriors }),
        ScoringConfigV1,
      );
      // The sleep_debt ceiling MUST fire here (~35h debt over 7 nights at 3h).
      // Asserting it fired makes this a hard proof that momentum cannot lift the
      // score past the cap — not a vacuous pass if the ceiling stopped firing.
      expect(r.appliedCeiling).not.toBeNull();
      expect(r.appliedCeiling!.ruleId).toBe("sleep_debt");
      expect(r.rawScore).toBeLessThanOrEqual(r.appliedCeiling!.cap);
    });
  });

  describe("marked skip pauses staleness decay", () => {
    it("a recent skip keeps a pillar's value from decaying", () => {
      const staleSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const decayed = computeFightFormScore(baseInputs({ sleepHours: staleSleep }), ScoringConfigV1);
      const withSkip = computeFightFormScore(
        baseInputs({ sleepHours: staleSleep, markedSkips: [{ date: "2026-04-30", pillar: "sleep" }] }),
        ScoringConfigV1,
      );
      expect(withSkip.subScores.sleep.value).toBeGreaterThan(decayed.subScores.sleep.value);
      expect(withSkip.subScores.sleep.value).toBeGreaterThanOrEqual(99);
    });
  });

  describe("a marked skip cannot release a latched safety ceiling (anti-gaming)", () => {
    it("holds the sleep_debt cap even when sleep is marked skipped", () => {
      // sleep_debt fired yesterday (priorCeilings). Real sleep is stale (last
      // real log 6 days before `date`, beyond grace). A skip yesterday must NOT
      // make the pillar look 'fresh' to the latch — the cap must stay applied.
      const staleSleep = Array.from({ length: 3 }, (_, i) => {
        const d = new Date("2026-04-25"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: staleSleep,
          markedSkips: [{ date: "2026-04-30", pillar: "sleep" }],
          priorCeilings: [{ date: "2026-04-30", ruleId: "sleep_debt", cap: 65 }],
        }),
        ScoringConfigV1,
      );
      expect(r.appliedCeiling?.ruleId).toBe("sleep_debt");
      expect(r.rawScore).toBeLessThanOrEqual(65);
    });
  });

  describe("backfill corrects today's score (no historical rewrite)", () => {
    it("a late-logged past sleep night re-enters the window and improves freshness", () => {
      const before = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: [
            { date: "2026-04-25", hours: 8 },
            { date: "2026-04-26", hours: 8 },
          ],
        }),
        ScoringConfigV1,
      );
      const after = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: [
            { date: "2026-04-25", hours: 8 },
            { date: "2026-04-26", hours: 8 },
            { date: "2026-04-30", hours: 8 },
            { date: "2026-05-01", hours: 8 },
          ],
        }),
        ScoringConfigV1,
      );
      // Before backfill: only 2 stale nights → sleep below its cold-start gate,
      // excluded (weight 0). After backfilling two recent nights: sleep is fresh,
      // present, and fully complete. Backfill corrects today's reading.
      expect(before.subScores.sleep.weight).toBe(0);
      expect(before.subScores.sleep.completeness ?? 0).toBe(0);
      expect(after.subScores.sleep.weight).toBeGreaterThan(0);
      expect(after.subScores.sleep.completeness).toBe(1);
    });
  });
});
