import { describe, it, expect } from "vitest";
import {
  assessCutFeasibility,
  weeksToWeighIn,
  MAX_WEEKLY_BW_FRACTION,
} from "../_shared/cutFeasibility";

/**
 * Unit tests for the cut-plan feasibility backstop. Locks in the 2.5%
 * bodyweight/week FAT-loss ceiling (pre-dehydration), the maintenance/
 * rehydration never-blocked carve-out, the float-borderline epsilon, and the
 * minWeeksNeeded math. Also exercises weeksToWeighIn's clamp against a fixed
 * "now" so it cannot drift from generateCutPlan's own computation.
 */

describe("assessCutFeasibility", () => {
  it("80kg -> 74kg (6kg) in 1 week is infeasible; minWeeksNeeded === 3", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 80,
      preDehydrationTargetKg: 74,
      weeksAvailable: 1,
    });
    expect(r.feasible).toBe(false);
    expect(r.fatLossKg).toBe(6);
    expect(r.maxPerWeekKg).toBeCloseTo(2.0, 9); // 0.025 * 80
    expect(r.perWeekKg).toBeCloseTo(6, 9);
    // ceil(6 / 2.0) = 3
    expect(r.minWeeksNeeded).toBe(3);
  });

  it("70kg -> 68kg (2kg) in 2 weeks is feasible (1.0 <= 1.75)", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 70,
      preDehydrationTargetKg: 68,
      weeksAvailable: 2,
    });
    expect(r.feasible).toBe(true);
    expect(r.fatLossKg).toBe(2);
    expect(r.perWeekKg).toBeCloseTo(1.0, 9);
    expect(r.maxPerWeekKg).toBeCloseTo(1.75, 9); // 0.025 * 70
  });

  it("80kg -> 76kg (4kg) in 2 weeks is feasible at exactly 2.5% (2.0 <= 2.0)", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 80,
      preDehydrationTargetKg: 76,
      weeksAvailable: 2,
    });
    // Borderline: perWeek 2.0 === maxPerWeek 2.0 — must pass via epsilon.
    expect(r.perWeekKg).toBeCloseTo(2.0, 9);
    expect(r.maxPerWeekKg).toBeCloseTo(2.0, 9);
    expect(r.feasible).toBe(true);
  });

  it("70kg -> 66kg (4kg) in 1 week is infeasible (4 > 1.75); minWeeksNeeded === 3", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 70,
      preDehydrationTargetKg: 66,
      weeksAvailable: 1,
    });
    expect(r.feasible).toBe(false);
    expect(r.fatLossKg).toBe(4);
    expect(r.maxPerWeekKg).toBeCloseTo(1.75, 9);
    // ceil(4 / 1.75) = ceil(2.285...) = 3
    expect(r.minWeeksNeeded).toBe(3);
  });

  it("target >= current (70kg -> 72kg) is feasible: no fat to lose, minWeeksNeeded 0", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 70,
      preDehydrationTargetKg: 72,
      weeksAvailable: 1,
    });
    expect(r.feasible).toBe(true);
    expect(r.fatLossKg).toBe(0);
    expect(r.perWeekKg).toBe(0);
    expect(r.minWeeksNeeded).toBe(0);
  });

  it("degenerate current weight <= 0 is feasible (never blocked)", () => {
    const r = assessCutFeasibility({
      currentWeightKg: 0,
      preDehydrationTargetKg: -5,
      weeksAvailable: 1,
    });
    expect(r.feasible).toBe(true);
    expect(r.minWeeksNeeded).toBe(0);
  });

  it("MAX_WEEKLY_BW_FRACTION is the documented 2.5%", () => {
    expect(MAX_WEEKLY_BW_FRACTION).toBe(0.025);
  });
});

describe("weeksToWeighIn", () => {
  // Fixed "now" so the clamp is deterministic and mirrors generateCutPlan.
  const NOW = Date.parse("2026-01-01T00:00:00.000Z");

  it("a fight ~6 weeks out, day_before weigh-in, clamps to 6 whole weeks", () => {
    // 2026-01-01 -> 2026-02-12 is 42 days; day_before weigh-in = 2026-02-11
    // = 41 days out -> ceil(41/7) = 6.
    const weeks = weeksToWeighIn("2026-02-12", "day_before", NOW);
    expect(weeks).toBe(6);
  });

  it("same_day weigh-in uses the fight date directly", () => {
    // 2026-01-01 -> 2026-02-12 is 42 days -> ceil(42/7) = 6.
    const weeks = weeksToWeighIn("2026-02-12", "same_day", NOW);
    expect(weeks).toBe(6);
  });

  it("clamps to a minimum of 1 week when the fight is today/past", () => {
    expect(weeksToWeighIn("2026-01-01", "same_day", NOW)).toBe(1);
    expect(weeksToWeighIn("2025-12-01", "same_day", NOW)).toBe(1);
  });

  it("clamps to a maximum of 20 weeks for far-off fights", () => {
    // ~3 years out, well past the 20-week ceiling.
    expect(weeksToWeighIn("2029-01-01", "same_day", NOW)).toBe(20);
  });
});
