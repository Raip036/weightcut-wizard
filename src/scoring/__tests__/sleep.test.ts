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

describe("computeSleep", () => {
  it("returns 100 when full 8h × 7 nights", () => {
    const r = computeSleep(week("2026-05-01", 8), "2026-05-01", cfg);
    expect(r.value).toBe(100);
  });
  it("Fix #3: per-night formula — 7h × 7 nights = 1h/night debt → 100 - 30 = 70", () => {
    const r = computeSleep(week("2026-05-01", 7), "2026-05-01", cfg);
    expect(r.value).toBe(70);
  });
  it("floors at 0 for catastrophic debt", () => {
    const r = computeSleep(week("2026-05-01", 2), "2026-05-01", cfg);
    expect(r.value).toBe(0);
  });
  it("Fix #3: drops weight (50/weight:0) when no logs in 7-day window", () => {
    const r = computeSleep([], "2026-05-01", cfg);
    expect(r.value).toBe(50);
    expect(r.weight).toBe(0);
    expect(r.reason).toMatch(/no sleep/i);
  });

  describe("Fix #3 — per-night debt + missing-data drop", () => {
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

    it("computes per-night debt from average of logged nights (4 nights at 7h → debt 1h/night → 70)", () => {
      // 4 nights at 7h, 3 nights unlogged. Old buggy formula would have
      // computed 28h/56h debt and bottomed out. Per-night avg = 7h, debt = 1h.
      const logs = [
        { date: "2026-04-28", hours: 7 },
        { date: "2026-04-29", hours: 7 },
        { date: "2026-04-30", hours: 7 },
        { date: "2026-05-01", hours: 7 },
      ];
      const r = computeSleep(logs, "2026-05-01", cfg);
      expect(r.value).toBe(70);
      expect(r.weight).toBe(0); // weight is assigned by compose.ts; sub-score reports 0.
    });

    it("2h/night debt → score 40", () => {
      const r = computeSleep(week("2026-05-01", 6), "2026-05-01", cfg);
      expect(r.value).toBe(40);
    });

    it("3h+/night debt clamps to floor (~10)", () => {
      const r = computeSleep(week("2026-05-01", 5), "2026-05-01", cfg);
      expect(r.value).toBe(10);
    });
  });

  describe("assumedSleepDates", () => {
    it("treats a 7h assumed entry like a real log so the target day isn't penalised", () => {
      // 6 prior nights at 8h + assumed 7h today → avg = (6*8+7)/7 = 7.857h/night
      // debt = 0.143h/night → 100 - 0.143*30 ≈ 95.7 → 96.
      const real = week("2026-05-01", 8).filter((s) => s.date !== "2026-05-01");
      const withAssumed = [...real, { date: "2026-05-01", hours: 7 }];
      const r = computeSleep(withAssumed, "2026-05-01", cfg, ["2026-05-01"]);
      expect(r.value).toBe(96);
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
