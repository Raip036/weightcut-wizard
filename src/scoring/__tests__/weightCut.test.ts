import { describe, it, expect } from "vitest";
import { computeWeightCut } from "../subScores/weightCut";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

describe("computeWeightCut", () => {
  it("returns 100 when rate is in sustainable band (0.7%/wk)", () => {
    // 80kg → 79.44kg over 7 days = 0.7% loss
    const weights = [
      { date: "2026-04-24", weightKg: 80 },
      { date: "2026-05-01", weightKg: 79.44 },
    ];
    const r = computeWeightCut(
      { weights, startingWeightKg: 80, goalWeightKg: 75, campStartDate: "2026-04-24", fightDate: "2026-06-24" },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBeGreaterThanOrEqual(90);
  });
  it("penalises dangerous cut rate (>2%/wk)", () => {
    const weights = [
      { date: "2026-04-24", weightKg: 80 },
      { date: "2026-05-01", weightKg: 78 }, // 2.5% in a week
    ];
    const r = computeWeightCut(
      { weights, startingWeightKg: 80, goalWeightKg: 75, campStartDate: "2026-04-24", fightDate: "2026-06-24" },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBeLessThanOrEqual(30);
  });
  it("returns 50 when no weight data yet", () => {
    const r = computeWeightCut(
      { weights: [], startingWeightKg: 80, goalWeightKg: 75, campStartDate: "2026-04-24", fightDate: "2026-06-24" },
      "2026-05-01",
      cfg,
    );
    expect(r.value).toBe(50);
  });

  describe("Fix #4 — plateau distinct from gaining, smooth ramp, week-floor", () => {
    it("plateau (≤ |0.05%/wk|) → 50 (no goal so no on-pace penalty)", () => {
      // 80 → 79.98kg over 14 days = 0.025%/wk, inside the dead band.
      // goalWeightKg = current so on-pace penalty doesn't fire (kgRemaining ≤ 0).
      const weights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 79.98 },
      ];
      const r = computeWeightCut(
        { weights, startingWeightKg: 80, goalWeightKg: 79.98, campStartDate: "2026-04-17", fightDate: "2026-07-01" },
        "2026-05-01",
        cfg,
      );
      expect(r.value).toBe(50);
    });

    it("plateau (≤ |0.05%/wk|) is DISTINCT from gaining — score should differ", () => {
      // Both with the same goal/fight setup so the on-pace penalty is the
      // same constant offset — what we're isolating is the band difference.
      const plateauWeights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 79.98 }, // ≈0.025%/wk (flat)
      ];
      const gainingWeights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 80.5 },  // +0.31%/wk (gaining)
      ];
      const baseInput = {
        startingWeightKg: 80, goalWeightKg: 75,
        campStartDate: "2026-04-17", fightDate: "2026-07-01",
      };
      const plateau = computeWeightCut({ ...baseInput, weights: plateauWeights }, "2026-05-01", cfg);
      const gaining = computeWeightCut({ ...baseInput, weights: gainingWeights }, "2026-05-01", cfg);
      // Pre-fix: both were 30 → 20 with penalty. Post-fix: plateau ≠ gaining.
      expect(plateau.value).toBeGreaterThan(gaining.value);
    });

    it("gaining > 0.05%/wk → 30 (no on-pace penalty path)", () => {
      // Use a fight date so close + a goal already met so kgRemaining ≤ 0.
      const weights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 80.5 },
      ];
      const r = computeWeightCut(
        { weights, startingWeightKg: 80, goalWeightKg: 81, campStartDate: "2026-04-17", fightDate: "2026-07-01" },
        "2026-05-01",
        cfg,
      );
      expect(r.value).toBe(30);
    });

    it("smooth ramp 50 → 100 across (0.05%, 0.3%]/wk — no discontinuity at 0+", () => {
      // 80 → 79.7kg over 14 days = ~0.187%/wk (between the dead-band edge
      // 0.05 and sustainable-band start 0.3). With goal already met no
      // on-pace penalty fires. Expected: ≈ 50 + (0.187-0.05)/0.25 * 50 ≈ 77.
      const weights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 79.7 },
      ];
      const r = computeWeightCut(
        { weights, startingWeightKg: 80, goalWeightKg: 79.7, campStartDate: "2026-04-17", fightDate: "2026-07-01" },
        "2026-05-01",
        cfg,
      );
      // Must be strictly above 50 (proves smooth ramp) and below 100 (proves
      // we're below the sustainable band).
      expect(r.value).toBeGreaterThan(50);
      expect(r.value).toBeLessThan(100);
    });

    it("no discontinuity at rate=0+: rates just above the dead-band give scores near 50, not 60", () => {
      // Pick a rate just above PLATEAU_BAND (0.05%/wk): 80 → 79.985 over 14 days
      // = ~0.067%/wk. Old code jumped to 60+ here; new code starts smoothly
      // from 50.
      const weights = [
        { date: "2026-04-17", weightKg: 80 },
        { date: "2026-05-01", weightKg: 79.985 },
      ];
      const r = computeWeightCut(
        { weights, startingWeightKg: 80, goalWeightKg: 79.985, campStartDate: "2026-04-17", fightDate: "2026-07-01" },
        "2026-05-01",
        cfg,
      );
      expect(r.value).toBeGreaterThanOrEqual(50);
      expect(r.value).toBeLessThanOrEqual(58); // smooth, not a 60→jump
    });

    it("same-day weigh-ins don't blow up the rate (week-floor)", () => {
      // Two weigh-ins on the same day: 80 → 79.5. Without the floor that's
      // ∞%/wk. With max(7, days) floor it's 0.5/80/1 * 100 = 0.625%/wk —
      // well inside the sustainable band.
      const weights = [
        { date: "2026-05-01", weightKg: 80 },
        { date: "2026-05-01", weightKg: 79.5 },
      ];
      const r = computeWeightCut(
        { weights, startingWeightKg: 80, goalWeightKg: 75, campStartDate: "2026-05-01", fightDate: "2026-07-01" },
        "2026-05-01",
        cfg,
      );
      // 0.625%/wk is inside [0.3, 1.0] sustainable → 100. on-pace penalty
      // may not fire because daysToFight is large; but value must NOT be
      // the catastrophic 20 of an unfloored danger-band cut.
      expect(r.value).toBeGreaterThanOrEqual(60);
    });
  });
});
