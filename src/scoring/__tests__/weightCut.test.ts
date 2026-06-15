import { describe, it, expect } from "vitest";
import { computeWeightCut } from "../subScores/weightCut";
import { resolvePlanWeek } from "../planWeek";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

/**
 * Tests for the rewritten `computeWeightCut`: weekly-plan adherence.
 *
 * The score compares the latest weight log to THIS WEEK'S target weight
 * (sourced from `cutPlanJson.weeklyPlan[].targetWeight` or a linear interp
 * fallback from `startingWeightKg → goalWeightKg`). The grading bands are:
 *
 *   delta ∈ [-0.5, +0.3] kg → 100
 *   delta ∈ (+0.3, +1.5)    → linear 100 → 0
 *   delta ≥ +1.5            → 0
 *   delta ∈ (-1.5, -0.5)    → linear 100 → 0 (too aggressive)
 *   delta ≤ -1.5            → 0
 *
 * Most tests below pin an explicit `cutPlanJson` so the week target is
 * deterministic (76.0 kg) regardless of how the engine resolves week index
 * from the camp dates.
 */

// 8-week plan with week-3 target pinned to 76.0 kg. The test scenarios all
// use asOfDate inside week 3 of camp so this row drives the score.
const plan = {
  totalWeeks: 8,
  weeklyPlan: [
    { week: 1, targetWeight: 79.0 },
    { week: 2, targetWeight: 77.5 },
    { week: 3, targetWeight: 76.0 },
    { week: 4, targetWeight: 75.5 },
    { week: 5, targetWeight: 75.0 },
    { week: 6, targetWeight: 74.5 },
    { week: 7, targetWeight: 74.0 },
    { week: 8, targetWeight: 73.5 },
  ],
};

// asOf 2026-05-08, camp starts 2026-04-24 → 14 days = floor(14/7)+1 = 3 weeks.
const asOf = "2026-05-08";
const baseEnv = {
  startingWeightKg: 80,
  goalWeightKg: 73.5,
  campStartDate: "2026-04-24",
  fightDate: "2026-06-19", // ~8 weeks
  cutPlanJson: plan,
};

describe("computeWeightCut (weekly-plan adherence)", () => {
  it("returns 100 when weight is on this week's target", () => {
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 76.0 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(100);
    expect(r.reason).toMatch(/on target/i);
  });

  it("scores 100 when slightly ahead of plan (-0.4 kg under target)", () => {
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 75.6 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(100);
    expect(r.reason).toMatch(/ahead/i);
  });

  it("scores 100 when 0.3 kg behind target (still inside the band)", () => {
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 76.3 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(100);
  });

  it("scores ~50 when ~0.9 kg behind target (midway in 0.3→1.5 ramp)", () => {
    // delta=+0.9 → 100*(1-(0.9-0.3)/1.2) = 50.
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 76.9 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/behind/i);
  });

  it("scores 0 when ≥1.5 kg over target (significant deviation)", () => {
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 77.5 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(0);
    expect(r.reason).toMatch(/significant deviation/i);
  });

  it("scores ~50 when 1.0 kg ahead of plan (midway in -0.5 → -1.5 aggressive ramp)", () => {
    // delta=-1.0 → 100*(1-(1.0-0.5)/1.0) = 50.
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 75.0 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/risk|aggressive|fast|faster/i);
  });

  it("scores 0 when ≥1.5 kg under target (cutting dangerously fast)", () => {
    // delta=-1.6 → < -1.5 → 0.
    const r = computeWeightCut(
      { ...baseEnv, weights: [{ date: asOf, weightKg: 74.4 }] },
      asOf, cfg,
    );
    expect(r.value).toBe(0);
    expect(r.reason).toMatch(/danger/i);
  });

  it("returns weight:0 + paused reason when no plan AND no camp", () => {
    const r = computeWeightCut(
      {
        weights: [{ date: "2026-05-01", weightKg: 80 }],
        startingWeightKg: null,
        goalWeightKg: null,
        campStartDate: null,
        fightDate: null,
      },
      "2026-05-01", cfg,
    );
    expect(r.weight).toBe(0);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/paused/i);
  });

  it("returns weight:0 + paused reason when no weight logs yet", () => {
    const r = computeWeightCut(
      {
        weights: [],
        startingWeightKg: 80,
        goalWeightKg: 75,
        campStartDate: "2026-04-24",
        fightDate: "2026-06-19",
      },
      "2026-05-01", cfg,
    );
    expect(r.weight).toBe(0);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/paused/i);
  });

  describe("cutPlanJson.weeklyPlan resolution", () => {
    it("picks the correct week from weeklyPlan based on weeksSinceCampStart", () => {
      // asOf 2026-05-08 = 14 days post-camp-start → week 3 → target 76.0 kg.
      const r = computeWeightCut(
        { ...baseEnv, weights: [{ date: asOf, weightKg: 76.0 }] },
        asOf, cfg,
      );
      expect(r.value).toBe(100);
    });

    it("week-7 plan row drives scoring on the corresponding day", () => {
      // 2026-04-24 + 42d = 2026-06-05 → weeksSinceStart = floor(42/7)+1 = 7.
      const w7Date = "2026-06-05";
      const r = computeWeightCut(
        { ...baseEnv, weights: [{ date: w7Date, weightKg: 74.0 }] },
        w7Date, cfg,
      );
      expect(r.value).toBe(100);
    });

    it("anchors the week on fightDate (not campStartDate) so the target matches the Camp Status widget", () => {
      // Regression for the cross-app non-uniformity bug: the score used to
      // anchor the week index on the earliest weight-log date (campStartDate),
      // while the dashboard Camp Status widget anchors on fightDate −
      // totalWeeks×7. Here the user logged their first weight LATE (mid-camp),
      // so the two anchors diverge:
      //   fight-date anchor  → planStart 2026-04-24, asOf +14d → week 3 (76.0)
      //   campStart anchor   → campStart 2026-05-08, asOf +0d  → week 1 (79.0)
      // The score must use the fight-date anchor (76.0), matching the widget.
      const lateCampStart = "2026-05-08"; // first logged weight = asOf
      const r = computeWeightCut(
        {
          ...baseEnv,
          campStartDate: lateCampStart,
          weights: [{ date: asOf, weightKg: 76.0 }],
        },
        asOf, cfg,
      );
      // 76.0 is exactly week 3's target → on-target (100). Were it still using
      // the campStart anchor it would grade against week 1 (79.0): delta -3 → 0.
      expect(r.value).toBe(100);
      expect(r.meta?.targetKg).toBe(76.0);
      expect(r.meta?.weekNumber).toBe(3);

      // ...and it equals what the widget's shared resolver returns for the
      // same inputs — one source of truth.
      const widget = resolvePlanWeek({
        asOfDate: asOf,
        fightDate: baseEnv.fightDate,
        weeklyPlan: plan.weeklyPlan,
        totalWeeks: plan.totalWeeks,
      });
      expect(widget?.targetWeight).toBe(r.meta?.targetKg);
      expect(widget?.week).toBe(r.meta?.weekNumber);
    });

    it("falls back to linear interp from start→goal when plan is missing", () => {
      // No cutPlanJson → linear interp. 8 weeks, week 3 of 8:
      // 80 + (73.5 - 80) * (3/8) = 80 - 2.4375 = 77.5625.
      // currentWeight 77.5 → delta = -0.0625 → score 100.
      const r = computeWeightCut(
        {
          weights: [{ date: asOf, weightKg: 77.5 }],
          startingWeightKg: 80,
          goalWeightKg: 73.5,
          campStartDate: "2026-04-24",
          fightDate: "2026-06-19",
        },
        asOf, cfg,
      );
      expect(r.value).toBe(100);
    });
  });
});
