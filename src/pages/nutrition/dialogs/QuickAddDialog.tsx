import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Edit2, Loader2, Mic, MicOff, Plus, X, Flame, Wheat, Droplet, Drumstick, Sparkles, Pencil } from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import { triggerHapticSelection } from "@/lib/haptics";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { MealPhotoScanOverlay } from "@/components/nutrition/MealPhotoScanOverlay";
import type { ManualMealForm } from "@/pages/nutrition/types";
import { selectLabeledItems, shortName, layoutLabels } from "@/lib/aiLineItemLabels";

interface MacroOverrides {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
}

interface AiMealShape {
  aiMealDescription: string;
  setAiMealDescription: React.Dispatch<React.SetStateAction<string>>;
  aiAnalyzing: boolean;
  aiLineItems: Array<{ name: string; quantity: string; calories: number; protein_g: number; carbs_g: number; fats_g: number; bbox?: { x: number; y: number; w: number; h: number } }>;
  setAiLineItems: React.Dispatch<React.SetStateAction<any[]>>;
  aiAnalysisComplete: boolean;
  setAiAnalysisComplete: React.Dispatch<React.SetStateAction<boolean>>;
  photoBase64: string | null;
  setPhotoBase64: React.Dispatch<React.SetStateAction<string | null>>;
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

interface AiTaskShape {
  id: string;
  label: string;
  steps: any[];
  startedAt: number;
}

interface QuickAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quickAddTab: "ai" | "manual";
  setQuickAddTab: (tab: "ai" | "manual") => void;
  manualMeal: ManualMealForm;
  setManualMeal: React.Dispatch<React.SetStateAction<ManualMealForm>>;
  aiMeal: AiMealShape;
  macroCalc: {
    handleCalorieChange: (value: string, setter: React.Dispatch<React.SetStateAction<ManualMealForm>>) => void;
  };
  savingAllMeals: boolean;
  /**
   * Single-meal save lock. Disables both the manual "Add to log" CTA and the
   * AI tab's "Done" button while a `createMealWithItems` mutation is in
   * flight, so spam taps on slow networks can't fire multiple inserts.
   * Server-side idempotency in the Convex mutation backs this up — if a tap
   * does slip through (e.g. before the disabled state propagates), the
   * duplicate collapses onto the first save's mealId server-side.
   */
  savingMeal: boolean;
  onAddManualMeal: () => void;
  aiTask: AiTaskShape | null;
  onCancelAi: () => void;
  onDismissTask: (id: string) => void;
  onToast: (args: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  gemBadge: React.ReactNode;
}

const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
] as const;

const INPUT_CLASS =
  "h-11 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[15px] text-foreground placeholder:text-muted-foreground/50 px-4 focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

export function QuickAddDialog({
  open,
  onOpenChange,
  quickAddTab,
  setQuickAddTab,
  manualMeal,
  setManualMeal,
  aiMeal,
  macroCalc,
  savingAllMeals,
  savingMeal,
  onAddManualMeal,
  aiTask,
  onCancelAi,
  onDismissTask,
  onToast,
  gemBadge,
}: QuickAddDialogProps) {
  const [hasSeenAiPlaceholder, setHasSeenAiPlaceholder] = useState(() => {
    try { return localStorage.getItem("wcw_ai_meal_placeholder_seen") === "1"; } catch { return false; }
  });
  // "Fix Results" reveals the detailed line-item editor (Cal-AI pattern:
  // the macro card view is primary; per-item edits are one tap away).
  const [showLineItemEditor, setShowLineItemEditor] = useState(false);
  // Which macro tile is currently in inline-edit mode (null when none).
  // Lets the user tap a tile to override the AI's headline value — e.g.
  // when they know the actual serving was bigger than the photo suggests.
  const [editingMacro, setEditingMacro] = useState<null | "calories" | "protein_g" | "carbs_g" | "fats_g">(null);
  const [editingDraft, setEditingDraft] = useState("");
  useEffect(() => {
    if (!aiMeal.aiAnalysisComplete) {
      setShowLineItemEditor(false);
      setEditingMacro(null);
    }
  }, [aiMeal.aiAnalysisComplete]);
  useEffect(() => {
    if (open && quickAddTab === "ai" && !hasSeenAiPlaceholder) {
      setHasSeenAiPlaceholder(true);
      try { localStorage.setItem("wcw_ai_meal_placeholder_seen", "1"); } catch { /* swallow */ }
    }
  }, [open, quickAddTab, hasSeenAiPlaceholder]);

  const { isListening, isSupported: voiceSupported, startListening, stopListening, interimText } = useSpeechRecognition({
    onTranscript: (text: string) => aiMeal.setAiMealDescription((prev) => (prev ? prev + " " + text : text)),
    onError: (error: string) => onToast({ title: "Voice Input", description: error, variant: "destructive" }),
  });

  // Pick the calorie-heaviest items + lay out their bubble positions over
  // the photo. Memoized because the layout pass walks the list once and
  // resolves collisions — cheap, but no point re-running on unrelated
  // re-renders (e.g. the meal-name input keystrokes).
  const placedLabels = useMemo(
    () => layoutLabels(selectLabeledItems(aiMeal.aiLineItems, 4)),
    [aiMeal.aiLineItems],
  );

  const summedAiCalories = aiMeal.aiLineItems.reduce((s, i) => s + i.calories, 0);
  const summedAiProtein = aiMeal.aiLineItems.reduce((s, i) => s + i.protein_g, 0);
  const summedAiCarbs = aiMeal.aiLineItems.reduce((s, i) => s + i.carbs_g, 0);
  const summedAiFats = aiMeal.aiLineItems.reduce((s, i) => s + i.fats_g, 0);
  // Displayed values respect any inline-edited override; raw sums feed
  // the save flow only when the user hasn't overridden that macro.
  const totalAiLineItemCalories = aiMeal.overrideTotals.calories ?? summedAiCalories;
  const totalAiProtein = aiMeal.overrideTotals.protein_g ?? summedAiProtein;
  const totalAiCarbs = aiMeal.overrideTotals.carbs_g ?? summedAiCarbs;
  const totalAiFats = aiMeal.overrideTotals.fats_g ?? summedAiFats;

  const beginEditMacro = (
    key: "calories" | "protein_g" | "carbs_g" | "fats_g",
    currentValue: number,
  ) => {
    triggerHapticSelection();
    setEditingMacro(key);
    setEditingDraft(String(Math.round(currentValue)));
  };
  const commitEditMacro = () => {
    if (!editingMacro) return;
    const trimmed = editingDraft.trim();
    aiMeal.setOverrideTotals((prev) => {
      const next = { ...prev };
      if (trimmed === "") {
        // Empty input clears just this macro's override; siblings stay.
        delete next[editingMacro!];
        return next;
      }
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n) || n < 0) return prev;
      const rounded = Math.round(n * 10) / 10;
      next[editingMacro!] = rounded;

      // Keep calories and macros in lockstep using Atwater factors
      // (protein 4, carbs 4, fat 9 kcal/g). Bumping a macro recomputes
      // the calorie headline; bumping calories scales the macros
      // proportionally so their Atwater sum lands on the new number.
      const currentProtein = next.protein_g ?? summedAiProtein;
      const currentCarbs = next.carbs_g ?? summedAiCarbs;
      const currentFats = next.fats_g ?? summedAiFats;

      if (editingMacro === "calories") {
        const atwater = 4 * currentProtein + 4 * currentCarbs + 9 * currentFats;
        if (atwater > 0) {
          const ratio = rounded / atwater;
          next.protein_g = Math.round(currentProtein * ratio * 10) / 10;
          next.carbs_g = Math.round(currentCarbs * ratio * 10) / 10;
          next.fats_g = Math.round(currentFats * ratio * 10) / 10;
        }
      } else {
        next.calories = Math.round(4 * currentProtein + 4 * currentCarbs + 9 * currentFats);
      }
      return next;
    });
    setEditingMacro(null);
    setEditingDraft("");
  };

  const handleAddIngredient = async () => {
    if (!aiMeal.newIngredient.name.trim() || !aiMeal.newIngredient.grams) {
      onToast({ title: "Missing Information", description: "Please enter ingredient name and grams", variant: "destructive" });
      return;
    }
    const ingredientName = aiMeal.newIngredient.name.trim();
    const grams = parseFloat(aiMeal.newIngredient.grams);
    if (isNaN(grams) || grams <= 0) {
      onToast({ title: "Invalid Amount", description: "Please enter a valid number of grams", variant: "destructive" });
      return;
    }
    aiMeal.setLookingUpIngredient(true);
    aiMeal.setIngredientLookupError(null);
    try {
      const nutritionData = await aiMeal.lookupIngredientNutrition(ingredientName);
      if (nutritionData) {
        const newIngredients = [
          ...manualMeal.ingredients,
          {
            name: ingredientName,
            grams,
            calories_per_100g: nutritionData.calories_per_100g,
            protein_per_100g: nutritionData.protein_per_100g,
            carbs_per_100g: nutritionData.carbs_per_100g,
            fats_per_100g: nutritionData.fats_per_100g,
            source: nutritionData.source,
          },
        ];
        const tc = newIngredients.reduce((s, i) => s + (i.calories_per_100g || 0) * i.grams / 100, 0);
        const tp = newIngredients.reduce((s, i) => s + (i.protein_per_100g || 0) * i.grams / 100, 0);
        const tcarb = newIngredients.reduce((s, i) => s + (i.carbs_per_100g || 0) * i.grams / 100, 0);
        const tf = newIngredients.reduce((s, i) => s + (i.fats_per_100g || 0) * i.grams / 100, 0);
        setManualMeal({
          ...manualMeal,
          ingredients: newIngredients,
          calories: Math.round(tc).toString(),
          protein_g: tp > 0 ? (Math.round(tp * 10) / 10).toString() : "",
          carbs_g: tcarb > 0 ? (Math.round(tcarb * 10) / 10).toString() : "",
          fats_g: tf > 0 ? (Math.round(tf * 10) / 10).toString() : "",
        });
        aiMeal.setNewIngredient({ name: "", grams: "" });
      } else {
        aiMeal.setManualNutritionDialog({
          open: true,
          ingredientName,
          grams,
          calories_per_100g: "",
          protein_per_100g: "",
          carbs_per_100g: "",
          fats_per_100g: "",
        });
      }
    } catch {
      aiMeal.setManualNutritionDialog({
        open: true,
        ingredientName,
        grams,
        calories_per_100g: "",
        protein_per_100g: "",
        carbs_per_100g: "",
        fats_per_100g: "",
      });
    } finally {
      aiMeal.setLookingUpIngredient(false);
    }
  };

  const handleBarcodeServingSet = (next: number, grams?: number) => {
    const base = aiMeal.barcodeBaseMacros!;
    aiMeal.setServingMultiplier(next);
    const gramTotal = grams ?? Math.round(next * base.serving_weight_g);
    setManualMeal((prev) => ({
      ...prev,
      calories: Math.round(base.calories * next).toString(),
      protein_g: (Math.round(base.protein_g * next * 10) / 10).toString(),
      carbs_g: (Math.round(base.carbs_g * next * 10) / 10).toString(),
      fats_g: (Math.round(base.fats_g * next * 10) / 10).toString(),
      portion_size: `${gramTotal}g`,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`w-[calc(100vw-1.5rem)] max-w-[420px] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-[28px] p-0 border-0 bg-card/95 backdrop-blur-xl gap-0 ${aiTask ? "[&>button]:hidden" : ""}`}
      >
        {aiTask && (
          aiMeal.photoAnalyzing && aiMeal.photoBase64 ? (
            <MealPhotoScanOverlay
              isOpen={true}
              isGenerating={true}
              photoBase64={aiMeal.photoBase64}
              steps={aiTask.steps}
              startedAt={aiTask.startedAt}
              title={aiTask.label}
              lineItems={aiMeal.aiLineItems}
              onCancel={() => { onCancelAi(); onDismissTask(aiTask.id); }}
            />
          ) : (
            <AICompactOverlay
              isOpen={true}
              isGenerating={true}
              steps={aiTask.steps}
              startedAt={aiTask.startedAt}
              title={aiTask.label}
              onCancel={() => { onCancelAi(); onDismissTask(aiTask.id); }}
            />
          )
        )}

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-3">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold tracking-tight text-center">
              Add a meal
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* ── Mode segmented pill (AI / Manual) ──────────────────── */}
        <div className="px-5">
          <LayoutGroup id="add-meal-tab">
            <div role="tablist" className="relative flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/30">
              {(["ai", "manual"] as const).map((tab) => {
                const active = quickAddTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => { if (!active) { setQuickAddTab(tab); triggerHapticSelection(); } }}
                    className="relative flex-1 h-10 rounded-xs text-[14px] font-semibold active:scale-[0.98] transition-transform"
                  >
                    {active && (
                      <motion.div
                        layoutId="add-meal-tab-pill"
                        className="absolute inset-0 rounded-xs bg-background ring-1 ring-border/30"
                        transition={{ type: "spring", damping: 28, stiffness: 380 }}
                      />
                    )}
                    <motion.span
                      className="relative z-10 inline-flex items-center gap-1.5"
                      animate={{ color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
                      transition={{ duration: 0.18 }}
                    >
                      {tab === "ai" ? <Sparkles className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                      {tab === "ai" ? "AI" : "Manual"}
                    </motion.span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
        </div>

        {/* ── Meal-type chooser (small chip row) ─────────────────── */}
        {/* Hidden in the AI tab once analysis completes — the result panel
            shows its own meal-type cap and the compose chrome would be
            redundant clutter behind the macro card. */}
        {!(quickAddTab === "ai" && aiMeal.aiAnalysisComplete && aiMeal.aiLineItems.length > 0) && (
          <div className="px-5 pt-3">
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 mb-1.5">
              Log to
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {MEAL_TYPES.map((t) => {
                const active = manualMeal.meal_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setManualMeal((prev) => ({ ...prev, meal_type: t.value }))}
                    aria-pressed={active}
                    className={`h-8 rounded-xs text-[12px] font-semibold transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AI tab ─────────────────────────────────────────────── */}
        {quickAddTab === "ai" && (
          <div className="px-5 pt-4 pb-5 space-y-3">
            {/* Big primary CTAs */}
            {!aiMeal.photoBase64 && !aiMeal.aiAnalysisComplete && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={async () => { await aiMeal.capturePhoto(); }}
                  disabled={aiMeal.aiAnalyzing}
                  className="card-surface rounded-xs h-[88px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-40"
                >
                  <Camera className="h-5 w-5 text-primary" strokeWidth={2.4} />
                  <span className="text-[13px] font-semibold text-foreground">Snap photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => { const ta = document.querySelector<HTMLTextAreaElement>("#ai-meal-description"); if (ta) ta.focus(); }}
                  className="card-surface rounded-xs h-[88px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                >
                  <Edit2 className="h-5 w-5 text-muted-foreground" strokeWidth={2.4} />
                  <span className="text-[13px] font-semibold text-foreground">Describe</span>
                </button>
              </div>
            )}

            {/* Photo preview — hero card. Suppressed while the scan overlay
                is active, otherwise the same image renders twice on screen
                (the overlay holds an animated copy with corner brackets).
                Returns automatically once `photoAnalyzing` flips back to
                false so the user has a static thumbnail post-scan. */}
            {aiMeal.photoBase64 && !aiMeal.photoAnalyzing && !aiMeal.aiAnalysisComplete && (
              <div className="relative rounded-xs overflow-hidden">
                <img
                  src={`data:image/jpeg;base64,${aiMeal.photoBase64}`}
                  alt="Meal"
                  className="w-full h-44 object-cover"
                />
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                <button
                  type="button"
                  onClick={() => aiMeal.setPhotoBase64(null)}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/55 flex items-center justify-center backdrop-blur active:scale-95 transition-transform"
                >
                  <X className="h-3.5 w-3.5 text-white" />
                </button>
                <button
                  type="button"
                  onClick={async () => { await aiMeal.capturePhoto(); }}
                  disabled={aiMeal.aiAnalyzing}
                  className="absolute bottom-2 right-2 h-8 px-2.5 rounded-full bg-black/55 flex items-center gap-1 backdrop-blur text-white text-[11px] font-semibold active:scale-95 transition-transform"
                >
                  <Camera className="h-3 w-3" /> Retake
                </button>
              </div>
            )}

            {/* Describe + analyze cluster — hidden once analysis lands so
                the result panel becomes the sole focus of the dialog. */}
            {!aiMeal.aiAnalysisComplete && (
              <>
            {/* Describe textarea */}
            <Textarea
              id="ai-meal-description"
              placeholder={
                isListening
                  ? "Listening…"
                  : aiMeal.photoBase64
                  ? "Add details (optional) — e.g. 1 cup brown rice"
                  : hasSeenAiPlaceholder
                  ? "What did you eat?"
                  : "e.g. bread with nutella, banana"
              }
              value={aiMeal.aiMealDescription}
              onChange={(e) => aiMeal.setAiMealDescription(e.target.value)}
              disabled={aiMeal.aiAnalyzing}
              className={`text-[15px] min-h-[88px] resize-none rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 py-3 px-4 placeholder:text-muted-foreground/50 ${isListening ? "ring-2 ring-func-danger-red/40" : ""}`}
              rows={3}
              onFocus={() => {
                setTimeout(() => {
                  const el = document.activeElement;
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 300);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !aiMeal.aiAnalyzing) {
                  e.preventDefault();
                  if (aiMeal.photoBase64) aiMeal.handlePhotoAnalyze();
                  else aiMeal.handleAiAnalyzeMeal();
                }
              }}
            />
            {isListening && interimText && (
              <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
            )}

            {/* Voice + analyze button */}
            <div className="flex gap-2">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={() => { triggerHapticSelection(); if (isListening) stopListening(); else startListening(); }}
                  disabled={aiMeal.aiAnalyzing}
                  className={`flex items-center justify-center gap-1.5 px-3.5 h-12 rounded-xs text-[14px] font-semibold transition-all ${
                    isListening
                      ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                      : "bg-muted/40 text-muted-foreground active:bg-muted/60"
                  }`}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {isListening ? "Stop" : "Voice"}
                </button>
              )}
              <Button
                type="button"
                onClick={() => {
                  if (isListening) stopListening();
                  if (aiMeal.photoBase64) aiMeal.handlePhotoAnalyze();
                  else aiMeal.handleAiAnalyzeMeal();
                }}
                disabled={aiMeal.aiAnalyzing || (!aiMeal.photoBase64 && !aiMeal.aiMealDescription.trim())}
                className="relative flex-1 h-12 rounded-xs text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                {aiMeal.aiAnalyzing ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing…
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" />
                      {aiMeal.photoBase64 ? "Analyze photo" : "Analyze"}
                    </span>
                    {gemBadge && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        {gemBadge}
                      </span>
                    )}
                  </>
                )}
              </Button>
            </div>
              </>
            )}

            {/* AI result — Cal-AI inspired result panel */}
            {aiMeal.aiAnalysisComplete && aiMeal.aiLineItems.length > 0 && (
              <div className="space-y-3 animate-fade-in pt-1">
                {/* Photo hero with floating ingredient bubbles */}
                {aiMeal.photoBase64 && (
                  <div className="relative rounded-xs overflow-hidden">
                    <img
                      src={`data:image/jpeg;base64,${aiMeal.photoBase64}`}
                      alt="Meal"
                      className="w-full h-44 object-cover"
                    />
                    <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/30 via-transparent to-black/15" />
                    {/* Labels only the most calorie-heavy items, anchored to
                        each food via the vision bbox where available. Names
                        are squashed to a readable short form ("French Fries"
                        → "Fries"). Layout clamps to edge insets and nudges
                        overlapping bubbles apart. See aiLineItemLabels.ts. */}
                    {placedLabels.map(({ x, y, item }, idx) => (
                      <div
                        key={idx}
                        className="absolute bg-white/95 dark:bg-card/95 backdrop-blur-md text-foreground px-2.5 py-1 rounded-full flex flex-col items-center leading-tight"
                        style={{
                          left: `${x * 100}%`,
                          top: `${y * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      >
                        <span className="text-[10px] font-semibold tracking-tight">{shortName(item.name)}</span>
                        <span className="text-[10px] font-bold tabular-nums">{Math.round(item.calories)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Meal-type chip row + AI-generated name (editable) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-1.5">
                    {MEAL_TYPES.map((t) => {
                      const active = manualMeal.meal_type === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => {
                            triggerHapticSelection();
                            setManualMeal((prev) => ({ ...prev, meal_type: t.value }));
                          }}
                          aria-pressed={active}
                          className={`h-7 px-3 rounded-full text-[11px] font-semibold tracking-tight transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={manualMeal.meal_name}
                    onChange={(e) => setManualMeal((prev) => ({ ...prev, meal_name: e.target.value }))}
                    placeholder="Name this meal"
                    className="h-12 rounded-xs bg-transparent border-0 text-[18px] font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/40 px-0 focus-visible:ring-0"
                  />
                </div>

                {/* 2×2 macro grid — tap a tile to inline-edit that macro.
                    Useful when the user knows the serving was off (e.g. AI
                    said 500cal but they ate 1.5× the photo). The override is
                    used on save; line items below stay at AI values. */}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "calories" as const, label: "Calories", value: Math.round(totalAiLineItemCalories), unit: "", Icon: Flame, color: "#f97316", tint: "rgba(249, 115, 22, 0.12)" },
                    { key: "carbs_g" as const, label: "Carbs", value: Math.round(totalAiCarbs), unit: "g", Icon: Wheat, color: "#f59e0b", tint: "rgba(245, 158, 11, 0.12)" },
                    { key: "protein_g" as const, label: "Protein", value: Math.round(totalAiProtein), unit: "g", Icon: Drumstick, color: "#ef4444", tint: "rgba(239, 68, 68, 0.12)" },
                    { key: "fats_g" as const, label: "Fats", value: Math.round(totalAiFats), unit: "g", Icon: Droplet, color: "#3b82f6", tint: "rgba(59, 130, 246, 0.12)" },
                  ]).map((m) => {
                    const isEditing = editingMacro === m.key;
                    const isOverridden = aiMeal.overrideTotals[m.key] !== undefined;
                    return (
                      <div
                        key={m.label}
                        className={`card-surface rounded-xs px-3 py-3 flex items-center gap-2.5 text-left transition-transform ${
                          isEditing ? "ring-2 ring-primary/40" : "active:scale-[0.98]"
                        }`}
                        onClick={() => { if (!isEditing) beginEditMacro(m.key, m.value); }}
                        role="button"
                        tabIndex={0}
                      >
                        <div
                          className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: m.tint }}
                        >
                          <m.Icon className="h-4 w-4" style={{ color: m.color }} strokeWidth={2.4} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-muted-foreground/70 leading-none">
                            {m.label}
                            {isOverridden && !isEditing && (
                              <span className="ml-1 text-primary/80">·&nbsp;edited</span>
                            )}
                          </p>
                          {isEditing ? (
                            <input
                              autoFocus
                              type="number"
                              inputMode="decimal"
                              value={editingDraft}
                              onChange={(e) => setEditingDraft(e.target.value)}
                              onBlur={commitEditMacro}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
                                if (e.key === "Escape") { setEditingMacro(null); setEditingDraft(""); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-transparent border-0 outline-none text-[15px] font-bold tabular-nums text-foreground leading-none mt-1 p-0 focus:ring-0"
                              aria-label={`Edit ${m.label}`}
                            />
                          ) : (
                            <p className="text-[15px] font-bold tabular-nums text-foreground leading-none mt-1">
                              {m.value}<span className="text-[11px] font-semibold text-muted-foreground/60">{m.unit}</span>
                            </p>
                          )}
                        </div>
                        <Pencil
                          className={`h-3 w-3 flex-shrink-0 ${isOverridden ? "text-primary" : "text-muted-foreground/40"}`}
                          strokeWidth={2.2}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Line-item editor (revealed by Fix Results) */}
                {showLineItemEditor && (
                  <div className="space-y-1.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
                        Items detected
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowLineItemEditor(false)}
                        className="text-[11px] font-medium text-muted-foreground/70 active:text-foreground transition-colors"
                      >
                        Done editing
                      </button>
                    </div>
                    <div className="rounded-xs bg-muted/30 divide-y divide-border/15 overflow-hidden max-h-44 overflow-y-auto">
                      {aiMeal.aiLineItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold truncate text-foreground">{item.name}</p>
                            <p className="text-[11px] text-muted-foreground/70 truncate">{item.quantity}</p>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground/85 flex-shrink-0">
                            <span className="font-bold text-foreground">{item.calories}</span>
                            <span className="text-blue-500">{Math.round(item.protein_g)}P</span>
                            <span className="text-func-carbs-orange">{Math.round(item.carbs_g)}C</span>
                            <span className="text-func-fats-purple">{Math.round(item.fats_g)}F</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => aiMeal.setAiLineItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="h-6 w-6 flex items-center justify-center rounded-full text-muted-foreground active:text-destructive flex-shrink-0"
                            aria-label="Remove item"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom action row — Fix Results (outline) + Done (filled) */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowLineItemEditor((v) => !v)}
                    className="flex-1 h-12 rounded-xs border border-border/40 bg-background/40 text-[14px] font-semibold text-foreground active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2.4} />
                    {showLineItemEditor ? "Hide details" : "Fix results"}
                  </button>
                  <button
                    onClick={aiMeal.handleSaveAiMeal}
                    disabled={aiMeal.aiLineItems.length === 0 || savingMeal}
                    className="flex-1 h-12 rounded-xs text-[15px] font-semibold bg-foreground text-background active:scale-[0.98] transition-transform disabled:opacity-40"
                  >
                    {savingMeal ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Adding…
                      </span>
                    ) : (
                      "Done"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Manual tab ─────────────────────────────────────────── */}
        {quickAddTab === "manual" && (
          <div className="px-5 pt-4 pb-5 space-y-2.5">
            <Input
              placeholder="Meal name"
              value={manualMeal.meal_name}
              onChange={(e) => setManualMeal({ ...manualMeal, meal_name: e.target.value })}
              className={INPUT_CLASS}
              autoFocus
            />

            {aiMeal.barcodeBaseMacros && (
              <div className="rounded-xs bg-muted/30 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">Serving</p>
                  <span className="text-[12px] text-muted-foreground/80 font-medium">{aiMeal.barcodeBaseMacros.serving_size}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-foreground/85 flex-1">Amount</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={Math.round(aiMeal.servingMultiplier * aiMeal.barcodeBaseMacros.serving_weight_g)}
                      onChange={(e) => {
                        const grams = parseFloat(e.target.value);
                        if (!isNaN(grams) && grams > 0) {
                          const m = grams / aiMeal.barcodeBaseMacros!.serving_weight_g;
                          handleBarcodeServingSet(Math.round(m * 10) / 10, Math.round(grams));
                        }
                      }}
                      className="w-16 text-[14px] text-right h-9 rounded-xs"
                    />
                    <span className="text-[14px] text-muted-foreground">g</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-foreground/85 flex-1">Servings</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleBarcodeServingSet(Math.max(0.5, Math.round((aiMeal.servingMultiplier - 0.5) * 10) / 10))}
                      disabled={aiMeal.servingMultiplier <= 0.5}
                      className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center text-[16px] font-medium active:bg-muted/80 transition-colors disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="text-[14px] font-bold w-9 text-center tabular-nums">
                      {aiMeal.servingMultiplier}×
                    </span>
                    <button
                      type="button"
                      onClick={() => handleBarcodeServingSet(Math.min(10, Math.round((aiMeal.servingMultiplier + 0.5) * 10) / 10))}
                      className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center text-[14px] font-medium active:bg-muted/80 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2 border-t border-border/20 text-[13px]">
                  <span className="font-bold text-primary">{manualMeal.calories} kcal</span>
                  <span className="text-blue-500">{manualMeal.protein_g}P</span>
                  <span className="text-func-carbs-orange">{manualMeal.carbs_g}C</span>
                  <span className="text-func-fats-purple">{manualMeal.fats_g}F</span>
                </div>
              </div>
            )}

            <Input
              type="number"
              inputMode="numeric"
              placeholder="Calories"
              value={manualMeal.calories}
              onChange={(e) => macroCalc.handleCalorieChange(e.target.value, setManualMeal)}
              className={INPUT_CLASS}
            />

            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="Protein"
                value={manualMeal.protein_g}
                onChange={(e) => setManualMeal({ ...manualMeal, protein_g: e.target.value })}
                className={INPUT_CLASS}
              />
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="Carbs"
                value={manualMeal.carbs_g}
                onChange={(e) => setManualMeal({ ...manualMeal, carbs_g: e.target.value })}
                className={INPUT_CLASS}
              />
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="Fats"
                value={manualMeal.fats_g}
                onChange={(e) => setManualMeal({ ...manualMeal, fats_g: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>

            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 pt-1">
              Ingredients (optional)
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Ingredient"
                value={aiMeal.newIngredient.name}
                onChange={(e) => aiMeal.setNewIngredient({ ...aiMeal.newIngredient, name: e.target.value })}
                className={`${INPUT_CLASS} flex-1`}
              />
              <Input
                type="number"
                inputMode="numeric"
                placeholder="g"
                value={aiMeal.newIngredient.grams}
                onChange={(e) => aiMeal.setNewIngredient({ ...aiMeal.newIngredient, grams: e.target.value })}
                className={`${INPUT_CLASS} w-16 px-2 text-center`}
              />
              <Button
                type="button"
                onClick={handleAddIngredient}
                disabled={aiMeal.lookingUpIngredient || !aiMeal.newIngredient.name.trim() || !aiMeal.newIngredient.grams}
                className="shrink-0 h-11 w-11 rounded-xs bg-primary/15 hover:bg-primary/25 text-primary p-0"
              >
                {aiMeal.lookingUpIngredient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.6} />}
              </Button>
            </div>
            {aiMeal.ingredientLookupError && (
              <p className="text-[12px] text-destructive">{aiMeal.ingredientLookupError}</p>
            )}
            {manualMeal.ingredients.length > 0 && (
              <div className="rounded-xs bg-muted/30 divide-y divide-border/15 overflow-hidden">
                {manualMeal.ingredients.map((ingredient, idx) => {
                  const cal = ingredient.calories_per_100g !== undefined
                    ? Math.round(ingredient.calories_per_100g * ingredient.grams / 100)
                    : null;
                  return (
                    <div key={idx} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                      <span className="flex-1 truncate text-foreground">{ingredient.name}</span>
                      <span className="text-muted-foreground/70 shrink-0 tabular-nums">{ingredient.grams}g</span>
                      {cal !== null && (
                        <span className="text-muted-foreground/70 shrink-0 tabular-nums">{cal}kcal</span>
                      )}
                      <button
                        type="button"
                        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-muted-foreground active:text-destructive"
                        onClick={() => {
                          const updated = [...manualMeal.ingredients];
                          updated.splice(idx, 1);
                          setManualMeal({ ...manualMeal, ingredients: updated });
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                {manualMeal.ingredients.some((ing) => ing.calories_per_100g !== undefined) && (
                  <div className="flex justify-between px-3 py-1.5 text-[12px] text-muted-foreground bg-muted/40">
                    <span>Total</span>
                    <span className="tabular-nums">{manualMeal.ingredients.reduce((s, i) => s + i.grams, 0)}g</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={onAddManualMeal}
              disabled={savingAllMeals || savingMeal}
              className="w-full h-12 mt-1 rounded-xs text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              {savingAllMeals || savingMeal ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding…
                </span>
              ) : (
                "Add to log"
              )}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
