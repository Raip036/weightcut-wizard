/**
 * Deterministic math utilities for plan generation. Ported as-is from
 * supabase/functions/_shared/math.ts — pure TS, no env deps.
 */

export function mifflinStJeor(opts: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: "male" | "female";
}): number {
  const { weightKg, heightCm, ageYears, sex } = opts;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  athlete: 1.9,
} as const;

export type ActivityLevel = keyof typeof ACTIVITY_MULTIPLIERS;

export function tdee(bmr: number, activityLevel: ActivityLevel): number {
  const mult = ACTIVITY_MULTIPLIERS[activityLevel] ?? ACTIVITY_MULTIPLIERS.moderate;
  return Math.round(bmr * mult);
}

// ── Carb-cycling model (combat-athlete cut) ──────────────────────────────
// Evidence base: 2025 ISSN combat-sports position stand + 2024 consensus
// scoping review on body-composition manipulation. The athlete trains hard
// through the deficit, so CARBS are maximised as the dominant fuel. The model:
//   • PROTEIN is the SWING variable, set by training-day type. Hard days anchor
//     protein LOW (1.6 g/kg) so freed calories flow into carbohydrate; rest
//     days push protein UP (2.2 g/kg) for satiety + lean-mass retention while
//     carbs pull back. Medium sits between (1.9 g/kg).
//   • FAT is held CONSTANT at a 0.5 g/kg floor every day (never below 15% of
//     total kcal — a hormonal-health guard), so the whole calorie budget
//     swings between carbs<->protein only. Total kcal is IDENTICAL across days.
//   • CARBOHYDRATE absorbs the remainder, so it always stays the largest macro.
export type TrainingDay = "hard" | "medium" | "rest";

export interface DayFuel {
  protein_g: number;
  carb_g: number;
  fat_g: number;
}

const CYCLE_PROTEIN_PER_KG: Record<TrainingDay, number> = {
  hard: 1.6,
  medium: 1.9,
  rest: 2.2,
};
const CYCLE_FAT_PER_KG = 0.5;

/** Macros for one training-day type at a FIXED calorie target. Fat sits at the
 *  0.5 g/kg floor (raised only to keep >=15% of kcal); protein is set by day
 *  type; carbohydrate fills whatever remains so it stays the dominant fuel. */
export function macroForDay(
  kcal: number,
  weightKg: number,
  day: TrainingDay,
): DayFuel {
  const protein_g = Math.round(weightKg * CYCLE_PROTEIN_PER_KG[day]);
  // Fat floor: 0.5 g/kg bodyweight, but never below 15% of total kcal so
  // hormonal health is protected on low-calorie / heavy-athlete edge cases.
  const fat_g = Math.max(
    Math.round(weightKg * CYCLE_FAT_PER_KG),
    Math.round((kcal * 0.15) / 9),
  );
  // Carbs take the remainder; the 20 g floor guards a degenerate budget.
  const remainderKcal = kcal - protein_g * 4 - fat_g * 9;
  const carb_g = Math.max(20, Math.round(remainderKcal / 4));
  return { protein_g, carb_g, fat_g };
}

/** The full carb cycle — hard / medium / rest fuels at the SAME calorie
 *  target. Calories are constant across all three; carbs swing up on hard
 *  days and down on rest days, with protein moving inversely. */
export function macroCycle(
  kcal: number,
  weightKg: number,
): Record<TrainingDay, DayFuel> {
  return {
    hard: macroForDay(kcal, weightKg, "hard"),
    medium: macroForDay(kcal, weightKg, "medium"),
    rest: macroForDay(kcal, weightKg, "rest"),
  };
}

export function macroSplit(
  kcal: number,
  weightKg: number,
  goal: "cut" | "maintain" | "recomp",
): { protein_g: number; carb_g: number; fat_g: number } {
  // Cut/recomp return the MEDIUM training-day macros from the carb cycle
  // (protein 1.9 g/kg, fat 0.5 g/kg floor, carbs fill the rest) — the
  // representative/typical day. The UI derives the hard/rest variants via
  // macroCycle(). Maintain keeps its own moderate, carb-forward split.
  if (goal === "cut" || goal === "recomp") {
    return macroForDay(kcal, weightKg, "medium");
  }
  const protein_g = Math.round(weightKg * 1.8);
  const fat_g = Math.round(weightKg * 0.9);
  const remainderKcal = kcal - protein_g * 4 - fat_g * 9;
  const carb_g = Math.max(20, Math.round(remainderKcal / 4));
  return { protein_g, carb_g, fat_g };
}

export function requiredDeficit(opts: {
  currentKg: number;
  targetKg: number;
  daysRemaining: number;
  waterCutAllowanceKg?: number;
  tdee?: number;
}): { dailyDeficitKcal: number; estimatedFatLossKg: number; estimatedWaterLossKg: number } {
  const { currentKg, targetKg, daysRemaining } = opts;
  const waterCutAllowanceKg = Math.max(0, opts.waterCutAllowanceKg ?? 0);
  const totalToLose = Math.max(0, currentKg - targetKg);
  const fatLossKg = Math.max(0, totalToLose - waterCutAllowanceKg);
  const days = Math.max(1, Math.round(daysRemaining));
  const rawDeficit = (fatLossKg * 7700) / days;
  const estTdee = opts.tdee && opts.tdee > 0 ? opts.tdee : currentKg * 30;
  const cappedDeficit = Math.min(rawDeficit, estTdee * 0.25);
  return {
    dailyDeficitKcal: Math.round(cappedDeficit),
    estimatedFatLossKg: Number(fatLossKg.toFixed(2)),
    estimatedWaterLossKg: Number(waterCutAllowanceKg.toFixed(2)),
  };
}

export function projectWeight(
  weightLogs: Array<{ date: string; weight: number }>,
  daysAhead: number,
): number | null {
  if (!Array.isArray(weightLogs) || weightLogs.length < 4) return null;
  const parsed = weightLogs
    .map((l) => ({ t: new Date(l.date).getTime(), w: Number(l.weight) }))
    .filter((l) => Number.isFinite(l.t) && Number.isFinite(l.w))
    .sort((a, b) => a.t - b.t);
  if (parsed.length < 4) return null;
  const latestT = parsed[parsed.length - 1].t;
  const cutoff = latestT - 14 * 86400000;
  const window = parsed.filter((p) => p.t >= cutoff);
  if (window.length < 4) return null;
  const t0 = window[0].t;
  const xs = window.map((p) => (p.t - t0) / 86400000);
  const ys = window.map((p) => p.w);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const xTarget = (latestT - t0) / 86400000 + daysAhead;
  return Number((slope * xTarget + intercept).toFixed(2));
}

export function safetyBounds(plan: {
  dailyKcal: number;
  proteinG: number;
  weightLossPerWeekKg: number;
  weightKg: number;
  bmr: number;
}): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (plan.dailyKcal < plan.bmr * 0.85) {
    violations.push(`dailyKcal (${plan.dailyKcal}) is below 85% of BMR (${Math.round(plan.bmr * 0.85)})`);
  }
  if (plan.dailyKcal < 1200) {
    violations.push(`dailyKcal (${plan.dailyKcal}) is below absolute floor 1200 kcal`);
  }
  if (plan.proteinG < plan.weightKg * 1.4) {
    violations.push(`proteinG (${plan.proteinG}) is below 1.4 g/kg minimum (${Math.round(plan.weightKg * 1.4)}g)`);
  }
  const maxWeeklyLoss = plan.weightKg * 0.015;
  if (plan.weightLossPerWeekKg > maxWeeklyLoss) {
    violations.push(
      `weightLossPerWeekKg (${plan.weightLossPerWeekKg.toFixed(2)}) exceeds 1.5% bw/wk (${maxWeeklyLoss.toFixed(2)}kg)`,
    );
  }
  return { ok: violations.length === 0, violations };
}

export function reidRealeWaterCut(weightKg: number) {
  const w = Math.max(40, weightKg);
  return {
    dayMinus2: { fluidML: Math.round(w * 100), sodiumMg: Math.round(w * 100) },
    dayMinus1: { fluidML: Math.round(w * 50), sodiumMg: Math.round(w * 50) },
    dayZero: { fluidML: 0, sodiumMg: 0 },
  };
}
