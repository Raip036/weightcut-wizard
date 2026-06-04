/**
 * Multi-camp trends (2026-06-04): the longitudinal "your cut, fight over fight"
 * read model. Phase 4 of the Fight Camp Coach redesign.
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 4 (multi-camp history & trends).
 *
 * `getCampTrends` is an authed `query` (indexed reads only, no node/fetch). It
 * loads the calling fighter's COMPLETED camps oldest-first, distils each to a
 * `CampTrendPoint`, and derives a cut series, average cut/rebound, and a coarse
 * `trend` verdict. Every field degrades gracefully: missing data → null, never
 * a throw — an empty roster returns the empty shape.
 *
 * GATING: this is intentionally UNGATED at the backend. Trends are read-only
 * aggregates of the user's own data; the calling UI is responsible for the Pro
 * gate via `useFeatureAccess` before rendering the trends surface. Keeping the
 * query open avoids a server round-trip just to discover access state and keeps
 * the gate in one place (the client) per the rest of the coach feature.
 *
 * Field mapping (fight_camps → CampTrendPoint) reuses Phase 3
 * (`coachCampHistory_internal.ts`):
 *   name                  → name
 *   fightDate             → dateISO
 *   totalWeightCut        → cutKg              (null when not captured)
 *   rehydrationNotes      → reboundKg          (parsed from free text; null if absent)
 *   startingWeight/fight  → durationDays        (derived from camp span when possible)
 *   performanceFeeling    → performanceFeeling (null when blank)
 *
 * DATA GAP (same as Phase 3): `fight_camps` has no numeric rebound column, so
 * `reboundKg` is best-effort parsed from the free-text `rehydrationNotes`. There
 * is also no explicit camp-start date, so `durationDays` is left null until the
 * post-fight debrief capture flow (spec §6) lands a real start field.
 */
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_CAMPS = 10;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

// ── Public contract ──────────────────────────────────────────────────────

/** One completed camp, distilled to the figures the trends surface charts. */
export interface CampTrendPoint {
  /** Camp name (e.g. "Spring Open"). */
  name: string;
  /** Fight date, ISO YYYY-MM-DD. */
  dateISO: string;
  /** Total weight cut for the camp, kg. `null` when not captured. */
  cutKg: number | null;
  /** Rebound after weigh-in, kg. `null` when no figure was captured. */
  reboundKg: number | null;
  /** Camp duration in days. `null` until a real start date is captured. */
  durationDays: number | null;
  /** Self-reported performance ("felt strong", "flat", …). `null` if blank. */
  performanceFeeling: string | null;
}

/** Longitudinal trends across a fighter's completed camps. */
export interface CampTrends {
  /** Completed camps, oldest-first, capped at ~10. */
  camps: CampTrendPoint[];
  /** Cut kg per camp, oldest-first; only camps with a captured cut. */
  cutSeries: { x: string; y: number }[];
  /** Mean total cut across camps that captured one. `null` when none. */
  avgCutKg: number | null;
  /** Mean rebound across camps that captured one. `null` when none. */
  avgReboundKg: number | null;
  /** Coarse direction of recent cuts vs earlier ones. `null` when too few. */
  trend: "improving" | "steady" | "worsening" | null;
}

// ── Small pure helpers ────────────────────────────────────────────────────

/** Pull the first plausible kg figure out of free-text rehydration notes,
 *  e.g. "rebounded 3.8 kg overnight" → 3.8. Returns null when none is found. */
function parseReboundKg(notes: string | undefined | null): number | null {
  if (!notes) return null;
  const m = /(\d+(?:\.\d+)?)\s*kg\b/i.exec(notes);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0 || val > 15) return null;
  return round1(val);
}

/** Coerce an optional numeric column to a rounded value or null. */
function num(v: number | undefined | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? round1(v) : null;
}

/** Mean of a list, rounded; null when empty. */
function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return round1(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** Map a feeling string to a coarse 1..3 score (worse → better). Unknown
 *  phrasings score a neutral 2 so they neither lift nor drag the trend. */
function feelingScore(feeling: string | null): number {
  if (!feeling) return 2;
  const f = feeling.toLowerCase();
  if (/\b(strong|great|sharp|good|energ|fresh|peak)\b/.test(f)) return 3;
  if (/\b(flat|weak|drained|depleted|terrible|bad|awful|empty|sluggish)\b/.test(f)) {
    return 1;
  }
  return 2;
}

/** Map a `fight_camps` row to the trimmed `CampTrendPoint` contract. */
function toTrendPoint(camp: {
  name: string;
  fightDate: string;
  totalWeightCut?: number | null;
  rehydrationNotes?: string | null;
  performanceFeeling?: string | null;
}): CampTrendPoint {
  const feel = camp.performanceFeeling?.trim();
  return {
    name: camp.name,
    dateISO: camp.fightDate,
    cutKg: num(camp.totalWeightCut),
    reboundKg: parseReboundKg(camp.rehydrationNotes),
    // No explicit camp-start column on `fight_camps` yet (see header DATA GAP).
    durationDays: null,
    performanceFeeling: feel ? feel : null,
  };
}

/**
 * Coarse trend over the camps. A cut is "better" when it is SMALLER in
 * magnitude (less weight to shed) and/or the fighter felt stronger. We split
 * the camps (oldest-first) into an earlier half and a recent half, then compare
 * a blended score (lower cut + higher feeling). Needs >= 2 camps; falls back to
 * null otherwise. The +/- threshold keeps small wobble reported as "steady".
 */
function computeTrend(camps: CampTrendPoint[]): CampTrends["trend"] {
  if (camps.length < 2) return null;

  const mid = Math.floor(camps.length / 2);
  const earlier = camps.slice(0, mid);
  const recent = camps.slice(mid);
  if (earlier.length === 0 || recent.length === 0) return null;

  // Blended camp score: invert cut magnitude (smaller cut = better) and add a
  // feeling bonus. Camps with no cut figure lean on feeling alone.
  const score = (group: CampTrendPoint[]): number => {
    const vals = group.map((c) => {
      const cutPenalty = c.cutKg !== null ? c.cutKg : 0;
      return feelingScore(c.performanceFeeling) - cutPenalty * 0.3;
    });
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const delta = score(recent) - score(earlier);
  if (delta > 0.4) return "improving";
  if (delta < -0.4) return "worsening";
  return "steady";
}

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * Multi-camp trends for the calling fighter. Returns the empty shape when not
 * authed or when there is no completed-camp history. Never throws.
 *
 * A camp counts as COMPLETED when `isCompleted === true` OR its `fightDate` is
 * in the past — matching Phase 3's `getCampHistory`. The `by_user` index has no
 * date component, so we collect the user's camps (a fighter has a handful, not
 * thousands) and sort/cap in memory.
 */
export const getCampTrends = query({
  args: {},
  handler: async (ctx): Promise<CampTrends> => {
    const empty: CampTrends = {
      camps: [],
      cutSeries: [],
      avgCutKg: null,
      avgReboundKg: null,
      trend: null,
    };

    const userId = await getAuthUserId(ctx);
    if (!userId) return empty;

    const today = todayIso();
    const all = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const completed = all.filter(
      (c) =>
        c.isCompleted === true ||
        (typeof c.fightDate === "string" && c.fightDate < today),
    );
    if (completed.length === 0) return empty;

    // Oldest-first (ISO strings sort lexicographically), then cap to the most
    // recent MAX_CAMPS by slicing the tail.
    completed.sort((a, b) => a.fightDate.localeCompare(b.fightDate));
    const recentSlice =
      completed.length > MAX_CAMPS ? completed.slice(-MAX_CAMPS) : completed;

    const camps = recentSlice.map(toTrendPoint);

    const cutSeries = camps
      .filter((c) => c.cutKg !== null)
      .map((c) => ({ x: c.dateISO, y: c.cutKg as number }));

    const cuts = camps
      .map((c) => c.cutKg)
      .filter((v): v is number => v !== null);
    const rebounds = camps
      .map((c) => c.reboundKg)
      .filter((v): v is number => v !== null);

    return {
      camps,
      cutSeries,
      avgCutKg: avg(cuts),
      avgReboundKg: avg(rebounds),
      trend: computeTrend(camps),
    };
  },
});
