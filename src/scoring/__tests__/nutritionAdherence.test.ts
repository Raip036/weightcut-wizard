import { describe, it, expect } from "vitest";
import { computeNutritionAdherence } from "../subScores/nutritionAdherence";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

function dayMeals(date: string, calories: number, proteinG: number) {
  return { date, calories, proteinG };
}

describe("computeNutritionAdherence", () => {
  it("returns 100 when all 7 days hit calorie target within tolerance and protein met", () => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return dayMeals(d.toISOString().slice(0, 10), 2500, 180);
    });
    const r = computeNutritionAdherence(
      days, { calories: 2500, proteinG: 180 }, "2026-05-01", cfg,
    );
    expect(r.value).toBe(100);
  });
  it("penalises protein shortfall — 7 days at 50% protein → big deduction", () => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return dayMeals(d.toISOString().slice(0, 10), 2500, 90);
    });
    const r = computeNutritionAdherence(
      days, { calories: 2500, proteinG: 180 }, "2026-05-01", cfg,
    );
    expect(r.value).toBe(100 - 7 * cfg.nutrition.proteinPenaltyPerDay);
  });
  it("Fix #2: drops weight (50/weight:0) when no meals logged — missing data, not failure", () => {
    const r = computeNutritionAdherence(
      [], { calories: 2500, proteinG: 180 }, "2026-05-01", cfg,
    );
    expect(r.value).toBe(50);
    expect(r.weight).toBe(0);
    expect(r.reason).toMatch(/0 day/i);
  });
  it("returns 50 fallback when no targets configured", () => {
    const r = computeNutritionAdherence([], { calories: null, proteinG: null }, "2026-05-01", cfg);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/target/i);
  });

  describe("Fix #2 — missing-data drops weight (not failure)", () => {
    it("drops weight when only 1–2 days are logged in the 7-day window", () => {
      const r = computeNutritionAdherence(
        [
          { date: "2026-04-30", calories: 2500, proteinG: 180 },
          { date: "2026-05-01", calories: 2500, proteinG: 180 },
        ],
        { calories: 2500, proteinG: 180 },
        "2026-05-01",
        cfg,
      );
      expect(r.weight).toBe(0);
      expect(r.value).toBe(50);
      expect(r.reason).toMatch(/2 day/);
    });

    it("computes over logged days only (not /7) when ≥3 days are logged", () => {
      // 4 days at target, 3 days unlogged → score = 4/4 = 100, not 4/7 = 57.
      const days = [
        { date: "2026-04-28", calories: 2500, proteinG: 180 },
        { date: "2026-04-29", calories: 2500, proteinG: 180 },
        { date: "2026-04-30", calories: 2500, proteinG: 180 },
        { date: "2026-05-01", calories: 2500, proteinG: 180 },
      ];
      const r = computeNutritionAdherence(
        days, { calories: 2500, proteinG: 180 }, "2026-05-01", cfg,
      );
      expect(r.value).toBe(100);
      expect(r.reason).toMatch(/4\/4/);
    });
  });
});
