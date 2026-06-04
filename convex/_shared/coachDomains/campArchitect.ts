/* ------------------------------------------------------------------ */
/* OFF-SEASON "CAMP ARCHITECT" card builder (2026-06-04, Phase 4).      */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md §5 */
/*       (Phase 4 — "Off-season Camp Architect mode": between fights,    */
/*        the coach flips from cutting to planning — walk-around weight,  */
/*        when to start the next cut, base-building.)                     */
/*                                                                       */
/* PURE functions only — no Convex ctx, no LLM, no I/O. The data is       */
/* loaded + computed server-side by `convex/coachArchitect_internal.ts`;  */
/* these builders only MAP a typed slice onto the generic CoachBlock      */
/* primitives in ../aiSchemas (stat_card / callout / checklist). Numbers  */
/* are server-authoritative — the LLM never emits them. When the fighter  */
/* HAS an upcoming camp, architect mode is OFF and both functions are     */
/* no-ops ([] / ""). Block field caps in aiSchemas are respected here     */
/* (titles ≤40, value ≤16, unit ≤8, callout text ≤200, ≤6 items).         */
/* ------------------------------------------------------------------ */

import type { CoachBlock } from "../aiSchemas";

/** Server-computed off-season facts. All optional-ish fields are nullable
 *  so a sparse account (no history / no logs) degrades gracefully. */
export interface CampArchitectData {
  /** When true, a real camp is in flight → architect mode is OFF. */
  hasUpcomingCamp: boolean;
  /** Stable walk-around weight (median of recent stable logs or profile). */
  walkAroundKg: number | null;
  lastFightDateISO: string | null;
  monthsSinceLastFight: number | null;
  /** totalWeightCut of the most recent completed camp. */
  lastCampCutKg: number | null;
  /** Coarse "start your next cut ~N weeks out" suggestion. */
  suggestedNextCutWeeks: number | null;
  /** current − walkAround (positive = drifted up off the base). */
  driftFromWalkAroundKg: number | null;
}

// ── Small pure helpers ──────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Cap a string to a field max without splitting mid-word awkwardly. */
function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Drift tone (kg above the walk-around base). A little float is normal in
 * the off-season; a big gap means a tougher cut is brewing.
 *   ≤4kg  → good (comfortable base)
 *   4–8kg → warn (creeping up)
 *   >8kg  → bad  (long road back)
 */
function driftTone(drift: number): "good" | "warn" | "bad" {
  const d = Math.abs(drift);
  if (d <= 4) return "good";
  if (d <= 8) return "warn";
  return "bad";
}

/** Signed drift label for the stat-card subtitle, e.g. "+2.3kg vs base". */
function driftSubtitle(drift: number): string {
  const sign = drift >= 0 ? "+" : "−";
  return `${sign}${round1(Math.abs(drift))}kg vs base`;
}

// ── Card builder ─────────────────────────────────────────────────────────

/**
 * Off-season cards from a CampArchitectData slice:
 *  - returns `[]` immediately when `hasUpcomingCamp` (mode is OFF).
 *  - `stat_card` "Walk-around" — the base weight, toned by current drift
 *    (subtitle shows the signed drift when known; otherwise the months
 *    since the last fight as light context).
 *  - `checklist` "Base-building" — off-season focus items, ending with a
 *    "Start your cut ~N weeks out" item when a suggestion exists.
 *  - `callout` (info) framing the next-cut timing in plain words, only when
 *    we have a concrete week count.
 * Omits any card lacking data; the whole set is capped at the schema's 6.
 */
export function buildCampArchitectCards(data: CampArchitectData): CoachBlock[] {
  if (data.hasUpcomingCamp) return [];

  const blocks: CoachBlock[] = [];

  // 1) Walk-around stat card (base weight; tone driven by drift).
  if (isNum(data.walkAroundKg)) {
    const drift = data.driftFromWalkAroundKg;
    const tone: "good" | "warn" | "bad" | "neutral" = isNum(drift)
      ? driftTone(drift)
      : "neutral";
    const subtitle = isNum(drift)
      ? driftSubtitle(drift)
      : isNum(data.monthsSinceLastFight)
        ? `${Math.round(data.monthsSinceLastFight)} mo since last fight`
        : undefined;
    blocks.push({
      type: "stat_card",
      title: "Walk-around",
      value: `${round1(data.walkAroundKg)}`,
      unit: "kg",
      tone,
      ...(subtitle ? { subtitle: cap(subtitle, 80) } : {}),
    });
  }

  // 2) Base-building checklist (always useful off-season; final item is the
  //    "start your cut" trigger when we can suggest a window).
  const items: { label: string }[] = [
    { label: "Hold a steady walk-around — no big swings" },
    { label: "Build aerobic base + strength while you can" },
    { label: "Keep protein high, dial back nothing drastic" },
  ];
  if (isNum(data.suggestedNextCutWeeks)) {
    const wk = Math.round(data.suggestedNextCutWeeks);
    items.push({ label: cap(`Start your cut ~${wk} weeks out`, 60) });
  }
  blocks.push({
    type: "checklist",
    title: "Base-building",
    items: items.slice(0, 6),
  });

  // 3) Next-cut timing callout (only with a concrete suggestion).
  if (isNum(data.suggestedNextCutWeeks)) {
    const wk = Math.round(data.suggestedNextCutWeeks);
    const driftBit =
      isNum(data.driftFromWalkAroundKg) && data.driftFromWalkAroundKg > 0
        ? ` You're ${round1(data.driftFromWalkAroundKg)}kg above your base.`
        : "";
    blocks.push({
      type: "callout",
      tone: "info",
      text: cap(
        `No fight booked yet. When one lands, give yourself about ${wk} weeks to cut in cleanly.${driftBit}`,
        200,
      ),
    });
  }

  return blocks.slice(0, 6);
}

/** One- or two-sentence plain-text off-season summary for the LLM prompt.
 *  Empty string when architect mode is OFF (a camp is upcoming). No markdown. */
export function summarizeCampArchitect(data: CampArchitectData): string {
  if (data.hasUpcomingCamp) return "";

  const parts: string[] = [];
  if (isNum(data.walkAroundKg)) {
    parts.push(`walk-around ~${round1(data.walkAroundKg)}kg`);
  }
  if (isNum(data.driftFromWalkAroundKg)) {
    const d = data.driftFromWalkAroundKg;
    const sign = d >= 0 ? "+" : "−";
    parts.push(`${sign}${round1(Math.abs(d))}kg vs base`);
  }
  if (isNum(data.monthsSinceLastFight)) {
    parts.push(`${Math.round(data.monthsSinceLastFight)} months since last fight`);
  }
  if (isNum(data.lastCampCutKg)) {
    parts.push(`last camp cut ${round1(data.lastCampCutKg)}kg`);
  }

  const lead =
    parts.length === 0
      ? "Off-season: no upcoming fight; in base-building mode."
      : `Off-season (no fight booked): ${parts.join(", ")}.`;

  const advice = isNum(data.suggestedNextCutWeeks)
    ? ` Plan ~${Math.round(data.suggestedNextCutWeeks)} weeks for the next cut once a fight is set.`
    : "";

  return lead + advice;
}
