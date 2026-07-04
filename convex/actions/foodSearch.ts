"use node";

/**
 * Food name search via USDA FoodData Central.
 *
 * Action-level cache (`searchCache`) survives container warm reuse, matching
 * the Supabase Deno-isolate behaviour. Results are bulk-upserted into the
 * `foods` catalog so repeat searches read from our DB.
 *
 * Env: USDA_API_KEY — public-tier key works fine; 1k requests/hour limit.
 */
import { v } from "convex/values";
import { action } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { rankFoods } from "../lib/foodRanking";
import { healthFromUsda } from "../_shared/foodHealthHeuristics";

interface USDANutrient {
  nutrientId: number;
  nutrientName: string;
  nutrientNumber: string;
  value: number;
  unitName: string;
}

interface USDAFoodPortion {
  gramWeight?: number;
  portionDescription?: string;
  modifier?: string;
  amount?: number;
  measureUnit?: { name?: string };
}

interface USDAFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  // Branded foods: the label ingredient string (used to derive whole-food
  // health signals). Absent on Foundation / SR Legacy rows.
  ingredients?: string;
  // Branded foods: explicit serving size on the row.
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  // Foundation / SR Legacy: a list of common portions (e.g. "1 cup, 240g").
  foodPortions?: USDAFoodPortion[];
  foodNutrients: USDANutrient[];
}

function getNutrient(nutrients: USDANutrient[], num: string): number {
  return nutrients.find((n) => n.nutrientNumber === num)?.value ?? 0;
}

/**
 * Pull a typical serving size in grams out of the USDA payload, if one is
 * declared. Branded foods carry an explicit `servingSize` + unit; Foundation
 * and SR Legacy rows have a `foodPortions` array — we use the first portion
 * with a gram weight. Returns null when the row only ships per-100g data.
 */
function extractServingGrams(food: USDAFood): { grams: number; label: string } | null {
  if (
    typeof food.servingSize === "number" &&
    food.servingSize > 0 &&
    food.servingSizeUnit?.toLowerCase() === "g"
  ) {
    const grams = Math.round(food.servingSize);
    const household = food.householdServingFullText?.trim();
    return {
      grams,
      label: household ? `${grams}g · ${household}` : `${grams}g`,
    };
  }
  const portion = food.foodPortions?.find(
    (p) => typeof p.gramWeight === "number" && p.gramWeight! > 0,
  );
  if (portion) {
    const grams = Math.round(portion.gramWeight!);
    const desc = (portion.portionDescription || portion.modifier || "").trim();
    return {
      grams,
      label: desc ? `${grams}g · ${desc}` : `${grams}g`,
    };
  }
  return null;
}

function normalizeFood(food: USDAFood) {
  const cal = getNutrient(food.foodNutrients, "208");
  const protein = getNutrient(food.foodNutrients, "203");
  const carbs = getNutrient(food.foodNutrients, "205");
  const fat = getNutrient(food.foodNutrients, "204");
  const serving = extractServingGrams(food);
  // Deterministic whole-food health signals from the USDA record — Branded
  // rows classify from the ingredient string, generic rows from the
  // description. Undefined (omitted) when the row can't be classified.
  const health = healthFromUsda({
    dataType: food.dataType,
    description: food.description,
    brand: food.brandOwner || food.brandName,
    ingredientsText: food.ingredients,
  });
  return {
    id: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner || food.brandName || "",
    dataType: food.dataType,
    calories_per_100g: Math.round(cal),
    protein_per_100g: Math.round(protein * 10) / 10,
    carbs_per_100g: Math.round(carbs * 10) / 10,
    fats_per_100g: Math.round(fat * 10) / 10,
    serving_size: serving?.label ?? "100g",
    serving_grams: serving?.grams ?? null,
    ...(health ? { health } : {}),
  };
}

// In-memory cache shared across warm invocations of the same container.
// IMPORTANT: stores the UNRANKED (user-independent) results — the USDA fetch +
// catalog upsert/id-remap output only. Ranking is per-user and is applied on
// every request (cache hit OR miss), so one user's personalization never leaks
// into another user's cached value.
const searchCache = new Map<string, { results: any[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const run = action({
  args: { query: v.string() },
  handler: async (ctx, { query }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new Error("Query is required (min 2 chars)");
    }

    // Personalize the (user-independent) unranked results for this caller.
    // History is best-effort — a ranking-history failure must never fail search.
    const rankForUser = async (unranked: any[]) => {
      let history: any[] = [];
      try {
        history = await ctx.runQuery(internal.foodRecents.historyForRanking, {
          userId,
        });
      } catch {
        // ranking history is best-effort — never fail search if it errors
      }
      return rankFoods(unranked, trimmed, history);
    };

    const cacheKey = trimmed.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      // Cache holds the UNRANKED results — rank per-request before returning.
      const ranked = await rankForUser(cached.results);
      return { results: ranked };
    }

    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) {
      throw new Error("USDA_API_KEY is not configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let usdaResponse: Response;
    try {
      usdaResponse = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: trimmed,
            dataType: ["Foundation", "SR Legacy", "Branded"],
            pageSize: 50,
          }),
          signal: controller.signal,
        },
      );
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error("USDA timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // USDA returns 404 when the query genuinely has zero hits in their
    // catalog. Surface that to the client as an empty result set rather
    // than an error toast — same UX as "no results found".
    if (usdaResponse.status === 404) {
      searchCache.set(cacheKey, { results: [], ts: Date.now() });
      return { results: [] };
    }
    if (!usdaResponse.ok) {
      throw new Error(`USDA API returned ${usdaResponse.status}`);
    }

    const usdaData = (await usdaResponse.json()) as { foods?: USDAFood[] };
    const foods = usdaData.foods ?? [];

    const normalised = foods
      .map(normalizeFood)
      .filter(
        (f) => f.calories_per_100g > 0 && f.name.trim().length > 0,
      );

    let results = normalised;
    if (normalised.length > 0) {
      try {
        const ids = (await ctx.runMutation(
          internal.foods.upsertManyFromExternal,
          {
            rows: normalised.map((f) => ({
              name: f.name,
              brand: f.brand || undefined,
              source: "usda",
              sourceRef: f.id,
              verified: true,
              caloriesPer100g: f.calories_per_100g,
              proteinPer100g: f.protein_per_100g,
              carbsPer100g: f.carbs_per_100g,
              fatsPer100g: f.fats_per_100g,
            })),
          },
        )) as string[];
        // Swap USDA fdcId for our catalog id so meal_items can FK to a stable
        // Convex `foods._id` instead of the external string ref.
        results = normalised.map((f, i) => ({ ...f, id: ids[i] ?? f.id }));
      } catch {
        // Upsert failure shouldn't break search — fall back to USDA payload
        // with the fdcId as a string id.
      }
    }

    // Cache the UNRANKED results (user-independent); rank per-request below.
    searchCache.set(cacheKey, { results, ts: Date.now() });
    const ranked = await rankForUser(results);
    return { results: ranked };
  },
});
