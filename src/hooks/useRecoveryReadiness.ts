import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import {
  computeAllMetrics,
  type SessionRow,
  type WellnessCheckIn as WellnessCheckInData,
  type PersonalBaseline,
} from "@/utils/performanceEngine";
import { loadOrComputeBaseline } from "@/utils/baselineComputer";
import { AIPersistence } from "@/lib/aiPersistence";

/**
 * Shared readiness computation so the dashboard `ReadinessCard` surfaces the
 * SAME number as the Recovery page hero. Both run the same `computeAllMetrics`
 * engine over the same inputs (28d sessions, today's wellness check-in, the
 * personal baseline, sleep logs and fight-camp phase) — so the widget matches
 * the hero live, without depending on the Recovery page having been opened
 * first to persist a `readinessScore`.
 *
 * Pass `null` to skip all work (e.g. for free users who never see the number).
 */
export function useRecoveryReadiness(userId: string | null | undefined): {
  score: number | null;
  loading: boolean;
} {
  const { profile } = useUser();

  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().split("T")[0];
  }, []);
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const rawSessions = useQuery(api.fight_camp.listCalendar, userId ? { from, to: today } : "skip");
  const checkinRows = useQuery(api.wellness.listCheckins, userId ? { from: today, to: today, limit: 1 } : "skip");
  const sleepRows = useQuery(api.sleep_logs.listForUser, userId ? { limit: 90 } : "skip");
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");

  const [baseline, setBaseline] = useState<PersonalBaseline | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadOrComputeBaseline(userId, profile?.tdee ?? null)
      .then((b) => { if (!cancelled && b) setBaseline(b); })
      .catch(() => { /* baseline is optional — engine falls back gracefully */ });
    return () => { cancelled = true; };
  }, [userId, profile?.tdee]);

  const sessions28d = useMemo<SessionRow[]>(() => {
    if (!rawSessions) return [];
    return rawSessions.map((r: any) => ({
      id: r._id,
      user_id: r.userId,
      date: r.date,
      session_type: r.sessionType,
      session_tag: r.sessionTag ?? null,
      duration_minutes: r.durationMinutes,
      rpe: r.rpe,
      intensity: r.intensity,
      intensity_level: r.intensityLevel ?? null,
      soreness_level: r.sorenessLevel ?? 0,
      sleep_hours: r.sleepHours ?? 0,
      fatigue_level: r.fatigueLevel ?? null,
      sleep_quality: r.sleepQuality ?? null,
      mobility_done: r.mobilityDone ?? null,
      created_at: r._creationTime ? new Date(r._creationTime).toISOString() : "",
    }));
  }, [rawSessions]);

  const wellnessCheckIn = useMemo<WellnessCheckInData | null>(() => {
    const row: any = checkinRows?.[0];
    if (!row) return null;
    return {
      sleep_quality: row.sleepQuality,
      fatigue_level: row.fatigueLevel,
      soreness_level: row.sorenessLevel,
      stress_level: row.stressLevel,
      energy_level: row.energyLevel,
      motivation_level: row.motivationLevel,
      sleep_hours: row.sleepHours,
      hydration_feeling: row.hydrationFeeling,
      appetite_level: row.appetiteLevel,
      hooper_index: row.hooperIndex,
    } as WellnessCheckInData;
  }, [checkinRows]);

  const sleepLogs = useMemo(() => {
    if (!sleepRows) return [] as { date: string; hours: number }[];
    return sleepRows
      .filter((r: any) => r.date >= from)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .map((r: any) => ({ date: r.date, hours: r.hours }));
  }, [sleepRows, from]);

  const daysToFight = useMemo<number | null>(() => {
    if (!activeCamp || activeCamp.isCompleted || !activeCamp.fightDate) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const f = new Date(activeCamp.fightDate); f.setHours(0, 0, 0, 0);
    const days = Math.ceil((f.getTime() - t.getTime()) / 86_400_000);
    return days >= 0 ? days : null;
  }, [activeCamp]);

  // Skipped queries stay `undefined`; treat the no-userId case as "not loading".
  const loading = !!userId && (rawSessions === undefined || checkinRows === undefined);

  const score = useMemo(() => {
    if (!userId || loading) return null;
    // Need at least one real signal to produce a meaningful number.
    if (sessions28d.length === 0 && !wellnessCheckIn) return null;
    const prevReadiness: number | null = AIPersistence.load(userId, "prev_readiness");
    const metrics = computeAllMetrics(
      sessions28d,
      profile?.training_frequency ?? null,
      profile?.activity_level ?? null,
      wellnessCheckIn,
      baseline,
      prevReadiness,
      sleepLogs,
      daysToFight,
    );
    return metrics.readiness.score;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userId,
    loading,
    sessions28d,
    wellnessCheckIn,
    baseline,
    sleepLogs,
    daysToFight,
    profile?.training_frequency,
    profile?.activity_level,
  ]);

  return { score, loading };
}
