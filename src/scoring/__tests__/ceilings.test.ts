import { describe, it, expect } from "vitest";
import { applyCeilings, latchCeilings } from "../ceilings";
import { ScoringConfigV1 } from "../config/v1";

// All existing tests use signals that pass the cold-start guard so that the
// pre-existing rule behaviour is preserved. The new tests at the bottom cover
// the cold-start regression directly.
const baseGuards = { trainingDaysIn28d: 20, acuteLoad: 2000, latestHooper: 12 };

describe("applyCeilings", () => {
  it("does NOT cap weight_cut_dangerous at only 3 consecutive days (below new 5-day threshold)", () => {
    const r = applyCeilings(80, {
      weightCutDangerousDays: 3,
      sleepDebt7d: 0,
      acwr: 1.0,
      ...baseGuards,
    }, ScoringConfigV1);
    expect(r.score).toBe(80);
    expect(r.applied).toBeNull();
  });

  it("caps at 65 when weight cut is dangerous for 5+ consecutive days", () => {
    const r = applyCeilings(80, {
      weightCutDangerousDays: 5,
      sleepDebt7d: 0,
      acwr: 1.0,
      ...baseGuards,
    }, ScoringConfigV1);
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("weight_cut_dangerous");
    expect(r.applied?.cap).toBe(65);
  });

  it("does not cap when no flags", () => {
    const r = applyCeilings(75, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 5,
      acwr: 1.0,
      ...baseGuards,
    }, ScoringConfigV1);
    expect(r.score).toBe(75);
    expect(r.applied).toBeNull();
  });

  it("picks the lowest cap when multiple apply", () => {
    const r = applyCeilings(90, {
      weightCutDangerousDays: 5,
      sleepDebt7d: 12,
      acwr: 2.5,
      ...baseGuards,
    }, ScoringConfigV1);
    // sleep_debt cap (65) ties with weight_cut_dangerous (65); training_spike
    // is now 60 — the lowest of the three.
    expect(r.score).toBe(60);
    expect(r.applied?.ruleId).toBe("training_spike");
    expect(r.applied?.cap).toBe(60);
  });

  it("still caps sleep_debt at 65 when sleepDebt7d > 10 (threshold unchanged)", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 11,
      acwr: 1.0,
      ...baseGuards,
    }, ScoringConfigV1);
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("sleep_debt");
    expect(r.applied?.cap).toBe(65);
  });

  it("does NOT cap sleep_debt when sleepDebt7d is 0 (regression: no sleep logs case)", () => {
    // Fix 1 (sleepDebt7d) returns 0 when no nights are logged. Verify the
    // ceiling does not fire on that zero value.
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 1.0,
      ...baseGuards,
    }, ScoringConfigV1);
    expect(r.score).toBe(85);
    expect(r.applied).toBeNull();
  });

  // ─── Cold-start regression tests ────────────────────────────────
  // Reproduces the original bug: one logged session against an empty 28-day
  // window produces an artificially huge ACWR. Without the gate the score
  // was wrongly capped at 45.

  it("does NOT fire training_spike with insufficient training days", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 4.0,
      trainingDaysIn28d: 1,     // only one session logged
      acuteLoad: 600,
      latestHooper: 12,
    }, ScoringConfigV1);
    expect(r.score).toBe(85);
    expect(r.applied).toBeNull();
  });

  it("does NOT fire training_spike when absolute weekly load is tiny", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 2.5,
      trainingDaysIn28d: 18,
      acuteLoad: 100,           // way below the 500 floor
      latestHooper: 12,
    }, ScoringConfigV1);
    expect(r.score).toBe(85);
    expect(r.applied).toBeNull();
  });

  it("does NOT fire training_spike when wellness check-in is good", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 2.5,
      trainingDaysIn28d: 18,
      acuteLoad: 1500,
      latestHooper: 20,         // Hooper 20/28 = Good
    }, ScoringConfigV1);
    expect(r.score).toBe(85);
    expect(r.applied).toBeNull();
  });

  it("does NOT fire training_spike at acwr=1.9 (below new 2.0 threshold)", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 1.9,
      trainingDaysIn28d: 18,
      acuteLoad: 1500,
      latestHooper: 12,
    }, ScoringConfigV1);
    expect(r.score).toBe(85);
    expect(r.applied).toBeNull();
  });

  it("DOES fire training_spike at acwr=2.1 (above new 2.0 threshold)", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 2.1,
      trainingDaysIn28d: 18,
      acuteLoad: 1500,
      latestHooper: 12,
    }, ScoringConfigV1);
    expect(r.score).toBe(60);
    expect(r.applied?.ruleId).toBe("training_spike");
    expect(r.applied?.cap).toBe(60);
  });

  it("DOES fire training_spike when all guards are passed", () => {
    const r = applyCeilings(85, {
      weightCutDangerousDays: 0,
      sleepDebt7d: 0,
      acwr: 2.5,
      trainingDaysIn28d: 18,
      acuteLoad: 1500,
      latestHooper: 12,
    }, ScoringConfigV1);
    expect(r.score).toBe(60);
    expect(r.applied?.ruleId).toBe("training_spike");
    expect(r.applied?.cap).toBe(60);
  });
});

describe("latchCeilings", () => {
  it("re-applies a recently-fired cap when its pillar is stale (escape attempt)", () => {
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-10",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }],
        staleDaysByRule: { sleep_debt: 6, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("sleep_debt");
  });

  it("releases the cap when the pillar has fresh data and no longer triggers", () => {
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-10",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }],
        staleDaysByRule: { sleep_debt: 1, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(90);
    expect(r.applied).toBeNull();
  });

  it("does not latch a cap older than the cooldown window", () => {
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-20",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }],
        staleDaysByRule: { sleep_debt: 12, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(90);
    expect(r.applied).toBeNull();
  });

  it("keeps the live cap when one is already applied (no-op)", () => {
    const r = latchCeilings(
      { score: 65, applied: { ruleId: "sleep_debt", cap: 65 } },
      { asOfDate: "2026-05-10", priorCeilings: [], staleDaysByRule: { sleep_debt: 0, weight_cut_dangerous: null, training_spike: null } },
      ScoringConfigV1,
    );
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("sleep_debt");
  });

  it("is a no-op when priorCeilings is empty", () => {
    const r = latchCeilings(
      { score: 88, applied: null },
      { asOfDate: "2026-05-10", priorCeilings: [], staleDaysByRule: { sleep_debt: 0, weight_cut_dangerous: null, training_spike: null } },
      ScoringConfigV1,
    );
    expect(r.score).toBe(88);
    expect(r.applied).toBeNull();
  });
});
