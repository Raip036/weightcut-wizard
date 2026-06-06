/* ------------------------------------------------------------------ */
/* Domain-aware coach cards (2026-06-04): NUTRITION card builder.       */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* Pure functions only — no ctx / IO. Maps a NutritionSlice onto the   */
/* generic CoachBlock visual primitives (metric_row / chart / list).    */
/* Same tight-cap discipline as aiSchemas.ts; every label/value is      */
/* trimmed to its `.max()` budget before emit.                          */
/* ------------------------------------------------------------------ */

import type { CoachBlock } from "../aiSchemas";
import type { NutritionSlice } from "./types";

/** Round to a whole number, guarding against NaN / undefined. */
function r(n: number | undefined): number {
  return Math.round(Number.isFinite(n) ? (n as number) : 0);
}

/** "1,850" — grouped thousands for kcal readability. */
function grouped(n: number): string {
  return r(n).toLocaleString("en-US");
}

/** Tone today's kcal against target: under/on = good, slight over = warn,
 *  well over (>10%) = bad. No target → undefined (renderer stays neutral). */
function kcalTone(
  today: number,
  target?: number,
): "good" | "warn" | "bad" | undefined {
  if (target === undefined || target <= 0) return undefined;
  if (today <= target) return "good";
  if (today <= target * 1.1) return "warn";
  return "bad";
}

/** metric_row of today's macros: kcal, protein, carbs, fat (≤4 metrics). */
function macrosRow(slice: NutritionSlice): CoachBlock {
  const { today, target } = slice;
  return {
    type: "metric_row",
    metrics: [
      {
        label: "kcal",
        value: grouped(today.kcal).slice(0, 16),
        ...(kcalTone(today.kcal, target?.kcal)
          ? { tone: kcalTone(today.kcal, target?.kcal) as "good" | "warn" | "bad" }
          : {}),
      },
      { label: "Protein", value: `${r(today.protein)}g` },
      { label: "Carbs", value: `${r(today.carbs)}g` },
      { label: "Fat", value: `${r(today.fat)}g` },
    ],
  };
}

/** "calories" chart from kcalSeries, with optional kcal target line. */
function caloriesChart(slice: NutritionSlice): CoachBlock {
  return {
    type: "chart",
    title: "Calories",
    kind: "calories",
    series: slice.kcalSeries
      .slice(-30)
      .map((p) => ({ x: p.x.slice(0, 16), y: r(p.y) })),
    ...(slice.target?.kcal !== undefined
      ? { targetLine: r(slice.target.kcal) }
      : {}),
  };
}

/** "Recent meals" list: label=name, value=`${kcal} kcal`, meta=when (≤6). */
function recentMealsList(slice: NutritionSlice): CoachBlock {
  return {
    type: "list",
    title: "Recent meals",
    items: slice.recentMeals.slice(0, 6).map((m) => ({
      label: m.name.slice(0, 48),
      value: `${grouped(m.kcal)} kcal`.slice(0, 24),
      meta: m.when.slice(0, 32),
    })),
  };
}

/**
 * Build 1–3 nutrition cards from a hydrated slice.
 * Cards with no underlying data are omitted entirely.
 */
export function buildNutritionCards(slice: NutritionSlice): CoachBlock[] {
  const cards: CoachBlock[] = [];

  const hasMacros =
    slice.today.kcal > 0 ||
    slice.today.protein > 0 ||
    slice.today.carbs > 0 ||
    slice.today.fat > 0;
  if (hasMacros) cards.push(macrosRow(slice));

  if (slice.kcalSeries.length > 0) cards.push(caloriesChart(slice));

  if (slice.recentMeals.length > 0) cards.push(recentMealsList(slice));

  return cards;
}

/**
 * One- to two-sentence factual summary of today's nutrition for the LLM.
 * No markdown, no em-dashes, numbers rounded.
 */
export function summarizeNutrition(slice: NutritionSlice): string {
  const { today, target } = slice;
  const targetStr =
    target?.kcal !== undefined ? ` (target ${grouped(target.kcal)} kcal)` : "";
  const first =
    `Today: ${grouped(today.kcal)} kcal, ${r(today.protein)}g protein, ` +
    `${r(today.carbs)}g carbs, ${r(today.fat)}g fat${targetStr}.`;

  const last = slice.recentMeals[slice.recentMeals.length - 1];
  const second = last ? ` Last meal: ${last.name}.` : "";

  return `${first}${second}`;
}
