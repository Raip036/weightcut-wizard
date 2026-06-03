import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Sparkles, ChevronRight } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { nutritionLogSchema } from "@/lib/validation";
import { useUser } from "@/contexts/UserContext";
import { logger } from "@/lib/logger";
import { useAITask } from "@/contexts/AITaskContext";

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
const WizardDietScrollOverlay = lazy(() => import("@/components/nutrition/WizardDietScrollOverlay").then((m) => ({ default: m.WizardDietScrollOverlay })));

export default function NutritionPage() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { userId } = useUser();
  const { checkFeatureAccess } = useSubscription();

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
  const [pendingCaptionFromDial, setPendingCaptionFromDial] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [expandedMealIdeas, setExpandedMealIdeas] = useState<Set<string>>(new Set());
  const [isEditTargetsDialogOpen, setIsEditTargetsDialogOpen] = useState(false);
  const [editingTargets, setEditingTargets] = useState({ calories: "", protein: "", carbs: "", fats: "" });
  const [showMealSuccess, setShowMealSuccess] = useState(false);
  const [isFoodSearchOpen, setIsFoodSearchOpen] = useState(false);
  const [foodSearchMealType, setFoodSearchMealType] = useState<string>("snack");
  // Seeds the food-search input when a user taps "+ Add" on a diet-analysis
  // suggestion, so the suggested food is searched immediately.
  const [foodSearchInitialQuery, setFoodSearchInitialQuery] = useState<string | undefined>(undefined);
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
  // Pro-gating is now driven by the shared <ProGate> wrapper, which renders
  // its own glass-blur + lock-chip overlay for free users. The page no
  // longer needs to mint per-callsite badge JSX.

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
  // We seed the captured base64 into `useAIMealAnalysis` and open the
  // QuickAdd sheet on the AI tab, parked on the caption step so the user
  // can add an optional description before analysis fires. The dialog
  // handles the post-caption analyze internally once the user taps
  // Continue. State is cleared via `navigate(..., { state: null })` so a
  // refresh / back-nav can't replay the flow.
  const aiPhotoStateHandledRef = useRef(false);
  const setPhotoBase64 = aiMeal.setPhotoBase64;
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

    if (st.aiPhoto) {
      setPhotoBase64(st.aiPhoto);
      // Flag the dialog to land on the caption step on its open transition.
      // MUST be set BEFORE opening the sheet so React batches both updates
      // and the dialog mounts with the prop already `true` — otherwise the
      // dialog's open-transition effect sees `false` and skips caption mode.
      setPendingCaptionFromDial(true);
      setIsQuickAddSheetOpen(true);
    } else {
      setIsQuickAddSheetOpen(true);
      if (st.captureFailed === "denied") {
        toast({
          title: "Camera access denied",
          description: "Enable Camera in Settings → FightCamp Wizard to log meals with a photo.",
          variant: "destructive",
        });
      }
    }
    // Clear state so it can't replay on refresh / back navigation.
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, setPhotoBase64, toast]);

  // Reset the caption-from-dial flag whenever the sheet closes, so the next
  // dial-Nutrition open starts from a clean slate.
  useEffect(() => {
    if (!isQuickAddSheetOpen && pendingCaptionFromDial) {
      setPendingCaptionFromDial(false);
    }
  }, [isQuickAddSheetOpen, pendingCaptionFromDial]);

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
    setFoodSearchInitialQuery(undefined);
    setFoodSearchMealType(inferDefaultMealType());
    setIsFoodSearchOpen(true);
  }, []);

  // "+ Add" from a diet-analysis suggestion → open food search prefilled.
  const handleAddSuggestedFood = useCallback((food: string) => {
    setFoodSearchInitialQuery(food);
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

  // Barcode scan → log the food STRAIGHT AWAY (no detour through the manual
  // Add-a-meal sheet). The scanner already lets the user confirm/adjust the
  // portion + macros before pressing "Log food", so we commit immediately via
  // the same direct-insert path the food search uses. Meal type defaults to
  // time-of-day since the scanner is a global action, not section-scoped.
  const handleBarcodeLogged = useCallback((food: {
    meal_name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fats_g: number;
    serving_size: string;
  }) => {
    const hour = new Date().getHours();
    const mealType = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
    const grams = parseInt(food.serving_size, 10);
    mealOps.handleFoodSearchSelected(
      {
        meal_name: food.meal_name,
        calories: food.calories,
        protein_g: food.protein_g,
        carbs_g: food.carbs_g,
        fats_g: food.fats_g,
        serving_size: food.serving_size,
        portion_size: food.serving_size,
        food_id: null,
        grams: Number.isFinite(grams) ? grams : null,
      },
      mealType,
    );
  }, [mealOps.handleFoodSearchSelected]);

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

        {/* Extra top padding so the Today's tip card breathes above the
            Snap / Search / Barcode action row. */}
        <div className="pt-3">
          <MealSections
            mealsLoading={nutritionData.mealsLoading}
            meals={meals}
            quickActions={quickActions}
            aiMealHandlers={{ handleBarcodeScanned: handleBarcodeLogged }}
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
        </div>

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
                onAddFood={handleAddSuggestedFood}
              />
            </Suspense>
          ) : nutritionData.dietAnalysisLoading ? (
            // First-run analysis: the wizard pores over a glowing recipe
            // scroll right here in the card slot, then becomes the result.
            <Suspense fallback={null}>
              <WizardDietScrollOverlay
                onCancel={() => {
                  cancelAI();
                  if (aiTask) dismissTask(aiTask.id);
                }}
              />
            </Suspense>
          ) : meals.length > 0 && checkFeatureAccess("AI_DIET_ANALYSIS") ? (
            <button
              onClick={() => dietAnalysisHook.handleAnalyseDiet()}
              disabled={nutritionData.dietAnalysisLoading}
              className="card-surface w-full p-4 flex items-center gap-3 active:scale-[0.98] transition-transform rounded-2xl text-left"
            >
              <span className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold text-foreground">Analyse my day</span>
                <span className="block text-[12px] text-muted-foreground/80 leading-snug">
                  Your protein g/kg and micronutrient gaps for today
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            </button>
          ) : null}
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
            onOpenChange={(open) => {
              setIsFoodSearchOpen(open);
              if (!open) setFoodSearchInitialQuery(undefined);
            }}
            onFoodSelected={handleFoodSearchSelected}
            mealType={foodSearchMealType}
            initialQuery={foodSearchInitialQuery}
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
          savingMeal={mealOps.savingMeal}
          onAddManualMeal={handleAddManualMeal}
          aiTask={aiTask ?? null}
          onCancelAi={cancelAI}
          onDismissTask={dismissTask}
          onToast={toast}
          initialPendingCaption={pendingCaptionFromDial}
        />

        <AiMealPlanDialog
          open={mealPlan.isAiDialogOpen}
          onOpenChange={(open) => mealPlan.setIsAiDialogOpen(open)}
          selectedDate={selectedDate}
          aiPrompt={mealPlan.aiPrompt}
          setAiPrompt={mealPlan.setAiPrompt}
          generatingPlan={mealPlan.generatingPlan}
          onGenerate={mealPlan.handleGenerateMealPlan}
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
