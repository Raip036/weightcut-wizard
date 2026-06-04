/**
 * Gym session + set CRUD.
 *
 * - `getSessionWithSets` does a one-query join of session + its sets
 *   (replaces the multi-roundtrip pattern in `useGymSessions.fetchHistory`).
 * - `createSession`, `addSetToSession`, `completeSession`, `deleteSession`
 *   are stand-alone mutations — clients call them rather than chaining
 *   inserts/updates in succession.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import type { Doc, Id } from "./_generated/dataModel";

function sessionToClient(row: Doc<"gym_sessions">) {
  return {
    id: row._id,
    user_id: row.userId,
    date: row.date,
    session_type: row.sessionType,
    session_tag: row.sessionTag ?? null,
    status: row.status,
    duration_minutes: row.durationMinutes,
    perceived_fatigue: row.perceivedFatigue,
    notes: row.notes,
    updated_at: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    // ISO string — matches the legacy Supabase contract that the UI relies on
    // (e.g. `.split("T")` in ExercisePerformanceChart, `new Date(s.created_at)` formatters).
    created_at: new Date(row._creationTime).toISOString(),
  };
}

function setToClient(row: Doc<"gym_sets">) {
  return {
    id: row._id,
    session_id: row.sessionId,
    exercise_id: row.exerciseId,
    user_id: row.userId,
    exercise_order: row.exerciseOrder,
    set_order: row.setOrder,
    reps: row.reps,
    weight_kg: row.weightKg ?? null,
    assisted_weight_kg: row.assistedWeightKg ?? null,
    rpe: row.rpe ?? null,
    is_warmup: row.isWarmup,
    is_bodyweight: row.isBodyweight,
    completed: row.completed ?? false,
    notes: row.notes ?? null,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────

export const listForUserByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .collect();
    return rows.map(sessionToClient);
  },
});

/** All sets for a given exercise — used by the analytics history chart.
 *  Returns most-recent first, capped to `limit` (default 50). */
export const listSetsForExercise = query({
  args: {
    exerciseId: v.id("exercises"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { exerciseId, limit }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("gym_sets")
      .withIndex("by_exercise_user", (q) =>
        q.eq("exerciseId", exerciseId).eq("userId", userId),
      )
      .collect();
    // is_warmup filter + recency sort applied here so the index does the bulk
    // of the work even though it doesn't sort by creationTime directly.
    return rows
      .filter((r) => !r.isWarmup)
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, limit ?? 50)
      .map(setToClient);
  },
});

export const listHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUserId(ctx);
    const sessions = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 20);
    const completed = sessions.filter((s) => s.status === "completed");
    // Join sets per session so the history detail sheet can render
    // exercises + reps without a second round-trip per row.
    const withSets = await Promise.all(
      completed.map(async (s) => {
        const sets = await ctx.db
          .query("gym_sets")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        return {
          ...sessionToClient(s),
          sets: sets.map(setToClient),
        };
      }),
    );
    return withSets;
  },
});

export const getSessionWithSets = query({
  args: { id: v.id("gym_sessions") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(id);
    if (!session) return null;
    if (session.userId !== userId) throw new Error("Not authorized");
    const sets = await ctx.db
      .query("gym_sets")
      .withIndex("by_session", (q) => q.eq("sessionId", id))
      .collect();
    return {
      ...sessionToClient(session),
      sets: sets.map(setToClient),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────

export const createSession = mutation({
  args: {
    date: v.string(),
    sessionType: v.string(),
    sessionTag: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const sessionId = await ctx.db.insert("gym_sessions", {
      userId,
      date: args.date,
      sessionType: args.sessionType,
      sessionTag: args.sessionTag,
      status: args.status ?? "in_progress",
      updatedAt: Date.now(),
    });
    // Recompute fight-form score after session creation. Recompute is
    // cheap + idempotent, so we hook unconditionally rather than try to
    // detect whether the session will ever be completed.
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: args.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
    return sessionId;
  },
});

export const addSetToSession = mutation({
  args: {
    sessionId: v.id("gym_sessions"),
    exerciseId: v.id("exercises"),
    exerciseOrder: v.number(),
    setOrder: v.number(),
    reps: v.number(),
    weightKg: v.optional(v.number()),
    assistedWeightKg: v.optional(v.number()),
    rpe: v.optional(v.number()),
    isWarmup: v.optional(v.boolean()),
    isBodyweight: v.optional(v.boolean()),
    completed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");
    const setId: Id<"gym_sets"> = await ctx.db.insert("gym_sets", {
      sessionId: args.sessionId,
      exerciseId: args.exerciseId,
      userId,
      exerciseOrder: args.exerciseOrder,
      setOrder: args.setOrder,
      reps: args.reps,
      weightKg: args.weightKg,
      assistedWeightKg: args.assistedWeightKg,
      rpe: args.rpe,
      isWarmup: args.isWarmup ?? false,
      isBodyweight: args.isBodyweight ?? false,
      completed: args.completed ?? false,
      notes: args.notes,
    });
    // Recompute fight-form score after adding a set. The session may end
    // up with durationMinutes + perceivedFatigue set even without
    // completeSession being called explicitly; hook unconditionally
    // since recompute is idempotent.
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: session.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
    return setId;
  },
});

export const updateSet = mutation({
  args: {
    id: v.id("gym_sets"),
    reps: v.optional(v.number()),
    weightKg: v.optional(v.number()),
    assistedWeightKg: v.optional(v.number()),
    rpe: v.optional(v.number()),
    isWarmup: v.optional(v.boolean()),
    completed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Set not found");
    if (row.userId !== userId) throw new Error("Not authorized");
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch as any);
    // Recompute fight-form score after set update. The set row doesn't
    // carry its own date — resolve it via the parent session.
    try {
      const session = await ctx.db.get(row.sessionId);
      if (session) {
        await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
          userId,
          date: session.date,
        });
      }
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const deleteSet = mutation({
  args: { id: v.id("gym_sets") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    // Capture the parent session's date BEFORE the delete so the
    // recompute hook below can still find it.
    let sessionDate: string | null = null;
    try {
      const session = await ctx.db.get(row.sessionId);
      sessionDate = session?.date ?? null;
    } catch {
      /* session missing — treat as no recompute target */
    }
    await ctx.db.delete(id);
    // Recompute fight-form score after set deletion
    if (sessionDate) {
      try {
        await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
          userId,
          date: sessionDate,
        });
      } catch (err) {
        console.warn("fight-form recompute schedule failed", err);
      }
    }
  },
});

export const completeSession = mutation({
  args: {
    id: v.id("gym_sessions"),
    durationMinutes: v.optional(v.number()),
    perceivedFatigue: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Session not found");
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(args.id, {
      status: "completed",
      durationMinutes: args.durationMinutes,
      perceivedFatigue: args.perceivedFatigue,
      notes: args.notes,
      updatedAt: Date.now(),
    });
    // Recompute fight-form score after session completion
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: row.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const deleteSession = mutation({
  args: { id: v.id("gym_sessions") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    const date = row.date;
    // Cascade — delete sets first.
    const sets = await ctx.db
      .query("gym_sets")
      .withIndex("by_session", (q) => q.eq("sessionId", id))
      .collect();
    for (const s of sets) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
    // Recompute fight-form score after session deletion
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});
