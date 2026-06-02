/** Recovery-coach prompt context builder. Pure TS. */

import type { LoadMetrics, SessionRow } from "./loadMetrics";

interface WellnessRow {
  date: string;
  hooper_index: number | null;
  readiness_score: number | null;
  sleep_quality: number | null;
  sleep_hours: number | null;
  stress_level: number | null;
  fatigue_level: number | null;
  soreness_level: number | null;
  energy_level: number | null;
  motivation_level: number | null;
}

interface ProfileRow {
  athlete_type?: string | null;
  experience_level?: string | null;
  training_frequency?: string | number | null;
  tdee?: number | null;
  current_weight_kg?: number | null;
  goal_weight_kg?: number | null;
  sex?: string | null;
  age?: number | null;
}

interface BaselineRow {
  hooper_mean_60d?: number | null;
  sleep_hours_mean_60d?: number | null;
  daily_load_mean_14d?: number | null;
  hooper_cv_14d?: number | null;
  avg_deficit_7d?: number | null;
}

interface FightCamp {
  name?: string | null;
  fight_date?: string | null;
}

export interface RecoveryContextInput {
  profile: ProfileRow | null;
  loadMetrics: LoadMetrics;
  wellness7d: WellnessRow[];
  todayWellness: WellnessRow | null;
  baseline: BaselineRow | null;
  upcomingCamp: FightCamp | null;
}

function avgOf(xs: (number | null | undefined)[]): string {
  const valid = xs.filter((v): v is number => v != null);
  if (valid.length === 0) return "—";
  return (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1);
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return n.toFixed(digits);
}

function describeSession(s: SessionRow): string {
  const parts: string[] = [];
  parts.push(s.date);
  parts.push(
    `${s.session_type ?? "session"}${s.session_tag ? ` (${s.session_tag})` : ""}`,
  );
  if (s.duration_minutes != null) parts.push(`${s.duration_minutes}min`);
  if (s.rpe != null) parts.push(`rpe${s.rpe}`);
  if (s.soreness_level != null) parts.push(`sore${s.soreness_level}`);
  if (s.sleep_hours != null) parts.push(`sleep${s.sleep_hours}h`);
  if (s.mobility_done) parts.push("mobility");
  let line = parts.join(" ");
  if (s.notes) {
    const trimmed = s.notes.replace(/\s+/g, " ").trim().slice(0, 80);
    if (trimmed) line += ` "${trimmed}"`;
  }
  return line;
}

export function buildRecoveryContext(input: RecoveryContextInput): string {
  const { profile, loadMetrics, wellness7d, todayWellness, baseline, upcomingCamp } = input;
  const sections: string[] = [];
  if (profile) {
    const bits: string[] = [];
    if (profile.athlete_type) bits.push(profile.athlete_type);
    if (profile.experience_level) bits.push(profile.experience_level);
    if (profile.training_frequency) bits.push(`${profile.training_frequency}/wk`);
    if (profile.sex) bits.push(profile.sex);
    if (profile.age) bits.push(`age ${profile.age}`);
    if (profile.current_weight_kg) bits.push(`${profile.current_weight_kg}kg`);
    if (profile.tdee) bits.push(`TDEE ${profile.tdee}`);
    sections.push(`PROFILE: ${bits.join(", ") || "—"}`);
  }
  sections.push(
    `LOAD (today): strain ${fmt(loadMetrics.todayStrain)}, acute ${Math.round(loadMetrics.acuteLoad)}, chronic ${Math.round(loadMetrics.chronicLoad)}, ratio ${fmt(loadMetrics.loadRatio, 2)}, zone ${loadMetrics.loadZone}`,
  );
  sections.push(
    `7d AVG: rpe ${fmt(loadMetrics.avgRpe7d)}, soreness ${fmt(loadMetrics.avgSoreness7d)}/10, sleep ${fmt(loadMetrics.avgSleep7d)}h, ${loadMetrics.sessionsLast7d} sessions`,
  );
  if (todayWellness) {
    sections.push(
      `READINESS (today): score ${todayWellness.readiness_score ?? "—"}/100, Hooper ${todayWellness.hooper_index ?? "—"}/28, sleep ${todayWellness.sleep_hours ?? "—"}h q${todayWellness.sleep_quality ?? "—"}/7, soreness ${todayWellness.soreness_level ?? "—"}/7, fatigue ${todayWellness.fatigue_level ?? "—"}/7, stress ${todayWellness.stress_level ?? "—"}/7, energy ${todayWellness.energy_level ?? "—"}/7, motivation ${todayWellness.motivation_level ?? "—"}/7`,
    );
  } else {
    sections.push("READINESS (today): no check-in yet");
  }
  if (wellness7d.length > 0) {
    sections.push(
      `WELLNESS (7d avg): Hooper ${avgOf(wellness7d.map((w) => w.hooper_index))}/28, sleep ${avgOf(wellness7d.map((w) => w.sleep_hours))}h, soreness ${avgOf(wellness7d.map((w) => w.soreness_level))}/7, fatigue ${avgOf(wellness7d.map((w) => w.fatigue_level))}/7, energy ${avgOf(wellness7d.map((w) => w.energy_level))}/7`,
    );
  }
  if (loadMetrics.recentSessions.length > 0) {
    sections.push("RECENT SESSIONS (last 7d, newest first):");
    for (const s of loadMetrics.recentSessions) sections.push(`  ${describeSession(s)}`);
  } else {
    sections.push("RECENT SESSIONS: none in last 7d");
  }
  if (baseline) {
    const parts: string[] = [];
    if (baseline.sleep_hours_mean_60d != null) parts.push(`sleep60d ${fmt(baseline.sleep_hours_mean_60d)}h`);
    if (baseline.hooper_mean_60d != null) parts.push(`hooper60d ${fmt(baseline.hooper_mean_60d)}`);
    if (baseline.daily_load_mean_14d != null) parts.push(`avgLoad14d ${Math.round(baseline.daily_load_mean_14d)}`);
    if (baseline.hooper_cv_14d != null) parts.push(`hooperCV14d ${fmt(baseline.hooper_cv_14d, 2)}`);
    if (baseline.avg_deficit_7d != null) parts.push(`deficit7d ${Math.round(baseline.avg_deficit_7d)}kcal`);
    if (parts.length > 0) sections.push(`BASELINES: ${parts.join(", ")}`);
  }
  if (upcomingCamp?.fight_date) {
    const days = Math.ceil((new Date(upcomingCamp.fight_date).getTime() - Date.now()) / 86400000);
    sections.push(`UPCOMING CAMP: "${upcomingCamp.name ?? "fight"}" on ${upcomingCamp.fight_date} (${days} days out)`);
  }
  return sections.join("\n");
}
