import { useState, useCallback, useRef } from "react";
import { useMutation } from "convex/react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { AIPersistence } from "@/lib/aiPersistence";
import { localCache } from "@/lib/localCache";
import { nutritionCache } from "@/lib/nutritionCache";
import { celebrateSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { resolveMealType } from "@/lib/buildMealPayload";
import { coerceMealName } from "@/lib/mealName";
import {
  buildCreateMealRpcArgs,
  ingredientsToRpcItems,
  type CreateMealRpcArgs,
  type RpcItemPayload,
} from "@/lib/buildMealRpcArgs";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Meal, Ingredient } from "@/pages/nutrition/types";

// Re-export the helper so the tester's gate can pull it from this module.
export { buildCreateMealRpcArgs } from "@/lib/buildMealRpcArgs";

interface UseMealOperationsParams {
  meals: Meal[];
  setMeals: React.Dispatch<React.SetStateAction<Meal[]>>;
  mealPlanIdeas: Meal[];
  setMealPlanIdeas: React.Dispatch<React.SetStateAction<Meal[]>>;
  selectedDate: string;
  loadMeals: (skipCache?: boolean) => Promise<void>;
}

/** Internal: build the full optimistic Meal row that matches meals_with_totals shape. */
function buildOptimisticMeal(args: {
  id: string;
  date: string;
  args: CreateMealRpcArgs;
  ingredients?: Ingredient[] | null;
  portion_size?: string | null;
  recipe_notes?: string | null;
}): Meal {
  const { id, date, args: rpcArgs, ingredients, portion_size, recipe_notes } = args;
  const totals = rpcArgs.p_items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories,
      protein_g: acc.protein_g + it.protein_g,
      carbs_g: acc.carbs_g + it.carbs_g,
      fats_g: acc.fats_g + it.fats_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fats_g: 0 }
  );
  return {
    id,
    meal_name: rpcArgs.p_meal_name,
    meal_type: rpcArgs.p_meal_type,
    calories: Math.round(totals.calories),
    protein_g: totals.protein_g,
    carbs_g: totals.carbs_g,
    fats_g: totals.fats_g,
    portion_size: portion_size ?? undefined,
    recipe_notes: recipe_notes ?? undefined,
    ingredients: ingredients ?? undefined,
    is_ai_generated: rpcArgs.p_is_ai_generated,
    notes: rpcArgs.p_notes,
    item_count: rpcArgs.p_items.length,
    date,
  };
}

/**
 * Heuristic: a Convex Id is a base32-ish string roughly 24-36 chars long
 * containing only [a-z0-9]. Legacy UUIDs include hyphens. We use this only
 * to decide whether to forward `food_id` to the Convex mutation (which
 * requires a real `v.id("foods")`) vs. dropping it and logging a warning.
 */
const CONVEX_ID_PATTERN = /^[a-z0-9]{20,40}$/;

// Module-level guard so we only log the "dropping legacy food_id" warning
// once per call site rather than spamming the console for every item.
let warnedAboutDroppedFoodId = false;

/** Map the RPC payload shape (snake_case) → Convex mutation arg shape (camelCase). */
function rpcItemsToConvexItems(items: RpcItemPayload[]) {
  let droppedThisCall = 0;
  const mapped = items.map((it) => {
    const raw = it.food_id;
    let foodId: string | undefined;
    if (raw && typeof raw === "string") {
      if (CONVEX_ID_PATTERN.test(raw)) {
        foodId = raw;
      } else {
        droppedThisCall += 1;
      }
    }
    return {
      name: it.name,
      grams: it.grams,
      calories: it.calories,
      proteinG: it.protein_g,
      carbsG: it.carbs_g,
      fatsG: it.fats_g,
      // TODO: backend support — once `foods.upsertFood` is wired into the
      // insert path, legacy UUIDs can be resolved to Convex Ids before
      // hitting this layer instead of being dropped.
      ...(foodId ? { foodId: foodId as unknown as Id<"foods"> } : {}),
    };
  });
  if (droppedThisCall > 0 && !warnedAboutDroppedFoodId) {
    logger.warn(
      `rpcItemsToConvexItems: dropped ${droppedThisCall} legacy food_id value(s) ` +
      `that didn't match the Convex Id pattern. Will not warn again this session.`,
    );
    warnedAboutDroppedFoodId = true;
  }
  return mapped;
}

export function useMealOperations(params: UseMealOperationsParams) {
  const { setMeals, setMealPlanIdeas, selectedDate, loadMeals } = params;
  const { userId } = useUser();
  const { toast } = useToast();
  const { isMounted: _isMounted } = useSafeAsync();
  const createMealMut = useMutation(api.meals.createMealWithItems);
  const deleteMealMut = useMutation(api.meals.deleteMeal);
  const [loggingMeal, setLoggingMeal] = useState<string | null>(null);
  const [savingAllMeals, setSavingAllMeals] = useState(false);
  // `savingMeal` is the single-meal insert lock surfaced to button `disabled`
  // props. `savingAllMeals` covers the bulk meal-plan save flow and stays
  // independent so a one-off save doesn't grey out the "Save all" CTA and
  // vice versa.
  const [savingMeal, setSavingMeal] = useState(false);
  // Source-of-truth for the in-flight guard inside `runInsertFlow`. A ref
  // (not state) because we need to read+write it synchronously inside the
  // same tick — by the time a `useState` setter's value propagates, the
  // second tap of a spam-double-click has already fired its mutation.
  const inFlightRef = useRef(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mealToDelete, setMealToDelete] = useState<Meal | null>(null);

  /**
   * Single point-of-truth for every insert path. Fires an optimistic cache
   * row, then calls the `createMealWithItems` Convex mutation. The mutation
   * is transactional — both `meals` and `meal_items` inserts succeed or fail
   * together. On success we swap the optimistic id for the canonical one so
   * the reactive `listWithTotals` query doesn't briefly show duplicates.
   */
  const runInsertFlow = useCallback(async (opts: {
    args: CreateMealRpcArgs;
    ingredients?: Ingredient[] | null;
    portion_size?: string | null;
    recipe_notes?: string | null;
    photoStorageId?: string | null;
    photoPreviewUrl?: string | null;
    successToast?: { title: string; description?: string };
  }) => {
    if (!userId) throw new Error("Not authenticated");

    // In-flight lock. The UI also gates the Save button on `savingMeal`,
    // but the React state hasn't necessarily propagated by the time a
    // doubled tap fires its onClick — the ref gives us a synchronous,
    // intra-tick guard that beats the render loop. Silent no-op (no
    // toast) because the button is already disabled visually.
    //
    // NOTE: we deliberately don't pass an AbortController to the Convex
    // mutation here. Convex mutations are atomic and don't expose a
    // signal; the "abort" guarantee against doubled-up writes comes from
    // (a) this ref, and (b) the server-side `idempotencyKey` receipt in
    // `createMealWithItems`. The two together make the write idempotent
    // end-to-end without needing JS-level cancellation.
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setSavingMeal(true);

    const optimisticId = crypto.randomUUID();
    // One stable dedupe token per save attempt. If the user explicitly taps
    // again after a failure, the disabled state has already flipped back
    // and a fresh `runInsertFlow` call runs with a new key — which is the
    // right semantic ("user retried" → new log; "tap fired twice in same
    // call" → same key → server collapses to one log).
    const idempotencyKey = crypto.randomUUID();

    const optimisticMeal = buildOptimisticMeal({
      id: optimisticId,
      date: selectedDate,
      args: opts.args,
      ingredients: opts.ingredients,
      portion_size: opts.portion_size,
      recipe_notes: opts.recipe_notes,
    });
    // Render the freshly captured photo instantly via a data URL so the user
    // sees their image in the meal list before the storage URL round-trips.
    if (opts.photoPreviewUrl) {
      optimisticMeal.photo_url = opts.photoPreviewUrl;
    }

    setMeals((prev) => {
      const updated = [...prev, optimisticMeal];
      localCache.setForDate(userId, "nutrition_logs", selectedDate, updated);
      nutritionCache.setMeals(userId, selectedDate, updated);
      localCache.remove(userId, "gamification_data");
      return updated;
    });

    try {
      const canonicalId = await createMealMut({
        date: opts.args.p_date,
        mealType: opts.args.p_meal_type,
        mealName: opts.args.p_meal_name,
        notes: opts.args.p_notes ?? undefined,
        isAiGenerated: opts.args.p_is_ai_generated,
        photoStorageId: opts.photoStorageId
          ? (opts.photoStorageId as unknown as Id<"_storage">)
          : undefined,
        items: rpcItemsToConvexItems(opts.args.p_items),
        idempotencyKey,
      });

      if (canonicalId && canonicalId !== optimisticId) {
        setMeals((prev) => {
          const updated = prev.map((m) =>
            m.id === optimisticId ? { ...m, id: canonicalId as unknown as string } : m,
          );
          localCache.setForDate(userId, "nutrition_logs", selectedDate, updated);
          nutritionCache.setMeals(userId, selectedDate, updated);
          return updated;
        });
      }

      celebrateSuccess();
      if (opts.successToast) toast(opts.successToast);
      return canonicalId;
    } catch (err) {
      logger.error("createMealWithItems failed", err);
      // Roll back the optimistic insert so a stale row doesn't linger.
      setMeals((prev) => {
        const updated = prev.filter((m) => m.id !== optimisticId);
        localCache.setForDate(userId, "nutrition_logs", selectedDate, updated);
        nutritionCache.setMeals(userId, selectedDate, updated);
        return updated;
      });
      toast({
        title: "Failed to save meal",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      return null;
    } finally {
      inFlightRef.current = false;
      setSavingMeal(false);
    }
  }, [userId, selectedDate, setMeals, toast, createMealMut]);

  // ── Insert path 1: manual submit ──
  const saveMealToDb = useCallback(async (mealData: {
    meal_name: string;
    calories: number;
    protein_g: number | null;
    carbs_g: number | null;
    fats_g: number | null;
    meal_type: string;
    portion_size: string | null;
    recipe_notes: string | null;
    ingredients: Ingredient[] | null;
    is_ai_generated: boolean;
    photo_storage_id?: string | null;
    photo_preview_url?: string | null;
  }) => {
    if (!userId) throw new Error("Not authenticated");

    const items = ingredientsToRpcItems(mealData.ingredients);
    const args = buildCreateMealRpcArgs({
      header: {
        meal_name: mealData.meal_name,
        meal_type: mealData.meal_type,
        date: selectedDate,
        notes: mealData.recipe_notes,
        is_ai_generated: mealData.is_ai_generated,
      },
      items,
      fallbackTotals: {
        calories: mealData.calories,
        protein_g: mealData.protein_g,
        carbs_g: mealData.carbs_g,
        fats_g: mealData.fats_g,
        name: coerceMealName(mealData.meal_name, mealData.meal_type),
      },
    });

    await runInsertFlow({
      args,
      ingredients: mealData.ingredients,
      portion_size: mealData.portion_size,
      recipe_notes: mealData.recipe_notes,
      photoStorageId: mealData.photo_storage_id ?? null,
      photoPreviewUrl: mealData.photo_preview_url ?? null,
    });
  }, [userId, selectedDate, runInsertFlow]);

  // ── Insert path 2: log a meal-plan idea ──
  const handleLogMealIdea = useCallback(async (mealIdea: Meal, mealTypeOverride?: string) => {
    setLoggingMeal(mealIdea.id);
    try {
      if (!userId) throw new Error("Not authenticated");

      const mealType = resolveMealType(mealTypeOverride ?? mealIdea.meal_type);
      const consistentCalories =
        (mealIdea.protein_g || 0) * 4 + (mealIdea.carbs_g || 0) * 4 + (mealIdea.fats_g || 0) * 9;

      const items = ingredientsToRpcItems(mealIdea.ingredients);
      const args = buildCreateMealRpcArgs({
        header: {
          meal_name: mealIdea.meal_name,
          meal_type: mealType,
          date: selectedDate,
          notes: mealIdea.recipe_notes ?? null,
          is_ai_generated: true,
        },
        items,
        fallbackTotals: {
          calories: consistentCalories || mealIdea.calories,
          protein_g: mealIdea.protein_g ?? null,
          carbs_g: mealIdea.carbs_g ?? null,
          fats_g: mealIdea.fats_g ?? null,
          name: coerceMealName(mealIdea.meal_name, mealType),
        },
      });

      await runInsertFlow({
        args,
        ingredients: mealIdea.ingredients,
        portion_size: mealIdea.portion_size,
        recipe_notes: mealIdea.recipe_notes,
        successToast: { title: "Meal logged!", description: `${mealIdea.meal_name} added to your day` },
      });
    } catch (error) {
      logger.error("Error logging meal", error);
      toast({ title: "Error", description: "Failed to log meal", variant: "destructive" });
    } finally {
      setLoggingMeal(null);
    }
  }, [userId, selectedDate, runInsertFlow, toast]);

  // ── Insert path 3: save all meal-plan ideas as real meals ──
  const saveMealIdeasToDatabase = async (mealIdeas: Meal[]) => {
    if (mealIdeas.length === 0 || savingAllMeals) return;
    setSavingAllMeals(true);
    try {
      if (!userId) throw new Error("Not authenticated");

      // Fire all inserts in parallel. `runInsertFlow` already swallows its
      // own errors and returns `null` on failure, but we still wrap each
      // call in a tiny adapter so a thrown error inside the orchestration
      // layer (e.g. buildCreateMealRpcArgs validation) is captured per-meal
      // rather than aborting the whole batch.
      const results = await Promise.allSettled(
        mealIdeas.map(async (meal) => {
          const recalcCal = (meal.protein_g || 0) * 4 + (meal.carbs_g || 0) * 4 + (meal.fats_g || 0) * 9;
          const mealType = resolveMealType(meal.meal_type);
          const items = ingredientsToRpcItems((meal.ingredients as Ingredient[] | null | undefined));
          const args = buildCreateMealRpcArgs({
            header: {
              meal_name: meal.meal_name,
              meal_type: mealType,
              date: selectedDate,
              notes: meal.recipe_notes ?? null,
              is_ai_generated: true,
            },
            items,
            fallbackTotals: {
              calories: recalcCal || meal.calories,
              protein_g: meal.protein_g ?? null,
              carbs_g: meal.carbs_g ?? null,
              fats_g: meal.fats_g ?? null,
              name: coerceMealName(meal.meal_name, mealType),
            },
          });
          const canonicalId = await runInsertFlow({
            args,
            ingredients: meal.ingredients,
            portion_size: meal.portion_size,
            recipe_notes: meal.recipe_notes,
          });
          // `runInsertFlow` returns null on a swallowed failure — treat that
          // as a failure for the purpose of partial-success accounting.
          if (canonicalId == null) {
            throw new Error(`Failed to save "${meal.meal_name}"`);
          }
          return { id: meal.id, name: meal.meal_name };
        }),
      );

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<{ id: string; name: string }> => r.status === "fulfilled",
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      const successfulIds = new Set(fulfilled.map((r) => r.value.id));

      // Only clear the successful subset from the meal-plan ideas list; the
      // failed ones stay so the user can retry individually.
      setMealPlanIdeas((prev) => prev.filter((m) => !successfulIds.has(m.id)));

      if (rejected.length === 0) {
        AIPersistence.remove(userId, "meal_plans");
        toast({
          title: "All meals saved!",
          description: `${fulfilled.length} meal${fulfilled.length === 1 ? "" : "s"} added to your day`,
        });
      } else if (fulfilled.length === 0) {
        toast({
          title: "Couldn't save meals",
          description: `All ${rejected.length} meal${rejected.length === 1 ? "" : "s"} failed to save. Please try again.`,
          variant: "destructive",
        });
      } else {
        // Partial success — leave the persisted plan in place so the user
        // can retry the failed ones; only the fulfilled ones were stripped
        // from local state above.
        toast({
          title: "Some meals didn't save",
          description: `Saved ${fulfilled.length}, failed ${rejected.length}. Tap a failed meal to retry.`,
          variant: "destructive",
        });
        rejected.forEach((r) => logger.warn("saveMealIdeasToDatabase item failed", { reason: String(r.reason) }));
      }
    } catch (error: any) {
      logger.error("Error saving meal ideas", error);
      toast({ title: "Error saving meals", description: error.message || "Failed to save meals", variant: "destructive" });
    } finally {
      setSavingAllMeals(false);
    }
  };

  const clearMealIdeas = async () => {
    setMealPlanIdeas([]);
    try {
      if (userId) AIPersistence.remove(userId, "meal_plans");
    } catch (e) {
      logger.warn("Failed to clear persisted meal plans", { error: String(e) });
    }
  };

  // ── Delete: cascade removes items via the Convex mutation. ──
  const initiateDeleteMeal = useCallback((meal: Meal) => {
    setMealToDelete(meal);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteMeal = useCallback(async () => {
    if (!mealToDelete || !userId) return;
    const deletedId = mealToDelete.id;

    setMeals((prev) => {
      const updated = prev.filter((m) => m.id !== deletedId);
      localCache.setForDate(userId, "nutrition_logs", selectedDate, updated);
      nutritionCache.setMeals(userId, selectedDate, updated);
      return updated;
    });
    setDeleteDialogOpen(false);
    setMealToDelete(null);

    try {
      await deleteMealMut({ id: deletedId as unknown as Id<"meals"> });
      await loadMeals(true);
    } catch (error) {
      logger.error("Error deleting meal", error);
      toast({
        title: "Failed to delete",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }, [mealToDelete, userId, setMeals, selectedDate, loadMeals, toast, deleteMealMut]);

  // ── Insert path 4: food-search select ──
  const handleFoodSearchSelected = useCallback(async (food: {
    meal_name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fats_g: number;
    serving_size: string;
    portion_size: string;
    food_id?: string | null;
    grams?: number | null;
  }, foodSearchMealType: string) => {
    if (!userId) return;
    const mealType = resolveMealType(foodSearchMealType);
    const args = buildCreateMealRpcArgs({
      header: {
        meal_name: food.meal_name,
        meal_type: mealType,
        date: selectedDate,
        notes: null,
        is_ai_generated: false,
      },
      items: [{
        name: food.meal_name,
        grams: food.grams ?? null,
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fats_g: food.fats_g,
        food_id: food.food_id ?? null,
      }],
    });

    await runInsertFlow({
      args,
      portion_size: food.portion_size,
      successToast: { title: "Food logged!", description: `${food.meal_name} · ${food.calories} kcal` },
    });
  }, [userId, selectedDate, runInsertFlow]);

  return {
    loggingMeal,
    savingAllMeals,
    // Per-meal save lock. Bound to the Save/Add button `disabled` prop in
    // QuickAddDialog so spam taps on slow networks can't fire multiple
    // inserts. Distinct from `savingAllMeals` (bulk meal-plan save).
    savingMeal,
    deleteDialogOpen, setDeleteDialogOpen,
    mealToDelete,
    saveMealToDb,
    handleLogMealIdea,
    saveMealIdeasToDatabase,
    clearMealIdeas,
    initiateDeleteMeal,
    handleDeleteMeal,
    handleFoodSearchSelected,
  };
}
