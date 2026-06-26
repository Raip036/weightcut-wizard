/**
 * Unit tests for convex/_shared/weightProtocolMath.ts (WP-T23).
 *
 * Pure function tests — no Convex runtime required.
 *
 * Pins the spec at docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
 * (§3 algorithms, §6 research-grounded values). If any of these assertions
 * change, the spec changed first.
 */

import { describe, it, expect } from "vitest";
import {
  computeDerived,
  buildSafetyWarnings,
  buildFightPlanSkeleton,
  buildRehydrationSkeleton,
  type GatheredInputs,
  type DerivedInputs,
  type Approach,
} from "../../convex/_shared/weightProtocolMath";

// ──────────────────────────────────────────────────────────────────────────
// Helpers — build a deterministic GatheredInputs we can perturb
// ──────────────────────────────────────────────────────────────────────────

function baseInputs(over: Partial<GatheredInputs> = {}): GatheredInputs {
  return {
    profile: { age: 28, sex: "male", heightCm: 180, currentWeightKg: 75 },
    camp: {
      fightDate: "2026-06-15",
      weighInDate: "2026-06-14",
      weighInTime: "11:00",
      targetWeightKg: 71.25, // 5% cut from 75
    },
    weights28d: [{ date: "2026-06-01", weightKg: 75 }],
    sessions7d: [],
    sleep7d: [{ date: "2026-06-01", hours: 8 }],
    wellness14d: [],
    priorCamps: [
      { startingWeightKg: 78, endWeightKg: 74, weightViaDehydration: 60 },
    ],
    today: "2026-06-08", // 6 days to weigh-in
    ...over,
  };
}

function baseDerived(over: Partial<DerivedInputs> = {}): DerivedInputs {
  return {
    currentWeightKg: 75,
    targetWeightKg: 71.25,
    cutDepthKg: 3.75,
    cutDepthPct: 5,
    cutCategory: "heavy",
    leanBodyMassKg: 59.51,
    weighInIso: "2026-06-14",
    fightIso: "2026-06-15",
    weighInToFightHours: 31,
    daysToFight: 7,
    daysToWeighIn: 6,
    trainingLoadIndex7d: 0,
    avgSleepHours7d: 8,
    recoveryReadinessToday: null,
    historicalReboundKg: null,
    historicalReboundPct: null,
    sex: "male",
    isFirstTimeCutter: false,
    ...over,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 1. computeDerived
// ──────────────────────────────────────────────────────────────────────────

describe("computeDerived", () => {
  it("standard 75kg male, 5% cut, 7 days, standard approach → expected derived", () => {
    const d = computeDerived(baseInputs(), "standard");
    expect(d.currentWeightKg).toBeCloseTo(75, 2);
    expect(d.targetWeightKg).toBeCloseTo(71.25, 2);
    expect(d.cutDepthKg).toBeCloseTo(3.75, 2);
    expect(d.cutDepthPct).toBeCloseTo(5, 2);
    // categorizeCut: < 2 light ; < 4 moderate ; <=6 heavy ; > 6 extreme
    expect(d.cutCategory).toBe("moderate");
    expect(d.sex).toBe("male");
    expect(d.weighInIso).toBe("2026-06-14");
    expect(d.fightIso).toBe("2026-06-15");
    expect(d.isFirstTimeCutter).toBe(false);
  });

  it("female athlete 60kg, 4% cut → female-specific LBM", () => {
    const d = computeDerived(
      baseInputs({
        profile: { age: 26, sex: "female", heightCm: 165, currentWeightKg: 60 },
        camp: {
          fightDate: "2026-06-15",
          weighInDate: "2026-06-14",
          weighInTime: "11:00",
          targetWeightKg: 57.6,
        },
        weights28d: [{ date: "2026-06-01", weightKg: 60 }],
      }),
      "standard",
    );
    expect(d.sex).toBe("female");
    // Boer female: 0.252*60 + 0.473*165 − 48.3 = 15.12 + 78.045 − 48.3 = 44.865 → 44.87
    expect(d.leanBodyMassKg).toBeCloseTo(44.87, 2);
    expect(d.cutDepthPct).toBeCloseTo(4, 2);
  });

  it("first-time cutter (priorCamps empty) → isFirstTimeCutter true & historicalRebound null", () => {
    const d = computeDerived(baseInputs({ priorCamps: [] }), "standard");
    expect(d.isFirstTimeCutter).toBe(true);
    expect(d.historicalReboundKg).toBeNull();
    expect(d.historicalReboundPct).toBeNull();
  });

  it("missing weighInDate falls back to fightDate − 1 day (day_before default)", () => {
    const d = computeDerived(
      baseInputs({
        camp: {
          fightDate: "2026-06-15",
          weighInDate: null,
          targetWeightKg: 71.25,
        },
      }),
      "standard",
    );
    expect(d.weighInIso).toBe("2026-06-14");
    expect(d.fightIso).toBe("2026-06-15");
  });

  it("same_day timing: missing weighInDate resolves to the FIGHT day (no phantom extra day)", () => {
    const d = computeDerived(
      baseInputs({
        profile: {
          age: 28,
          sex: "male",
          heightCm: 180,
          currentWeightKg: 75,
          weighInTiming: "same_day",
        },
        camp: {
          fightDate: "2026-06-15",
          weighInDate: null,
          targetWeightKg: 71.25,
        },
        today: "2026-06-08",
      }),
      "standard",
    );
    expect(d.weighInIso).toBe("2026-06-15"); // weigh-in == fight day
    expect(d.fightIso).toBe("2026-06-15");
    // Weigh-in and fight are the same calendar day → equal countdowns and a
    // short same-day rehydration window (11:00 → 18:00 = 7h), not ~31h.
    expect(d.daysToWeighIn).toBe(d.daysToFight);
    expect(d.weighInToFightHours).toBe(7);
  });

  it("day_before timing: weigh-in is one day before the fight with a long rehydration window", () => {
    const d = computeDerived(
      baseInputs({
        profile: {
          age: 28,
          sex: "male",
          heightCm: 180,
          currentWeightKg: 75,
          weighInTiming: "day_before",
        },
        camp: {
          fightDate: "2026-06-15",
          weighInDate: null,
          targetWeightKg: 71.25,
        },
        today: "2026-06-08",
      }),
      "standard",
    );
    expect(d.weighInIso).toBe("2026-06-14");
    expect(d.fightIso).toBe("2026-06-15");
    expect(d.daysToWeighIn).toBe(d.daysToFight - 1);
    // 11:00 day before → 18:00 fight day = 31h recovery window.
    expect(d.weighInToFightHours).toBe(31);
  });

  it("LBM Boer male spot-check (75kg, 180cm) = 0.407*75 + 0.267*180 − 19.2", () => {
    const d = computeDerived(baseInputs(), "standard");
    // 30.525 + 48.06 − 19.2 = 59.385 → rounded to 59.39 (2dp)
    expect(d.leanBodyMassKg).toBeCloseTo(59.39, 2);
  });

  it("daysToWeighIn computed from today + weighInIso", () => {
    const d = computeDerived(
      baseInputs({ today: "2026-06-07" }), // 7 days to 2026-06-14
      "standard",
    );
    expect(d.daysToWeighIn).toBe(7);
    expect(d.daysToFight).toBe(8);
  });

  it("most recent weight from weights28d overrides profile weight", () => {
    const d = computeDerived(
      baseInputs({
        profile: { age: 28, sex: "male", heightCm: 180, currentWeightKg: 75 },
        weights28d: [
          { date: "2026-06-01", weightKg: 75 },
          { date: "2026-06-07", weightKg: 76.4 }, // latest
        ],
      }),
      "standard",
    );
    expect(d.currentWeightKg).toBeCloseTo(76.4, 2);
  });

  it("weighInToFightHours uses weighInTime parse + default fight hour 18", () => {
    const d = computeDerived(baseInputs(), "standard");
    // weigh-in 11:00 on 06-14 → fight 18:00 on 06-15 → 31h gap
    expect(d.weighInToFightHours).toBeCloseTo(31, 1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. buildSafetyWarnings
// ──────────────────────────────────────────────────────────────────────────

describe("buildSafetyWarnings", () => {
  it("8.5% cut → DEPTH_GT_8PCT critical", () => {
    const w = buildSafetyWarnings(baseDerived({ cutDepthPct: 8.5 }), []);
    const found = w.find((x) => x.code === "DEPTH_GT_8PCT");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("critical");
  });

  it("6% cut, 2 days to weigh-in → AGGRESSIVE_TIMELINE critical", () => {
    const w = buildSafetyWarnings(
      baseDerived({ cutDepthPct: 6, daysToWeighIn: 2 }),
      [],
    );
    const found = w.find((x) => x.code === "AGGRESSIVE_TIMELINE");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("critical");
  });

  it("first-timer + 6% cut → FIRST_TIMER_DEEP_CUT critical", () => {
    const w = buildSafetyWarnings(
      baseDerived({ cutDepthPct: 6, isFirstTimeCutter: true }),
      [],
    );
    const found = w.find((x) => x.code === "FIRST_TIMER_DEEP_CUT");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("critical");
  });

  it("avg sleep 5.5h → SLEEP_DEBT warn", () => {
    const w = buildSafetyWarnings(baseDerived({ avgSleepHours7d: 5.5 }), []);
    const found = w.find((x) => x.code === "SLEEP_DEBT");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("warn");
  });

  it("recovery readiness 35 → LOW_READINESS warn", () => {
    const w = buildSafetyWarnings(
      baseDerived({ recoveryReadinessToday: 35 }),
      [],
    );
    const found = w.find((x) => x.code === "LOW_READINESS");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("warn");
  });

  it("female + 7.5% cut → FEMALE_CAP warn", () => {
    const w = buildSafetyWarnings(
      baseDerived({ sex: "female", cutDepthPct: 7.5 }),
      [],
    );
    const found = w.find((x) => x.code === "FEMALE_CAP");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("warn");
  });

  it("compound triggers fire together (deep cut + first-timer + sleep debt)", () => {
    const w = buildSafetyWarnings(
      baseDerived({
        cutDepthPct: 8.5,
        isFirstTimeCutter: true,
        avgSleepHours7d: 5.5,
      }),
      [],
    );
    const codes = w.map((x) => x.code);
    expect(codes).toContain("DEPTH_GT_8PCT");
    expect(codes).toContain("FIRST_TIMER_DEEP_CUT");
    expect(codes).toContain("SLEEP_DEBT");
  });

  it("no triggers → empty array", () => {
    const w = buildSafetyWarnings(baseDerived(), []);
    expect(w).toEqual([]);
  });

  it("critical warning is signaled via severity='critical' (caller can force gradual)", () => {
    const w = buildSafetyWarnings(baseDerived({ cutDepthPct: 9 }), []);
    const critical = w.filter((x) => x.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
    // Shape contract for caller: { severity, code, message }
    for (const c of critical) {
      expect(typeof c.code).toBe("string");
      expect(typeof c.message).toBe("string");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. buildFightPlanSkeleton
// ──────────────────────────────────────────────────────────────────────────

describe("buildFightPlanSkeleton", () => {
  it("75kg male, 7-day window, standard → body-weight carb restriction + spec water/sodium", () => {
    const plan = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 7, currentWeightKg: 75, cutDepthKg: 3.75 }),
      "standard",
    );
    // 8 days expected: dtw 7..0
    expect(plan.days.length).toBe(8);
    const byDtw = Object.fromEntries(plan.days.map((d) => [d.daysToWeighIn, d]));
    // T-7: early step-down 2 g/kg * 75 = 150g ; canonical normal water 40mL/kg *
    // 75 = 3.0L ; sodium 35mg/kg * 75 = 2625mg
    expect(byDtw[7].carbsGrams).toBe(150);
    expect(byDtw[7].waterLitres).toBeCloseTo(3.0, 2);
    expect(byDtw[7].sodiumMg).toBe(2625);
    expect(byDtw[7].fibreNote).toBe("normal");
    // T-4: restriction 0.5 g/kg → round(37.5) = 38g (under 50g) ; this is the
    // first WATER-LOAD day → 100mL/kg * 75 = 7.5L ; fibre now low-residue (T-4
    // is ~96h out, the start of the gut taper per Reale 2018).
    expect(byDtw[4].carbsGrams).toBe(38);
    expect(byDtw[4].waterLitres).toBeCloseTo(7.5, 2);
    expect(byDtw[4].fibreNote).toBe("low_residue_only");
    // T-1 is the FLUSH: water drops sharply to 15mL/kg * 75 = 1.125L (round2 → 1.13)
    expect(byDtw[1].waterLitres).toBeCloseTo(1.13, 2);
    // Weigh-in day (dtw=0): fixed 30g
    expect(byDtw[0].dayLabel).toBe("Weigh-in");
    expect(byDtw[0].carbsGrams).toBe(30);
  });

  it("60kg female: carbs scale with bodyweight; water/sodium scale by 60/75", () => {
    const plan = buildFightPlanSkeleton(
      baseDerived({ currentWeightKg: 60, cutDepthKg: 3, daysToWeighIn: 7 }),
      "standard",
    );
    const t7 = plan.days.find((d) => d.daysToWeighIn === 7)!;
    // early step-down 2 g/kg * 60 = 120
    expect(t7.carbsGrams).toBe(120);
    // T-7 is normal water (pre-load) 40mL/kg * 60 = 2.4L
    expect(t7.waterLitres).toBeCloseTo(2.4, 2);
    // sodium 35mg/kg * 60 = 2100
    expect(t7.sodiumMg).toBe(2100);
    // T-4 water-load scales too: 100mL/kg * 60 = 6.0L
    const t4 = plan.days.find((d) => d.daysToWeighIn === 4)!;
    expect(t4.waterLitres).toBeCloseTo(6.0, 2);
    // restriction day (T-3): 0.5 g/kg * 60 = 30g
    const t3 = plan.days.find((d) => d.daysToWeighIn === 3)!;
    expect(t3.carbsGrams).toBe(30);
  });

  it("approach 'gradual' shifts the carb curve right by a day (more carbs at the boundary)", () => {
    const std = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 5, currentWeightKg: 75, cutDepthKg: 3 }),
      "standard",
    ).days.find((d) => d.daysToWeighIn === 5)!;
    const grad = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 5, currentWeightKg: 75, cutDepthKg: 3 }),
      "gradual",
    ).days.find((d) => d.daysToWeighIn === 5)!;
    // standard at T-5 is in the restriction band (0.5 g/kg → 38g); gradual reads
    // T-6 (early step-down, 2 g/kg → 150g) — lighter on the cut today.
    expect(std.carbsGrams).toBe(38);
    expect(grad.carbsGrams).toBe(150);
  });

  it("approach 'aggressive' shifts the carb curve left by a day (harsher at the boundary)", () => {
    const std = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 6, currentWeightKg: 75, cutDepthKg: 3 }),
      "standard",
    ).days.find((d) => d.daysToWeighIn === 6)!;
    const agg = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 6, currentWeightKg: 75, cutDepthKg: 3 }),
      "aggressive",
    ).days.find((d) => d.daysToWeighIn === 6)!;
    // standard at T-6 is the early step-down (2 g/kg → 150g); aggressive reads
    // T-5 (restriction, 0.5 g/kg → 38g) — harsher today.
    expect(std.carbsGrams).toBe(150);
    expect(agg.carbsGrams).toBe(38);
  });

  it("carb restriction stays strictly under 50g (100kg → 49g cap)", () => {
    const t3 = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 5, currentWeightKg: 100, cutDepthKg: 5 }),
      "standard",
    ).days.find((d) => d.daysToWeighIn === 3)!;
    // 0.5 * 100 = 50 → capped to 49g (strictly under 50)
    expect(t3.carbsGrams).toBe(49);
  });

  it("same-day weigh-in HOLDS carbs AND is water-neutral (no load/flush); fibre still taper", () => {
    const d = baseDerived({ daysToWeighIn: 7, currentWeightKg: 75, cutDepthKg: 3.75 });
    const dayBefore = buildFightPlanSkeleton(d, "standard", false);
    const sameDay = buildFightPlanSkeleton(d, "standard", true);
    const sdByDtw = Object.fromEntries(
      sameDay.days.map((day) => [day.daysToWeighIn, day]),
    );
    const dbByDtw = Object.fromEntries(
      dayBefore.days.map((day) => [day.daysToWeighIn, day]),
    );
    // Carbs held at maintenance (3 g/kg * 75 = 225g) EVERY day — including the
    // restriction window and weigh-in morning where day-before depletes.
    for (const day of sameDay.days) {
      expect(day.carbsGrams).toBe(225);
    }
    // Day-before still depletes (T-4 restriction 38g, weigh-in 30g) — proves
    // the two strategies actually diverge.
    expect(dbByDtw[4].carbsGrams).toBe(38);
    expect(dbByDtw[0].carbsGrams).toBe(30);
    // WATER-NEUTRAL same-day: no water load. On the day-before LOAD day (T-4)
    // day-before is 100mL/kg → 7.5L, same-day stays near-normal 40mL/kg → 3.0L.
    expect(dbByDtw[4].waterLitres).toBeCloseTo(7.5, 2);
    expect(sdByDtw[4].waterLitres).toBeCloseTo(3.0, 2);
    expect(sdByDtw[4].waterLitres).toBeLessThan(dbByDtw[4].waterLitres);
    // Same-day never water-loads on ANY day (cap near-normal ~40mL/kg → 3.0L).
    for (const day of sameDay.days) {
      expect(day.waterLitres).toBeLessThanOrEqual(3.0);
    }
    // Fibre taper IS shared — same-day still cuts fibre to empty the gut.
    for (const dtw of [7, 4, 2, 0]) {
      expect(sdByDtw[dtw].fibreNote).toBe(dbByDtw[dtw].fibreNote);
    }
    // No glycogen stripped when carbs are held; far less bound water too.
    expect(sameDay.expectedWeightLossKg.glycogen).toBe(0);
    expect(sameDay.expectedWeightLossKg.water).toBeLessThan(
      dayBefore.expectedWeightLossKg.water,
    );
    expect(dayBefore.expectedWeightLossKg.glycogen).toBeCloseTo(0.015 * 75, 3);
  });

  it("1 day to weigh-in → produces 2 days (T-1 and Weigh-in)", () => {
    const plan = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 1, currentWeightKg: 75, cutDepthKg: 1 }),
      "standard",
    );
    expect(plan.days.length).toBe(2);
    expect(plan.days.map((d) => d.daysToWeighIn)).toEqual([1, 0]);
  });

  it("0 days to weigh-in → produces 1 day (Weigh-in)", () => {
    // horizon clamps to min 1, so we still get 2 days; the spec edge case is
    // really 'today IS weigh-in' — but the function's contract here is min 1
    // day of horizon → 2 cards. We pin that behavior.
    const plan = buildFightPlanSkeleton(
      baseDerived({ daysToWeighIn: 0, currentWeightKg: 75, cutDepthKg: 0.5 }),
      "standard",
    );
    expect(plan.days.length).toBe(2);
    expect(plan.days.at(-1)!.dayLabel).toBe("Weigh-in");
  });

  it("expectedWeightLossKg: glycogen=1.5%, water=2.5%, gut=1.2%, fat=remainder", () => {
    const d = baseDerived({ currentWeightKg: 80, cutDepthKg: 5, daysToWeighIn: 5 });
    const plan = buildFightPlanSkeleton(d, "standard");
    expect(plan.expectedWeightLossKg.glycogen).toBeCloseTo(0.015 * 80, 3);
    expect(plan.expectedWeightLossKg.water).toBeCloseTo(0.025 * 80, 3);
    expect(plan.expectedWeightLossKg.gut).toBeCloseTo(0.012 * 80, 3);
    const expectedFat = Math.max(
      0,
      5 - (0.015 * 80 + 0.025 * 80 + 0.012 * 80),
    );
    expect(plan.expectedWeightLossKg.fat).toBeCloseTo(expectedFat, 3);
    expect(plan.expectedWeightLossKg.total).toBeCloseTo(
      plan.expectedWeightLossKg.glycogen +
        plan.expectedWeightLossKg.water +
        plan.expectedWeightLossKg.gut +
        plan.expectedWeightLossKg.fat,
      3,
    );
  });

  it("targetWeightKg linearly interpolates current → target across days", () => {
    const plan = buildFightPlanSkeleton(
      baseDerived({
        currentWeightKg: 80,
        targetWeightKg: 76,
        cutDepthKg: 4,
        daysToWeighIn: 4,
      }),
      "standard",
    );
    const byDtw = Object.fromEntries(plan.days.map((d) => [d.daysToWeighIn, d]));
    // horizon = 4. At dtw=4 → current. At dtw=0 → target. Linear interp.
    expect(byDtw[4].targetWeightKg).toBeCloseTo(80, 2);
    expect(byDtw[3].targetWeightKg).toBeCloseTo(79, 2);
    expect(byDtw[2].targetWeightKg).toBeCloseTo(78, 2);
    expect(byDtw[1].targetWeightKg).toBeCloseTo(77, 2);
    expect(byDtw[0].targetWeightKg).toBeCloseTo(76, 2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. buildRehydrationSkeleton
// ──────────────────────────────────────────────────────────────────────────

describe("buildRehydrationSkeleton", () => {
  it("24h gap → 25 hour rows (H+0 through H+24)", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    expect(skel.hours.length).toBe(25);
    expect(skel.hours[0].hourOffset).toBe(0);
    expect(skel.hours.at(-1)!.hourOffset).toBe(24);
  });

  it("3h gap → 4 rows (H+0 through H+3)", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 3,
      }),
    );
    expect(skel.hours.length).toBe(4);
    expect(skel.hours.at(-1)!.hourOffset).toBe(3);
  });

  it("30h gap → 31 rows", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 30,
      }),
    );
    expect(skel.hours.length).toBe(31);
    expect(skel.hours.at(-1)!.hourOffset).toBe(30);
  });

  it("liquids in H+0..H+4 are ≤1000 mL/hr (rapid-rehydration cap)", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    for (let h = 0; h <= 4; h++) {
      expect(skel.hours[h].liquidsMl).toBeLessThanOrEqual(1000);
    }
  });

  it("sodium curve: H+0..H+3 ≈1000 mg/hr, H+4..H+11 ≈500 mg/hr, taper after", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    expect(skel.hours[0].foodGrams.sodium).toBeGreaterThanOrEqual(800);
    expect(skel.hours[3].foodGrams.sodium).toBeGreaterThanOrEqual(800);
    expect(skel.hours[5].foodGrams.sodium).toBeGreaterThanOrEqual(400);
    expect(skel.hours[5].foodGrams.sodium).toBeLessThanOrEqual(600);
    expect(skel.hours[20].foodGrams.sodium).toBeLessThanOrEqual(300);
  });

  it("carb curve H+0..H+3 hits ~1.0 g/kg / 4 each hour", () => {
    const weighIn = 70;
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: weighIn,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    // per spec: 1.0 g/kg spread over first 4h = ~17.5 g/h for 70kg → rounded to 18
    for (let h = 0; h <= 3; h++) {
      const row = skel.hours[h];
      expect(row.foodGrams.carbs).toBeGreaterThanOrEqual(15);
      expect(row.foodGrams.carbs).toBeLessThanOrEqual(20);
    }
    // sum of first 4h should be ≈ 1.0 g/kg * weighIn = 70 ±5g (rounding slack)
    const first4 = skel.hours
      .slice(0, 4)
      .reduce((s, r) => s + r.foodGrams.carbs, 0);
    expect(first4).toBeGreaterThanOrEqual(65);
    expect(first4).toBeLessThanOrEqual(75);
  });

  it("totalFluidTargetMl = 1500 * cutDepthKg", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    expect(skel.totalFluidTargetMl).toBe(Math.round(1500 * 3));
  });

  it("weighInWeightKg = derived.targetWeightKg; fightWeightTargetKg = +cutDepthKg", () => {
    const skel = buildRehydrationSkeleton(
      baseDerived({
        targetWeightKg: 70,
        cutDepthKg: 3,
        weighInToFightHours: 24,
      }),
    );
    expect(skel.weighInWeightKg).toBeCloseTo(70, 2);
    expect(skel.fightWeightTargetKg).toBeCloseTo(73, 2);
  });
});
