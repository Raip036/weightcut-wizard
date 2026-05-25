import { describe, it, expect } from "vitest";
import { computeNutritionAdherence } from "../subScores/nutritionAdherence";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

function dayMeals(date: string, calories: number, proteinG = 100) {
  return { date, calories, proteinG };
}

function isoBack(days: number, from = "2026-05-01") {
  const d = new Date(from + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe("computeNutritionAdherence (v2 — calorie-only soft falloff)", () => {
  it("returns 100 when all 7 days are dead-on calorie target", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      dayMeals(isoBack(i), 2500),
    );
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(100);
    expect(r.weight).toBe(0); // assigned by compose.ts when subScoreHasData is true
  });

  it("hands out 75 for ±20% drift on every day", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      dayMeals(isoBack(i), 2000), // 20% under 2500 target
    );
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(75);
  });

  it("hands out 40 for ±30% drift on every day", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      dayMeals(isoBack(i), 1750),
    );
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(40);
  });

  it("drops to 0 once drift exceeds ±40% on every day", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      dayMeals(isoBack(i), 1400), // 44% under 2500
    );
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(0);
  });

  it("ignores protein entirely — low protein no longer reduces the score", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      dayMeals(isoBack(i), 2500, 30), // way under 180g target
    );
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(100);
  });

  it("skips partial-log days (<30% of target kcal) as 'incomplete log'", () => {
    // 4 fully-logged days at target + 3 sparse days at 200 kcal — sparse
    // days should be skipped, score = 100 (not punished as starvation).
    const days = [
      dayMeals(isoBack(0), 2500),
      dayMeals(isoBack(1), 2500),
      dayMeals(isoBack(2), 2500),
      dayMeals(isoBack(3), 2500),
      dayMeals(isoBack(4), 200),
      dayMeals(isoBack(5), 200),
      dayMeals(isoBack(6), 200),
    ];
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(100);
    expect(r.reason).toMatch(/partial/);
  });

  it("drops weight when <3 fully-logged days in last 7", () => {
    const r = computeNutritionAdherence(
      [
        dayMeals(isoBack(0), 2500),
        dayMeals(isoBack(1), 2500),
      ],
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.weight).toBe(0);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/2 day/);
  });

  it("drops weight when no meals logged", () => {
    const r = computeNutritionAdherence(
      [],
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.weight).toBe(0);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/0 day/);
  });

  it("returns 50/no-target fallback when calorie target missing", () => {
    const r = computeNutritionAdherence(
      [],
      { calories: null, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/target/i);
  });

  it("averages per-day scores over fully-logged days only (regression of v1 'days/7' bug)", () => {
    // 4 days logged perfectly, 3 days un-logged → 100/100 not 4/7.
    const days = [
      dayMeals(isoBack(0), 2500),
      dayMeals(isoBack(1), 2500),
      dayMeals(isoBack(2), 2500),
      dayMeals(isoBack(3), 2500),
    ];
    const r = computeNutritionAdherence(
      days,
      { calories: 2500, proteinG: 180 },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(100);
  });
});
