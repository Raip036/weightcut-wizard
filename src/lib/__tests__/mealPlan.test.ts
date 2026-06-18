import { describe, it, expect } from "vitest";
import { clampMealCount, computePlanTotals, isOnTarget } from "../mealPlan";
import type { DayPlanMeal } from "@/pages/nutrition/types";

const meal = (p: number, c: number, f: number): DayPlanMeal => ({
  id: "x", name: "m", type: "lunch", timingLabel: "Lunch", calories: p * 4 + c * 4 + f * 9,
  protein: p, carbs: c, fats: f, why: "", prep: "", ingredients: [],
});

describe("clampMealCount", () => {
  it("clamps below range up to 3", () => expect(clampMealCount(1)).toBe(3));
  it("clamps above range down to 6", () => expect(clampMealCount(9)).toBe(6));
  it("keeps in-range values", () => expect(clampMealCount(4)).toBe(4));
  it("defaults non-numbers to 4", () => expect(clampMealCount(NaN)).toBe(4));
});

describe("computePlanTotals", () => {
  it("sums macros and derives 4/4/9 kcal", () => {
    const totals = computePlanTotals([meal(40, 50, 10), meal(20, 30, 5)]);
    expect(totals.protein).toBe(60);
    expect(totals.carbs).toBe(80);
    expect(totals.fats).toBe(15);
    expect(totals.kcal).toBe(60 * 4 + 80 * 4 + 15 * 9);
  });
});

describe("isOnTarget", () => {
  const target = { kcal: 2000, protein: 150, carbs: 200, fats: 60 };
  it("true within 5% kcal and macro tolerance", () => {
    expect(isOnTarget({ kcal: 1960, protein: 148, carbs: 203, fats: 59 }, target)).toBe(true);
  });
  it("false when kcal off by >5%", () => {
    expect(isOnTarget({ kcal: 1700, protein: 150, carbs: 200, fats: 60 }, target)).toBe(false);
  });
});
