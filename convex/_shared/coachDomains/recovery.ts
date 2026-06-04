/* ------------------------------------------------------------------ */
/* Domain card builders: RECOVERY + SLEEP (2026-06-04).                 */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* PURE functions only — no Convex ctx, no LLM, no I/O. Each builder    */
/* maps a typed slice (from ./types) onto the generic CoachBlock visual */
/* primitives in ../aiSchemas (stat_card / metric_row / chart). Numbers */
/* are server-authoritative: the LLM never emits these. Cards with no    */
/* data are omitted; an empty slice yields []. Block field caps in       */
/* aiSchemas are respected here (titles ≤40, values ≤16, units ≤8, etc). */
/* ------------------------------------------------------------------ */

import type { CoachBlock } from "../aiSchemas";
import type { RecoverySlice, SleepSlice } from "./types";

// ── Small pure helpers ──────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isNum(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Cap a chart series to the schema max (30) and round y values. */
function toSeries(
  series: { x: string; y: number }[] | undefined,
): { x: string; y: number }[] {
  if (!series) return [];
  return series
    .filter((p) => Number.isFinite(p.y))
    .slice(-30)
    .map((p) => ({ x: p.x, y: round1(p.y) }));
}

// ── Recovery ─────────────────────────────────────────────────────────────

/** Readiness tone bands: good ≥67, warn 34–66, bad <34 (0–100 scale). */
function readinessTone(v: number): "good" | "warn" | "bad" {
  if (v >= 67) return "good";
  if (v >= 34) return "warn";
  return "bad";
}

/**
 * Recovery cards from a RecoverySlice:
 *  - `stat_card` "Readiness" when present (value %, tone by band).
 *  - `metric_row` with HRV (ms) and RHR (bpm) when present. HRV higher is
 *    better and RHR lower is better, but without a personal baseline we can
 *    only flag at coarse population reference points — otherwise neutral.
 *  - `chart` kind "hrv" from hrvSeries when there are ≥2 points.
 * Omits any card lacking data; returns [] for an empty slice.
 */
export function buildRecoveryCards(slice: RecoverySlice): CoachBlock[] {
  const blocks: CoachBlock[] = [];

  if (isNum(slice.readiness)) {
    const r = Math.round(slice.readiness);
    blocks.push({
      type: "stat_card",
      title: "Readiness",
      value: `${r}`,
      unit: "%",
      tone: readinessTone(r),
    });
  }

  const metrics: {
    label: string;
    value: string;
    tone?: "good" | "warn" | "bad";
  }[] = [];
  if (isNum(slice.hrv)) {
    // Coarse reference only (no personal baseline available): high HRV is a
    // positive signal, very low is a concern. Neutral in the middle band.
    const hrv = Math.round(slice.hrv);
    const tone: "good" | "warn" | "bad" | undefined =
      hrv >= 70 ? "good" : hrv < 30 ? "bad" : undefined;
    metrics.push({ label: "HRV", value: `${hrv} ms`, ...(tone ? { tone } : {}) });
  }
  if (isNum(slice.rhr)) {
    // Lower resting HR is generally better; flag clearly elevated values.
    const rhr = Math.round(slice.rhr);
    const tone: "good" | "warn" | "bad" | undefined =
      rhr <= 50 ? "good" : rhr >= 70 ? "warn" : undefined;
    metrics.push({ label: "RHR", value: `${rhr} bpm`, ...(tone ? { tone } : {}) });
  }
  if (metrics.length > 0) {
    blocks.push({ type: "metric_row", metrics: metrics.slice(0, 4) });
  }

  const hrvPoints = toSeries(slice.hrvSeries);
  if (hrvPoints.length >= 2) {
    blocks.push({
      type: "chart",
      title: "HRV trend",
      kind: "hrv",
      series: hrvPoints,
    });
  }

  return blocks;
}

/** One- or two-sentence plain-text recovery summary. Empty-safe; no markdown. */
export function summarizeRecovery(slice: RecoverySlice): string {
  const parts: string[] = [];
  if (isNum(slice.hrv)) parts.push(`HRV ${Math.round(slice.hrv)}ms`);
  if (isNum(slice.rhr)) parts.push(`RHR ${Math.round(slice.rhr)}bpm`);
  if (isNum(slice.readiness)) parts.push(`readiness ${Math.round(slice.readiness)}%`);
  if (parts.length === 0) return "Recovery: no data yet.";
  return `Recovery: ${parts.join(", ")}.`;
}

// ── Sleep ────────────────────────────────────────────────────────────────

/** Sleep tone bands (hours): good ≥7, warn 6–7, bad <6. */
function sleepTone(hours: number): "good" | "warn" | "bad" {
  if (hours >= 7) return "good";
  if (hours >= 6) return "warn";
  return "bad";
}

/**
 * Sleep cards from a SleepSlice:
 *  - `stat_card` "Last night" (value=lastNightHours, unit "h", subtitle the
 *    weekly average when available, tone by band).
 *  - `chart` kind "sleep" from series when there are ≥2 points.
 * Omits any card lacking data; returns [] for an empty slice.
 */
export function buildSleepCards(slice: SleepSlice): CoachBlock[] {
  const blocks: CoachBlock[] = [];

  if (isNum(slice.lastNightHours)) {
    const h = round1(slice.lastNightHours);
    blocks.push({
      type: "stat_card",
      title: "Last night",
      value: `${h}`,
      unit: "h",
      tone: sleepTone(h),
      ...(isNum(slice.avgHours)
        ? { subtitle: `avg ${round1(slice.avgHours)}h` }
        : {}),
    });
  }

  const points = toSeries(slice.series);
  if (points.length >= 2) {
    blocks.push({
      type: "chart",
      title: "Sleep trend",
      kind: "sleep",
      series: points,
    });
  }

  return blocks;
}

/** One- or two-sentence plain-text sleep summary. Empty-safe; no markdown. */
export function summarizeSleep(slice: SleepSlice): string {
  const parts: string[] = [];
  if (isNum(slice.lastNightHours)) {
    parts.push(`${round1(slice.lastNightHours)}h last night`);
  }
  if (isNum(slice.avgHours)) parts.push(`${round1(slice.avgHours)}h avg this week`);
  if (parts.length === 0) return "Sleep: no data yet.";
  return `Sleep: ${parts.join(", ")}.`;
}
