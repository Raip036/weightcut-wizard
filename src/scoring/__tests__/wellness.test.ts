import { describe, it, expect } from "vitest";
import { computeWellness } from "../subScores/wellness";
import { ScoringConfigV1 } from "../config/v1";

/**
 * Wellness sub-score: linear map over the Hooper EMA (HIGHER = better),
 * matching the survey convention and the config (`hooperFloor: 4`,
 * `hooperScalar: 4.2`):
 *   Hooper 4  → 0
 *   Hooper 16 → ~50
 *   Hooper 28 → 100
 */
function sevenDaysOf(hooper: number): Array<{ date: string; hooper: number }> {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date("2026-05-01");
    d.setDate(d.getDate() - i);
    return { date: d.toISOString().slice(0, 10), hooper };
  });
}

describe("computeWellness", () => {
  it("Hooper 28 (great day) → 100 (regression: used to score 0)", () => {
    const r = computeWellness(sevenDaysOf(28), "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(100);
    expect(r.reason).toMatch(/fresh/i);
  });

  it("Hooper 4 (wrung out) → 0", () => {
    const r = computeWellness(sevenDaysOf(4), "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(0);
    expect(r.reason).toMatch(/fatigue|stress/i);
  });

  it("Hooper 16 (moderate) → ~50", () => {
    const r = computeWellness(sevenDaysOf(16), "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(50);
  });

  it("is monotonic increasing in Hooper (higher = better)", () => {
    const low = computeWellness(sevenDaysOf(10), "2026-05-01", ScoringConfigV1).value;
    const mid = computeWellness(sevenDaysOf(18), "2026-05-01", ScoringConfigV1).value;
    const high = computeWellness(sevenDaysOf(26), "2026-05-01", ScoringConfigV1).value;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("clamps to 0..100 outside the floor/scalar range", () => {
    expect(computeWellness(sevenDaysOf(2), "2026-05-01", ScoringConfigV1).value).toBe(0);
    expect(computeWellness(sevenDaysOf(30), "2026-05-01", ScoringConfigV1).value).toBe(100);
  });

  it("returns 50 fallback with no check-ins", () => {
    const r = computeWellness([], "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(50);
    expect(r.weight).toBe(0);
    expect(r.reason).toMatch(/no.*check-in/i);
  });
});
