import { describe, it, expect } from "vitest";
import { maintenanceMacros } from "../_shared/math";

describe("maintenanceMacros", () => {
  it("returns calories equal to the rounded TDEE", () => {
    const r = maintenanceMacros(2801.6, 75);
    expect(r.calories).toBe(2802);
  });

  it("uses medium-day macros (protein ~1.9 g/kg)", () => {
    const r = maintenanceMacros(2800, 75);
    // 1.9 g/kg * 75kg = ~142.5g, rounded by macroForDay
    expect(r.protein_g).toBeGreaterThanOrEqual(140);
    expect(r.protein_g).toBeLessThanOrEqual(146);
    // carbs fill the remainder => dominant macro at maintenance
    expect(r.carbs_g).toBeGreaterThan(r.protein_g);
    expect(r.fats_g).toBeGreaterThan(0);
  });

  it("never returns negative macros for a low-weight athlete", () => {
    const r = maintenanceMacros(1600, 50);
    expect(r.protein_g).toBeGreaterThan(0);
    expect(r.carbs_g).toBeGreaterThanOrEqual(0);
    expect(r.fats_g).toBeGreaterThan(0);
  });
});
