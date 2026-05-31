/**
 * Exercises (gym lift library).
 *
 * The `exercises` table holds both global rows (userId undefined) and
 * user-custom rows. `listForUser` returns the union.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

function toClient(row: Doc<"exercises">) {
  return {
    id: row._id,
    user_id: row.userId ?? null,
    name: row.name,
    category: row.category,
    muscle_group: row.muscleGroup,
    equipment: row.equipment,
    is_custom: row.isCustom,
    is_bodyweight: row.isBodyweight,
    tracking_type: row.trackingType ?? null,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

export const listForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // Two indexed reads — built-ins (userId === undefined) and the user's
    // own custom rows. Avoids a full-table scan as the catalog grows.
    const [builtIns, custom] = await Promise.all([
      ctx.db
        .query("exercises")
        .withIndex("by_user", (q) => q.eq("userId", undefined))
        .collect(),
      ctx.db
        .query("exercises")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    return [...builtIns, ...custom].map(toClient);
  },
});

export const createCustom = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    muscleGroup: v.string(),
    equipment: v.optional(v.string()),
    isBodyweight: v.optional(v.boolean()),
    trackingType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    // Idempotent by (userId, lowercased name). Repeated creation — whether
    // from the create dialog or fallback-library materialization in
    // addExerciseToSession — reuses the SAME row instead of piling up
    // duplicates with drifting ids. Stable ids are what keep custom
    // exercises (and id-keyed recents) from "disappearing" between workouts.
    const wanted = args.name.trim().toLowerCase();
    const mine = await ctx.db
      .query("exercises")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const existing = mine.find((e) => e.name.trim().toLowerCase() === wanted);
    if (existing) {
      // Backfill a newly-specified tracking type onto the existing row.
      if (args.trackingType && existing.trackingType !== args.trackingType) {
        await ctx.db.patch(existing._id, { trackingType: args.trackingType });
      }
      return existing._id;
    }

    return await ctx.db.insert("exercises", {
      userId,
      name: args.name,
      category: args.category,
      muscleGroup: args.muscleGroup,
      equipment: args.equipment,
      isCustom: true,
      isBodyweight: args.isBodyweight ?? false,
      trackingType: args.trackingType,
    });
  },
});

/**
 * Recent exercises derived from the user's actual logged sets across ALL past
 * workouts (newest-first, deduped by exercise). Returns the exercise ids; the
 * client filters its in-memory library by these so recents survive reinstalls
 * and span every previous session — not just the current one.
 */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUserId(ctx);
    const cap = limit ?? 20;
    // 300 newest set rows is plenty to surface ~20 distinct exercises.
    const recentSets = await ctx.db
      .query("gym_sets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(300);
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const s of recentSets) {
      const key = s.exerciseId as unknown as string;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(key);
      if (ids.length >= cap) break;
    }
    return ids;
  },
});

export const deleteCustom = mutation({
  args: { id: v.id("exercises") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(id);
  },
});
