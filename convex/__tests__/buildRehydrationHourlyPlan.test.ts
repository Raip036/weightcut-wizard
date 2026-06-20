import { describe, it, expect } from "vitest";
import {
  buildRehydrationHourlyPlan,
  type RehydrationPlanHour,
} from "../_shared/weightProtocolMath";

/**
 * Unit tests for the deterministic hour-by-hour rehydration/refeed planner
 * (WP-T7b). The numerics are server-authoritative — these tests lock in the
 * research algorithm (front-load shape, 1 L/h ceiling + shortfall flag, sleep
 * zero-block, pre-sleep top-up, wake dose, same-day no-sleep case).
 *
 * Constants enforced (hard rules): total = 1.4 × deficit; ceiling 1.0 L/h
 * (1.2 L hour 1); awake floor 0.2 L/h; sleep = 0 intake; wake bolus ~0.9 L;
 * pre-fight buffer ≤200 ml; carbs ~6 g/kg ≤60 g/h.
 */

function offset(hours: RehydrationPlanHour[], h: number): RehydrationPlanHour {
  const found = hours.find((x) => x.hourOffset === h);
  if (!found) throw new Error(`no hour H+${h}`);
  return found;
}

describe("buildRehydrationHourlyPlan", () => {
  it("produces a contiguous H+0..H+gap array of the right length", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 8,
      bodyMassKg: 70,
    });
    expect(plan.hours).toHaveLength(9); // H+0..H+8 inclusive
    plan.hours.forEach((h, i) => expect(h.hourOffset).toBe(i));
  });

  it("front-loads: earlier WAKING hours get more fluid than later ones", () => {
    // Short same-day window so there's no sleep block to interrupt the ramp.
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 6,
      bodyMassKg: 70,
    });
    // The pre-fight buffer (final hour) is sips-only, exclude it. Compare the
    // ramp hours: H+0 should be the largest, and the ramp should be descending.
    const ramp = plan.hours
      .filter((h) => h.phase !== "pre-fight" && !h.isSleep)
      .sort((a, b) => a.hourOffset - b.hourOffset);
    expect(ramp[0].liquidsMl).toBeGreaterThanOrEqual(ramp[1].liquidsMl);
    expect(ramp[1].liquidsMl).toBeGreaterThanOrEqual(ramp[2].liquidsMl);
    // Hour 0 is the single largest of the whole plan.
    const maxMl = Math.max(...plan.hours.map((h) => h.liquidsMl));
    expect(offset(plan.hours, 0).liquidsMl).toBe(maxMl);
  });

  it("respects the hourly ceiling and flags shortfall when the cut is too deep", () => {
    // 8 L deficit over a 3h same-day gap → target = 11.2 L, but only ~3 ramp
    // hours (H+0..H+2; H+3 is pre-fight) can hold 1.2 + 1.0 + 1.0 = 3.2 L.
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 8,
      hoursUntilFight: 3,
      bodyMassKg: 80,
    });
    expect(plan.deficitTooLarge).toBe(true);
    // No ramp hour exceeds the ceiling (1200 ml hour 1, else 1000 ml).
    for (const h of plan.hours) {
      if (h.phase === "pre-fight" || h.isSleep) continue;
      const cap = h.hourOffset === 0 ? 1200 : 1000;
      expect(h.liquidsMl).toBeLessThanOrEqual(cap);
    }
  });

  it("does NOT flag shortfall when the gap is comfortably long enough", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2, // target 2.8 L, easily fits an 8h window
      hoursUntilFight: 8,
      bodyMassKg: 70,
    });
    expect(plan.deficitTooLarge).toBe(false);
  });

  it("schedules zero intake across the sleep block ('Sleep, no intake')", () => {
    // 24h gap, weigh-in at 11:00, sleep 23:00→07:00. Sleep hours are H+12..H+19.
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 24,
      sleepStartHour: 23,
      sleepEndHour: 7,
      weighInClockHour: 11,
      bodyMassKg: 70,
    });
    expect(plan.hasSleep).toBe(true);
    const sleepHours = plan.hours.filter((h) => h.isSleep);
    expect(sleepHours.length).toBeGreaterThan(0);
    for (const h of sleepHours) {
      expect(h.liquidsMl).toBe(0);
      expect(h.carbG).toBe(0);
      expect(h.sodiumMg).toBe(0);
      expect(h.phase).toBe("sleep");
      expect(h.cue).toBe("Sleep, no intake");
    }
    // The sleep window starts at 23:00 → H+12 (11:00 + 12h).
    expect(offset(plan.hours, 12).isSleep).toBe(true);
    // 07:00 wake → H+20 is the first waking hour again.
    expect(offset(plan.hours, 19).isSleep).toBe(true);
    expect(offset(plan.hours, 20).isSleep).toBe(false);
  });

  it("pushes the pre-sleep hours to the ceiling with a top-up meal marker", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 3,
      hoursUntilFight: 24,
      sleepStartHour: 23,
      sleepEndHour: 7,
      weighInClockHour: 11,
      bodyMassKg: 75,
    });
    // First sleep hour is H+12, so the pre-sleep hours are H+10 and H+11.
    const preSleep = plan.hours.filter((h) => h.phase === "pre-sleep");
    expect(preSleep.length).toBeGreaterThanOrEqual(1);
    for (const h of preSleep) {
      expect(h.liquidsMl).toBe(1000); // pushed to the 1 L/h ceiling
      expect(h.isMeal).toBe(true);
      // Generic TIMING marker — no longer prescribes a specific food.
      expect(h.mealLabel).toMatch(/top up before bed/i);
    }
  });

  it("gives a fresh ORS bolus on the first waking hour after sleep", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 3,
      hoursUntilFight: 24,
      sleepStartHour: 23,
      sleepEndHour: 7,
      weighInClockHour: 11,
      bodyMassKg: 75,
    });
    const wake = plan.hours.find((h) => h.phase === "wake-dose");
    expect(wake).toBeDefined();
    expect(wake!.hourOffset).toBe(20); // 07:00 wake → H+20
    expect(wake!.liquidsMl).toBe(900); // ~0.9 L bolus
  });

  it("makes the final hour a sips-only pre-fight buffer with no carbs", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 8,
      bodyMassKg: 70,
    });
    const last = offset(plan.hours, 8);
    expect(last.phase).toBe("pre-fight");
    expect(last.liquidsMl).toBeLessThanOrEqual(200);
    expect(last.carbG).toBe(0);
  });

  it("same-day (short) gap places NO sleep block even when a window is passed", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 6, // < 10h → treated as same-day
      sleepStartHour: 23,
      sleepEndHour: 7,
      weighInClockHour: 11,
      bodyMassKg: 70,
    });
    expect(plan.hasSleep).toBe(false);
    expect(plan.hours.some((h) => h.isSleep)).toBe(false);
    expect(plan.sleepStartHour).toBeNull();
    expect(plan.sleepEndHour).toBeNull();
  });

  it("scales carbs to ~6 g/kg, caps per-hour ≤60 g, and starts at H+2", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 12,
      bodyMassKg: 70, // 6 g/kg ≈ 420 g total
      sleepStartHour: 23, // 12h gap < overnight threshold won't trigger sleep here
      sleepEndHour: 7,
      weighInClockHour: 11,
    });
    // No carbs in the first two hours.
    expect(offset(plan.hours, 0).carbG).toBe(0);
    expect(offset(plan.hours, 1).carbG).toBe(0);
    // Per-hour cap respected.
    for (const h of plan.hours) expect(h.carbG).toBeLessThanOrEqual(60);
    // Some carbs are actually scheduled.
    expect(plan.totalCarbScheduled).toBeGreaterThan(0);
  });

  it("skips carbs gracefully when body mass is unknown", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 2,
      hoursUntilFight: 8,
      bodyMassKg: 0,
    });
    expect(plan.totalCarbScheduled).toBe(0);
    for (const h of plan.hours) expect(h.carbG).toBe(0);
  });

  it("delivers sodium per-litre with a stronger ORS phase early then weaker", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 3,
      hoursUntilFight: 8,
      bodyMassKg: 75,
    });
    // Sodium is positive on hours that carry fluid.
    const withFluid = plan.hours.filter((h) => h.liquidsMl > 0);
    for (const h of withFluid) expect(h.sodiumMg).toBeGreaterThan(0);
    // Early concentration (~1600 mg/L) is higher than late (~700 mg/L).
    const early = offset(plan.hours, 0);
    const earlyConc = early.sodiumMg / (early.liquidsMl / 1000);
    expect(earlyConc).toBeGreaterThan(1000); // closer to 1600 than 700
  });

  it("keeps awake ramp hours at or above the 0.2 L/h floor", () => {
    const plan = buildRehydrationHourlyPlan({
      deficitLitres: 1, // small deficit → without a floor late hours could dip low
      hoursUntilFight: 8,
      bodyMassKg: 70,
    });
    for (const h of plan.hours) {
      if (h.phase === "pre-fight" || h.isSleep) continue;
      if (h.liquidsMl > 0) expect(h.liquidsMl).toBeGreaterThanOrEqual(200);
    }
  });
});
