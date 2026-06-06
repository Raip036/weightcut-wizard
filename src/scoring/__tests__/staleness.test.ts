import { describe, it, expect } from "vitest";
import { daysBetween, staleDaysFor, decayFactor, lastLogDates } from "../staleness";
import { ScoringConfigV1 } from "../config/v1";
import type { ScoringInputs } from "../types";

const emptyInputs = (): ScoringInputs => ({
  date: "2026-05-10", fightDate: "2026-06-15", campStartDate: "2026-04-01",
  startingWeightKg: 80, goalWeightKg: 75, currentWeightKg: 77,
  sessions: [], sleepHours: [], weights: [], hooperByDate: [], meals: [],
  targets: { calories: null, proteinG: null }, priorRawScores: [],
});

describe("daysBetween", () => {
  it("counts whole UTC days between two ISO dates", () => {
    expect(daysBetween("2026-05-01", "2026-05-10")).toBe(9);
    expect(daysBetween("2026-05-10", "2026-05-10")).toBe(0);
  });
});

describe("lastLogDates", () => {
  it("returns the max log date per pillar, null when empty", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }, { date: "2026-05-07", hours: 7 }];
    inputs.weights = [{ date: "2026-05-09", weightKg: 77 }];
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-07");
    expect(last.weightCut).toBe("2026-05-09");
    expect(last.wellness).toBeNull();
  });

  it("includes restDays in the trainingLoad recency", () => {
    const inputs = emptyInputs();
    inputs.sessions = [{ date: "2026-05-02", rpe: 7, durationMinutes: 45 }];
    inputs.restDays = ["2026-05-08"];
    const last = lastLogDates(inputs);
    expect(last.trainingLoad).toBe("2026-05-08");
  });

  it("treats a marked skip as recency for its pillar (pauses staleness)", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }];
    inputs.markedSkips = [{ date: "2026-05-09", pillar: "sleep" }];
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-09");
  });

  it("ignores a skip for a different pillar", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }];
    inputs.markedSkips = [{ date: "2026-05-09", pillar: "weightCut" }];
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-03");
  });
});

describe("staleDaysFor", () => {
  it("is 0 when logged on the as-of date", () => {
    expect(staleDaysFor("2026-05-10", "2026-05-10")).toBe(0);
  });
  it("counts days since last log", () => {
    expect(staleDaysFor("2026-05-04", "2026-05-10")).toBe(6);
  });
  it("returns null when never logged", () => {
    expect(staleDaysFor(null, "2026-05-10")).toBeNull();
  });
});

describe("decayFactor", () => {
  const cfg = ScoringConfigV1.staleness.byPillar.sleep; // grace 2, horizon 9, dMax 0.7

  it("is 0 within the grace window", () => {
    expect(decayFactor(2, cfg)).toBe(0);
    expect(decayFactor(1, cfg)).toBe(0);
  });
  it("ramps linearly past grace toward dMax at horizon", () => {
    expect(decayFactor(9, cfg)).toBeCloseTo(0.7, 5);
    expect(decayFactor(5, cfg)).toBeCloseTo(3 / 7, 5);
  });
  it("never exceeds dMax", () => {
    expect(decayFactor(100, cfg)).toBe(0.7);
  });
});
