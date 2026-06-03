/**
 * Pure builders that turn an `AthleteDetailData` shape into the prop
 * objects each of the four chart-cards on AthleteDetail consumes.
 *
 * Kept out of the page component so the JSX body stays focused on
 * layout/composition. Each builder is side-effect-free and only depends
 * on the data it receives.
 */
import type {
  AthleteDetailData,
  FightFormDetail,
} from "@/hooks/coach/useAthleteDetail";
import type { ChartCardTone } from "./AthleteChartCard";
import { isScoredState } from "@/lib/fightFormState";

export interface ChartCardConfig {
  label: string;
  value: string;
  valueSubLabel?: string;
  tone: ChartCardTone;
  sparkline: number[];
  changeText?: string;
}

export interface AthleteDerived {
  ath: NonNullable<AthleteDetailData["profile"]>;
  target: number | null;
  currentWeight: number | null;
  delta: number | null;
  days: number | null;
  weeklyPace: number | null;
  weightSeries: number[];
  weeklyWeightDelta: number | null;
  strain7d: number[];
  strainTotal: number;
  strainDeltaPct: number | null;
  sessionCount: number;
  readiness: number | null;
  readinessSeries: number[];
  readinessAvg: number | null;
  sleepSub: FightFormDetail["sub_scores"]["sleep"] | null;
}

// Derive every chart-relevant number in one pass — keeps the page tidy
// and means every card sees a consistent snapshot of the data.
export function deriveAthleteMetrics(
  data: AthleteDetailData | null,
): AthleteDerived | null {
  if (!data || !data.profile) return null;
  const ath = data.profile;
  const target = ath.fight_week_target_kg ?? ath.goal_weight_kg ?? null;
  const currentWeight = ath.current_weight_kg ?? null;
  const delta =
    target != null && currentWeight != null
      ? +(currentWeight - target).toFixed(1)
      : null;
  const days = ath.target_date
    ? Math.ceil(
        (new Date(ath.target_date).getTime() - Date.now()) / 86_400_000,
      )
    : null;
  const weeklyPace =
    delta != null && days != null && days > 0
      ? +(delta / Math.max(0.143, days / 7)).toFixed(2)
      : null;

  const weight7d = data.weight_7d ?? [];
  const weightSeries = weight7d.map((w) => w.weight_kg);
  const weeklyWeightDelta =
    weightSeries.length >= 2
      ? +(weightSeries[weightSeries.length - 1] - weightSeries[0]).toFixed(1)
      : null;

  const strain7d = data.strain_7d ?? [];
  const strainTotal = strain7d.reduce((s, v) => s + (v || 0), 0);
  // 4-day leading vs 3-day trailing average — proxy for "is load
  // ramping or tapering across the week" since we only have 7d.
  const leading = strain7d.slice(0, 4);
  const trailing = strain7d.slice(4);
  const leadAvg = leading.length
    ? leading.reduce((s, v) => s + v, 0) / leading.length
    : 0;
  const trailAvg = trailing.length
    ? trailing.reduce((s, v) => s + v, 0) / trailing.length
    : 0;
  const strainDeltaPct =
    leadAvg > 0.1 ? Math.round(((trailAvg - leadAvg) / leadAvg) * 100) : null;
  const sessionCount = (data.recent_sessions ?? []).length;

  const readiness =
    isScoredState(data.fight_form?.state) ? data.fight_form!.score : null;
  const readinessSeries = (data.fight_form_trend ?? [])
    .filter((t) => isScoredState(t.state))
    .map((t) => t.score);
  const readinessAvg = readinessSeries.length
    ? Math.round(
        readinessSeries.reduce((s, v) => s + v, 0) / readinessSeries.length,
      )
    : null;

  const sleepSub = data.fight_form?.sub_scores?.sleep ?? null;

  return {
    ath,
    target,
    currentWeight,
    delta,
    days,
    weeklyPace,
    weightSeries,
    weeklyWeightDelta,
    strain7d,
    strainTotal,
    strainDeltaPct,
    sessionCount,
    readiness,
    readinessSeries,
    readinessAvg,
    sleepSub,
  };
}

function scoreTone(score: number | null): ChartCardTone {
  if (score == null) return "neutral";
  if (score >= 70) return "green";
  if (score >= 50) return "amber";
  return "red";
}

function strainTone(deltaPct: number | null): ChartCardTone {
  if (deltaPct == null) return "neutral";
  if (Math.abs(deltaPct) >= 40) return "red";
  if (Math.abs(deltaPct) >= 20) return "amber";
  return "green";
}

function weightTone(
  delta: number | null,
  weeklyPace: number | null,
): ChartCardTone {
  if (delta == null) return "neutral";
  if (delta <= 0.2) return "green";
  if (weeklyPace != null && weeklyPace > 1.5) return "red";
  if (weeklyPace != null && weeklyPace > 1.0) return "amber";
  return "green";
}

export function buildChartCards(
  derived: AthleteDerived,
  data: AthleteDetailData,
): { readiness: ChartCardConfig; weight: ChartCardConfig; training: ChartCardConfig; sleep: ChartCardConfig } {
  const {
    target,
    currentWeight,
    delta,
    weeklyPace,
    weightSeries,
    weeklyWeightDelta,
    strain7d,
    strainTotal,
    strainDeltaPct,
    sessionCount,
    readiness,
    readinessSeries,
    readinessAvg,
    sleepSub,
  } = derived;

  const readinessCard: ChartCardConfig = {
    label: "Readiness",
    value: readiness != null ? String(readiness) : "—",
    valueSubLabel: readiness != null ? "/ 100" : undefined,
    tone: scoreTone(readiness),
    sparkline: readinessSeries,
    changeText:
      readinessAvg != null
        ? `${readinessSeries.length}d avg ${readinessAvg}`
        : data.fight_form?.state === "calibrating"
          ? "Calibrating"
          : "No score yet",
  };

  let weightChange: string | undefined;
  if (weeklyWeightDelta != null) {
    const sign = weeklyWeightDelta > 0 ? "+" : "";
    weightChange = `${sign}${weeklyWeightDelta.toFixed(1)} kg this week`;
  } else if (target != null && delta != null) {
    const sign = delta > 0 ? "+" : "";
    weightChange = `${sign}${delta.toFixed(1)}kg to target`;
  }

  const weightCard: ChartCardConfig = {
    label: "Weight",
    value:
      currentWeight != null
        ? currentWeight.toFixed(1)
        : target != null
          ? `→ ${target.toFixed(1)}`
          : "—",
    valueSubLabel: currentWeight != null ? "kg" : undefined,
    tone: weightTone(delta, weeklyPace),
    sparkline: weightSeries,
    changeText: weightChange,
  };

  const trainingCard: ChartCardConfig = {
    label: "Training load",
    value:
      sessionCount > 0
        ? String(sessionCount)
        : strainTotal > 0
          ? strainTotal.toFixed(1)
          : "—",
    valueSubLabel: sessionCount > 0 ? "sessions" : undefined,
    tone: strainTone(strainDeltaPct),
    sparkline: strain7d,
    changeText:
      strainDeltaPct != null
        ? `${strainDeltaPct > 0 ? "+" : ""}${strainDeltaPct}% vs early week`
        : sessionCount === 0
          ? "No training logged"
          : `${strainTotal.toFixed(1)} RPE-hours`,
  };

  const sleepCard: ChartCardConfig = {
    label: "Sleep",
    value: sleepSub ? String(sleepSub.value) : "—",
    valueSubLabel: sleepSub ? "/ 100" : undefined,
    tone: scoreTone(sleepSub?.value ?? null),
    // No per-day sleep series in the data hook — leave the sparkline
    // empty so the card renders "No data" rather than a fake trend.
    sparkline: [],
    changeText: sleepSub?.reason
      ? sleepSub.reason.replace(/\s*—\s*/g, " · ")
      : "No sleep data yet",
  };

  return {
    readiness: readinessCard,
    weight: weightCard,
    training: trainingCard,
    sleep: sleepCard,
  };
}
