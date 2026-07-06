import { useState, useRef, useCallback, useEffect } from "react";
import { useAction, useMutation } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAITask } from "@/contexts/AITaskContext";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { AIPersistence } from "@/lib/aiPersistence";
import { createAIAbortController } from "@/lib/timeoutWrapper";
import { logger } from "@/lib/logger";
import { lookupUSDA } from "@/lib/usdaLookup";
import { coerceHealthInputs, scoreFood, scoreMeal } from "@/lib/foodHealthScore";
import { track, EVENTS } from "@/lib/analytics";
import { Capacitor } from "@capacitor/core";
import { Search, Database, CheckCircle, PieChart, Camera } from "lucide-react";
import type { AiLineItem, Ingredient, ManualMealForm, ManualNutritionDialogState, BarcodeBaseMacros, INITIAL_MANUAL_MEAL, INITIAL_MANUAL_NUTRITION_DIALOG } from "@/pages/nutrition/types";

// Validate + clamp a bounding box from the vision model. Returns undefined
// when the value is missing or out of range, which lets the UI fall back
// to scattered positions instead of anchoring labels to nonsense coords.
function normalizeBbox(raw: unknown): AiLineItem["bbox"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  const nums = [r.x, r.y, r.w, r.h].map((v) => (typeof v === "number" ? v : Number(v)));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  const [x, y, w, h] = nums;
  if (w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) return undefined;
  return { x, y, w, h };
}

interface UseAIMealAnalysisParams {
  manualMeal: ManualMealForm;
  setManualMeal: React.Dispatch<React.SetStateAction<ManualMealForm>>;
  saveMealToDb: (mealData: any) => Promise<unknown>;
  setIsQuickAddSheetOpen: (open: boolean) => void;
  setQuickAddTab: (tab: "ai" | "manual") => void;
}

export function useAIMealAnalysis(params: UseAIMealAnalysisParams) {
  const { manualMeal, setManualMeal, saveMealToDb, setIsQuickAddSheetOpen, setQuickAddTab } = params;
  const { userId } = useUser();
  const { toast } = useToast();
  const { isMounted } = useSafeAsync();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasMealAccess } = useFeatureAccess("AI_MEAL_ANALYSIS");
  const { hasAccess: hasIngredientAccess } = useFeatureAccess("AI_LOOKUP_INGREDIENT");
  const { addTask, completeTask, failTask } = useAITask();
  const analyzeMealAction = useAIAction(api.actions.analyzeMeal.run, "AI_MEAL_ANALYSIS");
  const lookupIngredientAction = useAIAction(api.actions.lookupIngredient.run, "AI_LOOKUP_INGREDIENT");
  const generatePhotoUploadUrl = useMutation(api.meals.generatePhotoUploadUrl);
  const aiAbortRef = useRef<AbortController | null>(null);

  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiLineItems, setAiLineItems] = useState<AiLineItem[]>([]);
  const [aiAnalysisComplete, setAiAnalysisComplete] = useState(false);
  const [aiMealDescription, setAiMealDescription] = useState("");
  const [aiIngredientDescription, setAiIngredientDescription] = useState("");
  const [aiAnalyzingIngredient, setAiAnalyzingIngredient] = useState(false);
  const [barcodeBaseMacros, setBarcodeBaseMacros] = useState<BarcodeBaseMacros | null>(null);
  const [servingMultiplier, setServingMultiplier] = useState(1);

  // Ingredient lookup state
  const [newIngredient, setNewIngredient] = useState({ name: "", grams: "" });
  const [lookingUpIngredient, setLookingUpIngredient] = useState(false);
  const [ingredientLookupError, setIngredientLookupError] = useState<string | null>(null);
  const [manualNutritionDialog, setManualNutritionDialog] = useState<ManualNutritionDialogState>({
    open: false,
    ingredientName: "",
    grams: 0,
    calories_per_100g: "",
    protein_per_100g: "",
    carbs_per_100g: "",
    fats_per_100g: "",
  });

  // Photo capture state. `photoBase64` is the primary angle (drives the
  // dialog's mode machine); `extraPhotos` holds up to 2 optional extra
  // angles of the same meal for the multi-view accuracy boost.
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);

  // Extra angles only make sense alongside a primary photo — drop them
  // whenever the primary is cleared (retake / remove / sheet close).
  useEffect(() => {
    if (!photoBase64) setExtraPhotos([]);
  }, [photoBase64]);

  // Per-macro overrides applied on top of the AI-summed totals. Lets the
  // user say "actually it was more like 750 cal" after the photo analysis
  // without forcing them to edit every individual line item. Saved totals
  // use override ?? sum; line items stay at AI values for the breakdown.
  const [overrideTotals, setOverrideTotals] = useState<{
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fats_g?: number;
  }>({});

  // Drop stale overrides when the line-item list is fully cleared
  // (e.g., the dialog closed and reopened, or every item was removed).
  // Avoids "edited" badges hanging around with no meal underneath them.
  useEffect(() => {
    if (aiLineItems.length === 0) setOverrideTotals({});
  }, [aiLineItems.length]);

  // Low-level capture — returns the base64 body (no data: prefix) WITHOUT
  // mutating any photo state. Callers decide whether it becomes the primary
  // photo or an extra angle.
  const captureRawPhoto = useCallback(async (): Promise<string | null> => {
    try {
      if (Capacitor.isNativePlatform()) {
        const { Camera, CameraResultType, CameraSource, CameraDirection } = await import("@capacitor/camera");

        // Check and request permission
        const perms = await Camera.checkPermissions();
        if (perms.camera !== "granted") {
          const requested = await Camera.requestPermissions({ permissions: ["camera"] });
          if (requested.camera === "denied") {
            toast({ title: "Camera access denied", description: "Go to Settings > FightCamp Wizard > Camera to enable.", variant: "destructive" });
            return null;
          }
        }

        const photo = await Camera.getPhoto({
          quality: 70,
          allowEditing: false,
          resultType: CameraResultType.Base64,
          source: CameraSource.Camera,
          direction: CameraDirection.Rear,
          width: 1024,
          height: 1024,
          promptLabelHeader: "Snap your meal",
          promptLabelPhoto: "Take Photo",
        });
        return photo.base64String ?? null;
      } else {
        // Web fallback: file input
        return new Promise<string | null>((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          // `environment` = rear camera on mobile browsers (better for food
          // shots). Desktop browsers ignore this and show the file picker.
          input.capture = "environment";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(",")[1];
              resolve(base64 ?? null);
            };
            reader.readAsDataURL(file);
          };
          input.click();
        });
      }
    } catch (err: any) {
      // User cancelled the camera — not an error
      const msg = err?.message?.toLowerCase() || "";
      if (msg.includes("cancel") || msg.includes("dismissed") || msg.includes("user denied")) return null;
      logger.warn("Photo capture failed", err);
    }
    return null;
  }, [toast]);

  // Capture the primary photo (used by the snap hero / retake).
  const capturePhoto = useCallback(async (): Promise<string | null> => {
    const b64 = await captureRawPhoto();
    if (b64) setPhotoBase64(b64);
    return b64;
  }, [captureRawPhoto]);

  // Capture an additional angle of the same meal (max 2 extras = 3 total).
  // Returns the captured base64 so callers can chain a re-analysis.
  const addExtraPhoto = useCallback(async (): Promise<string | null> => {
    const b64 = await captureRawPhoto();
    if (b64) setExtraPhotos((prev) => (prev.length >= 2 ? prev : [...prev, b64]));
    return b64;
  }, [captureRawPhoto]);

  const removeExtraPhoto = useCallback((idx: number) => {
    setExtraPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // `description` is an optional free-text caption from the user — the
  // QuickAddDialog caption step passes it through so the vision model can
  // use it as authoritative hints for portions, brand, or hidden ingredients
  // the camera can't see. Falls back to `aiMealDescription` state for older
  // callers that don't pass it explicitly. Empty/whitespace = no hint sent.
  const handlePhotoAnalyze = useCallback(async (base64?: string, description?: string) => {
    const imageData = base64 || photoBase64;
    if (!imageData) {
      toast({ title: "No photo", description: "Take a photo first", variant: "destructive" });
      return;
    }
    if (!hasMealAccess) { openPaywall("meal_scanner"); return; }

    const captionRaw = description ?? aiMealDescription;
    const caption = captionRaw?.trim() || undefined;

    aiAbortRef.current?.abort();
    const controller = createAIAbortController();
    aiAbortRef.current = controller;

    setPhotoAnalyzing(true);
    setAiAnalyzing(true);
    setAiAnalysisComplete(false);
    setAiLineItems([]);
    setOverrideTotals({});

    const taskId = addTask({
      id: `photo-meal-${Date.now()}`,
      type: "meal-analysis",
      label: "Analyzing Photo",
      steps: [
        { icon: Camera, label: "Processing image" },
        { icon: Search, label: "Identifying foods" },
        { icon: PieChart, label: "Estimating nutrition" },
        { icon: CheckCircle, label: "Building breakdown" },
      ],
      returnPath: "/nutrition",
    });

    try {
      let data: any;
      try {
        data = await analyzeMealAction({
          imagesBase64: [imageData, ...extraPhotos],
          mealDescription: caption,
          persist: false,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (await handlePaywallError(err)) { failTask(taskId, "Pro required"); return; }
        throw new Error(err?.message || "Photo analysis failed");
      }

      if (controller.signal.aborted) return;
      if (data?.error) throw new Error(data.error);

      const nutritionData = data.nutritionData;
      if (!nutritionData) throw new Error("No analysis returned");
      if (nutritionData.items && Array.isArray(nutritionData.items) && nutritionData.items.length > 0) {
        setAiLineItems(nutritionData.items.map((item: any) => {
          const calories = item.calories || 0;
          const protein_g = item.protein_g || 0;
          const carbs_g = item.carbs_g || 0;
          const fats_g = item.fats_g || 0;
          return {
            name: item.name || "Unknown",
            quantity: item.quantity || "",
            calories,
            protein_g,
            carbs_g,
            fats_g,
            bbox: normalizeBbox(item.bbox),
            confidence:
              item.confidence === "high" || item.confidence === "medium" || item.confidence === "low"
                ? item.confidence
                : undefined,
            base: { calories, protein_g, carbs_g, fats_g },
            health: coerceHealthInputs(item),
          };
        }));
      } else {
        const calories = nutritionData.calories || 0;
        const protein_g = nutritionData.protein_g || 0;
        const carbs_g = nutritionData.carbs_g || 0;
        const fats_g = nutritionData.fats_g || 0;
        setAiLineItems([{
          name: nutritionData.meal_name || "Meal",
          quantity: "",
          calories,
          protein_g,
          carbs_g,
          fats_g,
          base: { calories, protein_g, carbs_g, fats_g },
        }]);
      }

      // Auto-set meal name from AI
      setManualMeal(prev => ({ ...prev, meal_name: nutritionData.meal_name || prev.meal_name }));
      setAiAnalysisComplete(true);
      completeTask(taskId, nutritionData);
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) return;
      logger.error("Photo analysis failed", err);
      failTask(taskId, err.message || "Analysis failed");
      toast({ title: "Analysis failed", description: err.message || "Could not analyze photo", variant: "destructive" });
    } finally {
      setPhotoAnalyzing(false);
      setAiAnalyzing(false);
    }
  }, [photoBase64, extraPhotos, aiMealDescription, hasMealAccess, openPaywall, handlePaywallError, analyzeMealAction, toast, addTask, completeTask, failTask, setManualMeal]);

  const extractIngredientName = (userInput: string): string => {
    let cleaned = userInput.trim();
    cleaned = cleaned.replace(/(\d+(?:\.\d+)?)\s*(g|kg|oz|lb|cup|cups|tbsp|tsp|tablespoon|teaspoon|ml|l|gram|grams|kilogram|kilograms|ounce|ounces|pound|pounds)/gi, "");
    cleaned = cleaned.replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+|a|an)\s+/i, "");
    cleaned = cleaned.replace(/^(about|approximately|around|roughly)\s+/i, "");
    cleaned = cleaned.replace(/\s+/g, " ").trim();
    cleaned = cleaned.split(" ").map(word =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(" ");
    return cleaned || userInput;
  };

  const handleAiAnalyzeMeal = useCallback(async () => {
    if (!aiMealDescription.trim()) {
      toast({ title: "Missing description", description: "Please describe your meal", variant: "destructive" });
      return;
    }

    // Check cache first — no access check needed for cached results
    const mealCacheKey = `meal_${aiMealDescription.toLowerCase().trim().replace(/\s+/g, '_').slice(0, 60)}`;
    const cachedData = userId ? AIPersistence.load(userId, mealCacheKey) : null;

    // If no cache, check Pro access before showing any overlay
    if (!cachedData && !hasMealAccess) {
      openPaywall("meal_scanner");
      return;
    }

    aiAbortRef.current?.abort();
    const controller = createAIAbortController();
    aiAbortRef.current = controller;

    setAiAnalyzing(true);
    setAiAnalysisComplete(false);
    setOverrideTotals({});
    const taskId = addTask({
      id: `meal-analysis-${Date.now()}`,
      type: "meal-analysis",
      label: "Analyzing Meal",
      steps: [
        { icon: Search, label: "Identifying food items" },
        { icon: Database, label: "Retrieving macros" },
        { icon: CheckCircle, label: "Finalizing log" },
      ],
      returnPath: "/nutrition",
    });
    try {
      let nutritionData = cachedData;

      if (!nutritionData) {
        let data: any;
        try {
          data = await analyzeMealAction({
            mealDescription: aiMealDescription,
            persist: false,
          });
        } catch (error: any) {
          if (controller.signal.aborted) return;
          if (await handlePaywallError(error)) { failTask(taskId, "Pro required"); return; }
          throw new Error(error?.message || "Failed to analyze meal");
        }

        if (controller.signal.aborted) return;
        if (data?.error) throw new Error(data.error);
        nutritionData = data.nutritionData;
        if (userId && nutritionData) {
          AIPersistence.save(userId, mealCacheKey, nutritionData, 24 * 7);
        }
      }

      if (nutritionData.items && Array.isArray(nutritionData.items) && nutritionData.items.length > 0) {
        setAiLineItems(nutritionData.items.map((item: any) => ({
          name: item.name,
          quantity: item.quantity || "",
          calories: item.calories || 0,
          protein_g: item.protein_g || 0,
          carbs_g: item.carbs_g || 0,
          fats_g: item.fats_g || 0,
          health: coerceHealthInputs(item),
        })));
      } else {
        setAiLineItems([{
          name: nutritionData.meal_name,
          quantity: nutritionData.portion_size || "1 serving",
          calories: nutritionData.calories || 0,
          protein_g: nutritionData.protein_g || 0,
          carbs_g: nutritionData.carbs_g || 0,
          fats_g: nutritionData.fats_g || 0,
        }]);
      }

      setManualMeal(prev => ({ ...prev, meal_name: nutritionData.meal_name }));
      setAiAnalysisComplete(true);
      completeTask(taskId, nutritionData);
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) return;
      logger.error("Error analyzing meal", error);
      failTask(taskId, error.message || "Analysis failed");
      toast({ title: "Analysis failed", description: error.message || "Failed to analyze meal", variant: "destructive" });
    } finally {
      setAiAnalyzing(false);
    }
  }, [aiMealDescription, userId, setManualMeal, toast, hasMealAccess, openPaywall, handlePaywallError, analyzeMealAction, addTask, completeTask, failTask]);

  const handleSaveAiMeal = useCallback(async () => {
    if (aiLineItems.length === 0) return;

    // Whole-food meal grade, computed from the foods the AI classified, so the
    // saved meal carries a score for the daily food-quality average. Null when
    // no item was classified (older cached scans).
    const scoredItems = aiLineItems.filter((i) => i.health);
    const aiMealHealthScore = scoredItems.length
      ? scoreMeal(scoredItems.map((i) => ({ calories: i.calories, healthScore: scoreFood(i.health!) }))).score
      : null;

    // User-edited macro values take precedence over the AI-summed line
    // items. Line items still ship in the saved meal as the ingredient
    // breakdown — only the headline macros reflect the override.
    const totalCalories = overrideTotals.calories ?? aiLineItems.reduce((s, i) => s + i.calories, 0);
    const totalProtein = overrideTotals.protein_g ?? aiLineItems.reduce((s, i) => s + i.protein_g, 0);
    const totalCarbs = overrideTotals.carbs_g ?? aiLineItems.reduce((s, i) => s + i.carbs_g, 0);
    const totalFats = overrideTotals.fats_g ?? aiLineItems.reduce((s, i) => s + i.fats_g, 0);

    const itemBreakdown = aiLineItems
      .map(i => `${i.quantity} ${i.name} (${i.calories} cal)`)
      .join(", ");

    const ingredients: Ingredient[] = aiLineItems.map(item => ({
      name: item.name,
      grams: 0,
      calories: Math.round(item.calories),
      protein_g: Math.round(item.protein_g * 10) / 10,
      carbs_g: Math.round(item.carbs_g * 10) / 10,
      fats_g: Math.round(item.fats_g * 10) / 10,
      quantity: item.quantity,
    }));

    // Upload the AI-scanned photo to Convex Storage so the meal card can
    // render the actual photo where the macro donut normally sits. Failure
    // is non-blocking — the meal still saves, the photo just won't appear.
    let photoStorageId: string | null = null;
    let photoPreviewUrl: string | null = null;
    if (photoBase64) {
      try {
        photoPreviewUrl = `data:image/jpeg;base64,${photoBase64}`;
        const uploadUrl = await generatePhotoUploadUrl();
        const binary = atob(photoBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const resp = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (resp.ok) {
          const { storageId } = await resp.json();
          if (typeof storageId === "string") photoStorageId = storageId;
        } else {
          logger.warn("Meal photo upload returned non-OK", { status: resp.status });
        }
      } catch (e) {
        logger.warn("Meal photo upload failed (continuing without photo)", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    try {
      const savedId = await saveMealToDb({
        meal_name: manualMeal.meal_name || aiMealDescription,
        calories: Math.round(totalCalories),
        protein_g: Math.round(totalProtein * 10) / 10,
        carbs_g: Math.round(totalCarbs * 10) / 10,
        fats_g: Math.round(totalFats * 10) / 10,
        meal_type: manualMeal.meal_type,
        portion_size: null,
        recipe_notes: itemBreakdown,
        ingredients: ingredients,
        is_ai_generated: true,
        photo_storage_id: photoStorageId,
        photo_preview_url: photoPreviewUrl,
        health_score: aiMealHealthScore,
      });

      // Analytics: fire once per successful AI-assisted log, BEFORE the photo
      // state is cleared below. A photo present means the analyze-meal photo
      // flow; otherwise it was an AI text-description analysis.
      if (savedId) {
        track(EVENTS.MEAL_LOGGED, { method: photoBase64 ? "photo" : "manual" });
      }

      setIsQuickAddSheetOpen(false);
      setAiLineItems([]);
      setAiAnalysisComplete(false);
      setAiMealDescription("");
      setPhotoBase64(null);
      setOverrideTotals({});
      setManualMeal(prev => ({ ...prev, meal_name: "" }));
    } catch (error) {
      logger.error("Error saving AI meal", error);
      toast({ title: "Error", description: "Failed to add meal", variant: "destructive" });
    }
  }, [aiLineItems, overrideTotals, manualMeal, aiMealDescription, photoBase64, generatePhotoUploadUrl, saveMealToDb, setIsQuickAddSheetOpen, setManualMeal, toast]);

  const handleAiAnalyzeIngredient = useCallback(async () => {
    if (!aiIngredientDescription.trim()) {
      toast({ title: "Input Required", description: "Please describe the ingredient", variant: "destructive" });
      return;
    }

    if (!hasMealAccess) {
      openPaywall("meal_scanner");
      return;
    }

    aiAbortRef.current?.abort();
    const ingController = createAIAbortController();
    aiAbortRef.current = ingController;

    setAiAnalyzingIngredient(true);
    const ingTaskId = addTask({
      id: `ingredient-lookup-${Date.now()}`,
      type: "ingredient-lookup",
      label: "Looking Up Ingredient",
      steps: [
        { icon: Search, label: "Searching ingredient" },
        { icon: PieChart, label: "Calculating macros" },
      ],
      returnPath: "/nutrition",
    });
    try {
      let data: any;
      try {
        data = await analyzeMealAction({
          mealDescription: aiIngredientDescription,
          persist: false,
        });
      } catch (error: any) {
        if (ingController.signal.aborted) return;
        if (await handlePaywallError(error)) { failTask(ingTaskId, "Pro required"); return; }
        throw new Error(error?.message || "Failed to analyze ingredient");
      }

      if (ingController.signal.aborted) return;
      if (data?.error) throw new Error(data.error);

      const { nutritionData } = data;

      let ingredientName = "";
      let ingredientGrams = 0;
      let ingredientSource = "";
      let caloriesPer100g = 0;
      let proteinPer100g = 0;
      let carbsPer100g = 0;
      let fatsPer100g = 0;

      if (nutritionData.ingredients && nutritionData.ingredients.length > 0) {
        const ingredient = nutritionData.ingredients[0];
        ingredientName = extractIngredientName(aiIngredientDescription);
        if (ingredientName.length < 3 || ingredientName.toLowerCase() === aiIngredientDescription.toLowerCase().trim()) {
          ingredientName = ingredient.name || nutritionData.meal_name;
        }
        ingredientGrams = ingredient.grams || 0;
        ingredientSource = ingredient.source || nutritionData.data_source || "AI Analysis";
      } else {
        ingredientName = extractIngredientName(aiIngredientDescription);
        if (ingredientName.length < 3) {
          ingredientName = nutritionData.meal_name;
        }
        ingredientSource = nutritionData.data_source || "AI Analysis";

        const portionSize = nutritionData.portion_size || "";
        const gramsMatch = portionSize.match(/(\d+(?:\.\d+)?)\s*g/i);
        if (gramsMatch) {
          ingredientGrams = parseFloat(gramsMatch[1]);
        } else {
          toast({ title: "Weight Required", description: "Could not determine ingredient weight. Please specify weight (e.g., '250g chicken breast')", variant: "destructive" });
          failTask(ingTaskId, "Weight required");
          setAiAnalyzingIngredient(false);
          return;
        }
      }

      if (ingredientGrams <= 0) {
        toast({ title: "Invalid Weight", description: "Could not determine ingredient weight. Please specify weight (e.g., '250g chicken breast')", variant: "destructive" });
        failTask(ingTaskId, "Invalid weight");
        setAiAnalyzingIngredient(false);
        return;
      }

      const mealCalories = nutritionData.calories || 0;
      const mealProtein = nutritionData.protein_g || 0;
      const mealCarbs = nutritionData.carbs_g || 0;
      const mealFats = nutritionData.fats_g || 0;

      caloriesPer100g = (mealCalories / ingredientGrams) * 100;
      proteinPer100g = (mealProtein / ingredientGrams) * 100;
      carbsPer100g = (mealCarbs / ingredientGrams) * 100;
      fatsPer100g = (mealFats / ingredientGrams) * 100;

      const newIngredients = [
        ...manualMeal.ingredients,
        {
          name: ingredientName,
          grams: ingredientGrams,
          calories_per_100g: Math.round(caloriesPer100g),
          protein_per_100g: Math.round(proteinPer100g * 10) / 10,
          carbs_per_100g: Math.round(carbsPer100g * 10) / 10,
          fats_per_100g: Math.round(fatsPer100g * 10) / 10,
          source: ingredientSource,
        }
      ];

      const tc = newIngredients.reduce((sum, ing) => sum + (ing.calories_per_100g || 0) * ing.grams / 100, 0);
      const tp = newIngredients.reduce((sum, ing) => sum + (ing.protein_per_100g || 0) * ing.grams / 100, 0);
      const tcarb = newIngredients.reduce((sum, ing) => sum + (ing.carbs_per_100g || 0) * ing.grams / 100, 0);
      const tf = newIngredients.reduce((sum, ing) => sum + (ing.fats_per_100g || 0) * ing.grams / 100, 0);

      setManualMeal({
        ...manualMeal,
        ingredients: newIngredients,
        calories: Math.round(tc).toString(),
        protein_g: Math.round(tp * 10) / 10 !== 0 ? (Math.round(tp * 10) / 10).toString() : "",
        carbs_g: Math.round(tcarb * 10) / 10 !== 0 ? (Math.round(tcarb * 10) / 10).toString() : "",
        fats_g: Math.round(tf * 10) / 10 !== 0 ? (Math.round(tf * 10) / 10).toString() : "",
      });

      setAiIngredientDescription("");
      completeTask(ingTaskId, nutritionData);
      toast({ title: "Ingredient Added", description: `${ingredientName} (${ingredientGrams}g) added. Meal totals updated.` });
    } catch (error: any) {
      if (error?.name === 'AbortError' || ingController.signal.aborted) return;
      logger.error("Error analyzing ingredient", error);
      failTask(ingTaskId, error.message || "Analysis failed");
      toast({ title: "Analysis failed", description: error.message || "Failed to analyze ingredient. Please try again or add manually.", variant: "destructive" });
    } finally {
      setAiAnalyzingIngredient(false);
    }
  }, [aiIngredientDescription, manualMeal, setManualMeal, toast]);

  const parseServingGrams = (servingSize: string): number => {
    const match = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    if (match) return parseFloat(match[1]);
    return 100;
  };

  const handleBarcodeScanned = useCallback(async (foodData: {
    meal_name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fats_g: number;
    serving_size: string;
  }) => {
    const servingWt = parseServingGrams(foodData.serving_size || "100g");
    setBarcodeBaseMacros({
      calories: foodData.calories,
      protein_g: foodData.protein_g,
      carbs_g: foodData.carbs_g,
      fats_g: foodData.fats_g,
      serving_size: foodData.serving_size || "1 serving",
      serving_weight_g: servingWt,
    });
    setServingMultiplier(1);
    setManualMeal(prev => {
      // Preserve the section the user already pinned. Only fall back to a
      // time-of-day default when no meal_type has been set — never silently
      // drop to "snack".
      const hour = new Date().getHours();
      const fallbackType: "breakfast" | "lunch" | "dinner" | "snack" =
        hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
      return {
        ...prev,
        meal_name: foodData.meal_name,
        calories: foodData.calories.toString(),
        protein_g: foodData.protein_g.toString(),
        carbs_g: foodData.carbs_g.toString(),
        fats_g: foodData.fats_g.toString(),
        meal_type: prev.meal_type || fallbackType,
        portion_size: foodData.serving_size || "1 serving",
        recipe_notes: "",
        ingredients: [],
      };
    });
    setQuickAddTab("manual");
    setIsQuickAddSheetOpen(true);
  }, [setManualMeal, setQuickAddTab, setIsQuickAddSheetOpen]);

  const lookupIngredientNutrition = useCallback(async (ingredientName: string): Promise<{
    calories_per_100g: number;
    protein_per_100g: number;
    carbs_per_100g: number;
    fats_per_100g: number;
    source?: string;
  } | null> => {
    // 1. Try USDA first — free, fast, no Pro required
    const usdaResult = await lookupUSDA(ingredientName);
    if (usdaResult && usdaResult.calories_per_100g > 0) {
      return usdaResult;
    }

    // 2. Fall back to AI lookup only if USDA returned nothing
    try {
      if (!hasIngredientAccess) {
        setIngredientLookupError("No results found in food database. Please enter nutrition info manually.");
        return null;
      }

      let data: any;
      try {
        data = await lookupIngredientAction({ name: ingredientName });
      } catch (error: any) {
        if (await handlePaywallError(error)) {
          setIngredientLookupError("Upgrade to Pro to use AI ingredient lookup, or enter nutrition info manually.");
          return null;
        }
        logger.error("Ingredient lookup error", error);
        return null;
      }

      if (data?.error) {
        logger.info("Ingredient not found", { error: data.error });
        return null;
      }

      // The Convex action returns a flat shape with per100g rates. Normalise to
      // the per_100g fields the UI expects.
      if (data?.per100g) {
        return {
          calories_per_100g: data.per100g.calories ?? 0,
          protein_per_100g: data.per100g.protein_g ?? 0,
          carbs_per_100g: data.per100g.carbs_g ?? 0,
          fats_per_100g: data.per100g.fats_g ?? 0,
          source: "AI",
        };
      }
      if (data?.nutritionData) {
        return data.nutritionData;
      }

      return null;
    } catch (error) {
      logger.error("Error looking up ingredient", error);
      return null;
    }
  }, [hasIngredientAccess, handlePaywallError, lookupIngredientAction, setIngredientLookupError]);

  const handleManualNutritionSubmit = useCallback(() => {
    if (!manualNutritionDialog.calories_per_100g) {
      toast({ title: "Calories Required", description: "Please enter calories per 100g", variant: "destructive" });
      return;
    }

    const ingredientName = manualNutritionDialog.ingredientName;
    const nutritionData = {
      calories_per_100g: parseFloat(manualNutritionDialog.calories_per_100g),
      protein_per_100g: manualNutritionDialog.protein_per_100g ? parseFloat(manualNutritionDialog.protein_per_100g) : 0,
      carbs_per_100g: manualNutritionDialog.carbs_per_100g ? parseFloat(manualNutritionDialog.carbs_per_100g) : 0,
      fats_per_100g: manualNutritionDialog.fats_per_100g ? parseFloat(manualNutritionDialog.fats_per_100g) : 0,
    };

    const newIngredients = [
      ...manualMeal.ingredients,
      {
        name: ingredientName,
        grams: manualNutritionDialog.grams,
        ...nutritionData,
      }
    ];

    const tc = newIngredients.reduce((sum, ing) => sum + (ing.calories_per_100g || 0) * ing.grams / 100, 0);
    const tp = newIngredients.reduce((sum, ing) => sum + (ing.protein_per_100g || 0) * ing.grams / 100, 0);
    const tcarb = newIngredients.reduce((sum, ing) => sum + (ing.carbs_per_100g || 0) * ing.grams / 100, 0);
    const tf = newIngredients.reduce((sum, ing) => sum + (ing.fats_per_100g || 0) * ing.grams / 100, 0);

    setManualMeal({
      ...manualMeal,
      ingredients: newIngredients,
      calories: Math.round(tc).toString(),
      protein_g: Math.round(tp * 10) / 10 !== 0 ? (Math.round(tp * 10) / 10).toString() : "",
      carbs_g: Math.round(tcarb * 10) / 10 !== 0 ? (Math.round(tcarb * 10) / 10).toString() : "",
      fats_g: Math.round(tf * 10) / 10 !== 0 ? (Math.round(tf * 10) / 10).toString() : "",
    });

    setManualNutritionDialog({
      open: false, ingredientName: "", grams: 0,
      calories_per_100g: "", protein_per_100g: "", carbs_per_100g: "", fats_per_100g: "",
    });
    setIngredientLookupError(null);
    toast({ title: "Ingredient Added", description: `${ingredientName} added with manual nutrition data` });
  }, [manualNutritionDialog, manualMeal, setManualMeal, toast]);

  const cancelAI = () => {
    aiAbortRef.current?.abort();
    setAiAnalyzing(false);
    setAiAnalyzingIngredient(false);
  };

  return {
    aiAnalyzing,
    aiLineItems, setAiLineItems,
    aiAnalysisComplete, setAiAnalysisComplete,
    aiMealDescription, setAiMealDescription,
    aiIngredientDescription, setAiIngredientDescription,
    aiAnalyzingIngredient,
    barcodeBaseMacros, setBarcodeBaseMacros,
    servingMultiplier, setServingMultiplier,
    newIngredient, setNewIngredient,
    lookingUpIngredient, setLookingUpIngredient,
    ingredientLookupError, setIngredientLookupError,
    manualNutritionDialog, setManualNutritionDialog,
    aiAbortRef,
    handleAiAnalyzeMeal,
    handleSaveAiMeal,
    handleAiAnalyzeIngredient,
    handleBarcodeScanned,
    lookupIngredientNutrition,
    handleManualNutritionSubmit,
    cancelAI,
    // Photo analysis
    photoBase64, setPhotoBase64,
    extraPhotos, addExtraPhoto, removeExtraPhoto,
    photoAnalyzing,
    capturePhoto,
    handlePhotoAnalyze,
    // Per-macro overrides for inline-edit of AI totals
    overrideTotals, setOverrideTotals,
  };
}
