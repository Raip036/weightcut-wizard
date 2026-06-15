import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { nutritionCache, sanitizeMealRows } from "@/lib/nutritionCache";
import { localCache } from "@/lib/localCache";
import { useUser } from "@/contexts/UserContext";
import type { Meal, MacroGoals, ManualMealForm, ManualNutritionDialogState, EditingTargets, BarcodeBaseMacros, AiLineItem, INITIAL_MANUAL_MEAL, INITIAL_MANUAL_NUTRITION_DIALOG } from "@/pages/nutrition/types";

interface PersistedMacroGoals {
  macroGoals?: MacroGoals;
  dailyCalorieTarget?: number;
}

export function useNutritionState(initialDate?: string) {
  const { userId } = useUser();
  const today = format(new Date(), "yyyy-MM-dd");
  // Initialize meals from cache to prevent empty→loaded flicker on navigation.
  // Sanitize the cached payload so any partial-shape rows from prior versions
  // (or from a now-removed realtime raw-row push) cannot reach the renderer.
  const [meals, setMeals] = useState<Meal[]>(() => {
    if (!userId) return [];
    const cached =
      nutritionCache.getMeals(userId, today)
      || localCache.getForDate<Meal[]>(userId, "nutrition_logs", today)
      || [];
    return sanitizeMealRows<Meal>(cached);
  });
  const [mealPlanIdeas, setMealPlanIdeas] = useState<Meal[]>([]);
  // Seed the initial selected date from the optional deep-link arg (e.g. the
  // dashboard catch-up sheet's `?date=` param), falling back to today. Lazy
  // init runs ONCE on mount, so the user can still tap other dates afterward —
  // we never reactively overwrite their manual date-strip selection.
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? today);
  // Seed from last-known-good macro goals cached in localStorage so the ring
  // always has a non-zero target on cold-start and survives mid-session state
  // resets (e.g. a profile refetch returning briefly empty).
  const [dailyCalorieTarget, setDailyCalorieTarget] = useState<number>(() => {
    if (!userId) return 2000;
    const persisted = localCache.get<PersistedMacroGoals>(userId, "macro_goals");
    return persisted?.dailyCalorieTarget && persisted.dailyCalorieTarget > 0
      ? persisted.dailyCalorieTarget
      : 2000;
  });
  const [aiMacroGoals, setAiMacroGoals] = useState<MacroGoals | null>(() => {
    if (!userId) return null;
    const persisted = localCache.get<PersistedMacroGoals>(userId, "macro_goals");
    return persisted?.macroGoals ?? null;
  });
  const [safetyStatus, setSafetyStatus] = useState<"green" | "yellow" | "red">("green");
  const [safetyMessage, setSafetyMessage] = useState("");

  // Re-hydrate from cache whenever userId resolves OR selectedDate changes.
  // The useState initializers above only run once on mount — if userId is still
  // null at first render (cold auth bootstrap) the ring shows 0 until the
  // network fetch lands. Reading the cache lazily here paints the last-known
  // calorie ring instantly on every navigation back to Nutrition.
  useEffect(() => {
    if (!userId) return;
    const cachedMeals = nutritionCache.getMeals(userId, selectedDate)
      || localCache.getForDate<Meal[]>(userId, "nutrition_logs", selectedDate);
    const cleanCached = sanitizeMealRows<Meal>(cachedMeals);
    if (cleanCached.length > 0) {
      setMeals((prev) => (prev.length === 0 ? cleanCached : prev));
    }
    const persisted = localCache.get<PersistedMacroGoals>(userId, "macro_goals");
    if (persisted?.dailyCalorieTarget && persisted.dailyCalorieTarget > 0) {
      setDailyCalorieTarget((prev) => (prev > 0 ? prev : persisted.dailyCalorieTarget!));
    }
    if (persisted?.macroGoals) {
      setAiMacroGoals((prev) => prev ?? persisted.macroGoals!);
    }
  }, [userId, selectedDate]);

  // Derived totals
  const totalCalories = meals.reduce((sum, meal) => sum + meal.calories, 0);
  const totalProtein = meals.reduce((sum, meal) => sum + (meal.protein_g || 0), 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + (meal.carbs_g || 0), 0);
  const totalFats = meals.reduce((sum, meal) => sum + (meal.fats_g || 0), 0);

  return {
    meals, setMeals,
    mealPlanIdeas, setMealPlanIdeas,
    selectedDate, setSelectedDate,
    dailyCalorieTarget, setDailyCalorieTarget,
    aiMacroGoals, setAiMacroGoals,
    safetyStatus, setSafetyStatus,
    safetyMessage, setSafetyMessage,
    totalCalories, totalProtein, totalCarbs, totalFats,
  };
}
