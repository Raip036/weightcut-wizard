import { useState, useCallback, useEffect } from "react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAITask } from "@/contexts/AITaskContext";
import { AIPersistence } from "@/lib/aiPersistence";
import { createAIAbortController } from "@/lib/timeoutWrapper";
import { logger } from "@/lib/logger";
import { clampMealCount, computePlanTotals, isOnTarget } from "@/lib/mealPlan";
import { Activity, Utensils, CheckCircle } from "lucide-react";
import type { Meal, DayPlan, DayPlanMeal, MealTargets } from "@/pages/nutrition/types";

interface UseMealPlanGenerationParams {
  selectedDate: string;
  dailyCalorieTarget: number;
  setDailyCalorieTarget: React.Dispatch<React.SetStateAction<number>>;
  safetyStatus: "green" | "yellow" | "red";
  setSafetyStatus: React.Dispatch<React.SetStateAction<"green" | "yellow" | "red">>;
  safetyMessage: string;
  setSafetyMessage: React.Dispatch<React.SetStateAction<string>>;
  mealPlanIdeas: Meal[];
  setMealPlanIdeas: React.Dispatch<React.SetStateAction<Meal[]>>;
  aiAbortRef: React.MutableRefObject<AbortController | null>;
  // ── New (additive) inputs for the day-plan flow. All optional so the
  // existing single call site keeps compiling unchanged; a later unit wires
  // these through. ──
  targets?: MealTargets;
  trainingContext?: { sessionType: string; sessionTag?: string } | null;
}

export function useMealPlanGeneration(params: UseMealPlanGenerationParams) {
  const {
    selectedDate, dailyCalorieTarget, setDailyCalorieTarget,
    safetyStatus, setSafetyStatus, safetyMessage, setSafetyMessage,
    mealPlanIdeas, setMealPlanIdeas, aiAbortRef,
    targets, trainingContext,
  } = params;

  const { isSessionValid, checkSessionValidity, refreshSession, userId, profile: contextProfile } = useUser();
  const profile = contextProfile;
  const { toast } = useToast();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_MEAL_PLANNER");
  const { addTask, completeTask, failTask } = useAITask();
  const mealPlannerAction = useAIAction(api.actions.mealPlanner.run, "AI_MEAL_PLANNER");

  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  // ── New (additive) state for the day-plan flow. ──
  const [mealCount, setMealCount] = useState(4);
  const [dayPlan, setDayPlan] = useState<DayPlan | null>(null);

  const handleGenerateMealPlan = useCallback(async () => {
    if (!aiPrompt.trim()) {
      toast({ title: "Please enter a prompt", description: "Describe what kind of meals you'd like", variant: "destructive" });
      return;
    }

    if (!hasAiAccess) {
      openPaywall();
      return;
    }

    aiAbortRef.current?.abort();
    const controller = createAIAbortController();
    aiAbortRef.current = controller;

    setGeneratingPlan(true);
    setIsAiDialogOpen(false);
    const taskId = addTask({
      id: `meal-plan-${Date.now()}`,
      type: "meal-plan",
      label: "Generating Meal Plan",
      steps: [
        { icon: Activity, label: "Analyzing nutritional needs" },
        { icon: Utensils, label: "Designing meal structure" },
        { icon: CheckCircle, label: "Optimizing recipes" },
      ],
      returnPath: "/nutrition",
    });
    try {
      if (!isSessionValid) {
        const sessionValid = await checkSessionValidity();
        if (!sessionValid) {
          toast({ title: "Authentication Required", description: "Your session has expired. Please refresh the page and log in again.", variant: "destructive" });
          setGeneratingPlan(false);
          return;
        }
      }

      if (!userId) {
        throw new Error("Authentication required. Please log in again.");
      }

      const userData = profile ? {
        currentWeight: profile.current_weight_kg,
        goalWeight: profile.goal_weight_kg,
        tdee: profile.tdee,
        daysToWeighIn: profile.target_date ? Math.ceil(
          (new Date(profile.target_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        ) : 0,
      } : null;

      let data: any;
      try {
        data = await mealPlannerAction({ prompt: aiPrompt, userData, action: "generate" });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (await handlePaywallError(err)) { failTask(taskId, "Pro required"); return; }
        throw new Error(err?.message || "Failed to generate meal plan");
      }

      if (controller.signal.aborted) return;
      if (data?.error) {
        throw new Error(data.error);
      }

      const { mealPlan, dailyCalorieTarget: target, safetyStatus: status, safetyMessage: message } = data;

      const ideasToStore: Meal[] = [];

      if (mealPlan && mealPlan.meals && Array.isArray(mealPlan.meals)) {
        mealPlan.meals.forEach((meal: any, idx: number) => {
          const mealType = meal.type || "meal";
          const timestamp = Date.now() + idx;
          const mealProtein = meal.protein || 0;
          const mealCarbs = meal.carbs || 0;
          const mealFats = meal.fats || 0;

          ideasToStore.push({
            id: `idea-${mealType}-${timestamp}`,
            meal_name: meal.name || `${mealType} meal`,
            calories: mealProtein * 4 + mealCarbs * 4 + mealFats * 9,
            protein_g: mealProtein,
            carbs_g: mealCarbs,
            fats_g: mealFats,
            meal_type: mealType as "breakfast" | "lunch" | "dinner" | "snack",
            portion_size: meal.portion || "1 serving",
            recipe_notes: meal.recipe || "",
            ingredients: meal.ingredients || undefined,
            is_ai_generated: true,
            date: selectedDate,
          });
        });
      } else if (mealPlan && typeof mealPlan === 'object') {
        const mealTypes = ['breakfast', 'lunch', 'dinner'];
        mealTypes.forEach(mealType => {
          if (mealPlan[mealType]) {
            const meal = mealPlan[mealType];
            const mp = meal.protein || 0;
            const mc = meal.carbs || 0;
            const mf = meal.fats || 0;
            ideasToStore.push({
              id: `idea-${mealType}-${Date.now()}`,
              meal_name: meal.name || `${mealType} meal`,
              calories: mp * 4 + mc * 4 + mf * 9,
              protein_g: mp,
              carbs_g: mc,
              fats_g: mf,
              meal_type: mealType as "breakfast" | "lunch" | "dinner",
              portion_size: meal.portion || "1 serving",
              recipe_notes: meal.recipe || "",
              ingredients: meal.ingredients || undefined,
              is_ai_generated: true,
              date: selectedDate,
            });
          }
        });

        if (mealPlan.snacks && Array.isArray(mealPlan.snacks)) {
          mealPlan.snacks.forEach((snack: any, idx: number) => {
            const sp = snack.protein || 0;
            const sc = snack.carbs || 0;
            const sf = snack.fats || 0;
            ideasToStore.push({
              id: `idea-snack-${idx}-${Date.now()}`,
              meal_name: snack.name || "Snack",
              calories: sp * 4 + sc * 4 + sf * 9,
              protein_g: sp,
              carbs_g: sc,
              fats_g: sf,
              meal_type: "snack",
              portion_size: snack.portion || "1 serving",
              recipe_notes: snack.recipe || "",
              ingredients: snack.ingredients || undefined,
              is_ai_generated: true,
              date: selectedDate,
            });
          });
        }
      }

      if (ideasToStore.length === 0) {
        toast({ title: "No meals found", description: "The AI response didn't contain parseable meal data. Please try a different prompt.", variant: "destructive" });
        return;
      }

      setMealPlanIdeas(prev => [...prev, ...ideasToStore]);
      setDailyCalorieTarget(target || dailyCalorieTarget);
      setSafetyStatus(status || safetyStatus);
      setSafetyMessage(message || safetyMessage);

      const accumulatedIdeas = [...mealPlanIdeas, ...ideasToStore].slice(-30);
      if (userId) {
        AIPersistence.save(userId, 'meal_plans', {
          meals: accumulatedIdeas,
          dailyCalorieTarget: target || dailyCalorieTarget,
          safetyStatus: status || safetyStatus,
          safetyMessage: message || safetyMessage,
          prompt: aiPrompt
        }, 24);
      }

      setIsAiDialogOpen(false);
      setAiPrompt("");
      completeTask(taskId, data);
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return;
      logger.error("Error generating meal plan", error);

      let errorMsg = "Failed to generate meal plan";

      if (error?.message?.includes("authorization") || error?.code === 401) {
        try {
          const refreshSuccess = await refreshSession();
          if (refreshSuccess) {
            errorMsg = "Session refreshed. Please try again.";
          } else {
            errorMsg = "Session expired. Please refresh the page and log in again.";
          }
        } catch {
          errorMsg = "Authentication failed. Please refresh the page and log in again.";
        }
      } else if (error?.message) {
        if (error.message.includes('429') || error.message.includes('quota')) {
          errorMsg = "AI service is temporarily busy. Please try again in a few minutes.";
        } else if (error.message.includes('404')) {
          errorMsg = "AI service temporarily unavailable. Please try again later.";
        } else {
          errorMsg = error.message;
        }
      }

      failTask(taskId, errorMsg);
      toast({ title: "Error generating meal plan", description: errorMsg, variant: "destructive" });
    } finally {
      setGeneratingPlan(false);
    }
  }, [aiPrompt, isSessionValid, checkSessionValidity, userId, profile, selectedDate, dailyCalorieTarget, safetyStatus, safetyMessage, mealPlanIdeas, setMealPlanIdeas, setDailyCalorieTarget, setSafetyStatus, setSafetyMessage, aiAbortRef, refreshSession, toast, hasAiAccess, openPaywall, handlePaywallError, addTask, completeTask, failTask, mealPlannerAction]);

  // ── New (additive): day-plan generation. Mirrors the existing
  // paywall/error handling so Pro gating stays consistent, but writes to the
  // new `dayPlan` state and `meal_day_plan` cache rather than the legacy
  // `mealPlanIdeas` flow. Does NOT touch `handleGenerateMealPlan`. ──
  const generateDayPlan = useCallback(async () => {
    if (!targets || !userId) return;

    if (!hasAiAccess) {
      openPaywall();
      return;
    }

    setGeneratingPlan(true);
    try {
      let plan: DayPlan;
      try {
        plan = (await mealPlannerAction({
          prompt: aiPrompt,
          action: "day_plan",
          mealCount: clampMealCount(mealCount),
          targets,
          trainingContext: trainingContext ?? undefined,
        })) as DayPlan;
      } catch (err: any) {
        if (await handlePaywallError(err)) return;
        throw new Error(err?.message || "Failed to generate meal plan");
      }

      setDayPlan(plan);
      AIPersistence.save(userId, "meal_day_plan", {
        generatedAt: Date.now(), dateIso: selectedDate, targetsSnapshot: targets,
        prompt: aiPrompt, mealCount, plan,
      }, 24);
    } catch (error: any) {
      logger.error("Error generating day plan", error);
      toast({ title: "Error generating meal plan", description: error?.message || "Failed to generate meal plan", variant: "destructive" });
    } finally {
      setGeneratingPlan(false);
    }
  }, [targets, userId, aiPrompt, mealCount, trainingContext, selectedDate, mealPlannerAction, hasAiAccess, openPaywall, handlePaywallError, toast]);

  // ── New (additive): swap a single meal in the current day plan. ──
  const swapMeal = useCallback(async (mealId: string) => {
    if (!dayPlan || !targets || !userId) return;
    const target = dayPlan.meals.find((m) => m.id === mealId);
    if (!target) return;
    const otherMeals = dayPlan.meals.filter((m) => m.id !== mealId)
      .map((m) => ({ protein: m.protein, carbs: m.carbs, fats: m.fats }));
    const res = (await mealPlannerAction({
      action: "swap", prompt: aiPrompt, targets,
      slot: { type: target.type, timingLabel: target.timingLabel }, otherMeals,
    })) as { meal: DayPlanMeal };
    const meals = dayPlan.meals.map((m) => (m.id === mealId ? { ...res.meal, id: mealId } : m));
    const totals = computePlanTotals(meals);
    const next: DayPlan = { ...dayPlan, meals, totals, onTarget: isOnTarget(totals, targets) };
    setDayPlan(next);
    AIPersistence.save(userId, "meal_day_plan", {
      generatedAt: Date.now(), dateIso: selectedDate, targetsSnapshot: targets,
      prompt: aiPrompt, mealCount, plan: next,
    }, 24);
  }, [dayPlan, targets, userId, aiPrompt, selectedDate, mealCount, mealPlannerAction]);

  // ── New (additive): restore a cached day plan when the sheet opens, only
  // if no plan is loaded yet and the cache is for the same date. ──
  useEffect(() => {
    if (!isAiDialogOpen || dayPlan || !userId) return;
    const cached = AIPersistence.load(userId, "meal_day_plan");
    if (cached?.plan && cached.dateIso === selectedDate) {
      setDayPlan(cached.plan);
      setAiPrompt(cached.prompt ?? "");
      setMealCount(cached.mealCount ?? 4);
    }
  }, [isAiDialogOpen, userId, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── New (additive): true when a plan exists but live targets have drifted
  // from the targets the plan was generated against. ──
  const targetsChanged = !!dayPlan && !!targets && (
    dayPlan.targets.kcal !== targets.kcal ||
    dayPlan.targets.protein !== targets.protein ||
    dayPlan.targets.carbs !== targets.carbs ||
    dayPlan.targets.fats !== targets.fats
  );

  return {
    generatingPlan, setGeneratingPlan,
    aiPrompt, setAiPrompt,
    isAiDialogOpen, setIsAiDialogOpen,
    handleGenerateMealPlan,
    // ── New (additive) day-plan API ──
    dayPlan, setDayPlan,
    mealCount, setMealCount,
    generateDayPlan,
    swapMeal,
    targetsChanged,
  };
}
