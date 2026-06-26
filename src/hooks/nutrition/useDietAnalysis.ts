import { useRef, useCallback } from "react";
import { api } from "@/../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useAIAction } from "@/hooks/useAIAction";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAITask } from "@/contexts/AITaskContext";
import { AIPersistence } from "@/lib/aiPersistence";
import { createAIAbortController, extractEdgeFunctionError } from "@/lib/timeoutWrapper";
import { triggerHapticSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { track, EVENTS } from "@/lib/analytics";
import { Utensils, PieChart, Search, CheckCircle } from "lucide-react";
import type { Meal, MacroGoals } from "@/pages/nutrition/types";
import type { DietAnalysisResult } from "@/types/dietAnalysis";

interface UseDietAnalysisParams {
  meals: Meal[];
  selectedDate: string;
  dailyCalorieTarget: number;
  aiMacroGoals: MacroGoals | null;
  dietAnalysis: DietAnalysisResult | null;
  setDietAnalysis: React.Dispatch<React.SetStateAction<DietAnalysisResult | null>>;
  dietAnalysisLoading: boolean;
  setDietAnalysisLoading: React.Dispatch<React.SetStateAction<boolean>>;
  aiAbortRef: React.MutableRefObject<AbortController | null>;
}

export function useDietAnalysis(params: UseDietAnalysisParams) {
  const {
    meals, selectedDate, dailyCalorieTarget, aiMacroGoals,
    dietAnalysis, setDietAnalysis, dietAnalysisLoading, setDietAnalysisLoading,
    aiAbortRef,
  } = params;

  const { userId, profile: contextProfile } = useUser();
  const { toast } = useToast();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_DIET_ANALYSIS");
  const { addTask, completeTask, failTask } = useAITask();
  const analyseDietAction = useAIAction(api.actions.analyseDiet.run, "AI_DIET_ANALYSIS");

  const handleAnalyseDiet = useCallback(async (forceRefresh = false) => {
    if (!userId || meals.length === 0) return;

    const cacheKey = `diet_analysis_${selectedDate}`;
    if (!forceRefresh) {
      const cached = AIPersistence.load(userId, cacheKey);
      if (cached) {
        setDietAnalysis(cached);
        return;
      }
    }

    if (!hasAiAccess) {
      openPaywall();
      return;
    }

    aiAbortRef.current?.abort();
    const dietController = createAIAbortController();
    aiAbortRef.current = dietController;

    setDietAnalysisLoading(true);
    const taskId = addTask({
      id: `diet-analysis-${Date.now()}`,
      type: "diet-analysis",
      label: "Analysing Diet",
      steps: [
        { icon: Utensils, label: "Reviewing meals" },
        { icon: PieChart, label: "Estimating micronutrients" },
        { icon: Search, label: "Identifying gaps" },
        { icon: CheckCircle, label: "Generating recommendations" },
      ],
      returnPath: "/nutrition",
    });
    try {

      let data: any;
      try {
        data = await analyseDietAction({
          meals: meals.map(m => ({
            meal_name: m.meal_name,
            calories: m.calories,
            protein_g: m.protein_g || 0,
            carbs_g: m.carbs_g || 0,
            fats_g: m.fats_g || 0,
            meal_type: m.meal_type,
            ingredients: m.ingredients,
          })),
          profile: contextProfile ? {
            age: contextProfile.age,
            sex: contextProfile.sex,
            height_cm: contextProfile.height_cm,
            current_weight_kg: contextProfile.current_weight_kg,
            activity_level: contextProfile.activity_level,
            training_frequency: contextProfile.training_frequency,
          } : {},
          macroGoals: aiMacroGoals ? {
            calorieTarget: dailyCalorieTarget,
            proteinGrams: aiMacroGoals.proteinGrams,
            carbsGrams: aiMacroGoals.carbsGrams,
            fatsGrams: aiMacroGoals.fatsGrams,
          } : {},
          date: selectedDate,
        });
      } catch (error: any) {
        if (await handlePaywallError(error)) { failTask(taskId, "Pro required"); return; }
        throw new Error(error?.message || "Could not analyse your diet");
      }

      if (dietController.signal.aborted) return;

      const result = data.analysisData as DietAnalysisResult;
      setDietAnalysis(result);
      AIPersistence.save(userId, cacheKey, result, 6);
      completeTask(taskId, result);
      triggerHapticSuccess();
      // Analytics: a fresh diet-analysis artifact was generated (cached early
      // returns above never reach here, so this only fires on real generation).
      track(EVENTS.PLAN_GENERATED, { type: "diet_analysis" });
    } catch (error: any) {
      if (error?.name === 'AbortError' || dietController.signal.aborted) return;
      logger.error("Error analysing diet", error);
      failTask(taskId, error instanceof Error ? error.message : "Could not analyse your diet");
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Could not analyse your diet",
        variant: "destructive",
      });
    } finally {
      setDietAnalysisLoading(false);
    }
  }, [userId, meals, selectedDate, dailyCalorieTarget, aiMacroGoals, setDietAnalysis, setDietAnalysisLoading, aiAbortRef, contextProfile, toast, hasAiAccess, openPaywall, handlePaywallError, addTask, completeTask, failTask, analyseDietAction]);

  return { handleAnalyseDiet };
}
