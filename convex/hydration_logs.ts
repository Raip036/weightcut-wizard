/**
 * Hydration log queries + mutations.
 *
 * Upsert semantics: most rows are 1-per-date but the schema allows multiple
 * (e.g. pre-/post-training entries). `logHydration` upserts by date when
 * `merge: true` (accumulate amountMl) — otherwise inserts a fresh row.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { requireFeatureGate } from "./_shared/featureGates";
import type { Doc } from "./_generated/dataModel";

function toClient(row: Doc<"hydration_logs">) {
  return {
    id: row._id,
    user_id: row.userId,
    date: row.date,
    amount_ml: row.amountMl,
    sodium_mg: row.sodiumMg,
    sweat_loss_percent: row.sweatLossPercent,
    training_weight_pre: row.trainingWeightPre,
    training_weight_post: row.trainingWeightPost,
    notes: row.notes,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

export const listForUser = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { from, to, limit }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("hydration_logs")
      .withIndex("by_user_date", (idx) => {
        const base = idx.eq("userId", userId);
        if (from && to) return base.gte("date", from).lte("date", to);
        if (from) return base.gte("date", from);
        if (to) return base.lte("date", to);
        return base;
      })
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
      .query("hydration_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return row ? toClient(row) : null;
  },
});

export const logHydration = mutation({
  args: {
    date: v.string(),
    amountMl: v.number(),
    sodiumMg: v.optional(v.number()),
    sweatLossPercent: v.optional(v.number()),
    trainingWeightPre: v.optional(v.number()),
    trainingWeightPost: v.optional(v.number()),
    notes: v.optional(v.string()),
    merge: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireFeatureGate(ctx, userId, "RECOVERY");
    if (args.merge) {
      const existing = await ctx.db
        .query("hydration_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).eq("date", args.date),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          amountMl: (existing.amountMl ?? 0) + args.amountMl,
          sodiumMg:
            args.sodiumMg !== undefined
              ? (existing.sodiumMg ?? 0) + args.sodiumMg
              : existing.sodiumMg,
          notes: args.notes ?? existing.notes,
        });
        return existing._id;
      }
    }
    return await ctx.db.insert("hydration_logs", {
      userId,
      date: args.date,
      amountMl: args.amountMl,
      sodiumMg: args.sodiumMg,
      sweatLossPercent: args.sweatLossPercent,
      trainingWeightPre: args.trainingWeightPre,
      trainingWeightPost: args.trainingWeightPost,
      notes: args.notes,
    });
  },
});

export const deleteLog = mutation({
  args: { id: v.id("hydration_logs") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    await requireFeatureGate(ctx, userId, "RECOVERY");
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(id);
  },
});
