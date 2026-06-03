import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";

const PILLAR = v.union(
  v.literal("sleep"),
  v.literal("weight"),
  v.literal("nutrition"),
  v.literal("wellness"),
);

export const setSkip = mutation({
  args: { date: v.string(), pillar: PILLAR },
  handler: async (ctx, { date, pillar }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date_pillar", (q) =>
        q.eq("userId", userId).eq("date", date).eq("pillar", pillar),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("marked_skips", { userId, date, pillar });
    }
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, { userId, date });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const clearSkip = mutation({
  args: { date: v.string(), pillar: PILLAR },
  handler: async (ctx, { date, pillar }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date_pillar", (q) =>
        q.eq("userId", userId).eq("date", date).eq("pillar", pillar),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, { userId, date });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const skipsForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
      .collect();
    return rows.map((r) => r.pillar);
  },
});
