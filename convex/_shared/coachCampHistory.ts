/**
 * Cross-camp memory for the Fight Camp Coach (Phase 3, spec §5 + §6).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 3 item 4 ("Cross-camp memory") + §6 (Data Model).
 *
 * PURE functions: no Convex ctx, no LLM, no I/O. They take a `CampHistory`
 * (hydrated by `coachCampHistory_internal.getCampHistory`) and map it onto
 * generic `CoachBlock` primitives + a one-line prompt summary so the coach can
 * reference past completed camps ("last camp you rebounded 3.8kg and felt
 * strong"). Numbers are SERVER-AUTHORITATIVE — the LLM never emits them; the
 * action merges these blocks in and reads `summarizeCampHistory` into the
 * prompt facts.
 *
 * Same tight-cap / no-prose-blob discipline as the other domain builders
 * (`coachDomains/*`): every string is clamped to the matching schema `.max()`,
 * numbers are rounded, and the summary carries no markdown or em-dashes.
 */

import type { CoachBlock } from "./aiSchemas";

// ── Public contract ─────────────────────────────────────────────────────

/** One completed/past camp, distilled to the figures the coach references. */
export interface PastCamp {
  /** Camp name (e.g. "Spring Open"). */
  name: string;
  /** Fight date, ISO YYYY-MM-DD. */
  date: string;
  /** Total weight cut for the camp, kg. Omitted when not captured. */
  totalCutKg?: number;
  /** Rebound after weigh-in (fight-day weight minus weigh-in), kg. Omitted
   *  when no rehydration figure was captured. */
  reboundKg?: number;
  /** Self-reported performance ("felt strong", "flat", …). Omitted if blank. */
  performanceFeeling?: string;
  /** Portion of the cut achieved via dehydration, kg. Omitted when missing. */
  viaDehydrationKg?: number;
  /** Portion of the cut achieved via carb reduction, kg. Omitted when missing. */
  viaCarbKg?: number;
}

/** Most-recent first, capped ~5 by the loader. */
export interface CampHistory {
  camps: PastCamp[];
}

// ── Small pure helpers ──────────────────────────────────────────────────

/** Schema cap: `list.items` is `.max(6)`. We surface up to 5 past camps. */
const MAX_CAMP_ROWS = 5;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Clamp a string to a schema cap without trailing whitespace. */
function clamp(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** "2026-03-14" → "Mar". Falls back to the raw string if unparseable. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthLabel(iso: string): string {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(iso);
  if (!m) return iso;
  const idx = Number(m[1]) - 1;
  return idx >= 0 && idx < 12 ? MONTHS[idx] : iso;
}

/** Format a kg figure as a short "7.2kg" style string. */
const kg = (n: number): string => `${round1(n)}kg`;

// ── Cards ────────────────────────────────────────────────────────────────

/**
 * Build the visual cards for cross-camp memory.
 *
 * Produces a `list` titled "Past camps" (one row per camp: label = name + month,
 * value = total cut kg, meta = performance feeling) and, when enough rebound
 * figures exist, a `stat_card` for the typical (median) post-weigh-in rebound.
 * Returns [] when there is no history at all.
 */
export function buildCampHistoryCards(history: CampHistory): CoachBlock[] {
  const camps = history.camps ?? [];
  if (camps.length === 0) return [];

  const blocks: CoachBlock[] = [];

  const items = camps.slice(0, MAX_CAMP_ROWS).map((c) => {
    const label = clamp(`${c.name} (${monthLabel(c.date)})`, 48);
    const row: { label: string; value?: string; meta?: string } = { label };
    if (typeof c.totalCutKg === "number" && Number.isFinite(c.totalCutKg)) {
      row.value = clamp(kg(c.totalCutKg), 24);
    }
    const feel = c.performanceFeeling?.trim();
    if (feel) row.meta = clamp(feel, 32);
    return row;
  });

  blocks.push({
    type: "list",
    title: "Past camps",
    items,
  });

  // Typical rebound stat — median over the camps that captured a rebound.
  const rebounds = camps
    .map((c) => c.reboundKg)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (rebounds.length > 0) {
    const sorted = [...rebounds].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    blocks.push({
      type: "stat_card",
      title: "Typical rebound",
      value: clamp(String(round1(median)), 16),
      unit: "kg",
      tone: "neutral",
      subtitle: clamp(
        `Across ${rebounds.length} camp${rebounds.length === 1 ? "" : "s"} after weigh-in.`,
        80,
      ),
    });
  }

  return blocks;
}

/**
 * One-line plain-text summary of camp history for the LLM prompt facts.
 * Leads with the most recent camp (the figure the coach most often cites),
 * then appends a typical-rebound aggregate when available. No markdown, no
 * em-dashes; numbers rounded. Returns "" when there is no usable history.
 */
export function summarizeCampHistory(history: CampHistory): string {
  const camps = history.camps ?? [];
  if (camps.length === 0) return "";

  const parts: string[] = [];

  const last = camps[0];
  const lastBits: string[] = [];
  if (typeof last.totalCutKg === "number" && Number.isFinite(last.totalCutKg)) {
    lastBits.push(`cut ${kg(last.totalCutKg)}`);
  }
  if (typeof last.reboundKg === "number" && Number.isFinite(last.reboundKg)) {
    lastBits.push(`rebounded ${kg(last.reboundKg)} in 24h`);
  }
  const feel = last.performanceFeeling?.trim();
  if (feel) lastBits.push(`felt ${feel.toLowerCase()}`);

  if (lastBits.length > 0) {
    parts.push(`Last camp (${monthLabel(last.date)}): ${lastBits.join(", ")}.`);
  } else {
    parts.push(`Last camp was ${monthLabel(last.date)}.`);
  }

  if (camps.length > 1) {
    parts.push(`${camps.length} completed camps on record.`);
  }

  return parts.join(" ").trim();
}
