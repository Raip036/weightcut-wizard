import { describe, it, expect } from "vitest";
import { completenessFor, rollUpConfidence } from "../confidence";
import { ScoringConfigV1 } from "../config/v1";

describe("completenessFor", () => {
  it("is 1 when logged today", () => {
    expect(completenessFor(0, ScoringConfigV1.staleness.byPillar.sleep)).toBe(1);
  });
  it("is 0 when never logged (null staleDays)", () => {
    expect(completenessFor(null, ScoringConfigV1.staleness.byPillar.sleep)).toBe(0);
  });
  it("decreases linearly to 0 at the horizon", () => {
    expect(completenessFor(9, ScoringConfigV1.staleness.byPillar.sleep)).toBeCloseTo(0, 5);
    expect(completenessFor(4.5, ScoringConfigV1.staleness.byPillar.sleep)).toBeCloseTo(0.5, 5);
  });
});

describe("rollUpConfidence", () => {
  it("is the weight-weighted mean of present pillars' completeness", () => {
    const c = rollUpConfidence([
      { weight: 0.25, completeness: 1 },
      { weight: 0.25, completeness: 0.5 },
      { weight: 0, completeness: 0 }, // excluded
    ]);
    expect(c).toBeCloseTo(0.75, 5);
  });
  it("is 0 when no pillar is present", () => {
    expect(rollUpConfidence([{ weight: 0, completeness: 0.9 }])).toBe(0);
  });
});
