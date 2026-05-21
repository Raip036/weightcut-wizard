import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Crown } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { nutritionLogSchema } from "@/lib/validation";
import { useUser } from "@/contexts/UserContext";
import { logger } from "@/lib/logger";
import { useAITask } from "@/contexts/AITaskContext";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

import type { Meal, ManualMealForm } from "@/pages/nutrition/types";
import {
  useNutritionState,
  useNutritionData,
  useMealOperations,
  useAIMealAnalysis,
  useMealPlanGeneration,
  useDietAnalysis,
  useNutritionWisdom,
  useMacroCalculation,
  useQuickMealActions,
} from "@/hooks/nutrition";
import { useSaveNutritionTargets } from "@/hooks/nutrition/useSaveNutritionTargets";
import { useNutritionPageEffects } from "@/hooks/nutrition/useNutritionPageEffects";

import { NutritionHero } from "./NutritionHero";
import { MealSections } from "./MealSections";
import { MealIdeasSection } from "./MealIdeasSection";
import { TrainingWisdomSheet } from "./TrainingWisdomSheet";
import { EmptyMealsBanner } from "./EmptyMealsBanner";
import { AiTaskBanner } from "./AiTaskBanner";
import { QuickAddDialog } from "./dialogs/QuickAddDialog";
import { AiMealPlanDialog } from "./dialogs/AiMealPlanDialog";
import { EditTargetsDialog } from "./dialogs/EditTargetsDialog";
import { ManualNutritionDialog } from "./dialogs/ManualNutritionDialog";
import { FavoritesSheet } from "./dialogs/FavoritesSheet";

const FoodSearchDialog = lazy(() => import("@/components/nutrition/FoodSearchDialog").then((m) => ({ default: m.FoodSearchDialog })));
const DietAnalysisCard = lazy(() => import("@/components/nutrition/DietAnalysisCard").then((m) => ({ default: m.DietAnalysisCard })));

export default function NutritionPage() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { userId } = useUser();

  // ── Shared state ──
  const state = useNutritionState();
  const {
    meals, setMeals, mealPlanIdeas, setMealPlanIdeas,
    selectedDate, setSelectedDate,
    dailyCalorieTarget, setDailyCalorieTarget,
    aiMacroGoals, setAiMacroGoals,
    safetyStatus, setSafetyStatus, safetyMessage, setSafetyMessage,
    totalCalories, totalProtein, totalCarbs, totalFats,
  } = state;

  // ── UI state ──
  const [isQuickAddSheetOpen, setIsQuickAddSheetOpen] = useState(false);
  const [quickAddTab, setQuickAddTab] = useState<"ai" | "manual">("ai");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [expandedMealIdeas, setExpandedMealIdeas] = useState<Set<string>>(new Set());
  const [isEditTargetsDialogOpen, setIsEditTargetsDialogOpen] = useState(false);
  const [editingTargets, setEditingTargets] = useState({ calories: "", protein: "", carbs: "", fats: "" });
  const [showMealSuccess, setShowMealSuccess] = useState(false);
  const [isFoodSearchOpen, setIsFoodSearchOpen] = useState(false);
  const [foodSearchMealType, setFoodSearchMealType] = useState<string>("snack");
  const [manualMeal, setManualMeal] = useState<ManualMealForm>({
    meal_name: "", calories: "", protein_g: "", carbs_g: "", fats_g: "",
    meal_type: "breakfast", portion_size: "", recipe_notes: "", ingredients: [],
  });

  // ── Hooks ──
  const nutritionData = useNutritionData({
    selectedDate, meals, setMeals, mealPlanIdeas, setMealPlanIdeas,
    dailyCalorieTarget, setDailyCalorieTarget,
    aiMacroGoals, setAiMacroGoals, setSafetyStatus, setSafetyMessage,
  });
  const mealOps = useMealOperations({
    meals, setMeals, mealPlanIdeas, setMealPlanIdeas,
    selectedDate, loadMeals: nutritionData.loadMeals,
  });
  const aiMeal = useAIMealAnalysis({
    manualMeal, setManualMeal,
    saveMealToDb: mealOps.saveMealToDb,
    setIsQuickAddSheetOpen,
    setQuickAddTab,
  });
  const mealPlan = useMealPlanGeneration({
    selectedDate, dailyCalorieTarget, setDailyCalorieTarget,
    safetyStatus, setSafetyStatus, safetyMessage, setSafetyMessage,
    mealPlanIdeas, setMealPlanIdeas, aiAbortRef: aiMeal.aiAbortRef,
  });
  const dietAnalysisHook = useDietAnalysis({
    meals, selectedDate, dailyCalorieTarget, aiMacroGoals,
    dietAnalysis: nutritionData.dietAnalysis,
    setDietAnalysis: nutritionData.setDietAnalysis,
    dietAnalysisLoading: nutritionData.dietAnalysisLoading,
    setDietAnalysisLoading: nutritionData.setDietAnalysisLoading,
    aiAbortRef: aiMeal.aiAbortRef,
  });
  const wisdom = useNutritionWisdom({
    totalCalories, totalProtein, totalCarbs, totalFats,
    dailyCalorieTarget, aiMacroGoals, mealsLength: meals.length,
  });
  const quickActions = useQuickMealActions({ meals, selectedDate, saveMealToDb: mealOps.saveMealToDb });
  const macroCalc = useMacroCalculation();
  // Surface a Pro badge alongside AI-feature CTAs for free users. Treated as a
  // single banner because every AI feature on this page gates to the same tier.
  const { hasAccess: hasNutritionAiAccess } = useFeatureAccess("AI_MEAL_ANALYSIS");

  const proBadge = !hasNutritionAiAccess ? (
    <span className="inline-flex items-center gap-0.5 text-primary/70">
      <Crown className="h-3 w-3" />
      <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
    </span>
  ) : null;

  // Variant tuned for solid primary-bg buttons (e.g. the Analyze CTA inside
  // QuickAddDialog) where `text-primary/70` would melt into the background.
  const proBadgeOnPrimary = !hasNutritionAiAccess ? (
    <span className="inline-flex items-center gap-0.5 text-primary-foreground/80">
      <Crown className="h-3 w-3" />
      <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
    </span>
  ) : null;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const loading = mealPlan.generatingPlan || mealOps.loggingMeal !== null || mealOps.savingAllMeals;

  const handleDeleteMeal = useCallback((meal: Meal) => { mealOps.initiateDeleteMeal(meal); }, [mealOps.initiateDeleteMeal]);

  // Effective macro goals: AI values when available, otherwise derive from calorie target
  const effectiveMacroGoals = useMemo(() => {
    if (aiMacroGoals) return aiMacroGoals;
    return {
      proteinGrams: Math.round((dailyCalorieTarget * 0.30) / 4),
      carbsGrams: Math.round((dailyCalorieTarget * 0.40) / 4),
      fatsGrams: Math.round((dailyCalorieTarget * 0.30) / 9),
      recommendedCalories: dailyCalorieTarget,
    };
  }, [aiMacroGoals, dailyCalorieTarget]);

  // Meals come pre-sorted by `_creationTime asc` from `meals.listWithTotals`,
  // so the flat array is already chronological. No client-side grouping.
  // Per-meal type still ships down as a small chip on `MealCard`.

  // Time-of-day → default meal_type. Used when the log button is tapped from
  // the chronological list (no section context exists post-refactor).
  const inferDefaultMealType = (): "breakfast" | "lunch" | "dinner" | "snack" => {
    const h = new Date().getHours();
    return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
  };

  const { tasks, dismissTask } = useAITask();

  useNutritionPageEffects({
    userId,
    isQuickAddSheetOpen,
    quickAddTab,
    searchParams,
    setSearchParams,
    setIsQuickAddSheetOpen,
    setQuickAddTab,
    manualMeal,
    setManualMeal,
    tasks,
    dismissTask,
    setDietAnalysis: nutritionData.setDietAnalysis,
  });

  // QuickLog → Food deep-link.
  //
  // The photo is captured in BottomNav's click handler (where the iOS
  // user-gesture token is alive) and arrives here via `location.state`.
  // All we do is open the QuickAdd sheet on the AI tab, seed the captured
  // base64 into `useAIMealAnalysis`, and kick off the analyze step — which
  // is a Convex action call, not a camera call, so it doesn't need a
  // gesture token. The state is cleared via `navigate(..., { state: {} })`
  // so a refresh / back-nav doesn't accidentally replay the analyze.
  const aiPhotoStateHandledRef = useRef(false);
  const setPhotoBase64 = aiMeal.setPhotoBase64;
  const handlePhotoAnalyze = aiMeal.handlePhotoAnalyze;
  useEffect(() => {
    const st = (location.state ?? null) as
      | { aiPhoto?: string | null; captureFailed?: string | null }
      | null;
    if (!st || (!("aiPhoto" in st) && !("captureFailed" in st))) {
      // No relevant state — re-arm so the NEXT QuickLog → Food tap (same
      // session, same page) can run the flow again. Without this reset the
      // ref stays `true` forever and the second tap silently no-ops.
      aiPhotoStateHandledRef.current = false;
      return;
    }
    if (aiPhotoStateHandledRef.current) return;
    aiPhotoStateHandledRef.current = true;

    // Always open the AI tab — even on cancel/deny the user lands on the
    // dialog they expected, with "Snap photo" available to retry.
    setQuickAddTab("ai");
    setIsQuickAddSheetOpen(true);

    if (st.aiPhoto) {
      setPhotoBase64(st.aiPhoto);
      // Defer analyze one microtask so the dialog has mounted; analyze is
      // a network call (no gesture token needed) so this is safe.
      queueMicrotask(() => {
        void handlePhotoAnalyze(st.aiPhoto!);
      });
    } else if (st.captureFailed === "denied") {
      toast({
        title: "Camera access denied",
        description: "Enable Camera in Settings → FightCamp Wizard to log meals with a photo.",
        variant: "destructive",
      });
    }
    // Clear state so it can't replay on refresh / back navigation.
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, setPhotoBase64, handlePhotoAnalyze, toast]);

  const handleAddManualMeal = async () => {
    const validationResult = nutritionLogSchema.safeParse({
      meal_name: manualMeal.meal_name,
      calories: parseInt(manualMeal.calories),
      protein_g: manualMeal.protein_g ? parseFloat(manualMeal.protein_g) : null,
      carbs_g: manualMeal.carbs_g ? parseFloat(manualMeal.carbs_g) : null,
      fats_g: manualMeal.fats_g ? parseFloat(manualMeal.fats_g) : null,
      meal_type: manualMeal.meal_type,
      portion_size: manualMeal.portion_size || null,
      recipe_notes: manualMeal.recipe_notes || null,
    });

    if (!validationResult.success) {
      toast({ title: "Validation Error", description: validationResult.error.errors[0].message, variant: "destructive" });
      return;
    }

    try {
      await mealOps.saveMealToDb({
        meal_name: manualMeal.meal_name,
        calories: parseInt(manualMeal.calories),
        protein_g: manualMeal.protein_g ? parseFloat(manualMeal.protein_g) : null,
        carbs_g: manualMeal.carbs_g ? parseFloat(manualMeal.carbs_g) : null,
        fats_g: manualMeal.fats_g ? parseFloat(manualMeal.fats_g) : null,
        meal_type: manualMeal.meal_type,
        portion_size: manualMeal.portion_size || null,
        recipe_notes: manualMeal.recipe_notes || null,
        ingredients: manualMeal.ingredients.length > 0 ? manualMeal.ingredients : null,
        is_ai_generated: false,
      });

      setIsQuickAddSheetOpen(false);
      setShowMealSuccess(true);
      setTimeout(() => setShowMealSuccess(false), 1500);
      setManualMeal({
        meal_name: "", calories: "", protein_g: "", carbs_g: "", fats_g: "",
        meal_type: "breakfast", portion_size: "", recipe_notes: "", ingredients: [],
      });
      aiMeal.setAiMealDescription("");
      aiMeal.setNewIngredient({ name: "", grams: "" });
      aiMeal.setBarcodeBaseMacros(null);
      aiMeal.setServingMultiplier(1);
    } catch (error) {
      logger.error("Error in optimistic meal update setup", error);
      toast({ title: "Error", description: "Failed to add meal", variant: "destructive" });
    }
  };

  const cancelAI = () => {
    aiMeal.cancelAI();
    mealPlan.setGeneratingPlan(false);
    nutritionData.setDietAnalysisLoading(false);
  };

  const openFoodSearch = useCallback(() => {
    setFoodSearchMealType(inferDefaultMealType());
    setIsFoodSearchOpen(true);
  }, []);

  const openQuickAdd = useCallback(() => {
    setManualMeal((prev) => ({ ...prev, meal_type: inferDefaultMealType() }));
    setQuickAddTab("ai");
    setIsQuickAddSheetOpen(true);
  }, []);

  const openManualAdd = useCallback(() => {
    setManualMeal((prev) => ({
      ...prev, meal_type: inferDefaultMealType(), meal_name: "", calories: "",
      protein_g: "", carbs_g: "", fats_g: "", portion_size: "", recipe_notes: "", ingredients: [],
    }));
    aiMeal.setAiMealDescription("");
    aiMeal.setAiLineItems([]);
    aiMeal.setAiAnalysisComplete(false);
    setQuickAddTab("manual");
    setIsQuickAddSheetOpen(true);
  }, [aiMeal.setAiMealDescription, aiMeal.setAiLineItems, aiMeal.setAiAnalysisComplete]);

  const handleEditTargets = useCallback(() => {
    setEditingTargets({
      calories: dailyCalorieTarget.toString(),
      protein: effectiveMacroGoals.proteinGrams.toString(),
      carbs: effectiveMacroGoals.carbsGrams.toString(),
      fats: effectiveMacroGoals.fatsGrams.toString(),
    });
    setIsEditTargetsDialogOpen(true);
  }, [dailyCalorieTarget, effectiveMacroGoals]);

  const handleDietAnalysisDismiss = useCallback(() => {
    nutritionData.setDietAnalysis(null);
    if (userId) import("@/lib/aiPersistence").then(({ AIPersistence }) => AIPersistence.remove(userId, `diet_analysis_${selectedDate}`));
  }, [userId, selectedDate, nutritionData.setDietAnalysis]);

  const handleFoodSearchSelected = useCallback((food: any) => {
    // Prefer the meal_type the user picked inside the dialog; fall back to
    // the time-of-day default the page seeded on open.
    const effectiveMealType = (typeof food?.meal_type === "string" && food.meal_type) || foodSearchMealType;
    mealOps.handleFoodSearchSelected(food, effectiveMealType);
  }, [mealOps.handleFoodSearchSelected, foodSearchMealType]);

  const handleSheetOpenChange = useCallback((open: boolean) => {
    setIsQuickAddSheetOpen(open);
    if (!open) {
      aiMeal.setIngredientLookupError(null);
      aiMeal.setBarcodeBaseMacros(null);
      aiMeal.setServingMultiplier(1);
      aiMeal.setAiLineItems([]);
      aiMeal.setAiAnalysisComplete(false);
    }
  }, [aiMeal.setIngredientLookupError, aiMeal.setBarcodeBaseMacros, aiMeal.setServingMultiplier, aiMeal.setAiLineItems, aiMeal.setAiAnalysisComplete]);

  const saveTargets = useSaveNutritionTargets({
    setDailyCalorieTarget,
    setAiMacroGoals,
    setIsEditTargetsDialogOpen,
  });
  const handleSaveTargets = () => saveTargets(editingTargets);

  const aiTask = tasks.find((t) => t.status === "running" && ["meal-analysis", "ingredient-lookup", "meal-plan", "diet-analysis"].includes(t.type));

  const toggleFavoritesCollapsed = useCallback(() => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has("favorites")) next.delete("favorites");
      else next.add("favorites");
      return next;
    });
  }, []);

  return (
    <>
      <AiTaskBanner
        aiTask={aiTask}
        photoAnalyzing={aiMeal.photoAnalyzing}
        photoBase64={aiMeal.photoBase64}
        onCancel={cancelAI}
        onDismiss={dismissTask}
        suppressMealAnalysis={isQuickAddSheetOpen}
      />
      <div className="animate-page-in space-y-2.5 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto overflow-x-hidden">
        <header className="pt-1">
          <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
          <h1 className="text-title font-semibold leading-tight">Nutrition</h1>
        </header>
        <NutritionHero
          wisdom={wisdom}
          totalCalories={totalCalories}
          totalProtein={totalProtein}
          totalCarbs={totalCarbs}
          totalFats={totalFats}
          dailyCalorieTarget={dailyCalorieTarget}
          effectiveMacroGoals={effectiveMacroGoals}
          onEditTargets={handleEditTargets}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          mealsLoading={nutritionData.mealsLoading}
          mealsVisibleCount={meals.length}
        />

        {/* EmptyMealsBanner suppressed — the new MealSections renders
            its own wizard-led empty state with quick chips. */}

        {showMealSuccess && (
          <div className="flex items-center justify-center gap-1.5 text-success animate-[fadeSlideUp_0.3s_ease-out_both]">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Meal added</span>
          </div>
        )}

        <MealSections
          mealsLoading={nutritionData.mealsLoading}
          meals={meals}
          quickActions={quickActions}
          aiMealHandlers={{ handleBarcodeScanned: aiMeal.handleBarcodeScanned }}
          generatingPlan={mealPlan.generatingPlan}
          savingAllMeals={mealOps.savingAllMeals}
          onDeleteMeal={handleDeleteMeal}
          onOpenFoodSearch={openFoodSearch}
          onOpenQuickAdd={openQuickAdd}
          onOpenManualAdd={openManualAdd}
          onOpenFavorites={
            quickActions.favorites && quickActions.favorites.length > 0
              ? () => toggleFavoritesCollapsed("favorites")
              : undefined
          }
        />

        <FavoritesSheet
          favorites={quickActions.favorites}
          collapsed={collapsedSections.has("favorites")}
          onToggle={toggleFavoritesCollapsed}
          onLogFavorite={quickActions.logFavorite}
        />

        {/* Diet Analysis Section — extra top margin so it visually
            separates from the chronological meal list above. */}
        <div data-tutorial="analyse-diet" className="mt-6">
          {nutritionData.dietAnalysis ? (
            <Suspense fallback={null}>
              <DietAnalysisCard
                analysis={nutritionData.dietAnalysis}
                onDismiss={handleDietAnalysisDismiss}
                onRefresh={() => dietAnalysisHook.handleAnalyseDiet(true)}
                refreshing={nutritionData.dietAnalysisLoading}
              />
            </Suspense>
          ) : meals.length > 0 && (
            <button
              onClick={() => dietAnalysisHook.handleAnalyseDiet()}
              disabled={nutritionData.dietAnalysisLoading}
              className="relative card-surface w-full p-3.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform rounded-xs"
            >
              <span className="text-sm font-medium text-foreground">Analyse Diet</span>
              {proBadge && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {proBadge}
                </span>
              )}
            </button>
          )}
        </div>

        <MealIdeasSection
          mealPlanIdeas={mealPlanIdeas}
          setIsAiDialogOpen={mealPlan.setIsAiDialogOpen}
          generatingPlan={mealPlan.generatingPlan}
          savingAllMeals={mealOps.savingAllMeals}
          loggingMealId={mealOps.loggingMeal}
          expandedMealIdeas={expandedMealIdeas}
          setExpandedMealIdeas={setExpandedMealIdeas}
          onSaveAll={mealOps.saveMealIdeasToDatabase}
          onClear={mealOps.clearMealIdeas}
          onLogIdea={mealOps.handleLogMealIdea}
        />

        <Suspense fallback={null}>
          <FoodSearchDialog
            open={isFoodSearchOpen}
            onOpenChange={setIsFoodSearchOpen}
            onFoodSelected={handleFoodSearchSelected}
            mealType={foodSearchMealType}
          />
        </Suspense>

        <QuickAddDialog
          open={isQuickAddSheetOpen}
          onOpenChange={handleSheetOpenChange}
          quickAddTab={quickAddTab}
          setQuickAddTab={setQuickAddTab}
          manualMeal={manualMeal}
          setManualMeal={setManualMeal}
          aiMeal={aiMeal}
          macroCalc={macroCalc}
          savingAllMeals={mealOps.savingAllMeals}
          onAddManualMeal={handleAddManualMeal}
          aiTask={aiTask ?? null}
          onCancelAi={cancelAI}
          onDismissTask={dismissTask}
          onToast={toast}
          gemBadge={proBadgeOnPrimary}
        />

        <AiMealPlanDialog
          open={mealPlan.isAiDialogOpen}
          onOpenChange={(open) => mealPlan.setIsAiDialogOpen(open)}
          selectedDate={selectedDate}
          aiPrompt={mealPlan.aiPrompt}
          setAiPrompt={mealPlan.setAiPrompt}
          generatingPlan={mealPlan.generatingPlan}
          onGenerate={mealPlan.handleGenerateMealPlan}
          gemBadge={proBadge}
        />

        <ManualNutritionDialog
          state={aiMeal.manualNutritionDialog}
          setState={aiMeal.setManualNutritionDialog}
          macroCalc={macroCalc}
          onSubmit={aiMeal.handleManualNutritionSubmit}
          onClose={() => aiMeal.setIngredientLookupError(null)}
        />

        <EditTargetsDialog
          open={isEditTargetsDialogOpen}
          onOpenChange={setIsEditTargetsDialogOpen}
          editingTargets={editingTargets}
          setEditingTargets={setEditingTargets}
          macroCalc={macroCalc}
          onSave={handleSaveTargets}
        />

        <DeleteConfirmDialog
          open={mealOps.deleteDialogOpen}
          onOpenChange={mealOps.setDeleteDialogOpen}
          onConfirm={mealOps.handleDeleteMeal}
          title="Delete Meal Entry"
          itemName={mealOps.mealToDelete ? `${mealOps.mealToDelete.meal_name} (${mealOps.mealToDelete.calories} cal)` : undefined}
        />
      </div>

      <TrainingWisdomSheet
        open={wisdom.trainingWisdomSheetOpen}
        onOpenChange={wisdom.setTrainingWisdomSheetOpen}
        loading={wisdom.trainingWisdomLoading}
        wisdom={wisdom.trainingWisdom}
        preference={wisdom.trainingPreference}
        setPreference={wisdom.setTrainingPreference}
        onGenerate={wisdom.generateTrainingFoodIdeas}
      />

    </>
  );
}
