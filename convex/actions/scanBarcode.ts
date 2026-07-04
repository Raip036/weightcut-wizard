"use node";

/**
 * Barcode lookup via OpenFoodFacts.
 *
 * Auth required: the action is hit from the barcode scanner dialog while the
 * user is signed in. After a successful lookup the result is upserted into
 * the `foods` catalog so subsequent scans of the same barcode hit our DB and
 * `meal_items.foodId` can stably reference the food.
 */
import { v } from "convex/values";
import { action } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { healthFromOpenFoodFacts } from "../_shared/foodHealthHeuristics";

const BARCODE_RE = /^\d{8,14}$/;

export const run = action({
  args: { barcode: v.string() },
  handler: async (
    ctx,
    { barcode },
  ): Promise<
    | { found: false }
    | {
        found: true;
        food_id: string | null;
        productName: string;
        brand: string | null;
        // Per-serving (the user-facing default — already scaled to the
        // product's stated serving size, e.g. "127g packet").
        calories: number;
        protein_g: number;
        carbs_g: number;
        fats_g: number;
        // Per-100g (reference — used when the user changes portion
        // size in the UI so we can recompute live).
        calories_per_100g: number;
        protein_per_100g: number;
        carbs_per_100g: number;
        fats_per_100g: number;
        // Original serving description from OpenFoodFacts + the
        // numeric grams parsed from it (defaults to 100 when missing).
        serving_size: string;
        serving_grams: number;
        source: string;
        // Processing-based whole-food signals, derived deterministically from
        // the OpenFoodFacts record (NOVA + ingredients + additives). Omitted
        // when the product data is too thin to classify.
        health?: {
          novaClass: 1 | 2 | 3 | 4;
          ingredientCount: number;
          additivesCount: number;
          isWholeFood: boolean;
        };
      }
  > => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (!BARCODE_RE.test(barcode)) {
      throw new Error("Invalid barcode format. Expected 8-14 digits.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let resp: Response;
    try {
      resp = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(
          barcode,
        )}.json`,
        { signal: controller.signal },
      );
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error("OpenFoodFacts timed out");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const data = (await resp.json()) as any;
    if (data.status === 0 || !data.product) {
      return { found: false as const };
    }

    const product = data.product;
    const nutriments = product.nutriments || {};

    // Per-100g values (these are what we store in the foods catalog —
    // they're the canonical reference and don't change when the user
    // adjusts portion size).
    const calories100 = Math.round(
      Number(nutriments["energy-kcal_100g"] ?? nutriments["energy-kcal"] ?? 0),
    );
    const protein100 =
      Math.round(parseFloat(String(nutriments["proteins_100g"] ?? nutriments["proteins"] ?? 0)) * 10) /
      10;
    const carbs100 =
      Math.round(parseFloat(String(nutriments["carbohydrates_100g"] ?? nutriments["carbohydrates"] ?? 0)) * 10) /
      10;
    const fats100 =
      Math.round(parseFloat(String(nutriments["fat_100g"] ?? nutriments["fat"] ?? 0)) * 10) / 10;

    // Serving size: OpenFoodFacts exposes both a free-text
    // `serving_size` ("127 g (1 packet)") and a numeric
    // `serving_quantity`. Prefer the numeric field; fall back to
    // regex-parsing the free text; fall back to 100g if nothing useful
    // is present so the math is safe.
    const servingText: string = product.serving_size || "";
    const numericServing =
      typeof product.serving_quantity === "number"
        ? product.serving_quantity
        : parseFloat(String(product.serving_quantity ?? ""));
    let servingGrams = Number.isFinite(numericServing) && numericServing > 0 ? numericServing : NaN;
    if (!Number.isFinite(servingGrams)) {
      // Match "127g" / "127 g" / "1.5 g" — first number followed by g/kg/ml etc.
      const m = servingText.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml)/i);
      if (m) servingGrams = parseFloat(m[1]);
    }
    if (!Number.isFinite(servingGrams) || servingGrams <= 0) servingGrams = 100;

    // Prefer OpenFoodFacts' own per-serving fields when present; they
    // can differ from a strict per-100g × grams/100 calc (manufacturers
    // sometimes round differently on the label vs the per-100g column).
    const perServingFactor = servingGrams / 100;
    const fromOFF = (key: string): number | null => {
      const v = Number(nutriments[key]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const caloriesServing =
      fromOFF("energy-kcal_serving") !== null
        ? Math.round(fromOFF("energy-kcal_serving")!)
        : Math.round(calories100 * perServingFactor);
    const proteinServing =
      fromOFF("proteins_serving") !== null
        ? Math.round(fromOFF("proteins_serving")! * 10) / 10
        : Math.round(protein100 * perServingFactor * 10) / 10;
    const carbsServing =
      fromOFF("carbohydrates_serving") !== null
        ? Math.round(fromOFF("carbohydrates_serving")! * 10) / 10
        : Math.round(carbs100 * perServingFactor * 10) / 10;
    const fatsServing =
      fromOFF("fat_serving") !== null
        ? Math.round(fromOFF("fat_serving")! * 10) / 10
        : Math.round(fats100 * perServingFactor * 10) / 10;

    const productName: string =
      product.product_name || product.product_name_en || "Unknown Product";
    const brandName: string | undefined =
      (product.brands || "").split(",")[0]?.trim() || undefined;

    // Whole-food health signals from the OFF record — no LLM, fully
    // deterministic. Undefined when the product lacks NOVA/ingredient data.
    const health = healthFromOpenFoodFacts(product);

    let foodId: string | null = null;
    if (calories100 > 0 && productName.trim().length > 0) {
      foodId = await ctx.runMutation(internal.foods.upsertFromExternal, {
        name: productName,
        brand: brandName,
        barcode,
        source: "openfoodfacts",
        sourceRef: barcode,
        verified: true,
        caloriesPer100g: calories100,
        proteinPer100g: protein100,
        carbsPer100g: carbs100,
        fatsPer100g: fats100,
      });
    }

    return {
      found: true as const,
      food_id: foodId,
      productName,
      brand: brandName ?? null,
      // Per-serving (what the user sees by default — a scanned 127g
      // crisp packet returns calories FOR the packet, not per 100g).
      calories: caloriesServing,
      protein_g: proteinServing,
      carbs_g: carbsServing,
      fats_g: fatsServing,
      // Per-100g reference for live recomputation when the user tweaks
      // the portion in the scanner UI.
      calories_per_100g: calories100,
      protein_per_100g: protein100,
      carbs_per_100g: carbs100,
      fats_per_100g: fats100,
      serving_size: servingText || `${servingGrams}g`,
      serving_grams: servingGrams,
      source: "openfoodfacts",
      ...(health ? { health } : {}),
    };
  },
});
