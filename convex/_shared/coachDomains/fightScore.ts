/**
 * Domain card-builder for the FIGHT FORM SCORE domain.
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *
 * PURE functions: no Convex ctx, no LLM, no I/O. They map a `FightScoreSlice`
 * (hydrated by the data-loader) onto generic `CoachBlock` primitives so the
 * renderer stays domain-agnostic. The numbers are SERVER-AUTHORITATIVE — the
 * LLM never emits them, the action merges these blocks in.
 */

import type { CoachBlock } from "../aiSchemas";
import type { FightScoreSlice } from "./types";

// ── Tone thresholds (0–100 scale) ───────────────────────────────────────
// Sub-scores are expected on a 0–100 scale. We bucket into three bands so a
// glance at the ring tells you which pillars are dragging the score down.
//   good: >= 67   |   warn: 34–66   |   bad: < 34
// Robust to 0–10 inputs: such values just fall into the `bad` band and still
// render their raw number (no crash, no rescaling assumption).
const TONE_GOOD_MIN = 67;
const TONE_WARN_MIN = 34;

/** Schema cap: `score_ring.sublabels` is `.max(5)`. */
const MAX_SUBLABELS = 5;

function toneFor(value: number): "good" | "warn" | "bad" {
  if (!Number.isFinite(value)) return "warn";
  if (value >= TONE_GOOD_MIN) return "good";
  if (value >= TONE_WARN_MIN) return "warn";
  return "bad";
}

/** Render a sub-score value as a short string without trailing noise. */
function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // Keep integers clean; trim decimals to one place if present.
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Truncate to keep callouts within the schema's 200-char cap. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

// The coach must NEVER surface raw keys to the athlete. `topLimiter` arrives as
// a sub-score key (e.g. "nutritionAdherence") and `status` as a raw label
// (e.g. "at_risk"); map both to natural language.
const LIMITER_LABEL: Record<string, string> = {
  trainingLoad: "Training load",
  sleep: "Sleep",
  weightCut: "Weight cut",
  wellness: "Recovery",
  recovery: "Recovery",
  nutritionAdherence: "Nutrition",
};

const STATUS_LABEL: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off pace",
  at_risk: "At risk",
  calibrating: "Calibrating",
};

/** Fallback: snake_case / camelCase to sentence case, so an unmapped key still
 *  reads as plain language instead of a raw identifier. */
function humanizeKey(raw: string): string {
  const spaced = raw
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return raw;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const limiterLabel = (raw: string): string => LIMITER_LABEL[raw] ?? humanizeKey(raw);
const statusLabel = (raw: string): string => STATUS_LABEL[raw] ?? humanizeKey(raw);

/**
 * Build the visual cards for the fight-form-score domain.
 *
 * Produces a `score_ring` (label "Fight Form", optionally "· PHASE"), with up
 * to five sub-score chips, and an optional `warn` callout naming the biggest
 * limiter. The callout is omitted entirely when no `topLimiter` is present.
 */
export function buildFightScoreCards(slice: FightScoreSlice): CoachBlock[] {
  const blocks: CoachBlock[] = [];

  // Calibrating: there is no real score yet, so do NOT render a 0/100 ring or a
  // "biggest limiter" warning (both would imply the athlete is failing). Show a
  // single neutral info note instead.
  if (slice.calibrating) {
    blocks.push({
      type: "callout",
      tone: "info",
      text: clamp(
        "Fight Form Score is still calibrating. Keep logging your training, sleep, weight, and check-ins to unlock it.",
        200,
      ),
    });
    return blocks;
  }

  const phase = slice.phase?.trim();
  const label = clamp(phase ? `Fight Form · ${phase}` : "Fight Form", 40);

  const sublabels = slice.subScores.slice(0, MAX_SUBLABELS).map((s) => ({
    label: clamp(s.label, 20),
    value: clamp(formatValue(s.value), 12),
    tone: toneFor(s.value),
  }));

  blocks.push({
    type: "score_ring",
    label,
    score: slice.score,
    status: clamp(statusLabel(slice.status), 32),
    ...(sublabels.length > 0 ? { sublabels } : {}),
  });

  const limiter = slice.topLimiter?.trim();
  if (limiter) {
    blocks.push({
      type: "callout",
      tone: "warn",
      text: clamp(`Biggest limiter: ${limiterLabel(limiter)}. Fix this first.`, 200),
    });
  }

  return blocks;
}

/**
 * 1–2 sentence plain-text summary of the fight-form score for the LLM prompt.
 * No markdown, no em-dashes. Sub-scores are listed inline so the model can
 * reference specifics without re-deriving the numbers.
 */
export function summarizeFightScore(slice: FightScoreSlice): string {
  // Calibrating: there is no real score yet. Tell the model explicitly so it
  // never reads 0 as a low score or tells the athlete they are behind.
  if (slice.calibrating) {
    return (
      "Fight Form Score is still calibrating (not enough logged data yet), so there is no score to report. " +
      "Do not treat this as a low score and do not tell the athlete they are behind, encourage them to keep logging to unlock it."
    );
  }

  const parts: string[] = [];

  const phase = slice.phase?.trim();
  const head =
    `Fight Form ${formatValue(slice.score)}/100 (${statusLabel(slice.status)})` +
    (phase ? `, phase ${phase}` : "") +
    ".";
  parts.push(head);

  const limiter = slice.topLimiter?.trim();
  if (limiter) parts.push(`Top limiter: ${limiterLabel(limiter)}.`);

  if (slice.subScores.length > 0) {
    const subs = slice.subScores
      .map((s) => `${s.label} ${formatValue(s.value)}`)
      .join(", ");
    parts.push(`Sub-scores: ${subs}.`);
  }

  return parts.join(" ");
}
