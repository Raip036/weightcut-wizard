/**
 * Sleep log queries + mutations. Upsert by (userId, date).
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

function toClient(row: Doc<"sleep_logs">) {
  return {
    id: row._id,
    user_id: row.userId,
    date: row.date,
    hours: row.hours,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

export const listForUser = query({
  args: {
    limit: v.optional(v.number()),
    // Optional inclusive date range (YYYY-MM-DD). When both are supplied we
    // fetch exactly that window via the by_user_date index — mirrors
    // wellness.listCheckins so callers (e.g. the weekly report) get the right
    // week even for historical reports beyond the default `limit` window.
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { limit, from, to }) => {
    const userId = await requireUserId(ctx);
    if (from && to) {
      const rows = await ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", from).lte("date", to),
        )
        .collect();
      return rows.map(toClient);
    }
    const rows = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 90);
    return rows.map(toClient);
  },
});

export const getLatest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return row ? toClient(row) : null;
  },
});

export const logSleep = mutation({
  args: { date: v.string(), hours: v.number() },
  handler: async (ctx, { date, hours }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .unique();
    let resultId;
    if (existing) {
      await ctx.db.patch(existing._id, { hours });
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("sleep_logs", { userId, date, hours });
    }
    // Recompute fight-form score after sleep log upsert
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
    return resultId;
  },
});

export const deleteLog = mutation({
  args: { id: v.id("sleep_logs") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    const date = row.date;
    await ctx.db.delete(id);
    // Recompute fight-form score after sleep log deletion
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
