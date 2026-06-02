/**
 * Weight log queries + mutations.
 *
 * `logWeight` is an upsert keyed by (userId, date) — replaces the
 * Supabase pattern of "check + update OR insert" from `useWeightData.ts`.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

function toClient(row: Doc<"weight_logs">) {
  return {
    id: row._id,
    user_id: row.userId,
    date: row.date,
    weight_kg: row.weightKg,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

export const listForUser = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("asc")
      .take(limit ?? 365);
    return rows.map(toClient);
  },
});

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return row ? toClient(row) : null;
  },
});

/** Upsert by (userId, date). Same-date logs overwrite the prior value
 *  instead of creating a duplicate row — matches the Postgres unique
 *  constraint on (user_id, date). */
export const logWeight = mutation({
  args: { date: v.string(), weightKg: v.number() },
  handler: async (ctx, { date, weightKg }) => {
    const userId = await requireUserId(ctx);
    // Match the Zod range used by the frontend form: 30–250 kg, finite only.
    if (!Number.isFinite(weightKg)) {
      throw new Error("weightKg must be a finite number");
    }
    if (weightKg < 30 || weightKg > 250) {
      throw new Error("weightKg must be between 30 and 250 kg");
    }
    const existing = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .unique();
    let resultId;
    if (existing) {
      await ctx.db.patch(existing._id, { weightKg });
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("weight_logs", { userId, date, weightKg });
    }
    // Recompute fight-form score after weight log upsert
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }

    // WP-T8: Schedule weight-protocol drift-detector (60s debounce). Only
    // fires if the user has an active (non-completed) fight camp; otherwise
    // we skip scheduling entirely. The 60s delay gives the user time to fix
    // a typo before the regen kicks in. Multiple rapid logs may pile up
    // scheduled calls — that's fine, `maybeRegen` is idempotent.
    // If multiple active fight camps exist (the data model doesn't enforce
    // uniqueness), `.first()` deterministically picks one.
    try {
      const activeCamp = await ctx.db
        .query("fight_camps")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.neq(q.field("isCompleted"), true))
        .first();
      if (activeCamp) {
        await ctx.scheduler.runAfter(
          60_000, // 60s debounce
          internal.weight_protocols_internal.maybeRegen,
          { userId, campId: activeCamp._id },
        );
      }
    } catch (err) {
      console.warn("weight-protocol maybeRegen schedule failed", err);
    }

    return resultId;
  },
});

/**
 * Lightweight integer count of the user's weight logs. Used by the data
 * reset dialog and any UI that needs to show "you have N entries" without
 * paying to ship the full row set.
 */
export const getCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect();
    return { count: rows.length };
  },
});

export const deleteLog = mutation({
  args: { id: v.id("weight_logs") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    const date = row.date;
    await ctx.db.delete(id);
    // Recompute fight-form score after weight log deletion
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
