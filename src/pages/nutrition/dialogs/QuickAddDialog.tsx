/**
 * QuickAddDialog — "Add a meal" bottom sheet.
 *
 * Rewritten to be AI-first: snap photo as the hero, describe + voice as the
 * secondary path, and a small "log manually →" corner link that swaps the
 * sheet body to the manual sub-panel. The sheet's body is a state machine
 * with six modes:
 *
 *   "ai-input"  → camera hero + describe + voice + "log manually" link
 *   "caption"   → captured photo preview + optional caption textarea
 *   "scanning"  → Apple-style scan overlay with corner brackets + scan line
 *   "confirm"   → wizard "I think this is…" confirmation (fades in post-scan)
 *   "macros"    → existing macro editor + ingredient list + Save
 *   "manual"    → ManualLogPanel sub-panel
 *
 * All existing functionality is preserved — meal-time selection, photo
 * capture, voice transcription, AI analysis, macro editing, Atwater
 * cascade, save. Manual-form fields previously baked into this dialog now
 * live in `ManualLogPanel` (built by a parallel agent).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Crown } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { useSubscription } from "@/hooks/useSubscription";
import { NutritionProDialog } from "@/components/nutrition/NutritionProDialog";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useKeyboardAware } from "@/hooks/useKeyboardAware";
import { useScrollIntoViewOnFocus } from "@/hooks/useScrollIntoViewOnFocus";
import { MealTypeSelector, type MealType } from "./quickAdd/MealTypeSelector";
import { SnapPhotoHero } from "./quickAdd/SnapPhotoHero";
import { DescribeRow } from "./quickAdd/DescribeRow";
import { CaptionStep } from "./quickAdd/CaptionStep";
import { ScanOverlay } from "./quickAdd/ScanOverlay";
import { WizardCookingOverlay } from "./quickAdd/WizardCookingOverlay";
import { WizardConfirmCard } from "./quickAdd/WizardConfirmCard";
import { MacrosEditor } from "./quickAdd/MacrosEditor";
import { ManualLogPanel } from "./quickAdd/ManualLogPanel";
import type { QuickAddDialogProps } from "./quickAdd/types";

type SheetMode = "ai-input" | "caption" | "scanning" | "thinking" | "confirm" | "macros" | "manual";

export function QuickAddDialog({
  open,
  onOpenChange,
  quickAddTab,
  setQuickAddTab,
  manualMeal,
  setManualMeal,
  aiMeal,
  savingMeal,
  // The following three props remain in the QuickAddDialog public API for
  // backwards compatibility with NutritionPage's call site, but the
  // AI-first rewrite no longer needs them here. Manual logging is owned by
  // ManualLogPanel, which commits via the `onSaveManualMeal` callback below
  // (NutritionPage's `saveMealToDb`) so the new meal flows through the shared
  // optimistic-update orchestration and shows up in the day's list.
  onAddManualMeal: _onAddManualMeal,
  onSaveManualMeal,
  savingAllMeals: _savingAllMeals,
  macroCalc: _macroCalc,
  aiTask,
  onCancelAi,
  onDismissTask,
  onToast,
  initialPendingCaption = false,
}: QuickAddDialogProps) {
  // ── Mode state machine ─────────────────────────────────────────────
  // The displayed mode is derived from the live AI flow state PLUS a UI
  // override (the user tapping "log manually" or "not quite"). We compute
  // a default mode and let local UI flags route around it.
  const [manualOverride, setManualOverride] = useState<boolean>(quickAddTab === "manual");
  const [confirmDismissed, setConfirmDismissed] = useState(false);
  // When the user has just snapped a photo we route through the "caption"
  // step instead of dropping them back into ai-input. Flag clears when the
  // user proceeds to scanning, retakes back to ai-input, or the sheet closes.
  const [pendingCaption, setPendingCaption] = useState(false);

  // Keep the parent's quickAddTab in sync when the user toggles via the
  // corner link or back link. Parent uses this for analytics + reset.
  useEffect(() => {
    if (manualOverride && quickAddTab !== "manual") setQuickAddTab("manual");
    if (!manualOverride && quickAddTab !== "ai") setQuickAddTab("ai");
  }, [manualOverride, quickAddTab, setQuickAddTab]);

  // Parent-driven tab changes are seeded once at mount via the useState
  // initializer above. We intentionally do NOT mirror `quickAddTab` back
  // into `manualOverride` here — Effect 1 above already pushes the local
  // override out to the parent, and a reverse-direction effect would race
  // against the just-flipped local state. (Tapping "Use AI instead" used
  // to flicker back to manual because the parent's `quickAddTab` prop was
  // still "manual" on the same render the override flipped to false, so
  // the parent→child sync effect re-set it to true.)

  // Track previous `open` value so we can detect the false → true
  // transition and seed `pendingCaption` exactly once per open cycle.
  const prevOpenRef = useRef(open);

  // Reset transient UI state whenever the sheet closes so the next open
  // doesn't briefly flash a stale mode. Also seed `pendingCaption` from
  // `initialPendingCaption` on the false → true transition so the parent
  // can deep-link the sheet straight to the caption step.
  useEffect(() => {
    if (!open) {
      setManualOverride(false);
      setConfirmDismissed(false);
      setPendingCaption(false);
    } else if (!prevOpenRef.current && initialPendingCaption) {
      setPendingCaption(true);
    }
    prevOpenRef.current = open;
  }, [open, initialPendingCaption]);

  // Reset confirm dismissal whenever a fresh analysis lands.
  useEffect(() => {
    if (aiMeal.aiAnalysisComplete && aiMeal.aiLineItems.length > 0) {
      setConfirmDismissed(false);
    }
  }, [aiMeal.aiAnalysisComplete, aiMeal.aiLineItems.length]);

  // ── Mode derivation ────────────────────────────────────────────────
  const mode: SheetMode = useMemo(() => {
    if (manualOverride) return "manual";
    // Photo-driven analysis (or any analysis with a photo present) shows the
    // camera-style scan overlay. Text-only analysis routes to the new
    // "thinking" overlay so we don't pretend to scan an image that doesn't
    // exist.
    if (aiMeal.photoAnalyzing || (aiMeal.aiAnalyzing && aiMeal.photoBase64)) {
      return "scanning";
    }
    if (aiMeal.aiAnalyzing && !aiMeal.photoBase64) return "thinking";
    if (
      aiMeal.aiAnalysisComplete &&
      aiMeal.aiLineItems.length > 0 &&
      !confirmDismissed
    ) {
      return "confirm";
    }
    if (aiMeal.aiAnalysisComplete && aiMeal.aiLineItems.length > 0) {
      return "macros";
    }
    // Fresh-captured photo waiting for an optional caption before scan.
    if (pendingCaption && aiMeal.photoBase64) return "caption";
    return "ai-input";
  }, [
    manualOverride,
    aiMeal.aiAnalyzing,
    aiMeal.photoAnalyzing,
    aiMeal.aiAnalysisComplete,
    aiMeal.aiLineItems.length,
    confirmDismissed,
    pendingCaption,
    aiMeal.photoBase64,
  ]);

  // ── Voice + text input ────────────────────────────────────────────
  const handleInputFocus = useScrollIntoViewOnFocus();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    isListening,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    interimText,
  } = useSpeechRecognition({
    onTranscript: (text: string) =>
      aiMeal.setAiMealDescription((prev) => (prev ? prev + " " + text : text)),
    onError: (error: string) =>
      onToast({ title: "Voice Input", description: error, variant: "destructive" }),
  });

  // ── Pro gate for the AI capture surface ───────────────────────────
  // Photo, voice, and Analyze are all Pro-only. Rather than block each
  // control, a free tap on any of them opens a full-screen explainer that
  // sells AI photo + natural-language tracking before the paywall.
  const { isPremium, isSubscriptionResolved } = useSubscription();
  const prefersReduced = useReducedMotion();
  const [aiUpsellOpen, setAiUpsellOpen] = useState(false);
  // Treat an unresolved subscription as unlocked to avoid a lock flash on
  // cold start (mirrors ProGate's own behaviour).
  const aiLocked = isSubscriptionResolved && !isPremium;
  const openAiUpsell = () => {
    triggerHapticSelection();
    // Close the bottom sheet first. The Sheet renders in a Radix portal that
    // wins the stacking order, so leaving it open hides the full-screen
    // explainer behind it. QuickAddDialog stays mounted (NutritionPage owns
    // it) and NutritionProDialog is a sibling holding its own open state, so
    // the explainer stays up after the sheet closes.
    onOpenChange(false);
    setAiUpsellOpen(true);
  };

  // ── Keyboard padding ──────────────────────────────────────────────
  const { keyboardHeight } = useKeyboardAware();

  // ── Computed display values for the wizard confirm card ────────────
  const detectedName = useMemo(() => {
    if (manualMeal.meal_name?.trim()) return manualMeal.meal_name.trim();
    if (aiMeal.aiLineItems.length > 0) {
      const names = aiMeal.aiLineItems
        .map((i) => i.name?.trim())
        .filter((n): n is string => !!n);
      if (names.length === 1) return names[0];
      if (names.length === 2) return `${names[0]} & ${names[1]}`;
      if (names.length > 2) return `${names[0]} + ${names.length - 1} more`;
    }
    return "";
  }, [manualMeal.meal_name, aiMeal.aiLineItems]);

  const detectedKcal = useMemo(
    () =>
      aiMeal.overrideTotals.calories ??
      aiMeal.aiLineItems.reduce((s, i) => s + i.calories, 0),
    [aiMeal.overrideTotals.calories, aiMeal.aiLineItems],
  );
  const detectedProtein = useMemo(
    () =>
      aiMeal.overrideTotals.protein_g ??
      aiMeal.aiLineItems.reduce((s, i) => s + i.protein_g, 0),
    [aiMeal.overrideTotals.protein_g, aiMeal.aiLineItems],
  );
  const detectedCarbs = useMemo(
    () =>
      aiMeal.overrideTotals.carbs_g ??
      aiMeal.aiLineItems.reduce((s, i) => s + i.carbs_g, 0),
    [aiMeal.overrideTotals.carbs_g, aiMeal.aiLineItems],
  );
  const detectedFat = useMemo(
    () =>
      aiMeal.overrideTotals.fats_g ??
      aiMeal.aiLineItems.reduce((s, i) => s + i.fats_g, 0),
    [aiMeal.overrideTotals.fats_g, aiMeal.aiLineItems],
  );

  // ── Handlers ──────────────────────────────────────────────────────
  const handleAnalyze = () => {
    if (aiLocked) {
      openAiUpsell();
      return;
    }
    if (isListening) stopListening();
    if (aiMeal.photoBase64) aiMeal.handlePhotoAnalyze();
    else aiMeal.handleAiAnalyzeMeal();
  };

  const handleVoiceToggle = () => {
    if (aiLocked) {
      openAiUpsell();
      return;
    }
    if (isListening) stopListening();
    else startListening();
  };

  const handleManualSwap = () => {
    triggerHapticSelection();
    setManualOverride(true);
  };

  const handleBackToAi = () => {
    triggerHapticSelection();
    setManualOverride(false);
  };

  const handleNotQuite = () => {
    triggerHapticSelection();
    // Reopen the describe input prefilled with the detected name so the
    // user can correct it. Wipes the in-flight detection so the next
    // "Analyze" tap fires a clean re-analysis.
    aiMeal.setAiMealDescription(detectedName);
    aiMeal.setAiAnalysisComplete(false);
    aiMeal.setAiLineItems([]);
    aiMeal.setOverrideTotals({});
    setConfirmDismissed(false);
    // Focus the input after the next render so the user lands ready to type.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleLooksRight = () => {
    triggerHapticSelection();
    setConfirmDismissed(true);
  };

  const canAnalyze = !aiMeal.aiAnalyzing && (
    !!aiMeal.photoBase64 || aiMeal.aiMealDescription.trim().length > 0
  );

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideClose
        className="p-0 max-h-[92vh] flex flex-col"
        style={{
          paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardHeight}px)`,
        }}
      >
        <VisuallyHidden>
          <SheetTitle>Add a meal</SheetTitle>
        </VisuallyHidden>

        {/* ── Drag handle ──────────────────────────────────────────── */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div
            className="w-10 h-1 rounded-full bg-muted-foreground/25"
            aria-hidden
          />
        </div>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-1 pb-3 shrink-0">
          <h2 className="text-[19px] font-bold tracking-tight text-foreground">
            Add a meal
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="h-9 w-9 -mr-1 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition-colors"
          >
            <Icon name="closeOutline" size={16} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            {mode === "ai-input" && (
              <motion.div
                key="ai-input"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="px-5 pt-1 pb-5 space-y-4"
              >
                <MealTypeSelector
                  value={manualMeal.meal_type}
                  onChange={(v: MealType) =>
                    setManualMeal((prev) => ({ ...prev, meal_type: v }))
                  }
                />

                {/* If the user has a photo already captured, render it as a
                    preview with retake/remove controls; otherwise show the
                    full Snap-photo hero tile. */}
                {aiMeal.photoBase64 ? (
                  <PhotoPreview
                    photoBase64={aiMeal.photoBase64}
                    onClear={() => aiMeal.setPhotoBase64(null)}
                    onRetake={async () => {
                      const result = await aiMeal.capturePhoto();
                      if (result) setPendingCaption(true);
                    }}
                    disabled={aiMeal.aiAnalyzing}
                  />
                ) : (
                  <SnapPhotoHero
                    onTap={async () => {
                      if (aiLocked) {
                        openAiUpsell();
                        return;
                      }
                      const result = await aiMeal.capturePhoto();
                      if (result) setPendingCaption(true);
                    }}
                    disabled={aiMeal.aiAnalyzing}
                  />
                )}

                <DescribeRow
                  ref={inputRef}
                  value={aiMeal.aiMealDescription}
                  onChange={aiMeal.setAiMealDescription}
                  onSubmit={handleAnalyze}
                  disabled={aiMeal.aiAnalyzing}
                  voiceSupported={voiceSupported}
                  isListening={isListening}
                  interimText={interimText}
                  onMicTap={handleVoiceToggle}
                  onFocus={handleInputFocus}
                  placeholder={
                    aiMeal.photoBase64
                      ? "Add details (optional) - e.g. 1 cup brown rice"
                      : "What did you eat?"
                  }
                />

                {aiLocked ? (
                  // Free users: a premium crowned CTA that opens the AI
                  // tracking explainer (photo + natural-language) before the
                  // paywall — replaces ProGate's plain lock button here.
                  <button
                    type="button"
                    onClick={openAiUpsell}
                    aria-label="Upgrade to Pro to unlock AI meal tracking"
                    className="relative w-full h-12 overflow-hidden rounded-2xl text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform"
                  >
                    <span className="relative z-10 inline-flex w-full items-center justify-center gap-2">
                      <Crown
                        className="h-[18px] w-[18px]"
                        strokeWidth={2}
                        fill="currentColor"
                      />
                      Upgrade to Pro
                    </span>
                    {!prefersReduced && (
                      <motion.span
                        aria-hidden
                        className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25"
                        style={{ transform: "skewX(-20deg)" }}
                        initial={{ x: "-120%" }}
                        animate={{ x: "440%" }}
                        transition={{
                          duration: 1.1,
                          ease: "easeOut",
                          repeat: Infinity,
                          repeatDelay: 2.8,
                          delay: 1.1,
                        }}
                      />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={!canAnalyze}
                    className="w-full h-12 rounded-2xl text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
                  >
                    {aiMeal.aiAnalyzing ? (
                      <span className="inline-flex items-center gap-2">
                        <Icon name="syncOutline" size={16} className="animate-spin" />
                        Analyzing…
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        Analyze
                        <Icon name="arrowForwardOutline" size={16} />
                      </span>
                    )}
                  </button>
                )}

                {/* Small "Or log manually →" link. Mid-bottom, low-emphasis
                    so it doesn't compete with Analyze. */}
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={handleManualSwap}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary/80 active:text-primary px-2 py-1 rounded-md transition-colors"
                  >
                    Or log manually
                    <Icon name="arrowForwardOutline" size={11} />
                  </button>
                </div>
              </motion.div>
            )}

            {mode === "caption" && aiMeal.photoBase64 && (
              <CaptionStep
                key="caption"
                imageBase64={aiMeal.photoBase64}
                imagePreviewUrl={`data:image/jpeg;base64,${aiMeal.photoBase64}`}
                description={aiMeal.aiMealDescription}
                onDescriptionChange={aiMeal.setAiMealDescription}
                onAnalyze={(description) => {
                  // Caption value is already mirrored into aiMealDescription via
                  // onDescriptionChange — handlePhotoAnalyze reads from there.
                  // Setting it again here is defensive (covers any race where the
                  // textarea's last keystroke hasn't flushed yet).
                  aiMeal.setAiMealDescription(description);
                  setPendingCaption(false);
                  aiMeal.handlePhotoAnalyze();
                }}
                onRetake={async () => {
                  // Drop the current photo and re-fire the camera. If the user
                  // cancels the second capture we land back in ai-input.
                  aiMeal.setPhotoBase64(null);
                  setPendingCaption(false);
                  const result = await aiMeal.capturePhoto();
                  if (result) setPendingCaption(true);
                }}
                extraPhotos={aiMeal.extraPhotos}
                onAddAngle={() => aiMeal.addExtraPhoto()}
                onRemoveAngle={(i) => aiMeal.removeExtraPhoto(i)}
                onToast={onToast}
              />
            )}

            {mode === "scanning" && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="px-5 pt-1 pb-5 space-y-4"
              >
                <ScanOverlay photoBase64={aiMeal.photoBase64} />
                {aiTask && (
                  <button
                    type="button"
                    onClick={() => {
                      onCancelAi();
                      onDismissTask(aiTask.id);
                    }}
                    className="w-full h-11 rounded-2xl bg-muted/40 text-muted-foreground text-[13px] font-semibold active:bg-muted/60 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </motion.div>
            )}

            {mode === "thinking" && (
              <WizardCookingOverlay
                key="thinking"
                description={aiMeal.aiMealDescription}
                onCancel={onCancelAi}
              />
            )}

            {mode === "confirm" && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
                className="px-5 pt-1 pb-5"
              >
                <WizardConfirmCard
                  detectedName={detectedName}
                  kcal={detectedKcal}
                  proteinG={detectedProtein}
                  carbsG={detectedCarbs}
                  fatG={detectedFat}
                  onConfirm={handleLooksRight}
                  onReject={handleNotQuite}
                />
              </motion.div>
            )}

            {mode === "macros" && (
              <motion.div
                key="macros"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="px-5 pt-1 pb-5"
              >
                <MacrosEditor
                  manualMeal={manualMeal}
                  setManualMeal={setManualMeal}
                  aiLineItems={aiMeal.aiLineItems}
                  setAiLineItems={aiMeal.setAiLineItems}
                  overrideTotals={aiMeal.overrideTotals}
                  setOverrideTotals={aiMeal.setOverrideTotals}
                  photoBase64={aiMeal.photoBase64}
                  savingMeal={savingMeal}
                  onSave={aiMeal.handleSaveAiMeal}
                  canAddAngle={
                    !!aiMeal.photoBase64 &&
                    aiMeal.extraPhotos.length < 2 &&
                    aiMeal.aiLineItems.some((i) => i.confidence === "low")
                  }
                  onAddAngle={async () => {
                    const added = await aiMeal.addExtraPhoto();
                    if (added) aiMeal.handlePhotoAnalyze();
                  }}
                />
              </motion.div>
            )}

            {mode === "manual" && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.22 }}
              >
                <ManualLogPanel
                  mealTime={(manualMeal.meal_type as MealType) ?? "breakfast"}
                  onClose={() => onOpenChange(false)}
                  onBackToAi={handleBackToAi}
                  onSaveMeal={onSaveManualMeal}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>

      {/* Full-screen "what you get" explainer for the AI capture surface.
          Renders above the sheet (z-[10000], opaque) so a free tap on photo /
          voice / Analyze shows the value before the paywall. */}
      <NutritionProDialog open={aiUpsellOpen} onOpenChange={setAiUpsellOpen} />
    </>
  );
}

// ── PhotoPreview ─────────────────────────────────────────────────────
// Used in the ai-input mode when the user already snapped a photo but
// hasn't analyzed yet. Provides retake + clear controls.
function PhotoPreview({
  photoBase64,
  onClear,
  onRetake,
  disabled,
}: {
  photoBase64: string;
  onClear: () => void;
  onRetake: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="relative rounded-2xl overflow-hidden"
    >
      <img
        src={`data:image/jpeg;base64,${photoBase64}`}
        alt="Captured meal"
        className="w-full h-44 object-cover"
      />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove photo"
        className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/55 flex items-center justify-center backdrop-blur active:scale-95 transition-transform"
      >
        <Icon name="closeOutline" size={14} className="text-white" />
      </button>
      <button
        type="button"
        onClick={() => onRetake()}
        disabled={disabled}
        className="absolute bottom-2 right-2 h-8 px-2.5 rounded-full bg-black/55 flex items-center gap-1 backdrop-blur text-white text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-40"
      >
        <Icon name="cameraOutline" size={12} /> Retake
      </button>
    </motion.div>
  );
}

