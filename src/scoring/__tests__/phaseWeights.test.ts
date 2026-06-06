import { describe, it, expect } from "vitest";
import { resolvePhase, weightsForPhase } from "../phaseWeights";
import { ScoringConfigV1 } from "../config/v1";

describe("phase resolution", () => {
  it("returns 'build' when >14 days to fight", () => {
    expect(resolvePhase("2026-05-01", "2026-06-01", ScoringConfigV1)).toBe("build");
  });
  it("returns 'peak' when 7–14 days to fight", () => {
    expect(resolvePhase("2026-05-01", "2026-05-12", ScoringConfigV1)).toBe("peak");
  });
  it("returns 'fightWeek' when ≤7 days to fight", () => {
    expect(resolvePhase("2026-05-01", "2026-05-05", ScoringConfigV1)).toBe("fightWeek");
  });
  it("weightsForPhase returns the right map (nutrition-rebalanced fightWeek split)", () => {
    const w = weightsForPhase("fightWeek", ScoringConfigV1);
    // Updated: nutrition now carries 0.15 weight; other pillars rebalanced.
    // Old values were 0.25/0.25/0.25/0.25/0 — changed due to nutrition-weight rebalance.
    expect(w.weightCut).toBe(0.30);       // was 0.25
    expect(w.trainingLoad).toBe(0.15);    // was 0.25
    expect(w.sleep).toBe(0.25);           // unchanged
    expect(w.wellness).toBe(0.15);        // was 0.25
    expect(w.nutritionAdherence).toBe(0.15); // was 0
  });
});
