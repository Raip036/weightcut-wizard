import { describe, it, expect } from "vitest";
import {
  resolveCutPace,
  paceVerdictLabel,
  plannedRatePctPerWeek,
  ON_PLAN_BAND_KG,
} from "../_shared/cutPace";
import { resolvePlanWeek } from "../../src/scoring/planWeek";
import {
  buildWeightTargetBlock,
  computeDeterministicBundle,
} from "../_shared/coachBlocks";
import { evaluateSafety, type SafetyInput } from "../_shared/coachSafety";

/**
 * Locks the AI-coach pace read to the dashboard's: this week's target comes
 * from the cut plan via resolvePlanWeek, the on-plan band is ±0.5 kg
 * (DeltaPill), and the safety WARN tier tolerates the plan's own intended
 * rate. These are the invariants that stop the chat saying "cut pace is
 * high" while the Camp Status card says "on plan".
 */

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** ISO date `days` from today (UTC whole days). */
function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A 4-week plan whose fight date puts "today" inside week 2. */
function makePlan(opts?: { fightInDays?: number }) {
  // planStart = fightDate - 4*7; today lands in week 2 when the fight is in
  // 3 weeks minus a day or two → use fightInDays = 18 (planStart 10 days ago).
  const fightDate = isoInDays(opts?.fightInDays ?? 18);
  return {
    targetDate: fightDate,
    totalWeeks: 4,
    currentWeight: 80,
    weeklyPlan: [
      { week: 1, targetWeight: 79.0 },
      { week: 2, targetWeight: 78.0 },
      { week: 3, targetWeight: 77.0 },
      { week: 4, targetWeight: 75.0, phase: "fight_week" },
    ],
  };
}

describe("resolveCutPace", () => {
  it("matches the dashboard: weeklyTargetKg === resolvePlanWeek targetWeight", () => {
    const plan = makePlan();
    const pace = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 78.2,
      asOfIso: todayIso(),
    });
    const dashboard = resolvePlanWeek({
      asOfDate: todayIso(),
      fightDate: plan.targetDate,
      weeklyPlan: plan.weeklyPlan,
      totalWeeks: plan.totalWeeks,
    });
    expect(pace).not.toBeNull();
    expect(pace!.weeklyTargetKg).toBe(dashboard!.targetWeight);
    expect(pace!.planWeek).toBe(dashboard!.week);
  });

  it("grades on the ±0.5 kg dashboard band", () => {
    const plan = makePlan();
    const target = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 80,
      asOfIso: todayIso(),
    })!.weeklyTargetKg;

    const at = (kg: number) =>
      resolveCutPace({ cutPlanJson: plan, currentKg: kg, asOfIso: todayIso() })!;

    expect(at(target).verdict).toBe("on_plan");
    expect(at(target + ON_PLAN_BAND_KG).verdict).toBe("on_plan");
    expect(at(target + 0.6).verdict).toBe("over_plan");
    expect(at(target - 0.6).verdict).toBe("under_plan");
    expect(paceVerdictLabel(at(target + 0.6))).toBe("0.6 kg over plan");
    expect(paceVerdictLabel(at(target))).toBe("on plan");
  });

  it("plan.targetDate wins over profileTargetDate and fightDate", () => {
    const plan = makePlan();
    const pace = resolveCutPace({
      cutPlanJson: plan,
      profileTargetDate: isoInDays(60), // stale, must be ignored
      fightDate: isoInDays(90),
      currentKg: 78,
      asOfIso: todayIso(),
    });
    expect(pace!.fightDateIso).toBe(plan.targetDate);
  });

  it("returns null without a usable plan, anchor date, or current weight", () => {
    expect(
      resolveCutPace({ cutPlanJson: null, currentKg: 80, asOfIso: todayIso() }),
    ).toBeNull();
    expect(
      resolveCutPace({
        cutPlanJson: { weeklyPlan: [] },
        currentKg: 80,
        asOfIso: todayIso(),
      }),
    ).toBeNull();
    const noDate = { ...makePlan(), targetDate: undefined };
    expect(
      resolveCutPace({ cutPlanJson: noDate, currentKg: 80, asOfIso: todayIso() }),
    ).toBeNull();
    expect(
      resolveCutPace({
        cutPlanJson: makePlan(),
        currentKg: null,
        asOfIso: todayIso(),
      }),
    ).toBeNull();
  });

  it("derives this week's intended loss from adjacent plan rows", () => {
    const plan = makePlan();
    const pace = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 78,
      asOfIso: todayIso(),
    })!;
    // Week 2: 79.0 → 78.0 = 1.0 kg intended.
    expect(pace.planWeek).toBe(2);
    expect(pace.intendedThisWeekLossKg).toBe(1.0);
    // %BW/week at 78 kg ≈ 1.28.
    expect(plannedRatePctPerWeek(pace, 78)).toBeCloseTo(1.28, 2);
  });

  it("flags fight-week rows", () => {
    const plan = makePlan({ fightInDays: 3 }); // today inside week 4
    const pace = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 76,
      asOfIso: todayIso(),
    })!;
    expect(pace.planWeek).toBe(4);
    expect(pace.isFightWeekRow).toBe(true);
  });
});

describe("buildWeightTargetBlock (plan-aware)", () => {
  const baseData = (over: {
    currentKg: number;
    plan?: unknown;
    weighInTiming?: string | null;
    fightInDays?: number;
  }) => ({
    profile: {
      current_weight_kg: over.currentKg,
      goal_weight_kg: 75,
      fight_week_target_kg: 74, // stale on purpose; must NOT drive pace
      cut_plan_json: over.plan ?? null,
      target_date: null,
    },
    upcomingCamp: {
      id: "c1",
      name: "Test Fight",
      fight_date: isoInDays(over.fightInDays ?? 18),
      starting_weight_kg: 80,
      weigh_in_timing: over.weighInTiming ?? "day_before",
    },
    fightWeekLogs: [],
    weight14d: [{ date: todayIso(), weight_kg: over.currentKg }],
    hydration7d: [],
  });

  it("on plan this week → onTrack true, even far above the FINAL target", () => {
    const plan = makePlan();
    const weekly = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 80,
      asOfIso: todayIso(),
    })!.weeklyTargetKg;
    const wt = buildWeightTargetBlock(baseData({ currentKg: weekly, plan }));
    expect(wt.onTrack).toBe(true);
    expect(wt.pace?.verdict).toBe("on_plan");
    // delta to FINAL target is still large; it must not flip onTrack.
    expect(wt.delta).toBeGreaterThan(1);
    const block = wt.block;
    expect(block?.type).toBe("weight_target");
    if (block?.type === "weight_target") {
      expect(block.note).toContain("on plan");
    }
  });

  it("over this week's target by >0.5 kg → onTrack false", () => {
    const plan = makePlan();
    const weekly = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 80,
      asOfIso: todayIso(),
    })!.weeklyTargetKg;
    const wt = buildWeightTargetBlock(
      baseData({ currentKg: weekly + 1.2, plan }),
    );
    expect(wt.onTrack).toBe(false);
    expect(wt.pace?.verdict).toBe("over_plan");
  });

  it("no plan → legacy glide-path fallback still works", () => {
    const wt = buildWeightTargetBlock(baseData({ currentKg: 76, plan: null }));
    expect(wt.pace).toBeNull();
    // 1 kg over final target with ~2.5 weeks of runway → on track.
    expect(wt.onTrack).toBe(true);
  });

  it("days_out counts to the WEIGH-IN (day_before = fight − 1)", () => {
    const wt = buildWeightTargetBlock(
      baseData({ currentKg: 78, fightInDays: 10, weighInTiming: "day_before" }),
    );
    expect(wt.days).toBe(9);
    const sameDay = buildWeightTargetBlock(
      baseData({ currentKg: 78, fightInDays: 10, weighInTiming: "same_day" }),
    );
    expect(sameDay.days).toBe(10);
  });

  it("final target prefers goal_weight_kg over stale fight_week_target_kg", () => {
    const wt = buildWeightTargetBlock(baseData({ currentKg: 78 }));
    expect(wt.target).toBe(75);
  });
});

describe("computeDeterministicBundle (facts + metric_row consistency)", () => {
  const dataWith = (currentKg: number, plan: unknown) => ({
    profile: {
      current_weight_kg: currentKg,
      goal_weight_kg: 75,
      fight_week_target_kg: 74,
      cut_plan_json: plan,
      target_date: null,
    },
    upcomingCamp: {
      id: "c1",
      name: "Test Fight",
      fight_date: isoInDays(18),
      starting_weight_kg: 80,
      weigh_in_timing: "day_before",
    },
    fightWeekLogs: [],
    weight14d: [
      { date: isoInDays(-1), weight_kg: currentKg + 0.2 },
      { date: todayIso(), weight_kg: currentKg },
    ],
    hydration7d: [],
  });

  it("on-plan athlete: facts say on plan and the Pace card is NOT red", () => {
    const plan = makePlan();
    const weekly = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 80,
      asOfIso: todayIso(),
    })!.weeklyTargetKg;
    const bundle = computeDeterministicBundle(dataWith(weekly, plan));

    expect(bundle.facts).toContain("This week's plan target");
    expect(bundle.facts).toContain("on plan");
    expect(bundle.facts).toContain("On track: yes");
    expect(bundle.derived.paceVerdict).toBe("on_plan");

    const metricRow = bundle.blocks.find((b) => b.type === "metric_row");
    expect(metricRow).toBeDefined();
    if (metricRow?.type === "metric_row") {
      const vsPlan = metricRow.metrics.find((m) => m.label === "vs plan");
      expect(vsPlan?.value).toBe("on plan");
      expect(vsPlan?.tone).toBe("good"); // never red while facts say on plan
    }
  });

  it("over-plan athlete: facts + metric agree it is over plan", () => {
    const plan = makePlan();
    const weekly = resolveCutPace({
      cutPlanJson: plan,
      currentKg: 80,
      asOfIso: todayIso(),
    })!.weeklyTargetKg;
    const bundle = computeDeterministicBundle(dataWith(weekly + 1.2, plan));
    expect(bundle.derived.paceVerdict).toBe("over_plan");
    expect(bundle.facts).toContain("On track: no");
    const metricRow = bundle.blocks.find((b) => b.type === "metric_row");
    if (metricRow?.type === "metric_row") {
      const vsPlan = metricRow.metrics.find((m) => m.label === "vs plan");
      expect(vsPlan?.value).toContain("kg");
      expect(["warn", "bad"]).toContain(vsPlan?.tone);
    }
  });
});

describe("evaluateSafety (plan-aware warn tier)", () => {
  const base: SafetyInput = {
    rateOfLossPct7d: null,
    feelCheckTier: null,
    hrv: null,
    hrvBaseline: null,
    rhr: null,
    rhrBaseline: null,
    daysToWeighIn: 10,
    fightWeekRiskLevel: null,
    plannedRatePct7d: null,
    planDriftKg: null,
  };

  it("without a plan, >1%/week still warns (legacy behavior)", () => {
    const r = evaluateSafety({ ...base, rateOfLossPct7d: 1.2 });
    expect(r.tier).toBe("warn");
    expect(r.reasons[0]).toContain("Cut pace is high (1.2%/week)");
  });

  it("a pace the plan itself intends does NOT warn", () => {
    // Plan intends 1.1%/week → warn ceiling 1.375; observed 1.2 is fine.
    const r = evaluateSafety({
      ...base,
      rateOfLossPct7d: 1.2,
      plannedRatePct7d: 1.1,
      planDriftKg: 0.1,
    });
    expect(r.tier).toBe("ok");
  });

  it("clearly faster than the plan still warns, citing the plan", () => {
    const r = evaluateSafety({
      ...base,
      rateOfLossPct7d: 1.45,
      plannedRatePct7d: 1.0,
      planDriftKg: -0.9,
    });
    expect(r.tier).toBe("warn");
    expect(r.reasons[0]).toContain("vs ~1.0%/week planned");
  });

  it("the 1.5%/week danger floor is unconditional", () => {
    const r = evaluateSafety({
      ...base,
      rateOfLossPct7d: 1.8,
      plannedRatePct7d: 1.8, // even an aggressive plan cannot lift the floor
    });
    expect(r.tier).toBe("danger");
  });
});
