import { describe, test, expect, vi, afterEach } from "vitest";
import { buildChart, interpolatePlan } from "../PhaseCoachCard";
import type { PlanData } from "../CutPaceForecast";
import { resolvePlanWeek } from "@/scoring/planWeek";

const logs = (rows: [string, number][]) => rows.map(([date, kg]) => ({ date, weight_kg: String(kg) }));

// Plan: fight date 2026-07-15, 4 weeks → planStart = 2026-06-17.
// Week-end dates: w1 06-23, w2 06-30, w3 07-07, w4(fight_week) 07-14.
const PLAN = {
  weeklyPlan: [
    { week: 1, targetWeight: 79, phase: "build" },
    { week: 2, targetWeight: 78, phase: "build" },
    { week: 3, targetWeight: 77, phase: "peak" },
    { week: 4, targetWeight: 73.9, phase: "fight_week" },
  ],
  totalWeeks: 4,
  targetDate: "2026-07-15",
} as unknown as PlanData;

afterEach(() => vi.useRealTimers());

describe("in-sync with the week-forecast widget", () => {
  // The chart endpoint and the widget's resolver must read the SAME plan/week
  // math (both via the planWeek helpers). For a current week that is the last
  // non-fight-week, the chart's endpoint target and resolvePlanWeek's current
  // target are the same number — guarding against future anchoring drift.
  test("resolvePlanWeek(today) and the chart endpoint agree on the plan target", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z")); // inside week 3 (07-01..07-07)
    const resolved = resolvePlanWeek({
      asOfDate: "2026-07-01",
      fightDate: "2026-07-15",
      weeklyPlan: PLAN.weeklyPlan,
      totalWeeks: 4,
    });
    expect(resolved?.week).toBe(3);
    expect(resolved?.targetWeight).toBeCloseTo(77, 5);
    const chart = buildChart(logs([["2026-06-17", 80.5], ["2026-07-01", 80]]), 80, 99, "2026-07-15", PLAN);
    expect(chart!.targetKg).toBeCloseTo(resolved!.targetWeight!, 5);
  });
});

describe("interpolatePlan", () => {
  test("clamps before first and after last; interpolates mid-segment", () => {
    const pts = [{ ts: 0, kg: 80 }, { ts: 100, kg: 70 }];
    expect(interpolatePlan(pts, -10)).toBe(80);
    expect(interpolatePlan(pts, 110)).toBe(70);
    expect(interpolatePlan(pts, 50)).toBeCloseTo(75, 5);
  });
});

describe("buildChart plan polyline", () => {
  test("endpoint/target is the last NON-fight-week target, not the profile target or fight-week row", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const chart = buildChart(logs([["2026-06-17", 80.5], ["2026-07-01", 80]]), 80, 99 /* bogus profile */, "2026-07-15", PLAN);
    expect(chart).not.toBeNull();
    expect(chart!.targetKg).toBeCloseTo(77, 5); // week 3 (last non-fight-week), NOT 73.9 and NOT 99
  });

  test("plan path is a polyline (start + one vertex per non-fight-week row = 4 points → 3 L commands)", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const chart = buildChart(logs([["2026-06-17", 80.5], ["2026-07-01", 80]]), 80, 99, "2026-07-15", PLAN);
    const commandCount = (chart!.planPath.match(/[ML]/g) ?? []).length;
    expect(commandCount).toBe(4); // M + 3 L (start vertex + 3 non-fight-week targets)
  });

  test("today past pre-dehydration end → today dot sits beyond the line endpoint", () => {
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z")); // after week-3 end (07-07)
    const chart = buildChart(logs([["2026-06-17", 80.5], ["2026-07-10", 80]]), 80, 99, "2026-07-15", PLAN);
    expect(chart!.targetPx.x).toBeLessThan(chart!.todayPx.x);
    expect(Number.isNaN(chart!.targetPx.x)).toBe(false);
    expect(Number.isNaN(chart!.todayPx.x)).toBe(false);
  });
});

describe("buildChart fallback (no plan)", () => {
  test("plan=null → straight line to the profile targetWeight", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const chart = buildChart(logs([["2026-06-17", 80.5], ["2026-07-01", 80]]), 80, 74, "2026-07-15", null);
    expect(chart).not.toBeNull();
    expect(chart!.targetKg).toBeCloseTo(74, 5);
    expect((chart!.planPath.match(/[ML]/g) ?? []).length).toBe(2); // M + 1 L (straight)
  });
});
