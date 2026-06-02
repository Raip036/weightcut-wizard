// Baseline Computer — fetches historical data and computes rolling statistics.
// Called after check-in submission and on dashboard mount if stale (>24h).
//
// Post-Convex migration: data is fetched via the Convex client directly (the
// hook signature stays plain async so non-React callers — UserContext bootstrap,
// post-submit callbacks — can still invoke it).

import { convex } from "@/integrations/convex/client";
import { api } from "@/../convex/_generated/api";
import { AIPersistence } from "@/lib/aiPersistence";
import { logger } from "@/lib/logger";
import { isRestSession } from "@/lib/sessionTypes";
import type { PersonalBaseline } from "./performanceEngine";

const BASELINE_CACHE_KEY = 'personal_baseline';
const BASELINE_CACHE_HOURS = 24;

interface WellnessRow {
  date: string;
  sleep_quality: number;
  stress_level: number;
  fatigue_level: number;
  soreness_level: number;
  hooper_index: number;
  sleep_hours: number | null;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function cv(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return std(values) / m;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export async function computeAndStoreBaseline(userId: string, tdee?: number | null): Promise<PersonalBaseline | null> {
  try {
    const ninetyDaysAgo = daysAgo(90);
    const today = new Date().toISOString().split('T')[0];

    // Fetch wellness check-ins (last 90 days) via Convex.
    const wellnessRows = (await convex.query(api.wellness.listCheckins, {
      from: ninetyDaysAgo,
      limit: 200,
    })) ?? [];
    const wellness: WellnessRow[] = (wellnessRows as Array<any>).map((r) => ({
      date: r.date,
      sleep_quality: r.sleepQuality ?? 0,
      stress_level: r.stressLevel ?? 0,
      fatigue_level: r.fatigueLevel ?? 0,
      soreness_level: r.sorenessLevel ?? 0,
      hooper_index: r.hooperIndex ?? 0,
      sleep_hours: r.sleepHours ?? null,
    }));

    if (wellness.length < 3) return null;

    // Nutrition: one indexed range scan server-side aggregates the last 90
    // days into `[{ date, calories }]`. Replaces 90 sequential per-date
    // `listWithTotals` calls that each shipped full item arrays + photo URLs.
    const nutritionByDay = new Map<string, number>();
    try {
      const dailyTotals = await convex.query(
        api.meals.sumCaloriesByDateRange,
        { from: ninetyDaysAgo, to: today },
      );
      for (const row of (dailyTotals ?? []) as Array<{ date: string; calories: number }>) {
        if (row.calories > 0) nutritionByDay.set(row.date, row.calories);
      }
    } catch {
      // Tolerate failure — baselines handle gaps gracefully.
    }

    // Training-load via fight_camp_calendar (Convex).
    const sessions = (await convex.query(api.fight_camp.listCalendar, {
      from: ninetyDaysAgo,
    })) ?? [];

    const loadByDay = new Map<string, number>();
    for (const s of sessions as Array<any>) {
      if (isRestSession(s.sessionType)) continue;
      const intensityLevel = s.intensityLevel ?? (s.intensity === 'low' ? 1 : s.intensity === 'high' ? 5 : 3);
      const multipliers: Record<number, number> = { 1: 0.8, 2: 1.0, 3: 1.15, 4: 1.3, 5: 1.5 };
      const load = (s.rpe ?? 5) * (s.durationMinutes ?? 0) * (multipliers[intensityLevel] ?? 1.0);
      const existing = loadByDay.get(s.date) ?? 0;
      loadByDay.set(s.date, existing + load);
    }

    // Split into 14-day and 60-day windows
    const fourteenDaysAgo = daysAgo(14);
    const sixtyDaysAgo = daysAgo(60);

    const recent14 = wellness.filter(w => w.date >= fourteenDaysAgo);
    const recent60 = wellness.filter(w => w.date >= sixtyDaysAgo);

    const extract = (rows: WellnessRow[], fn: (w: WellnessRow) => number | null): number[] =>
      rows.map(fn).filter((v): v is number => v != null);

    const baseline: PersonalBaseline = {
      sleep_hours_mean_14d: recent14.length > 0 ? mean(extract(recent14, w => w.sleep_hours)) : null,
      sleep_hours_std_14d: recent14.length > 1 ? std(extract(recent14, w => w.sleep_hours)) : null,
      soreness_mean_14d: recent14.length > 0 ? mean(recent14.map(w => w.soreness_level)) : null,
      soreness_std_14d: recent14.length > 1 ? std(recent14.map(w => w.soreness_level)) : null,
      fatigue_mean_14d: recent14.length > 0 ? mean(recent14.map(w => w.fatigue_level)) : null,
      fatigue_std_14d: recent14.length > 1 ? std(recent14.map(w => w.fatigue_level)) : null,
      stress_mean_14d: recent14.length > 0 ? mean(recent14.map(w => w.stress_level)) : null,
      stress_std_14d: recent14.length > 1 ? std(recent14.map(w => w.stress_level)) : null,
      hooper_mean_14d: recent14.length > 0 ? mean(recent14.map(w => w.hooper_index)) : null,
      hooper_std_14d: recent14.length > 1 ? std(recent14.map(w => w.hooper_index)) : null,
      daily_load_mean_14d: null,
      daily_load_std_14d: null,

      sleep_hours_mean_60d: recent60.length > 0 ? mean(extract(recent60, w => w.sleep_hours)) : null,
      sleep_hours_std_60d: recent60.length > 1 ? std(extract(recent60, w => w.sleep_hours)) : null,
      soreness_mean_60d: recent60.length > 0 ? mean(recent60.map(w => w.soreness_level)) : null,
      soreness_std_60d: recent60.length > 1 ? std(recent60.map(w => w.soreness_level)) : null,
      fatigue_mean_60d: recent60.length > 0 ? mean(recent60.map(w => w.fatigue_level)) : null,
      fatigue_std_60d: recent60.length > 1 ? std(recent60.map(w => w.fatigue_level)) : null,
      stress_mean_60d: recent60.length > 0 ? mean(recent60.map(w => w.stress_level)) : null,
      stress_std_60d: recent60.length > 1 ? std(recent60.map(w => w.stress_level)) : null,
      hooper_mean_60d: recent60.length > 0 ? mean(recent60.map(w => w.hooper_index)) : null,
      hooper_std_60d: recent60.length > 1 ? std(recent60.map(w => w.hooper_index)) : null,
      daily_load_mean_60d: null,
      daily_load_std_60d: null,

      hooper_cv_14d: recent14.length >= 3 ? cv(recent14.map(w => w.hooper_index)) : null,

      avg_deficit_7d: null,
      avg_deficit_14d: null,
    };

    // Daily-load stats for 14d and 60d windows
    const loadValues14d: number[] = [];
    const loadValues60d: number[] = [];
    for (let i = 0; i < 60; i++) {
      const d = daysAgo(i);
      const load = loadByDay.get(d) ?? 0;
      if (i < 14) loadValues14d.push(load);
      loadValues60d.push(load);
    }
    if (loadValues14d.length > 0) {
      baseline.daily_load_mean_14d = mean(loadValues14d);
      baseline.daily_load_std_14d = std(loadValues14d);
    }
    if (loadValues60d.length > 0) {
      baseline.daily_load_mean_60d = mean(loadValues60d);
      baseline.daily_load_std_60d = std(loadValues60d);
    }

    // Caloric deficit if TDEE is available
    if (tdee && tdee > 0) {
      const deficits7d: number[] = [];
      const deficits14d: number[] = [];
      for (let i = 0; i < 14; i++) {
        const d = daysAgo(i);
        const intake = nutritionByDay.get(d);
        if (intake != null) {
          const deficit = tdee - intake;
          if (i < 7) deficits7d.push(deficit);
          deficits14d.push(deficit);
        }
      }
      if (deficits7d.length > 0) baseline.avg_deficit_7d = mean(deficits7d);
      if (deficits14d.length > 0) baseline.avg_deficit_14d = mean(deficits14d);
    }

    // Persist via Convex.
    try {
      await convex.mutation(api.wellness.upsertBaseline, {
        baselineDate: today,
        data: baseline as any,
      });
    } catch (err) {
      logger.warn("[BaselineComputer] upsertBaseline failed", { err: String(err) });
    }

    // Cache locally.
    AIPersistence.save(userId, BASELINE_CACHE_KEY, baseline, BASELINE_CACHE_HOURS);

    return baseline;
  } catch (err) {
    logger.error("[BaselineComputer] Error computing baseline", err);
    return null;
  }
}

export function loadCachedBaseline(userId: string): PersonalBaseline | null {
  return AIPersistence.load(userId, BASELINE_CACHE_KEY);
}

export async function loadOrComputeBaseline(userId: string, tdee?: number | null): Promise<PersonalBaseline | null> {
  const cached = loadCachedBaseline(userId);
  if (cached) return cached;
  return computeAndStoreBaseline(userId, tdee);
}

export async function storeReadinessScore(_userId: string, _date: string, _score: number): Promise<void> {
  // Readiness was a derived field on `daily_wellness_checkins`. Post-migration
  // it's recomputed on read from the baseline + latest check-in so we no
  // longer persist it. Kept as a no-op so callers compile without changes.
  return;
}
