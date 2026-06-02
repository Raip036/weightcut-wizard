/**
 * Full athlete detail for a coach view. Backed by `coach.athleteDetail`
 * Convex query.
 *
 * Convex enforces the coach-can-view-athlete privacy check server-side
 * (see `assertCoachCanViewAthlete` in `convex/coach.ts`). If the coach
 * isn't authorised or the athlete has paused sharing, the query throws
 * and `error` is populated.
 */
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type FightFormSubKey =
  | "training_load"
  | "sleep"
  | "weight_cut"
  | "wellness"
  | "nutrition_adherence";

export interface FightFormSub {
  value: number;
  weight: number;
  reason: string;
}

export interface FightFormDetail {
  date: string;
  score: number;
  raw_score: number;
  label: "sharp" | "sharpening" | "off_pace" | "at_risk";
  state: "ok" | "calibrating" | "no_camp" | "paused";
  phase: "build" | "peak" | "fightWeek" | null;
  top_driver: string;
  top_limiter: string;
  applied_ceiling: { rule_id: string; cap: number } | null;
  sub_scores: Record<FightFormSubKey, FightFormSub>;
}

export interface AthleteDetailData {
  profile: {
    id: string;
    display_name: string;
    athlete_type: string | null;
    avatar_url: string | null;
    goal_type: string | null;
    current_weight_kg: number | null;
    goal_weight_kg: number | null;
    fight_week_target_kg: number | null;
    target_date: string | null;
    ai_recommended_calories: number | null;
    ai_recommended_protein_g: number | null;
    ai_recommended_carbs_g: number | null;
    ai_recommended_fats_g: number | null;
  } | null;
  weight_7d: { date: string; weight_kg: number }[] | null;
  /** 7-day RPE-hours per day, oldest → newest. */
  strain_7d: number[] | null;
  today_macros: { calories: number; protein_g: number; carbs_g: number; fats_g: number } | null;
  recent_sessions: { date: string; session_type: string; session_tag?: string | null; rpe: number; soreness_level: number | null; duration_minutes: number }[] | null;
  /** Latest fight-form snapshot + sub-score breakdown. `null` until the
   *  athlete has generated at least one score. */
  fight_form: FightFormDetail | null;
  /** 14-day score history, oldest → newest. */
  fight_form_trend: { date: string; score: number; state: string }[] | null;
  membership: { share_data: boolean; status: string; joined_at: string; gym_name: string } | null;
}

export function useAthleteDetail(coachId: string | null, athleteId: string | null) {
  // Pass "skip" until both ids are available — Convex Auth provides the
  // coach userId server-side, so the `coachId` arg is only used here to
  // suppress the query while the parent's auth context is resolving.
  const data = useQuery(
    api.coach.athleteDetail,
    coachId && athleteId
      ? { athleteUserId: athleteId as Id<"users"> }
      : "skip",
  );

  // `data` is `undefined` while loading or skipped.
  const loading = data === undefined;
  // Convex queries that throw propagate as exceptions to the nearest
  // error boundary; useQuery itself never returns an error tuple. To
  // preserve the existing API we surface `null` here — components that
  // need a granular error can wrap themselves in <ErrorBoundary>.
  const error: string | null = null;
  const refresh = () => {};

  return {
    data: (data ?? null) as AthleteDetailData | null,
    loading,
    error,
    refresh,
  };
}
