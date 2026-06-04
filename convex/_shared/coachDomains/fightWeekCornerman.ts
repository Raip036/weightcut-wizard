/* ------------------------------------------------------------------ */
/* Domain card builder: DAILY FIGHT-WEEK CORNERMAN (2026-06-04).        */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md (5, Phase 3.2) */
/*                                                                     */
/* PURE functions only — no Convex ctx, no LLM, no I/O. A sibling       */
/* loader reads today's prescribed step from the stored fight-week plan */
/* (weight_protocols) and reconciles it against actual fight_week_logs, */
/* producing a FightWeekCornermanData. This module maps that onto the   */
/* generic CoachBlock primitives in ../aiSchemas. Numbers are           */
/* server-authoritative; the LLM never emits these. Block field caps in  */
/* aiSchemas are respected here (checklist title ≤40, item label ≤60,    */
/* 1–6 items; callout text ≤200). No data / no plan → []. Summary is     */
/* plain text, no markdown, no em-dashes, numbers already formatted.     */
/* ------------------------------------------------------------------ */

import type { CoachBlock } from "../aiSchemas";

// ── Input contract (the sibling loader produces this) ───────────────────────

export interface FightWeekCornermanData {
  hasPlan: boolean;
  /** e.g. "Water load - Day 2" or "Cut day" or "Weigh-in day". */
  dayLabel: string | null;
  daysToWeighIn: number | null;
  /** Today's prescribed targets vs actual, e.g.
   *  { label: "Fluid", target: "6 L", actual: "3 L", met: false }. */
  steps: { label: string; target: string; actual?: string; met?: boolean }[];
  /** Optional coach note for today, carried straight from the plan. */
  note?: string;
}

// ── Small pure helpers ──────────────────────────────────────────────────────

const CHECKLIST_TITLE_MAX = 40;
const CHECKLIST_LABEL_MAX = 60;
const CHECKLIST_MAX_ITEMS = 6;
const CALLOUT_TEXT_MAX = 200;

function cap(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** A step is off-track only when it is explicitly marked not met. An
 *  undefined `met` means "not measurable yet", which is not a miss. */
function isMissed(step: FightWeekCornermanData["steps"][number]): boolean {
  return step.met === false;
}

/**
 * Checklist item label for a step. Prefers a compact "actual/target"
 * read when an actual is known ("Fluid 3/6 L"), else just shows the
 * target ("Fluid 6 L"). Capped to the schema label limit.
 */
function stepItemLabel(
  step: FightWeekCornermanData["steps"][number],
): string {
  const actual = step.actual?.trim();
  const target = step.target.trim();
  const body = actual ? `${actual} / ${target}` : target;
  return cap(`${step.label.trim()} ${body}`, CHECKLIST_LABEL_MAX);
}

// ── Cards ────────────────────────────────────────────────────────────────────

/**
 * Cornerman cards reconciling today's plan against what was logged.
 *  - no plan → [] (the action falls back to generic guidance).
 *  - else a `checklist` "Today: {dayLabel}" of each step (1–6, capped),
 *    done = step met; plus a single `callout` summarizing on/off-track
 *    state (tone "warn" if anything is missed, else "info").
 * Always ≤3 blocks.
 */
export function buildFightWeekCornermanCards(
  data: FightWeekCornermanData,
): CoachBlock[] {
  if (!data.hasPlan) return [];

  const blocks: CoachBlock[] = [];

  const steps = data.steps.slice(0, CHECKLIST_MAX_ITEMS);
  if (steps.length > 0) {
    const title = cap(
      `Today: ${(data.dayLabel ?? "Fight week").trim()}`,
      CHECKLIST_TITLE_MAX,
    );
    blocks.push({
      type: "checklist",
      title,
      items: steps.map((step) => ({
        label: stepItemLabel(step),
        ...(typeof step.met === "boolean" ? { done: step.met } : {}),
      })),
    });
  }

  const missed = data.steps.filter(isMissed);
  if (missed.length > 0) {
    const lead = missed[0];
    const gap = lead.actual
      ? `You logged ${lead.actual.trim()} of ${lead.target.trim()} on ${lead.label.trim().toLowerCase()}`
      : `You are behind on ${lead.label.trim().toLowerCase()} (target ${lead.target.trim()})`;
    const more =
      missed.length > 1 ? ` Plus ${missed.length - 1} other target(s) off track.` : "";
    blocks.push({
      type: "callout",
      tone: "warn",
      text: cap(`${gap}. Catch up before the next phase.${more}`, CALLOUT_TEXT_MAX),
    });
  } else if (steps.length > 0) {
    blocks.push({
      type: "callout",
      tone: "info",
      text: cap(
        data.note?.trim()
          ? data.note.trim()
          : "On plan for today. Hold the line and keep logging.",
        CALLOUT_TEXT_MAX,
      ),
    });
  }

  return blocks.slice(0, 3);
}

/**
 * One- to two-sentence factual summary for the LLM. Empty string when
 * there is no plan. No markdown, no em-dashes; numbers already formatted
 * by the loader.
 */
export function summarizeFightWeekCornerman(
  data: FightWeekCornermanData,
): string {
  if (!data.hasPlan) return "";

  const day = (data.dayLabel ?? "Fight week").trim();
  const countdown =
    typeof data.daysToWeighIn === "number"
      ? data.daysToWeighIn <= 0
        ? "weigh-in today"
        : `${data.daysToWeighIn} day(s) to weigh-in`
      : null;

  const stepBits = data.steps.slice(0, CHECKLIST_MAX_ITEMS).map((step) => {
    const read = step.actual
      ? `${step.actual.trim()} of ${step.target.trim()}`
      : step.target.trim();
    const state =
      step.met === false ? " (behind)" : step.met === true ? " (on target)" : "";
    return `${step.label.trim().toLowerCase()} ${read}${state}`;
  });

  const head = countdown ? `${day}, ${countdown}` : day;
  const body = stepBits.length > 0 ? `: ${stepBits.join(", ")}` : "";
  return cap(`${head}${body}.`, 280);
}
