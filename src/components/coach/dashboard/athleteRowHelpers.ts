/**
 * Shared helpers for the athlete row + dashboard KPI strip. Lives in its
 * own module so AthleteListRow.tsx remains a pure component file (keeps
 * Fast Refresh happy and avoids a barrel export).
 */
import type {
  AthleteOverviewRow,
  FightFormLabel,
} from "@/hooks/coach/useCoachData";

export type Severity = "ok" | "warn" | "alert";

export interface AthleteAlert {
  tone: "alert" | "warn";
  label: string;
}

export const FIGHT_FORM_LABEL: Record<FightFormLabel, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function targetDelta(a: AthleteOverviewRow): number | null {
  const target = a.fight_week_target_kg ?? a.goal_weight_kg ?? null;
  if (a.current_weight_kg == null || target == null) return null;
  return +(a.current_weight_kg - target).toFixed(1);
}

/**
 * Sums the 7-day strain (RPE-hours / 5) into approximate training hours.
 * The strain bucket is `rpe * hours`, so dividing by a nominal session
 * intensity (RPE 5) yields a defensible "hours trained" estimate.
 */
export function trainingHoursThisWeek(a: AthleteOverviewRow): number {
  const arr = a.strain_7d ?? [];
  const total = arr.reduce((s, v) => s + (v || 0), 0);
  return +(total / 5).toFixed(1);
}

/**
 * Prefers the live `fight_form.score` (0..100) when the engine has
 * graduated past `calibrating`; returns null when no real readiness
 * exists yet so the row can fall back to the calibration label.
 */
export function deriveReadiness(a: AthleteOverviewRow): number | null {
  if (a.fight_form && a.fight_form.state === "ok") return a.fight_form.score;
  return null;
}

export function readinessSeverity(
  score: number | null,
  hasAlerts: boolean,
): Severity {
  if (hasAlerts) return "alert";
  if (score == null) return "warn";
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "alert";
}

/**
 * Returns the urgency chips that should render under the athlete row.
 * Capped at the two most-urgent flags so the row never grows tall.
 */
export function buildAlerts(a: AthleteOverviewRow): AthleteAlert[] {
  const alerts: AthleteAlert[] = [];
  const wDays = daysSince(a.last_weight_at);
  if (wDays != null && wDays >= 3) {
    alerts.push({ tone: "alert", label: `No weight ${wDays}d` });
  }
  if (a.fight_form && a.fight_form.state === "ok") {
    if (a.fight_form.label === "at_risk") {
      alerts.push({ tone: "alert", label: "At risk" });
    } else if (a.fight_form.label === "off_pace") {
      alerts.push({ tone: "warn", label: "Off pace" });
    }
  }
  const cals = a.todays_calories || 0;
  const goal = a.daily_calorie_goal || 0;
  if (goal > 0 && cals > goal * 1.15) {
    alerts.push({ tone: "warn", label: "Over kcal" });
  }
  return alerts.slice(0, 2);
}

// ── Camp phase mapping ──────────────────────────────────────────────────
// Derived from `goal_type` (cutting / maintaining / building) — the
// canonical profile field. Phase tone is tuned to urgency: cuts are
// tightest (amber), maintains are neutral, builds are long-game (green).

export type CampPhase = "Cut" | "Maintain" | "Build" | "Plan";

export function campPhase(goalType: string | null): CampPhase {
  if (!goalType) return "Plan";
  const g = goalType.toLowerCase();
  if (g.includes("cut") || g === "loss" || g === "fight") return "Cut";
  if (g.includes("build") || g.includes("gain") || g.includes("bulk")) {
    return "Build";
  }
  return "Maintain";
}
