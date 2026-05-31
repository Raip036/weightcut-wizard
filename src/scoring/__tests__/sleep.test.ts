import { describe, it, expect } from "vitest";
import { computeSleep } from "../subScores/sleep";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

function genSleep(date: string, hours: number) { return { date, hours }; }

function week(asOf: string, hoursPerNight: number) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(asOf + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    out.push(genSleep(d.toISOString().slice(0, 10), hoursPerNight));
  }
  return out;
}

/**
 * Sleep sub-score: new linear curve over average hours per logged night.
 *   avg >= 7.5h → 100
 *   avg <= 5.5h → 0
 *   linear 100*(avg-5.5)/2.0 between
 */
describe("computeSleep", () => {
  it("returns 100 when full 8h × 7 nights", () => {
    const r = computeSleep(week("2026-05-01", 8), "2026-05-01", cfg);
    expect(r.value).toBe(100);
  });

  it("pivot: avg = 7.5h → 100 (top of curve)", () => {
    const r = computeSleep(week("2026-05-01", 7.5), "2026-05-01", cfg);
    expect(r.value).toBe(100);
  });

  it("pivot: avg = 6.5h → 50 (midpoint of ramp)", () => {
    const r = computeSleep(week("2026-05-01", 6.5), "2026-05-01", cfg);
    expect(r.value).toBe(50);
  });

  it("pivot: avg = 5.5h → 0 (bottom of curve)", () => {
    const r = computeSleep(week("2026-05-01", 5.5), "2026-05-01", cfg);
    expect(r.value).toBe(0);
  });

  it("floors at 0 for catastrophic debt", () => {
    const r = computeSleep(week("2026-05-01", 2), "2026-05-01", cfg);
    expect(r.value).toBe(0);
  });

  it("drops weight (50/weight:0) when no logs in 7-day window", () => {
    const r = computeSleep([], "2026-05-01", cfg);
    expect(r.value).toBe(50);
    expect(r.weight).toBe(0);
    expect(r.reason).toMatch(/no sleep/i);
  });

  describe("Missing-data drop + per-night averaging", () => {
    it("drops weight when < 3 nights logged in window", () => {
      const logs = [
        { date: "2026-04-30", hours: 7 },
        { date: "2026-05-01", hours: 7 },
      ];
      const r = computeSleep(logs, "2026-05-01", cfg);
      expect(r.weight).toBe(0);
      expect(r.value).toBe(50);
      expect(r.reason).toMatch(/2 night/);
    });

    it("computes per-night avg over logged nights only (4 nights at 7h → 75)", () => {
      // 4 nights at 7h, 3 nights unlogged. Per-night avg = 7h → 100*(7-5.5)/2 = 75.
      const logs = [
        { date: "2026-04-28", hours: 7 },
        { date: "2026-04-29", hours: 7 },
        { date: "2026-04-30", hours: 7 },
        { date: "2026-05-01", hours: 7 },
      ];
      const r = computeSleep(logs, "2026-05-01", cfg);
      expect(r.value).toBe(75);
      expect(r.weight).toBe(0); // weight is assigned by compose.ts; sub-score reports 0.
    });

    it("7h × 7 nights → 75 (new linear curve)", () => {
      const r = computeSleep(week("2026-05-01", 7), "2026-05-01", cfg);
      expect(r.value).toBe(75);
    });

    it("6h × 7 nights → 25 (midway from 5.5 to 6.5 → halfway up the ramp)", () => {
      // 100*(6-5.5)/2 = 25
      const r = computeSleep(week("2026-05-01", 6), "2026-05-01", cfg);
      expect(r.value).toBe(25);
    });

    it("5h × 7 nights → 0 (below ramp floor)", () => {
      const r = computeSleep(week("2026-05-01", 5), "2026-05-01", cfg);
      expect(r.value).toBe(0);
    });
  });

  describe("assumedSleepDates", () => {
    it("treats a 7h assumed entry like a real log so the target day isn't penalised", () => {
      // 6 prior nights at 8h + assumed 7h today → avg = (6*8 + 7)/7 = 7.857h.
      // 7.857 >= 7.5 → score 100.
      const real = week("2026-05-01", 8).filter((s) => s.date !== "2026-05-01");
      const withAssumed = [...real, { date: "2026-05-01", hours: 7 }];
      const r = computeSleep(withAssumed, "2026-05-01", cfg, ["2026-05-01"]);
      expect(r.value).toBe(100);
    });

    it("appends an 'assumed' annotation to the reason when an in-window date matches", () => {
      const real = week("2026-05-01", 8).filter((s) => s.date !== "2026-05-01");
      const withAssumed = [...real, { date: "2026-05-01", hours: 7 }];
      const r = computeSleep(withAssumed, "2026-05-01", cfg, ["2026-05-01"]);
      expect(r.reason).toMatch(/assumed 7h on 1 day/);
    });

    it("doesn't annotate when the assumed date is outside the 7-day window", () => {
      // Assumed date is 30 days ago — outside the 7-day window so it shouldn't bleed into reason text.
      const r = computeSleep(week("2026-05-01", 8), "2026-05-01", cfg, ["2026-04-01"]);
      expect(r.reason).not.toMatch(/assumed/);
      expect(r.value).toBe(100);
    });

    it("is a no-op when assumedSleepDates is omitted (back-compat)", () => {
      const r = computeSleep(week("2026-05-01", 8), "2026-05-01", cfg);
      expect(r.value).toBe(100);
      expect(r.reason).not.toMatch(/assumed/);
    });
  });
});
