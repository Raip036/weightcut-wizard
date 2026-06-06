/**
 * Post-fight debrief capture (Fight Camp Coach redesign — Phase 3, spec §5/§6).
 *
 * Cross-camp memory ("last camp you rebounded 3.8kg in 24h and felt strong")
 * only works if `fight_camps` retrospective fields are reliably populated. The
 * existing wrap-up flow (`fight_camp.completeCamp` via `NextCampFlow`) only
 * fires when the user *starts a new camp* — so a fighter who finishes a camp
 * and doesn't immediately plan the next one never records how it went.
 *
 * This module adds:
 *  - `recordDebrief`     — write the debrief fields onto a camp the user owns.
 *  - `getPendingDebrief` — surface the most recent past camp still missing a
 *                          debrief so the UI can prompt at the right moment.
 *
 * Schema note (see convex/schema.ts → fight_camps): there is no dedicated
 * `debriefCompletedAt` flag, so we treat a set `performanceFeeling` as the
 * "debrief done" marker (mirrors `completeCamp`'s existing semantics). There
 * is likewise no dedicated rebound column, so rebound kg + the free-text
 * "what I'd change" note are folded into the existing `rehydrationNotes`
 * field — the schema is NOT modified.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";

const ISO_DATE_LEN = 10; // "YYYY-MM-DD"

/** Today as YYYY-MM-DD from the server clock (matches fight_camp.ts). */
function todayIso(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LEN);
}

/**
 * A camp counts as "needs a debrief" when its fight date has passed but no
 * `performanceFeeling` has been recorded yet. `isCompleted` alone is not the
 * gate: a user can mark a camp complete (or simply let the date lapse)
 * without ever reflecting on it, and that's exactly the gap we want to fill.
 */
function needsDebrief(camp: {
  fightDate: string;
  performanceFeeling?: string;
}): boolean {
  const hasFeeling =
    typeof camp.performanceFeeling === "string" &&
    camp.performanceFeeling.trim().length > 0;
  return camp.fightDate < todayIso() && !hasFeeling;
}

/**
 * Compose the rebound kg + free-text note into the single `rehydrationNotes`
 * column. Kept machine-parseable (a `rebound:` prefix line) so cross-camp
 * memory can read the rebound back out later without a schema migration.
 */
function composeRehydrationNotes(
  reboundKg: number | undefined,
  notes: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (typeof reboundKg === "number" && Number.isFinite(reboundKg)) {
    parts.push(`rebound: ${reboundKg}kg`);
  }
  const trimmed = notes?.trim();
  if (trimmed) parts.push(trimmed);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Record the post-fight debrief for a camp the caller owns. Marks the camp
 * completed (idempotent) and writes the retrospective fields the schema
 * already supports. Re-recording overwrites the prior debrief.
 */
export const recordDebrief = mutation({
  args: {
    campId: v.id("fight_camps"),
    // Free-form feeling string to mirror the existing `performanceFeeling`
    // convention (NextCampFlow stores chip values like "won_strong"). The
    // UI sends one of: "strong" | "ok" | "drained" (or a chip value).
    performanceFeeling: v.string(),
    // Actual 24h rebound after the weigh-in, in kg. Optional — the fighter
    // may not have weighed back. Folded into `rehydrationNotes`.
    reboundKg: v.optional(v.number()),
    // "What I'd change next time" — also folded into `rehydrationNotes`.
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { campId, performanceFeeling, reboundKg, notes }) => {
    const userId = await requireUserId(ctx);

    const camp = await ctx.db.get(campId);
    if (!camp) throw new Error("Camp not found");
    if (camp.userId !== userId) throw new Error("Not authorized");

    const feeling = performanceFeeling.trim();
    if (!feeling) throw new Error("performanceFeeling is required");

    if (reboundKg !== undefined) {
      if (!Number.isFinite(reboundKg)) {
        throw new Error("reboundKg must be a finite number");
      }
      // Sanity bound — a 24h rehydration rebound never exceeds ~15kg.
      if (reboundKg < 0 || reboundKg > 15) {
        throw new Error("reboundKg must be between 0 and 15 kg");
      }
    }

    const patch: Record<string, unknown> = {
      performanceFeeling: feeling,
      // Set the completed marker too so a debriefed-but-not-yet-wrapped camp
      // drops out of any "active camp" surfaces.
      isCompleted: true,
      updatedAt: Date.now(),
    };

    const rehydrationNotes = composeRehydrationNotes(reboundKg, notes);
    if (rehydrationNotes !== undefined) {
      patch.rehydrationNotes = rehydrationNotes;
    }

    await ctx.db.patch(campId, patch as any);
    return campId;
  },
});

/**
 * Most recent PAST camp belonging to the caller that still needs a debrief
 * (fight date has passed AND no `performanceFeeling` recorded). Returns the
 * minimal shape the prompt card needs, or `null` when nothing is pending.
 *
 * Bounded scan: most users have < 50 camps; we take the newest slice via the
 * by_user index and filter in memory (same pattern as `getActiveCamp`).
 */
export const getPendingDebrief = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("fight_camps"),
      name: v.string(),
      fightDate: v.string(),
      eventName: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    const rows = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    if (rows.length === 0) return null;

    // Among camps still needing a debrief, surface the one whose fight was
    // most recent (closest to today) — that's the freshest in the fighter's
    // mind and the one worth reflecting on first.
    const pending = rows
      .filter((r) => needsDebrief(r))
      .sort((a, b) => b.fightDate.localeCompare(a.fightDate));

    const camp = pending[0];
    if (!camp) return null;

    return {
      _id: camp._id,
      name: camp.name,
      fightDate: camp.fightDate,
      eventName: camp.eventName ?? null,
    };
  },
});
