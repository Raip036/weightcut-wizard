/* ------------------------------------------------------------------ */
/* Domain-aware coach cards (2026-06-04): the DomainBundle contract.    */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* This file is the typed boundary between the data-loader (which       */
/* hydrates the slices a turn needs) and the per-domain card builders   */
/* (which map a slice onto generic CoachBlock primitives in            */
/* convex/_shared/aiSchemas.ts). Only the slices listed in the arbiter  */
/* `DomainSelection` are populated — every field on DomainBundle is     */
/* optional so a loader can fill exactly what it has.                   */
/* ------------------------------------------------------------------ */

import type { DomainId } from "../aiSchemas";

/** Re-exported for convenience so domain builders can import everything
 *  they need from one module. */
export type { DomainId };

export interface TrainingLoadSlice {
  weekHours: number;
  lastWeekHours: number;
  sessions: {
    date: string;
    type: string;
    durationMin: number;
    intensity?: string;
    // Sanitized, length-capped notes — populated for the most-recent few
    // sessions only so the coach can reference WHAT was drilled and what the
    // athlete is working on, not just hours. Absent on older / note-less rows.
    techniques?: string;
    reflection?: string;
  }[];
  weeklySeries: { x: string; y: number }[];
}

export interface NutritionSlice {
  today: { kcal: number; protein: number; carbs: number; fat: number };
  target?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
  recentMeals: { name: string; kcal: number; when: string }[];
  kcalSeries: { x: string; y: number }[];
}

export interface FightScoreSlice {
  score: number;
  status: string;
  phase?: string;
  topLimiter?: string;
  subScores: { label: string; value: number }[];
}

export interface RecoverySlice {
  readiness?: number;
}

export interface SleepSlice {
  lastNightHours?: number;
  avgHours?: number;
  series?: { x: string; y: number }[];
}

export interface DomainBundle {
  trainingLoad?: TrainingLoadSlice;
  nutrition?: NutritionSlice;
  fightScore?: FightScoreSlice;
  recovery?: RecoverySlice;
  sleep?: SleepSlice;
}
