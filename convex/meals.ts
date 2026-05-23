/**
 * Meal queries + mutations.
 *
 * Compound write `createMealWithItems` replaces the Postgres RPC
 * `create_meal_with_items` — both rows are inserted in a single Convex
 * mutation (transactional by default), so no rollback dance is needed.
 *
 * `listWithTotals` reproduces the `meals_with_totals` Postgres view by
 * summing each meal's items in-query. The total payload is bounded (≤100
 * meals × ≤20 items each) so this is fine to compute on read.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import type { Doc, Id } from "./_generated/dataModel";

function mealToClient(
  meal: Doc<"meals">,
  items: Doc<"meal_items">[],
  photoUrl?: string | null,
) {
  const totals = items.reduce(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein_g: acc.protein_g + i.proteinG,
      carbs_g: acc.carbs_g + i.carbsG,
      fats_g: acc.fats_g + i.fatsG,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fats_g: 0 },
  );
  return {
    id: meal._id,
    user_id: meal.userId,
    date: meal.date,
    meal_type: meal.mealType,
    meal_name: meal.mealName,
    is_ai_generated: meal.isAiGenerated,
    notes: meal.notes,
    total_calories: Math.round(totals.calories),
    total_protein_g: totals.protein_g,
    total_carbs_g: totals.carbs_g,
    total_fats_g: totals.fats_g,
    calories: Math.round(totals.calories),
    protein_g: totals.protein_g,
    carbs_g: totals.carbs_g,
    fats_g: totals.fats_g,
    item_count: items.length,
    created_at: new Date(meal._creationTime).toISOString(),
    photo_url: photoUrl ?? null,
  };
}

function itemToClient(row: Doc<"meal_items">) {
  return {
    id: row._id,
    meal_id: row.mealId,
    food_id: row.foodId,
    name: row.name,
    position: row.position,
    grams: row.grams,
    calories: row.calories,
    protein_g: row.proteinG,
    carbs_g: row.carbsG,
    fats_g: row.fatsG,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────

export const listForUserByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .order("asc")
      .collect();
    return meals;
  },
});

/** The big one — replaces `meals_with_totals` view. Returns each meal
 *  with its items inlined and aggregated totals computed in-line. */
export const listWithTotals = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .order("asc")
      .collect();
    const result = [];
    for (const m of meals) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      const photoUrl = m.photoStorageId
        ? await ctx.storage.getUrl(m.photoStorageId)
        : null;
      result.push({
        ...mealToClient(m, items, photoUrl),
        items: items
          .sort((a, b) => a.position - b.position)
          .map(itemToClient),
      });
    }
    return result;
  },
});

export const getById = query({
  args: { id: v.id("meals") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const meal = await ctx.db.get(id);
    if (!meal) return null;
    if (meal.userId !== userId) throw new Error("Not authorized");
    const items = await ctx.db
      .query("meal_items")
      .withIndex("by_meal", (q) => q.eq("mealId", id))
      .collect();
    const photoUrl = meal.photoStorageId
      ? await ctx.storage.getUrl(meal.photoStorageId)
      : null;
    return {
      ...mealToClient(meal, items, photoUrl),
      items: items
        .sort((a, b) => a.position - b.position)
        .map(itemToClient),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────

const itemValidator = v.object({
  name: v.string(),
  foodId: v.optional(v.id("foods")),
  grams: v.number(),
  calories: v.number(),
  proteinG: v.number(),
  carbsG: v.number(),
  fatsG: v.number(),
});

/**
 * Auth-gated upload-URL generator for meal photos. Client uses this to
 * upload the photo to Convex Storage directly, then passes the resulting
 * `storageId` into `createMealWithItems` as `photoStorageId`.
 */
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * How far back we honour an idempotency receipt. 24 h is plenty for slow-
 * network retries (the bug we're guarding against fires within seconds);
 * past that, a user re-tapping with the same key clearly means a fresh log.
 */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const createMealWithItems = mutation({
  args: {
    date: v.string(),
    mealType: v.string(),
    mealName: v.string(),
    isAiGenerated: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    items: v.array(itemValidator),
    // Client-supplied dedupe token. When present, two calls with the same
    // (userId, idempotencyKey) inside the 24 h window collapse onto the
    // first insert's mealId. The client generates this once per save
    // attempt; user-initiated retries get a fresh key (because the button
    // is re-enabled and a fresh `runInsertFlow` call runs with a fresh
    // UUID), which is what we want — they're explicitly trying again.
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    // Idempotency short-circuit. Check before doing any work so a duplicate
    // tap doesn't even hit the validation loop on the second call.
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("meal_idempotency_keys")
        .withIndex("by_user_key", (q) =>
          q.eq("userId", userId).eq("key", args.idempotencyKey!),
        )
        .first();
      if (existing && Date.now() - existing._creationTime < IDEMPOTENCY_WINDOW_MS) {
        // Confirm the underlying meal still exists (user could have deleted
        // it between the duplicate calls). If gone, fall through to a fresh
        // insert so the user gets the meal they were trying to log.
        const stillThere = await ctx.db.get(existing.mealId);
        if (stillThere) return existing.mealId;
      }
    }

    // Validate item count + per-item macros at the boundary. Negative or
    // non-finite macros leak into TDEE / deficit calcs downstream, so reject
    // them up front instead of clamping silently.
    if (args.items.length > 50) {
      throw new Error("Cannot create a meal with more than 50 items");
    }
    for (const item of args.items) {
      for (const [k, val] of [
        ["calories", item.calories],
        ["proteinG", item.proteinG],
        ["carbsG", item.carbsG],
        ["fatsG", item.fatsG],
        ["grams", item.grams],
      ] as const) {
        if (!Number.isFinite(val)) {
          throw new Error(`Item field ${k} must be a finite number`);
        }
        if (val < 0) {
          throw new Error(`Item field ${k} cannot be negative`);
        }
      }
    }
    const mealId: Id<"meals"> = await ctx.db.insert("meals", {
      userId,
      date: args.date,
      mealType: args.mealType,
      mealName: args.mealName,
      isAiGenerated: args.isAiGenerated ?? false,
      notes: args.notes,
      photoStorageId: args.photoStorageId,
    });
    let i = 0;
    for (const item of args.items) {
      await ctx.db.insert("meal_items", {
        mealId,
        foodId: item.foodId,
        name: item.name,
        position: i,
        grams: item.grams,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatsG: item.fatsG,
      });
      i += 1;
    }

    // Record the receipt AFTER the insert succeeded but BEFORE the deferred
    // scheduler call. If the meal insert had thrown we'd never have got
    // here, so the only rows that exist have a meal behind them.
    if (args.idempotencyKey) {
      await ctx.db.insert("meal_idempotency_keys", {
        userId,
        key: args.idempotencyKey,
        mealId,
      });
    }

    await ctx.scheduler.runAfter(5_000, internal.fightFormScore.recomputeForUserDate, {
      userId,
      date: args.date,
    });
    return mealId;
  },
});

export const updateMeal = mutation({
  args: {
    id: v.id("meals"),
    mealType: v.optional(v.string()),
    mealName: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUserId(ctx);
    const meal = await ctx.db.get(id);
    if (!meal) throw new Error("Meal not found");
    if (meal.userId !== userId) throw new Error("Not authorized");
    const oldDate = meal.date;
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) clean[k] = val;
    }
    await ctx.db.patch(id, clean as any);
    // Recompute fight-form score after meal update. If the meal was moved
    // to a different date, schedule recomputes for BOTH the old and new
    // date so the nutrition sub-score recovers from the old date too.
    const newDate =
      typeof patch.date === "string" && patch.date !== oldDate
        ? patch.date
        : null;
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: oldDate,
      });
      if (newDate) {
        await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
          userId,
          date: newDate,
        });
      }
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

/**
 * Lightweight integer count of meals belonging to the user. Used by the
 * data reset dialog to avoid pulling every row just to display a number.
 */
export const getCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("meals")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect();
    return { count: rows.length };
  },
});

/**
 * Returns `[{ date, calories }]` aggregated server-side for every day in
 * [from, to] inclusive (ISO YYYY-MM-DD). Used by the baseline computer to
 * replace 90 sequential per-date queries with one call. Days with no meals
 * are omitted from the result.
 */
export const sumCaloriesByDateRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUserId(ctx);
    // One indexed range scan over the (userId, date) compound index.
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", from).lte("date", to),
      )
      .collect();

    // Fan-out item loads in parallel — bounded by number of meals in range.
    const itemArrays = await Promise.all(
      meals.map((m) =>
        ctx.db
          .query("meal_items")
          .withIndex("by_meal", (q) => q.eq("mealId", m._id))
          .collect(),
      ),
    );

    const totalsByDate = new Map<string, number>();
    meals.forEach((m, idx) => {
      const items = itemArrays[idx];
      const dayCalories = items.reduce((sum, it) => sum + (it.calories ?? 0), 0);
      totalsByDate.set(m.date, (totalsByDate.get(m.date) ?? 0) + dayCalories);
    });

    return Array.from(totalsByDate.entries())
      .map(([date, calories]) => ({ date, calories: Math.round(calories) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const deleteMeal = mutation({
  args: { id: v.id("meals") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const meal = await ctx.db.get(id);
    if (!meal) return;
    if (meal.userId !== userId) throw new Error("Not authorized");
    const date = meal.date;
    // Cascade — delete child items first.
    const items = await ctx.db
      .query("meal_items")
      .withIndex("by_meal", (q) => q.eq("mealId", id))
      .collect();
    for (const it of items) {
      await ctx.db.delete(it._id);
    }
    await ctx.db.delete(id);
    // Recompute fight-form score after meal deletion
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
