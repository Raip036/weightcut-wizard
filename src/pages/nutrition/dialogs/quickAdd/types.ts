/**
 * Prop-shape contracts shared between QuickAddDialog and its sub-panels.
 * Lifted here so the dialog file itself stays under 500 lines.
 *
 * NOTE: `aiMeal` is the bundle the parent page (NutritionPage) hands us —
 * the state/setters live in `useAIMealActions`. We keep the snake_case
 * field names verbatim to stay drop-in compatible with that hook's return
 * value; renaming would force a touch on three call sites.
 */
import type { ManualMealForm, Ingredient } from "@/pages/nutrition/types";

/**
 * Save callback the manual sub-panel uses to commit a meal. Wired to
 * `useMealOperations.saveMealToDb` by NutritionPage so the manual path goes
 * through the same optimistic-update + cache orchestration (`runInsertFlow`)
 * as every other insert path. Resolves to the new meal's id, or `null` if the
 * insert failed (in which case the orchestrator has already surfaced a toast).
 */
export type SaveManualMeal = (data: {
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
}) => Promise<unknown>;

export interface MacroOverrides {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
}

export interface AiLineItemShape {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  bbox?: { x: number; y: number; w: number; h: number };
  confidence?: "high" | "medium" | "low";
}

export interface AiMealShape {
  aiMealDescription: string;
  setAiMealDescription: React.Dispatch<React.SetStateAction<string>>;
  aiAnalyzing: boolean;
  aiLineItems: AiLineItemShape[];
  setAiLineItems: React.Dispatch<React.SetStateAction<any[]>>;
  aiAnalysisComplete: boolean;
  setAiAnalysisComplete: React.Dispatch<React.SetStateAction<boolean>>;
  photoBase64: string | null;
  setPhotoBase64: React.Dispatch<React.SetStateAction<string | null>>;
  /** Up to 2 optional extra angles of the same meal (multi-view accuracy). */
  extraPhotos: string[];
  addExtraPhoto: () => Promise<string | null>;
  removeExtraPhoto: (idx: number) => void;
  photoAnalyzing: boolean;
  capturePhoto: () => Promise<string | null | undefined>;
  handlePhotoAnalyze: () => void;
  handleAiAnalyzeMeal: () => void;
  handleSaveAiMeal: () => void;
  overrideTotals: MacroOverrides;
  setOverrideTotals: React.Dispatch<React.SetStateAction<MacroOverrides>>;
  barcodeBaseMacros: any;
  setBarcodeBaseMacros: React.Dispatch<React.SetStateAction<any>>;
  servingMultiplier: number;
  setServingMultiplier: React.Dispatch<React.SetStateAction<number>>;
  newIngredient: { name: string; grams: string };
  setNewIngredient: React.Dispatch<React.SetStateAction<{ name: string; grams: string }>>;
  lookingUpIngredient: boolean;
  setLookingUpIngredient: React.Dispatch<React.SetStateAction<boolean>>;
  lookupIngredientNutrition: (name: string) => Promise<any>;
  setManualNutritionDialog: React.Dispatch<React.SetStateAction<any>>;
  ingredientLookupError: string | null;
  setIngredientLookupError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface AiTaskShape {
  id: string;
  label: string;
  steps: any[];
  startedAt: number;
}

export interface QuickAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickAddTab: "ai" | "manual";
  setQuickAddTab: (tab: "ai" | "manual") => void;
  manualMeal: ManualMealForm;
  setManualMeal: React.Dispatch<React.SetStateAction<ManualMealForm>>;
  aiMeal: AiMealShape;
  macroCalc: {
    handleCalorieChange: (
      value: string,
      setter: React.Dispatch<React.SetStateAction<ManualMealForm>>,
    ) => void;
  };
  savingAllMeals: boolean;
  /**
   * Single-meal save lock. Disables both the manual "Add to log" CTA and
   * the AI flow's "Save meal" button while a `createMealWithItems`
   * mutation is in flight, so spam taps on slow networks can't fire
   * multiple inserts. Server-side idempotency in the Convex mutation
   * backs this up.
   */
  savingMeal: boolean;
  onAddManualMeal: () => void;
  /**
   * Commits a meal logged via the manual sub-panel. Routes through
   * `useMealOperations.saveMealToDb` so the meal appears in the day's list
   * (optimistic `setMeals` + cache writes) rather than persisting silently.
   */
  onSaveManualMeal: SaveManualMeal;
  aiTask: AiTaskShape | null;
  onCancelAi: () => void;
  onDismissTask: (id: string) => void;
  onToast: (args: {
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  }) => void;
  /**
   * If true, the dialog should open directly on the "caption" step
   * (assuming `aiMeal.photoBase64` is set). Used when the parent has
   * pre-seeded a captured photo via the bottom-nav radial dial and wants
   * the user to add an optional text caption before kicking off analysis.
   * Only respected at the moment `open` transitions false → true; later
   * toggles are ignored.
   */
  initialPendingCaption?: boolean;
}
