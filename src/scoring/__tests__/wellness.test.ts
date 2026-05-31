import { describe, it, expect } from "vitest";
import { computeWellness } from "../subScores/wellness";
import { ScoringConfigV1 } from "../config/v1";

/**
 * Wellness sub-score: new linear curve over Hooper EMA (lower = fresher).
 *   Hooper EMA <= 5 → 100
 *   Hooper EMA >= 8 → 0
 *   linear 100*(8-ema)/3 between
 */
describe("computeWellness", () => {
  it("pivot: Hooper 5 → 100 (top of curve)", () => {
    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), hooper: 5 };
    });
    const r = computeWellness(data, "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(100);
  });

  it("returns 100 when Hooper is well below the freshness threshold (4)", () => {
    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), hooper: 4 };
    });
    const r = computeWellness(data, "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(100);
  });

  it("pivot: Hooper 6.5 → 50 (midpoint of ramp)", () => {
    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), hooper: 6.5 };
    });
    const r = computeWellness(data, "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(50);
  });

  it("pivot: Hooper 8 → 0 (bottom of curve)", () => {
    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), hooper: 8 };
    });
    const r = computeWellness(data, "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(0);
  });

  it("floors at 0 when Hooper EMA is well above the high-fatigue threshold", () => {
    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), hooper: 14 };
    });
    const r = computeWellness(data, "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(0);
  });

  it("returns 50 fallback with no check-ins", () => {
    const r = computeWellness([], "2026-05-01", ScoringConfigV1);
    expect(r.value).toBe(50);
    expect(r.reason).toMatch(/no.*check-in/i);
  });
});
