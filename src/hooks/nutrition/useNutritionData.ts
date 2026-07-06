import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useConvex } from "convex/react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { AIPersistence } from "@/lib/aiPersistence";
import { nutritionCache, onMealsChange, sanitizeMealRows } from "@/lib/nutritionCache";
import { localCache } from "@/lib/localCache";
import { calculateCalorieTarget as calculateCalorieTargetUtil } from "@/lib/calorieCalculation";
import { logger } from "@/lib/logger";
import { coerceMealName } from "@/lib/mealName";
import { mapMealsWithTotalsToMeal } from "./mealsMapper";
import { api } from "../../../convex/_generated/api";
import { macroForDay, type TrainingDay } from "@/../convex/_shared/math";
import { deriveDayType, type DayTypeSession } from "@/lib/dayType";
import type { Meal, MacroGoals, MealWithTotals } from "@/pages/nutrition/types";
import type { DietAnalysisResult } from "@/types/dietAnalysis";

// Re-export so NutritionPage / MealCard can import the lazy item fetcher
// from the same entry point they already use for the data hook.
export { fetchMealItems } from "./mealsMapper";

const LOCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — stale-while-revalidate handles freshness

interface UseNutritionDataParams {
  selectedDate: string;
  meals: Meal[];
  setMeals: React.Dispatch<React.SetStateAction<Meal[]>>;
  mealPlanIdeas: Meal[];
  setMealPlanIdeas: React.Dispatch<React.SetStateAction<Meal[]>>;
  dailyCalorieTarget: number;
  setDailyCalorieTarget: React.Dispatch<React.SetStateAction<number>>;
  aiMacroGoals: MacroGoals | null;
  setAiMacroGoals: React.Dispatch<React.SetStateAction<MacroGoals | null>>;
  setSafetyStatus: React.Dispatch<React.SetStateAction<"green" | "yellow" | "red">>;
  setSafetyMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useNutritionData(params: UseNutritionDataParams) {
  const {
    selectedDate, meals, setMeals, mealPlanIdeas, setMealPlanIdeas,
    dailyCalorieTarget, setDailyCalorieTarget,
    aiMacroGoals, setAiMacroGoals,
    setSafetyStatus, setSafetyMessage,
  } = params;

  const { userId, profile: contextProfile, refreshProfile } = useUser();
  const profile = contextProfile;
  const convex = useConvex();
  const { safeAsync, isMounted } = useSafeAsync();
  const { toast } = useToast();
  const [fetchingMacroGoals, setFetchingMacroGoals] = useState(false);
  const [mealsLoading, setMealsLoading] = useState(false);
  const lastFetchRef = useRef(0);
  const activeDateRef = useRef(selectedDate);
  const mealsRef = useRef(meals);
  mealsRef.current = meals;

  // Diet analysis state
  const [dietAnalysis, setDietAnalysis] = useState<DietAnalysisResult | null>(null);
  const [dietAnalysisLoading, setDietAnalysisLoading] = useState(false);

  const calculateCalorieTarget = (profileData: any) => {
    const target = calculateCalorieTargetUtil(profileData);
    if (Number.isFinite(target) && target > 0) {
      setDailyCalorieTarget(target);
    }
    setSafetyStatus("green");
    setSafetyMessage("");
  };

  const fetchMacroGoals = async () => {
    if (!profile) return;
    safeAsync(setFetchingMacroGoals)(true);
    try {
      if (!userId) {
        safeAsync(setFetchingMacroGoals)(false);
        return;
      }

      const persistedMacros = localCache.get<any>(userId, 'macro_goals', 60 * 60 * 1000);
      if (persistedMacros?.macroGoals) {
        safeAsync(setAiMacroGoals)(persistedMacros.macroGoals);
        if (persistedMacros.dailyCalorieTarget && persistedMacros.dailyCalorieTarget > 0) {
          safeAsync(setDailyCalorieTarget)(persistedMacros.dailyCalorieTarget);
        }
        safeAsync(setFetchingMacroGoals)(false);
      }

      const cachedMacroGoals = nutritionCache.getMacroGoals(userId);
      if (cachedMacroGoals) {
        if (cachedMacroGoals.macroGoals) {
          safeAsync(setAiMacroGoals)(cachedMacroGoals.macroGoals);
        }
        if (cachedMacroGoals.dailyCalorieTarget && cachedMacroGoals.dailyCalorieTarget > 0) {
          safeAsync(setDailyCalorieTarget)(cachedMacroGoals.dailyCalorieTarget);
        }
        if (cachedMacroGoals.profileUpdate && profile && profile.manual_nutrition_override !== cachedMacroGoals.profileUpdate.manual_nutrition_override) {
          refreshProfile();
        }
        safeAsync(setFetchingMacroGoals)(false);
        return;
      }

      const profileData = contextProfile;

      if (profileData?.ai_recommended_calories) {
        const macroGoals: MacroGoals = {
          proteinGrams: profileData.ai_recommended_protein_g || 0,
          carbsGrams: profileData.ai_recommended_carbs_g || 0,
          fatsGrams: profileData.ai_recommended_fats_g || 0,
          recommendedCalories: profileData.ai_recommended_calories || 0,
        };

        setAiMacroGoals(macroGoals);
        setDailyCalorieTarget(profileData.ai_recommended_calories);
        if (profile && profile.manual_nutrition_override !== profileData.manual_nutrition_override) {
          refreshProfile();
        }

        const macroData = {
          macroGoals,
          dailyCalorieTarget: profileData.ai_recommended_calories,
          profileUpdate: { manual_nutrition_override: profileData.manual_nutrition_override }
        };
        nutritionCache.setMacroGoals(userId, macroData);
        localCache.set(userId, 'macro_goals', macroData);
      }
    } catch (error) {
      logger.warn("fetchMacroGoals failed, keeping last-known-good values", { error: String(error) });
    } finally {
      safeAsync(setFetchingMacroGoals)(false);
    }
  };

  const loadMeals = async (skipCache = false, _retryCount = 0, silent = false, clearAnalysis = false) => {
    if (!userId) return;
    const fetchDate = selectedDate;
    lastFetchRef.current = Date.now();

    if (clearAnalysis && _retryCount === 0) {
      setDietAnalysis(null);
      AIPersistence.remove(userId, `diet_analysis_${fetchDate}`);
    }

    if (!skipCache) {
      const cachedMeals = nutritionCache.getMeals(userId, fetchDate);
      if (cachedMeals) {
        setMeals(sanitizeMealRows<Meal>(cachedMeals));
        safeAsync(setMealsLoading)(false);
        return;
      }
    }

    let servedFromLocal = false;
    if (!skipCache) {
      const localMeals = localCache.getForDate<Meal[]>(userId, "nutrition_logs", fetchDate, LOCAL_CACHE_TTL_MS);
      const cleanLocal = sanitizeMealRows<Meal>(localMeals);
      if (cleanLocal.length > 0) {
        const normalized = cleanLocal.map(m => ({ ...m, meal_name: coerceMealName(m.meal_name, m.meal_type) }));
        setMeals(normalized);
        nutritionCache.setMeals(userId, fetchDate, cleanLocal);
        safeAsync(setMealsLoading)(false);
        servedFromLocal = true;
      }
    }

    const hasVisibleMeals = mealsRef.current.length > 0;
    const hasLocalCache = !!localCache.getForDate(userId, "nutrition_logs", fetchDate);
    if (!silent && !servedFromLocal && !hasVisibleMeals && !hasLocalCache) {
      safeAsync(setMealsLoading)(true);
    }

    // Convex query — replaces `meals_with_totals` view + RLS filter.
    let data: MealWithTotals[] | null = null;
    try {
      const raw = await convex.query(api.meals.listWithTotals, { date: fetchDate });
      data = (raw ?? []) as unknown as MealWithTotals[];
    } catch (err) {
      if (!isMounted()) return;
      logger.error("Error loading meals", err);
      const fallback = localCache.getForDate<Meal[]>(userId, "nutrition_logs", fetchDate);
      if (fallback && fallback.length > 0) {
        setMeals(fallback);
      }
      safeAsync(setMealsLoading)(false);
      return;
    }

    if (!isMounted()) return;
    if (activeDateRef.current !== fetchDate) return;

    const typedMeals: Meal[] = (data || []).map(mapMealsWithTotalsToMeal);

    const currentMeals = mealsRef.current;
    const serializedNew = JSON.stringify(typedMeals);
    const serializedCurrent = JSON.stringify(currentMeals);
    if (serializedNew !== serializedCurrent) {
      setMeals(typedMeals);
    }
    safeAsync(setMealsLoading)(false);
    nutritionCache.setMeals(userId, fetchDate, typedMeals);
    localCache.setForDate(userId, "nutrition_logs", fetchDate, typedMeals);
  };

  useEffect(() => {
    activeDateRef.current = selectedDate;

    if (userId) {
      const cached =
        nutritionCache.getMeals(userId, selectedDate)
        ?? localCache.getForDate<Meal[]>(userId, "nutrition_logs", selectedDate, LOCAL_CACHE_TTL_MS);
      setMeals(sanitizeMealRows<Meal>(cached));
    } else {
      setMeals([]);
    }

    loadMeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, userId]);

  // Recalculate calorie target when relevant profile fields change
  useEffect(() => {
    if (contextProfile) calculateCalorieTarget(contextProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextProfile?.ai_recommended_calories, contextProfile?.tdee, contextProfile?.bmr,
      contextProfile?.current_weight_kg, contextProfile?.goal_weight_kg,
      contextProfile?.manual_nutrition_override]);

  // Load persisted meal plans once on mount
  useEffect(() => {
    if (!userId) return;
    const persistedData = AIPersistence.load(userId, 'meal_plans');
    if (persistedData && mealPlanIdeas.length === 0) {
      setMealPlanIdeas(persistedData.meals || []);
      if (persistedData.dailyCalorieTarget) setDailyCalorieTarget(persistedData.dailyCalorieTarget);
      if (persistedData.safetyStatus) setSafetyStatus(persistedData.safetyStatus);
      if (persistedData.safetyMessage) setSafetyMessage(persistedData.safetyMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Visibility-based revalidation — silent refresh keeps existing meals visible
  useEffect(() => {
    const handleVis = () => {
      if (document.visibilityState === 'visible' && userId) {
        if (Date.now() - lastFetchRef.current < 2000) return;
        loadMeals(true, 0, /* silent */ true);
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedDate]);

  // Load cached diet analysis on date change
  useEffect(() => {
    if (!userId) return;
    const cached = AIPersistence.load(userId, `diet_analysis_${selectedDate}`);
    setDietAnalysis(cached || null);
  }, [selectedDate, userId]);

  // Fetch macro goals when profile changes
  useEffect(() => {
    if (contextProfile) {
      fetchMacroGoals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextProfile?.ai_recommended_protein_g, contextProfile?.ai_recommended_carbs_g,
      contextProfile?.ai_recommended_fats_g, contextProfile?.ai_recommended_calories,
      contextProfile?.manual_nutrition_override]);

  // In-process cache change events — let useMealOperations fire optimistic
  // updates through the same channel. Reactive Convex queries surface
  // out-of-band changes automatically; this hook now only listens to local
  // events from companion hooks.
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onMealsChange((evt) => {
      if (evt.userId !== userId) return;
      if (evt.date !== activeDateRef.current) return;
      if (evt.type === "delete") {
        const cached = nutritionCache.getMeals(userId, evt.date);
        if (cached) setMeals(sanitizeMealRows<Meal>(cached));
        return;
      }
      loadMeals(/* skipCache */ true, 0, /* silent */ true);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, setMeals]);

  return {
    loadMeals,
    fetchMacroGoals,
    calculateCalorieTarget,
    fetchingMacroGoals,
    mealsLoading,
    dietAnalysis, setDietAnalysis,
    dietAnalysisLoading, setDietAnalysisLoading,
    lastFetchRef,
  };
}

// Ref to track quick add sheet state for warmup effect
const isQuickAddSheetOpenRef = { current: false };
export function setQuickAddSheetOpenRef(val: boolean) {
  isQuickAddSheetOpenRef.current = val;
}

// ── Carb-cycle daily target ─────────────────────────────────────────────
// Cut plans carry a Hard/Medium/Rest carb cycle: calories are IDENTICAL every
// day, protein is the swing variable and carbs fill the rest (see
// convex/_shared/math.ts `macroForDay`). This hook resolves the macro target
// for the day being viewed by mapping that day's training session onto the
// cycle, with an optional manual per-day override, so the plan's carb cycle is
// actually followed day to day. Maintenance / no-plan users get
// `active: false` and the page keeps its flat `ai_recommended_*` target.
//
// Resolved ONCE at NutritionPage level so the calorie ring and the meal-plan
// generator share the same cycled macros. Callers pass the EFFECTIVE calorie
// target (`dailyCalorieTarget`, which honours manual edits) as the kcal base,
// plus the calendar sessions NutritionPage already queries (no duplicate
// query here). Bodyweight + goal type still come from the profile.
export interface CarbCycleTarget {
  /** True only when a carb-cycle cut plan is active AND we have the inputs. */
  active: boolean;
  /** The day type currently applied (a manual override wins over auto). */
  dayType: TrainingDay;
  /** The auto-derived day type from the viewed day's session. */
  autoDayType: TrainingDay;
  /** True when the viewed day's type has been manually overridden. */
  isOverridden: boolean;
  /** Resolved macro goals for `dayType`; null when the cycle is inactive. */
  macroGoals: MacroGoals | null;
  /** One-line reason under the ring (no em dashes). Empty when inactive. */
  reason: string;
  /** Override the viewed day's type (applies only to `selectedDate`). */
  setOverride: (day: TrainingDay) => void;
}

export function useCarbCycleTarget(params: {
  /** The day being viewed. Manual overrides are keyed by this. */
  selectedDate: string;
  /**
   * EFFECTIVE calorie target (post manual edits). This is the kcal base fed
   * to `macroForDay`, so a user who edits their calorie goal is honoured.
   */
  kcal: number;
  /**
   * The viewed day's calendar session(s), already queried by NutritionPage.
   * `sessions[0]` drives the auto day type. Passing them in avoids a duplicate
   * `listCalendar` query.
   */
  sessions: readonly DayTypeSession[] | null | undefined;
}): CarbCycleTarget {
  const { selectedDate, kcal, sessions } = params;
  const { profile } = useUser();

  // Manual overrides are keyed by date so a manual pick only ever applies to
  // the day it was made on; switching days is independent.
  const [overrides, setOverrides] = useState<Record<string, TrainingDay>>({});

  const setOverride = useCallback(
    (day: TrainingDay) => {
      setOverrides((prev) => ({ ...prev, [selectedDate]: day }));
    },
    [selectedDate],
  );

  const weightKg = profile?.current_weight_kg;
  const goalType = profile?.goal_type;

  return useMemo<CarbCycleTarget>(() => {
    const autoDayType = deriveDayType(sessions?.[0] ?? null);
    const override = overrides[selectedDate];
    const dayType = override ?? autoDayType;

    // The carb cycle applies to weight-cut plans only (cutting / losing
    // goals), and only when we have the calorie budget + bodyweight that
    // `macroForDay` needs. Maintenance and unresolved profiles fall back to
    // the flat `ai_recommended_*` target — no visible change for them.
    const isCutPlan = goalType === "cutting" || goalType === "losing";
    const active =
      isCutPlan &&
      typeof weightKg === "number" &&
      weightKg > 0 &&
      typeof kcal === "number" &&
      kcal > 0;

    if (!active) {
      return {
        active: false,
        dayType,
        autoDayType,
        isOverridden: override != null,
        macroGoals: null,
        reason: "",
        setOverride,
      };
    }

    const fuel = macroForDay(kcal, weightKg, dayType);
    const macroGoals: MacroGoals = {
      proteinGrams: fuel.protein_g,
      carbsGrams: fuel.carb_g,
      fatsGrams: fuel.fat_g,
      recommendedCalories: kcal,
    };

    let reason: string;
    if (dayType === "hard") {
      const mediumCarbs = macroForDay(kcal, weightKg, "medium").carb_g;
      const extraCarbs = Math.max(0, fuel.carb_g - mediumCarbs);
      reason = `Hard day, plus ${extraCarbs}g carbs`;
    } else if (dayType === "rest") {
      reason = "Rest day, protein led";
    } else {
      reason = "Medium day";
    }

    return {
      active: true,
      dayType,
      autoDayType,
      isOverridden: override != null,
      macroGoals,
      reason,
      setOverride,
    };
  }, [sessions, overrides, selectedDate, weightKg, kcal, goalType, setOverride]);
}
