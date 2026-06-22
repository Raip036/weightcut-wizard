import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";
import { normalizeLegacySession } from "./lib/sessionTypes";

/**
 * Sparring To-Do List — per-discipline AI-generated checklist of techniques
 * to deliberately work in live rounds. Driven by the athlete's logged
 * techniques (training_techniques) + recent session technique notes
 * (fight_camp_calendar.techniquesNotes).
 *
 * Public surface (called from React):
 *   - listSparringAssignments  — all assignments for the auth user (opt. by discipline)
 *   - getSparringFeatureStatus — Pro/free state for the widget gating
 *   - toggleAssignment         — tick / untick a single assignment row
 *   - regenerateDiscipline     — manual "Regenerate" button
 *
 * Internal surface (called from the `generateSparringPlanIfReady` action):
 *   - getSparringSourceData    — logged techniques + recent notes + existing rows
 *   - upsertAssignments        — persist generated assignments (preserve status)
 */

type SparringAssignment = Doc<"sparring_assignments">;

// How far back to scan session notes for the generator's source signal.
const RECENT_NOTES_WINDOW_DAYS = 45;
const RECENT_NOTES_CAP = 20;

// ───────────────────────────────────────────────────────────────────────────
// Public queries
// ───────────────────────────────────────────────────────────────────────────

/**
 * All sparring assignments for the current user, newest activity first. When
 * `discipline` is supplied the result is scoped to that discipline via the
 * by_user_discipline index; otherwise every assignment is returned.
 */
export const listSparringAssignments = query({
  args: { discipline: v.optional(v.string()) },
  handler: async (ctx, { discipline }): Promise<SparringAssignment[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = discipline
      ? await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user_discipline", (q) =>
            q.eq("userId", userId).eq("discipline", discipline),
          )
          .collect()
      : await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();

    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Pro/free state used by the widget to decide whether to render the live
 * checklist or the locked upsell card. Mirrors
 * `training_missions.getMissionFeatureStatus`.
 */
export const getSparringFeatureStatus = query({
  args: {},
  handler: async (ctx): Promise<{ isPro: boolean }> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return { isPro: false };
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { isPro: effectiveTier(profile) === "pro" };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Public mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * Flip a single assignment between "todo" and "done". Sets `completedAt`
 * when transitioning to done, clears it when reverting to todo, and always
 * bumps `updatedAt`. Awards a small discipline-XP nudge (fire-and-forget)
 * only on the todo → done transition.
 */
export const toggleAssignment = mutation({
  args: { id: v.id("sparring_assignments") },
  handler: async (ctx, { id }): Promise<{ status: "todo" | "done" }> => {
    const userId = await requireUserId(ctx);

    const row = await ctx.db.get(id);
    if (!row) throw new Error("Assignment not found");
    if (row.userId !== userId) throw new Error("Forbidden");

    const now = Date.now();
    const nextStatus = row.status === "done" ? "todo" : "done";
    await ctx.db.patch(id, {
      status: nextStatus,
      completedAt: nextStatus === "done" ? now : undefined,
      updatedAt: now,
    });

    // XP — only when transitioning INTO done. Fire-and-forget so a
    // scheduler/codegen hiccup can never block the tick.
    if (nextStatus === "done") {
      try {
        await ctx.scheduler.runAfter(0, internal.user_discipline_xp.awardXp, {
          userId,
          sport: row.discipline,
          amount: 15,
          reason: "sparring_assignment_done",
        });
      } catch (err) {
        console.warn("sparring_plan: xp schedule failed", err);
      }
    }

    return { status: nextStatus };
  },
});

/**
 * Manual "Regenerate" button. Schedules the generator action with
 * `force: true` so it re-rolls the discipline even when nothing materially
 * changed. Try-wrapped so a not-yet-deployed action can't break the call.
 */
export const regenerateDiscipline = mutation({
  args: { discipline: v.string() },
  handler: async (ctx, { discipline }): Promise<{ scheduled: true }> => {
    const userId = await requireUserId(ctx);
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.sparringPlan.generate.generateSparringPlanIfReady,
        { userId, sport: discipline, force: true },
      );
    } catch (err) {
      console.warn("sparring_plan.regenerateDiscipline: schedule failed", err);
    }
    return { scheduled: true };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Internal — called by the generator action
// ───────────────────────────────────────────────────────────────────────────

/**
 * Source signal for the generator: the user's logged techniques for this
 * discipline, recent session technique notes (last 45 days), and the
 * fingerprints of any assignments that already exist (so the action can
 * skip techniques that haven't materially changed).
 */
export const getSparringSourceData = internalQuery({
  args: { userId: v.id("users"), discipline: v.string() },
  handler: async (
    ctx,
    { userId, discipline },
  ): Promise<{
    loggedTechniques: Array<{
      technique: string;
      techniqueNormalized: string;
      cue?: string;
      detail: string;
    }>;
    recentNotes: string[];
    existing: Array<{ techniqueNormalized: string; sourceFingerprint: string }>;
  }> => {
    // Logged techniques for (user, discipline).
    const techniqueRows = await ctx.db
      .query("training_techniques")
      .withIndex("by_user_discipline", (q) =>
        q.eq("userId", userId).eq("discipline", discipline),
      )
      .collect();
    const loggedTechniques = techniqueRows.map((t) => ({
      technique: t.technique,
      techniqueNormalized: t.techniqueNormalized,
      cue: t.cue,
      detail: t.detail,
    }));

    // Recent session technique notes whose primary discipline matches, within
    // the trailing window, newest first, capped. `date` is a YYYY-MM-DD string
    // so the cutoff compares lexicographically via the by_user_date index.
    const cutoffMs = Date.now() - RECENT_NOTES_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
    const sessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", cutoffDate),
      )
      .collect();
    const recentNotes = sessions
      .filter((s) => {
        const primary = normalizeLegacySession(
          s.sessionType,
          s.sessionTag,
        ).primary;
        return (
          primary === discipline && (s.techniquesNotes?.trim().length ?? 0) > 0
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, RECENT_NOTES_CAP)
      .map((s) => s.techniquesNotes as string);

    // Existing assignments for (user, discipline) — projected to dedup keys.
    const existingRows = await ctx.db
      .query("sparring_assignments")
      .withIndex("by_user_discipline", (q) =>
        q.eq("userId", userId).eq("discipline", discipline),
      )
      .collect();
    const existing = existingRows.map((r) => ({
      techniqueNormalized: r.techniqueNormalized,
      sourceFingerprint: r.sourceFingerprint,
    }));

    return { loggedTechniques, recentNotes, existing };
  },
});

/**
 * Persist generated assignments. For each entry: if a row already exists for
 * (userId, techniqueNormalized) we patch the AI-derived fields and bump
 * updatedAt while PRESERVING the user's `status` / `completedAt` /
 * `landedCount` / `masteredAt`. Otherwise we insert a fresh "todo" row.
 *
 * Extended for Mastery Spine (Task 2.4): accepts optional `source`,
 * `combinations`, `timesLogged`, `sourceMissionId`, and `landedCount`.
 * On insert all supplied fields are written. On update AI-derived content
 * (`whenToUse`, `setups`, `counters`, `combinations`, `timesLogged`,
 * `source`, `sourceMissionId`) is refreshed; user-owned state (`status`,
 * `completedAt`, `landedCount`, `masteredAt`) is preserved.
 */
export const upsertAssignments = internalMutation({
  args: {
    userId: v.id("users"),
    discipline: v.string(),
    assignments: v.array(
      v.object({
        technique: v.string(),
        techniqueNormalized: v.string(),
        whenToUse: v.string(),
        setups: v.array(v.string()),
        counters: v.array(v.string()),
        sourceFingerprint: v.string(),
        // Mastery Spine extras (all optional so existing callers are unchanged)
        source: v.optional(v.union(v.literal("graduated"), v.literal("library"))),
        sourceMissionId: v.optional(v.id("training_missions")),
        landedCount: v.optional(v.number()),
        combinations: v.optional(v.array(v.string())),
        timesLogged: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { userId, discipline, assignments }): Promise<void> => {
    const now = Date.now();
    for (const a of assignments) {
      const existing = await ctx.db
        .query("sparring_assignments")
        .withIndex("by_user_norm", (q) =>
          q.eq("userId", userId).eq("techniqueNormalized", a.techniqueNormalized),
        )
        .first();
      if (existing) {
        // Preserve status + completedAt + landedCount + masteredAt — the
        // user's checkbox/counter state survives regeneration. Only refresh
        // AI-derived content and Mastery Spine provenance fields.
        await ctx.db.patch(existing._id, {
          whenToUse: a.whenToUse,
          setups: a.setups,
          counters: a.counters,
          sourceFingerprint: a.sourceFingerprint,
          // Mastery Spine: refresh these on every regen; do NOT touch
          // status / completedAt / landedCount / masteredAt.
          ...(a.source !== undefined && { source: a.source }),
          ...(a.sourceMissionId !== undefined && {
            sourceMissionId: a.sourceMissionId,
          }),
          ...(a.combinations !== undefined && { combinations: a.combinations }),
          ...(a.timesLogged !== undefined && { timesLogged: a.timesLogged }),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("sparring_assignments", {
          userId,
          discipline,
          technique: a.technique,
          techniqueNormalized: a.techniqueNormalized,
          whenToUse: a.whenToUse,
          setups: a.setups,
          counters: a.counters,
          sourceFingerprint: a.sourceFingerprint,
          status: "todo",
          createdAt: now,
          updatedAt: now,
          // Mastery Spine extras — written on first insert only.
          ...(a.source !== undefined && { source: a.source }),
          ...(a.sourceMissionId !== undefined && {
            sourceMissionId: a.sourceMissionId,
          }),
          ...(a.landedCount !== undefined && { landedCount: a.landedCount }),
          ...(a.combinations !== undefined && { combinations: a.combinations }),
          ...(a.timesLogged !== undefined && { timesLogged: a.timesLogged }),
        });
      }
    }
  },
});

/**
 * Point-lookup for a sparring assignment by its normalised technique key.
 * Returns the first matching row (there should be at most one, keyed on
 * `by_user_norm`), or `null` if none exists.
 *
 * Used by `generateMissionIfReady` (Model B, Task 2.2) to deduplicate: if a
 * non-mastered assignment already exists, we reinforce rather than duplicate.
 * If the assignment is mastered (`masteredAt != null`), a fresh mission journey
 * is allowed and the caller handles that by ignoring this result.
 */
export const findAssignmentByNorm = internalQuery({
  args: {
    userId: v.id("users"),
    techniqueNormalized: v.string(),
  },
  handler: async (ctx, { userId, techniqueNormalized }) => {
    return await ctx.db
      .query("sparring_assignments")
      .withIndex("by_user_norm", (q) =>
        q.eq("userId", userId).eq("techniqueNormalized", techniqueNormalized),
      )
      .first();
  },
});
