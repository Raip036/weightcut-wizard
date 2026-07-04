/**
 * Athlete Snapshot — single source of truth for AI prompt context.
 *
 * Convex flavour: receives already-fetched rows from runQuery calls in the
 * action layer. The shape of `Inputs` mirrors what
 * `internal.actions._helpers.fetchSnapshotData` returns.
 *
 * Pure TS; no DB access here.
 */

import { resolveCutPace } from "./cutPace";
import { resolveWeighInIso } from "./weighInTiming";

export interface AthleteSnapshot {
  userId: string;
  weightClass?: string;
  sport?: string;
  sex?: "male" | "female";
  age?: number;
  heightCm?: number;
  currentWeight?: number;
  targetWeight?: number;
  kgToCut?: number;
  daysToFight?: number;
  /** Days to the WEIGH-IN (fight date adjusted by weigh-in timing). */
  daysToWeighIn?: number;
  /** Plan-aware weekly pace (from the generated cut plan, when present). */
  planWeek?: number;
  planTotalWeeks?: number;
  weeklyTargetKg?: number;
  /** current − this week's plan target (+ = over plan). */
  planDriftKg?: number;
  paceVerdict?: "on_plan" | "over_plan" | "under_plan";
  fightCampPhase?: "early" | "mid" | "fight-week" | null;
  weightSlope7d?: number;
  calorieAvg7d?: number;
  proteinAvg7d?: number;
  carbAvg7d?: number;
  fatAvg7d?: number;
  trainingVolumeKg7d?: number;
  trainingSessions7d?: number;
  hardSessions7d?: number;
  sleepAvgHours7d?: number;
  hydrationMlAvg7d?: number;
  tdee?: number;
  bmr?: number;
  recoveryStatus?: "green" | "yellow" | "red";
  glycogenStatus?: "depleted" | "partial" | "full";
  weightProjectionAtFight?: number;
  adherenceScore?: number;
}

export interface AthleteSnapshotInputs {
  userId: string;
  profile: {
    age?: number | null;
    sex?: string | null;
    height_cm?: number | null;
    current_weight_kg?: number | null;
    goal_weight_kg?: number | null;
    target_date?: string | null;
    activity_level?: string | null;
    bmr?: number | null;
    tdee?: number | null;
    athlete_type?: string | null;
    /** `profiles.cutPlanJson` — enables the plan-aware pace read. */
    cut_plan_json?: unknown;
    /** `profiles.weighInTiming` — anchors days-to-weigh-in. */
    weigh_in_timing?: string | null;
  } | null;
  weight14d: Array<{ date: string; weight_kg: number }>;
  mealTotals7d: Array<{
    date: string;
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fats_g: number;
  }>;
  sessions7d: Array<{ id: string; date: string; perceived_fatigue: number | null }>;
  sets7d: Array<{
    session_id: string;
    weight_kg: number | null;
    reps: number;
    rpe: number | null;
    is_warmup: boolean;
  }>;
  sets3d: Array<{ weight_kg: number | null; reps: number; is_warmup: boolean }>;
  sleep7d: Array<{ date: string; hours: number }>;
  hydration7d: Array<{ date: string; amount_ml: number }>;
  wellness7d: Array<{
    date: string;
    soreness_level: number | null;
    fatigue_level: number | null;
    sleep_hours: number | null;
  }>;
  fightCamp: { name?: string | null; fight_date?: string | null; starting_weight_kg?: number | null; end_weight_kg?: number | null } | null;
  todayWellness: { soreness_level: number | null; fatigue_level: number | null; sleep_hours: number | null } | null;
}

const ACTIVITY_MULT: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
  athlete: 1.9,
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function avg(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function linearSlope(points: { date: string; weight: number }[]): number | undefined {
  if (points.length < 2) return undefined;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = new Date(sorted[0].date).getTime();
  const xs = sorted.map((p) => (new Date(p.date).getTime() - t0) / 86400000);
  const ys = sorted.map((p) => p.weight);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return undefined;
  return num / den;
}

function computeBMR(sex: "male" | "female", weightKg: number, heightCm: number, age: number): number {
  return sex === "male"
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
}

export function buildAthleteSnapshot(input: AthleteSnapshotInputs): AthleteSnapshot {
  const sevenDaysAgo = isoDaysAgo(7);
  const snap: AthleteSnapshot = { userId: input.userId };
  const profile = input.profile;
  if (profile) {
    if (profile.sex === "male" || profile.sex === "female") snap.sex = profile.sex;
    if (typeof profile.age === "number") snap.age = profile.age;
    if (profile.height_cm != null) snap.heightCm = Number(profile.height_cm);
    if (profile.current_weight_kg != null) snap.currentWeight = Number(profile.current_weight_kg);
    if (profile.goal_weight_kg != null) snap.targetWeight = Number(profile.goal_weight_kg);
    if (profile.athlete_type) snap.sport = profile.athlete_type;
    if (typeof profile.tdee === "number") snap.tdee = profile.tdee;
    if (typeof profile.bmr === "number") snap.bmr = profile.bmr;
    if (snap.currentWeight != null && snap.targetWeight != null) {
      snap.kgToCut = Math.max(0, +(snap.currentWeight - snap.targetWeight).toFixed(2));
    }
  }
  if (input.weight14d.length > 0) {
    const latest = [...input.weight14d].sort((a, b) => b.date.localeCompare(a.date))[0];
    snap.currentWeight = Number(latest.weight_kg);
    if (snap.targetWeight != null) {
      snap.kgToCut = Math.max(0, +(snap.currentWeight - snap.targetWeight).toFixed(2));
    }
  }
  if (snap.sex && snap.currentWeight != null && snap.heightCm != null && snap.age != null) {
    snap.bmr = Math.round(computeBMR(snap.sex, snap.currentWeight, snap.heightCm, snap.age));
    const mult = ACTIVITY_MULT[profile?.activity_level ?? ""] ?? 1.55;
    snap.tdee = Math.round(snap.bmr * mult);
  }
  const fightDate = input.fightCamp?.fight_date ?? profile?.target_date ?? null;
  if (fightDate) {
    const days = Math.floor((new Date(fightDate).getTime() - Date.now()) / 86400000);
    snap.daysToFight = days;
    const weighIn = resolveWeighInIso(
      fightDate.slice(0, 10),
      profile?.weigh_in_timing ?? null,
    );
    snap.daysToWeighIn = Math.floor(
      (new Date(`${weighIn}T00:00:00Z`).getTime() - Date.now()) / 86400000,
    );
    if (days <= 7) snap.fightCampPhase = "fight-week";
    else if (days <= 28) snap.fightCampPhase = "mid";
    else snap.fightCampPhase = "early";
  } else {
    snap.fightCampPhase = null;
  }

  // Plan-aware weekly pace — the SAME resolveCutPace read every coach surface
  // and the dashboard use, so any prose the LLM writes about "pace" can be
  // grounded in this week's plan target instead of the final weigh-in weight.
  const pace = resolveCutPace({
    cutPlanJson: profile?.cut_plan_json,
    profileTargetDate: profile?.target_date ?? null,
    fightDate,
    currentKg: snap.currentWeight ?? null,
    asOfIso: new Date().toISOString().slice(0, 10),
  });
  if (pace) {
    snap.planWeek = pace.planWeek;
    snap.planTotalWeeks = pace.totalWeeks;
    snap.weeklyTargetKg = pace.weeklyTargetKg;
    snap.planDriftKg = pace.driftKg;
    snap.paceVerdict = pace.verdict;
  }
  if (input.weight14d.length >= 2) {
    const slope = linearSlope(input.weight14d.map((w) => ({ date: w.date, weight: Number(w.weight_kg) })));
    if (slope != null) snap.weightSlope7d = +slope.toFixed(4);
  }
  if (input.mealTotals7d.length > 0) {
    const byDay = new Map<string, { c: number; p: number; cb: number; f: number }>();
    for (const m of input.mealTotals7d) {
      const cur = byDay.get(m.date) ?? { c: 0, p: 0, cb: 0, f: 0 };
      cur.c += Number(m.total_calories) || 0;
      cur.p += Number(m.total_protein_g) || 0;
      cur.cb += Number(m.total_carbs_g) || 0;
      cur.f += Number(m.total_fats_g) || 0;
      byDay.set(m.date, cur);
    }
    const days = Array.from(byDay.values());
    snap.calorieAvg7d = Math.round(avg(days.map((d) => d.c)) ?? 0) || undefined;
    snap.proteinAvg7d = Math.round(avg(days.map((d) => d.p)) ?? 0) || undefined;
    snap.carbAvg7d = Math.round(avg(days.map((d) => d.cb)) ?? 0) || undefined;
    snap.fatAvg7d = Math.round(avg(days.map((d) => d.f)) ?? 0) || undefined;
  }
  snap.trainingSessions7d = input.sessions7d.length || undefined;
  if (input.sets7d.length > 0) {
    const volume = input.sets7d
      .filter((s) => !s.is_warmup && s.weight_kg != null)
      .reduce((sum, s) => sum + Number(s.weight_kg) * s.reps, 0);
    snap.trainingVolumeKg7d = Math.round(volume) || undefined;
    const sessionRpe = new Map<string, number[]>();
    for (const s of input.sets7d) {
      if (s.rpe == null) continue;
      const list = sessionRpe.get(s.session_id) ?? [];
      list.push(s.rpe);
      sessionRpe.set(s.session_id, list);
    }
    let hard = 0;
    for (const rpes of sessionRpe.values()) {
      const a = avg(rpes);
      if (a != null && a >= 8) hard++;
    }
    snap.hardSessions7d = hard;
  }
  const sleepHours: number[] = [
    ...input.sleep7d.map((s) => Number(s.hours)).filter((n) => Number.isFinite(n) && n > 0),
    ...input.wellness7d.map((w) => w.sleep_hours).filter((n): n is number => n != null && n > 0),
  ];
  if (sleepHours.length > 0) snap.sleepAvgHours7d = +(avg(sleepHours) ?? 0).toFixed(1);
  if (input.hydration7d.length > 0) {
    snap.hydrationMlAvg7d = Math.round(avg(input.hydration7d.map((h) => h.amount_ml)) ?? 0);
  }
  const avgSoreness7d = avg(
    input.wellness7d.map((w) => w.soreness_level).filter((n): n is number => n != null),
  );
  const todayFatigue = input.todayWellness?.fatigue_level ?? null;
  const todaySoreness = input.todayWellness?.soreness_level ?? null;
  const lowSleep = (snap.sleepAvgHours7d ?? Infinity) < 6;
  const manyHard = (snap.hardSessions7d ?? 0) >= 4;
  const acuteRed = todayFatigue != null && todayFatigue >= 6 && (avgSoreness7d ?? 0) >= 5;
  const acuteYellow =
    (todaySoreness != null && todaySoreness >= 4) ||
    (snap.sleepAvgHours7d != null && snap.sleepAvgHours7d < 7);
  if ((lowSleep && manyHard) || acuteRed) snap.recoveryStatus = "red";
  else if (manyHard || acuteYellow) snap.recoveryStatus = "yellow";
  else if (snap.sleepAvgHours7d != null || snap.trainingSessions7d != null) snap.recoveryStatus = "green";
  if (snap.tdee && snap.calorieAvg7d) {
    const cal3dProxy = snap.calorieAvg7d;
    const lowFuel = cal3dProxy < snap.tdee * 0.85;
    const trainingVolume3d = input.sets3d
      .filter((s) => !s.is_warmup && s.weight_kg != null)
      .reduce((sum, s) => sum + Number(s.weight_kg) * s.reps, 0);
    const median7dDailyVolume = (snap.trainingVolumeKg7d ?? 0) / 7;
    const highTraining = trainingVolume3d > median7dDailyVolume * 3;
    if (lowFuel && highTraining) snap.glycogenStatus = "depleted";
    else if (lowFuel || highTraining) snap.glycogenStatus = "partial";
    else snap.glycogenStatus = "full";
  }
  if (snap.currentWeight != null && snap.weightSlope7d != null && snap.daysToFight != null) {
    snap.weightProjectionAtFight = +(snap.currentWeight + snap.weightSlope7d * snap.daysToFight).toFixed(2);
  }
  const dayHasMeal = new Set(input.mealTotals7d.map((m) => m.date));
  const dayHasWeight = new Set(input.weight14d.filter((w) => w.date >= sevenDaysAgo).map((w) => w.date));
  let logged = 0;
  for (let i = 0; i < 7; i++) {
    const d = isoDaysAgo(i);
    if (dayHasMeal.has(d) && dayHasWeight.has(d)) logged++;
  }
  snap.adherenceScore = Math.round((logged / 7) * 100);
  return snap;
}

export function snapshotToPromptBlock(s: AthleteSnapshot): string {
  const lines: string[] = ["ATHLETE STATE"];
  const w = s.currentWeight != null ? `${s.currentWeight.toFixed(1)}kg` : "?";
  const tw =
    s.targetWeight != null ? `${s.targetWeight.toFixed(1)}kg final target` : "?";
  // "still to cut" (total distance to the FINAL weigh-in weight) is NOT a
  // pace judgement — mid-camp an on-plan athlete is always above the final
  // target. Pace lives in the "Plan pace" line below.
  const over =
    s.kgToCut != null ? `(${s.kgToCut.toFixed(1)}kg still to cut in total)` : "";
  const dtf =
    s.daysToFight != null
      ? ` | ${s.daysToFight} days to fight${
          s.daysToWeighIn != null && s.daysToWeighIn !== s.daysToFight
            ? `, ${s.daysToWeighIn} to weigh-in`
            : ""
        }${s.fightCampPhase ? ` (${s.fightCampPhase})` : ""}`
      : "";
  lines.push(`Current: ${w} -> ${tw} ${over}${dtf}`.trim());
  if (s.weeklyTargetKg != null && s.planDriftKg != null && s.planWeek != null) {
    const sign = s.planDriftKg >= 0 ? "+" : "";
    const verdict =
      s.paceVerdict === "on_plan"
        ? "on plan"
        : s.paceVerdict === "over_plan"
          ? "over plan"
          : "under plan";
    lines.push(
      `Plan pace: week ${s.planWeek}/${s.planTotalWeeks ?? "?"} of the cut plan, this week's target ${s.weeklyTargetKg.toFixed(1)}kg, drift ${sign}${s.planDriftKg.toFixed(1)}kg (${verdict}). Judge cut pace by THIS, not by the total still to cut`,
    );
  }
  const idBits: string[] = [];
  if (s.sex) idBits.push(s.sex);
  if (s.age != null) idBits.push(`${s.age}y`);
  if (s.heightCm != null) idBits.push(`${s.heightCm}cm`);
  if (s.sport) idBits.push(s.sport);
  if (idBits.length) lines.push(`Athlete: ${idBits.join(", ")}`);
  const energyBits: string[] = [];
  if (s.bmr != null) energyBits.push(`BMR ${s.bmr}`);
  if (s.tdee != null) energyBits.push(`TDEE ${s.tdee}`);
  if (s.calorieAvg7d != null) energyBits.push(`7d avg intake ${s.calorieAvg7d} kcal`);
  if (s.proteinAvg7d != null)
    energyBits.push(`${s.proteinAvg7d}P/${s.carbAvg7d ?? "?"}C/${s.fatAvg7d ?? "?"}F g`);
  if (energyBits.length) lines.push(`Energy: ${energyBits.join(" | ")}`);
  if (s.weightSlope7d != null) {
    const direction = s.weightSlope7d < 0 ? "losing" : s.weightSlope7d > 0 ? "gaining" : "stable";
    const kgPerWeek = (s.weightSlope7d * 7).toFixed(2);
    let trend = `Trend: ${kgPerWeek}kg/wk (${direction})`;
    if (s.weightProjectionAtFight != null) {
      trend += ` -> straight-line projection at fight date ${s.weightProjectionAtFight.toFixed(1)}kg (ignores the planned fight-week water cut, not a pace verdict)`;
    }
    lines.push(trend);
  }
  const trainBits: string[] = [];
  if (s.trainingSessions7d != null) trainBits.push(`${s.trainingSessions7d} sessions`);
  if (s.hardSessions7d != null) trainBits.push(`${s.hardSessions7d} hard (RPE>=8)`);
  if (s.trainingVolumeKg7d != null) trainBits.push(`${s.trainingVolumeKg7d.toLocaleString()} kg volume`);
  if (trainBits.length) lines.push(`Training (7d): ${trainBits.join(", ")}`);
  const recBits: string[] = [];
  if (s.sleepAvgHours7d != null) recBits.push(`sleep ${s.sleepAvgHours7d}h`);
  if (s.hydrationMlAvg7d != null) recBits.push(`hydration ${s.hydrationMlAvg7d}ml`);
  if (s.recoveryStatus) recBits.push(`status ${s.recoveryStatus}`);
  if (s.glycogenStatus) recBits.push(`glycogen ${s.glycogenStatus}`);
  if (recBits.length) lines.push(`Recovery (7d): ${recBits.join(", ")}`);
  if (s.adherenceScore != null) lines.push(`Adherence: ${s.adherenceScore}% days fully logged (last 7)`);
  return lines.join("\n");
}
