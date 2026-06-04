/**
 * Cross-camp memory (2026-06-04): the DATA LOADER.
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 3 item 4 ("Cross-camp memory") + §6 (Data Model).
 *
 * `getCampHistory` is the single internal query the Fight Camp Coach action
 * calls to hydrate past completed camps. It's a query — indexed reads only,
 * no node/fetch. Every field degrades gracefully: missing data → omitted
 * optional fields, never a throw. Numbers are rounded.
 *
 * A camp counts as PAST when it is explicitly `isCompleted === true` OR its
 * `fightDate` is in the past. Results are most-recent first (by fightDate),
 * capped at 5, mapped to the pure `PastCamp[]` contract in
 * `_shared/coachCampHistory.ts`.
 *
 * Field mapping (fight_camps → PastCamp):
 *   name                  → name
 *   fightDate             → date
 *   totalWeightCut        → totalCutKg
 *   weightViaDehydration  → viaDehydrationKg
 *   weightViaCarbReduction→ viaCarbKg
 *   performanceFeeling    → performanceFeeling
 *   rehydrationNotes      → reboundKg (parsed from free text; omitted if absent)
 *
 * DATA GAP: there is no dedicated numeric rebound column on `fight_camps`
 * (only `endWeightKg` = weigh-in/end weight and the free-text
 * `rehydrationNotes`). `reboundKg` is best-effort parsed from `rehydrationNotes`
 * and omitted when no kg figure can be read. Reliable population needs the
 * post-fight debrief capture flow noted in spec §6.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { CampHistory, PastCamp } from "./_shared/coachCampHistory";

const MAX_CAMPS = 5;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Pull the first kg figure out of free-text rehydration notes, e.g.
 *  "rebounded 3.8 kg overnight" → 3.8. Returns undefined when none is found
 *  or the value is implausible (guards against parsing a stray date/number). */
function parseReboundKg(notes: string | undefined): number | undefined {
  if (!notes) return undefined;
  // First number that is immediately followed by a kg unit token.
  const m = /(\d+(?:\.\d+)?)\s*kg\b/i.exec(notes);
  if (!m) return undefined;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0 || val > 15) return undefined;
  return round1(val);
}

/** Map a completed `fight_camps` row to the trimmed `PastCamp` contract.
 *  Missing/blank fields are omitted rather than written as null. */
function toPastCamp(camp: {
  name: string;
  fightDate: string;
  totalWeightCut?: number | null;
  weightViaDehydration?: number | null;
  weightViaCarbReduction?: number | null;
  performanceFeeling?: string | null;
  rehydrationNotes?: string | null;
}): PastCamp {
  const out: PastCamp = { name: camp.name, date: camp.fightDate };

  if (typeof camp.totalWeightCut === "number" && Number.isFinite(camp.totalWeightCut)) {
    out.totalCutKg = round1(camp.totalWeightCut);
  }
  if (
    typeof camp.weightViaDehydration === "number" &&
    Number.isFinite(camp.weightViaDehydration)
  ) {
    out.viaDehydrationKg = round1(camp.weightViaDehydration);
  }
  if (
    typeof camp.weightViaCarbReduction === "number" &&
    Number.isFinite(camp.weightViaCarbReduction)
  ) {
    out.viaCarbKg = round1(camp.weightViaCarbReduction);
  }

  const feel = camp.performanceFeeling?.trim();
  if (feel) out.performanceFeeling = feel;

  const rebound = parseReboundKg(camp.rehydrationNotes ?? undefined);
  if (rebound !== undefined) out.reboundKg = rebound;

  return out;
}

/**
 * Load PAST/completed camps for a user, most-recent first, capped at 5.
 * Resolves nothing itself — the action passes the already-resolved userId.
 */
export const getCampHistory = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<CampHistory> => {
    const today = todayIso();

    // The `by_user` index has no fightDate component, so we collect the user's
    // camps and sort/filter in memory. A fighter has a handful of camps, not
    // thousands, so this stays a cheap indexed read.
    const all = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const past = all.filter(
      (c) => c.isCompleted === true || (typeof c.fightDate === "string" && c.fightDate < today),
    );

    // Most-recent first by fight date (ISO strings sort lexicographically).
    past.sort((a, b) => b.fightDate.localeCompare(a.fightDate));

    const camps = past.slice(0, MAX_CAMPS).map(toPastCamp);
    return { camps };
  },
});
