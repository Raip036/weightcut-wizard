/**
 * Per-user "recent foods" feature.
 *
 * Surfaces foods the user has recently logged or searched so the food-add
 * dialog can offer quick re-picks. Deduped per user by a normalized
 * (name, brand) key — NOT by foodId, since the same food can arrive from
 * different sources (external search vs. catalog) with/without a catalog id.
 *
 * `recordRecent` upserts on every log/search and prunes the user back to the
 * 50 most-recent rows. `historyForranking` is an internal query the food
 * search action reads to boost results the user has used before.
 */
import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { Doc, Id } from "./_generated/dataModel";

/** Cap on rows retained per user. The dialog only ever shows the top ~30. */
const MAX_RECENTS = 50;

/** Normalized dedupe key: lowercased trimmed name + "|" + brand. */
function recentKey(name: string, brand?: string): string {
  return `${name.trim().toLowerCase()}|${(brand ?? "").trim().toLowerCase()}`;
}

function toClient(row: Doc<"food_recents">) {
  return {
    id: row._id, // recent row id — unique key + delete handle
    foodId: row.foodId, // optional catalog id (Id<"foods"> | undefined)
    name: row.name,
    brand: row.brand ?? "",
    calories_per_100g: row.caloriesPer100g,
    protein_per_100g: row.proteinPer100g,
    carbs_per_100g: row.carbsPer100g,
    fats_per_100g: row.fatsPer100g,
    serving_size: row.servingSize,
    serving_grams: row.servingGrams ?? null,
    lastPortionGrams: row.lastPortionGrams ?? 100,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────

export const recordRecent = mutation({
  args: {
    foodId: v.optional(v.id("foods")),
    name: v.string(),
    brand: v.optional(v.string()),
    caloriesPer100g: v.number(),
    proteinPer100g: v.number(),
    carbsPer100g: v.number(),
    fatsPer100g: v.number(),
    servingSize: v.optional(v.string()),
    servingGrams: v.optional(v.number()),
    portionGrams: v.optional(v.number()),
    kind: v.union(v.literal("logged"), v.literal("searched")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const targetKey = recentKey(args.name, args.brand);

    // Look up candidates by exact (userId, name) via index, then match the
    // normalized brand in JS. foodId is intentionally not part of the key.
    const candidates = await ctx.db
      .query("food_recents")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", userId).eq("name", args.name),
      )
      .collect();
    const existing = candidates.find(
      (row) => recentKey(row.name, row.brand) === targetKey,
    );

    const now = Date.now();

    let rowId: Id<"food_recents">;
    if (existing) {
      // logged is the stronger source — never downgrade an existing "logged".
      const nextKind =
        existing.kind === "logged" || args.kind === "logged"
          ? "logged"
          : "searched";
      await ctx.db.patch(existing._id, {
        foodId: args.foodId ?? existing.foodId,
        name: args.name,
        brand: args.brand,
        caloriesPer100g: args.caloriesPer100g,
        proteinPer100g: args.proteinPer100g,
        carbsPer100g: args.carbsPer100g,
        fatsPer100g: args.fatsPer100g,
        servingSize: args.servingSize,
        servingGrams: args.servingGrams,
        lastPortionGrams: args.portionGrams ?? existing.lastPortionGrams,
        kind: nextKind,
        logCount: existing.logCount + (args.kind === "logged" ? 1 : 0),
        lastUsedAt: now,
      });
      rowId = existing._id;
    } else {
      rowId = await ctx.db.insert("food_recents", {
        userId,
        foodId: args.foodId,
        name: args.name,
        brand: args.brand,
        caloriesPer100g: args.caloriesPer100g,
        proteinPer100g: args.proteinPer100g,
        carbsPer100g: args.carbsPer100g,
        fatsPer100g: args.fatsPer100g,
        servingSize: args.servingSize,
        servingGrams: args.servingGrams,
        lastPortionGrams: args.portionGrams,
        kind: args.kind,
        logCount: args.kind === "logged" ? 1 : 0,
        lastUsedAt: now,
      });
    }

    // Prune: keep only the MAX_RECENTS most-recent rows. Walk the by_user
    // lastUsed index ascending (oldest first) and delete the overflow.
    const all = await ctx.db
      .query("food_recents")
      .withIndex("by_user_lastUsed", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();
    if (all.length > MAX_RECENTS) {
      const overflow = all.length - MAX_RECENTS;
      for (let i = 0; i < overflow; i++) {
        await ctx.db.delete(all[i]._id);
      }
    }

    return rowId;
  },
});

export const removeRecent = mutation({
  args: { id: v.id("food_recents") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(id);
  },
});

export const clearRecents = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("food_recents")
      .withIndex("by_user_lastUsed", (q) => q.eq("userId", userId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

// ───────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────

export const listRecents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("food_recents")
      .withIndex("by_user_lastUsed", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 30);
    return rows.map(toClient);
  },
});

/**
 * Internal — read by the food-search action to boost results the user has
 * used before. Returns a compact array keyed by normalized (name, brand).
 */
export const historyForRanking = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("food_recents")
      .withIndex("by_user_lastUsed", (q) => q.eq("userId", userId))
      .order("desc")
      .take(150);
    return rows.map((row) => ({
      key: recentKey(row.name, row.brand),
      name: row.name,
      brand: row.brand ?? "",
      foodId: row.foodId,
      logCount: row.logCount,
      lastUsedAt: row.lastUsedAt,
    }));
  },
});
