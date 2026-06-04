/* ------------------------------------------------------------------ */
/* Training-load domain card builder (2026-06-04): domain-aware cards.  */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* Pure functions only — no ctx / IO. Maps a hydrated TrainingLoadSlice */
/* onto generic CoachBlock primitives (stat_card / chart / list) and    */
/* produces a compact factual summary line for the LLM prompt.          */
/* Mirrors the tight-cap discipline of CoachBlockSchema: every emitted  */
/* string is kept comfortably inside its `.max()` cap.                  */
/* ------------------------------------------------------------------ */

import type { CoachBlock } from "../aiSchemas";
import type { TrainingLoadSlice } from "./types";

/** Round to one decimal, dropping a trailing ".0" so "9.5h" / "7h". */
function fmtHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

/** Signed delta vs last week as a short chip, e.g. "+2.5h vs last week". */
function deltaSubtitle(weekHours: number, lastWeekHours: number): string {
  const diff = Math.round((weekHours - lastWeekHours) * 10) / 10;
  if (diff === 0) return "Same as last week";
  const sign = diff > 0 ? "+" : "-";
  return `${sign}${fmtHours(Math.abs(diff))}h vs last week`;
}

/**
 * Tone heuristic for the hours stat card:
 *  - "warn" on a big upward spike (>40% jump and >2h absolute), an injury
 *    risk signal worth surfacing.
 *  - "good" when volume is steady (within ~15% of last week).
 *  - "neutral" otherwise.
 */
function hoursTone(
  weekHours: number,
  lastWeekHours: number,
): "good" | "warn" | "neutral" {
  if (lastWeekHours <= 0) return "neutral";
  const ratio = weekHours / lastWeekHours;
  const absJump = weekHours - lastWeekHours;
  if (ratio > 1.4 && absJump > 2) return "warn";
  if (ratio >= 0.85 && ratio <= 1.15) return "good";
  return "neutral";
}

/** Build 1–3 CoachBlocks for the training-load domain. */
export function buildTrainingLoadCards(slice: TrainingLoadSlice): CoachBlock[] {
  const blocks: CoachBlock[] = [];
  const { weekHours, lastWeekHours, sessions, weeklySeries } = slice;

  // 1. This week's training hours stat card.
  if (weekHours > 0 || lastWeekHours > 0) {
    blocks.push({
      type: "stat_card",
      title: "Training this week",
      value: fmtHours(weekHours),
      unit: "hrs",
      tone: hoursTone(weekHours, lastWeekHours),
      subtitle: deltaSubtitle(weekHours, lastWeekHours),
      icon: "barbellOutline",
    });
  }

  // 2. Weekly load chart (server-supplied series only).
  if (weeklySeries.length > 0) {
    blocks.push({
      type: "chart",
      title: "Weekly load",
      kind: "training_load",
      series: weeklySeries.slice(-30).map((p) => ({ x: p.x, y: p.y })),
    });
  }

  // 3. Recent sessions list (newest first, capped at 6 per block schema).
  if (sessions.length > 0) {
    const items = sessions.slice(0, 6).map((s) => {
      const meta = s.intensity ? `${s.date} · ${s.intensity}` : s.date;
      return {
        label: s.type.slice(0, 48),
        value: `${Math.round(s.durationMin)}m`,
        meta: meta.slice(0, 32),
      };
    });
    blocks.push({ type: "list", title: "Recent sessions", items });
  }

  return blocks;
}

/** 1–2 sentence factual summary for the LLM prompt. No markdown / em-dashes. */
export function summarizeTrainingLoad(slice: TrainingLoadSlice): string {
  const { weekHours, lastWeekHours, sessions } = slice;
  const parts: string[] = [];

  parts.push(
    `Training: ${fmtHours(weekHours)}h this week vs ${fmtHours(lastWeekHours)}h last week`,
  );

  if (sessions.length > 0) {
    const last = sessions[0];
    const intensity = last.intensity ? `${last.intensity} ` : "";
    parts.push(
      `${sessions.length} sessions, last was ${Math.round(last.durationMin)}m ${intensity}${last.type}`,
    );
  } else {
    parts.push("no sessions logged");
  }

  return `${parts.join("; ")}.`;
}
