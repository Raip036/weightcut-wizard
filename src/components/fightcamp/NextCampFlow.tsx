import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Loader2 } from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection, celebrateSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { NewCampWelcomeCutscene } from "./NewCampWelcomeCutscene";

/**
 * Two-stage flow used everywhere the user starts a new fight camp without
 * having to re-do the full first-time onboarding:
 *
 *   Stage A — WrapUp:    if there's a current camp, ask the user how the
 *                        fight went so the schema's retrospective fields
 *                        (endWeightKg, performanceFeeling, etc.) get filled
 *                        and the camp is marked isCompleted=true. The user
 *                        can skip this and just create the next camp if
 *                        they don't want to reflect.
 *
 *   Stage B — NextCamp:  a slim five-step wizard for the new camp. Re-uses
 *                        the user's existing profile (age, sex, height,
 *                        training frequency, sport) so they only re-enter
 *                        the fight-specific bits: name, fight date, target
 *                        weight, weigh-in style, current weight.
 *
 * Reusable from FightCamps page CTA and the Dashboard post-fight banner.
 */
interface NextCampFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Active camp at the moment the user opened the flow. If null, we skip
   * straight to Stage B (no camp to wrap up).
   */
  activeCamp: {
    _id: Id<"fight_camps">;
    name: string;
    fightDate: string;
    isCompleted?: boolean;
  } | null;
  /** Called after a new camp is successfully created. */
  onCreated?: (newCampId: Id<"fight_camps">) => void;
}

type Stage = "wrapup" | "wizard";

// Short, punchy one-liners the mascot says alongside each wizard step. Keyed
// by the step's `key` so they stay in sync if the step order ever changes.
const STEP_PROMPTS: Record<string, string> = {
  name: "Let's name this camp.",
  fightDate: "When's fight night?",
  targetWeightKg: "What do you weigh in at?",
  walkAroundWeightKg: "Your walk-around weight?",
  weighInTiming: "How's the weigh-in run?",
  currentWeightKg: "And today's weight?",
};

const PERFORMANCE_CHIPS = [
  { value: "won_strong",   label: "Won, felt strong" },
  { value: "won_drained",  label: "Won, drained" },
  { value: "lost_strong",  label: "Lost, felt strong" },
  { value: "lost_drained", label: "Lost, drained" },
  { value: "no_show",      label: "Didn't compete" },
];

const WEIGH_IN_CHIPS = [
  { value: "day_before",  label: "Day before" },
  { value: "morning_of",  label: "Morning of" },
  { value: "two_hour",    label: "2-hour rule" },
  { value: "unknown",     label: "Not sure yet" },
];

export function NextCampFlow({ open, onOpenChange, activeCamp, onCreated }: NextCampFlowProps) {
  const { profile } = useUser();
  const { toast } = useToast();
  const navigate = useNavigate();
  const completeCampMut = useMutation(api.fight_camp.completeCamp);
  const createCampMut = useMutation(api.fight_camp.createCampFromOnboarding);
  // After the camp is created we also (a) generate a fresh cut plan from the
  // wizard data, (b) persist it on the profile, and (c) cache it locally so
  // the iOS WebView's occasional storage wipe doesn't lose it. Identical
  // pattern to the first-time onboarding flow so the two flows stay aligned.
  const generateCutPlanAction = useAction(api.actions.generateCutPlan.run);
  const updateGoalsMut = useMutation(api.profiles.updateGoals);

  // Only show the wrap-up stage when there's an actually-incomplete camp.
  // Already-completed camps (or no active camp) skip straight to the wizard.
  const hasOpenCamp = !!activeCamp && !activeCamp.isCompleted;
  const [stage, setStage] = useState<Stage>(hasOpenCamp ? "wrapup" : "wizard");
  useEffect(() => {
    if (open) setStage(hasOpenCamp ? "wrapup" : "wizard");
  }, [open, hasOpenCamp]);

  // Wrap-up state
  const [endWeight, setEndWeight] = useState("");
  const [performance, setPerformance] = useState<string>("");
  const [notes, setNotes] = useState("");
  // Cut breakdown — how the total drop was achieved. Feeds the camp's
  // weightViaDehydration / weightViaCarbReduction fields (the "Breakdown" on
  // the camp detail page) so it's filled in automatically at wrap-up.
  const [dehydrationKg, setDehydrationKg] = useState("");
  const [dietKg, setDietKg] = useState("");
  const [wrappingUp, setWrappingUp] = useState(false);

  // Wizard state. `targetWeightKg` = fight-day weight (goal_weight_kg).
  // `walkAroundWeightKg` = pre-dehydration weight (fight_week_target_kg) —
  // i.e. the body weight the user should *actually* be carrying at the start
  // of fight week before the water/carb cut drops them to the goal weight.
  // We pre-fill walkAround from the goal using a 5.5% water-cut estimate
  // (amateur default; mirrors the onboarding heuristic) and let the user
  // override it on its own wizard step.
  const [step, setStep] = useState(0);
  const [wizardData, setWizardData] = useState({
    name: "",
    fightDate: "",
    targetWeightKg: "",
    walkAroundWeightKg: "",
    weighInTiming: "",
    currentWeightKg: profile?.current_weight_kg ? String(profile.current_weight_kg) : "",
  });
  const [walkAroundAuto, setWalkAroundAuto] = useState(true);
  const [creating, setCreating] = useState(false);

  // Full-screen welcome cutscene state. Once `welcome` is set, the sheet is
  // closed and the cutscene overlay takes over while the cut plan generates
  // in the background. `planReady` flips true in the `finally` of the
  // generation pipeline so the cutscene's CTA enables whether the plan
  // succeeded or failed.
  const [welcome, setWelcome] = useState<{
    campName: string;
    targets: {
      currentWeight: number;
      targetWeight: number;
      weightToCut: number;
      daysToFight: number;
      weeks: number;
    };
  } | null>(null);
  const [planReady, setPlanReady] = useState(false);

  const handleSeePlan = () => {
    setWelcome(null);
    navigate("/cut-plan");
  };
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setWizardData({
      name: "",
      fightDate: "",
      targetWeightKg: "",
      walkAroundWeightKg: "",
      weighInTiming: "",
      currentWeightKg: profile?.current_weight_kg ? String(profile.current_weight_kg) : "",
    });
    setWalkAroundAuto(true);
    setEndWeight("");
    setPerformance("");
    setNotes("");
    setDehydrationKg("");
    setDietKg("");
  }, [open, profile?.current_weight_kg]);

  // Re-estimate the walk-around weight any time the target changes IF the
  // user hasn't manually edited it. 5.5% buffer matches the "amateur" tier
  // the onboarding wizard uses as its mid-point — safe enough for most
  // hobbyists and amateurs, easily overridden by pros.
  useEffect(() => {
    if (!walkAroundAuto) return;
    const t = parseFloat(wizardData.targetWeightKg);
    if (!Number.isFinite(t) || t <= 0) return;
    const estimate = Math.round(t * 1.055 * 10) / 10;
    setWizardData((d) => ({ ...d, walkAroundWeightKg: String(estimate) }));
  }, [wizardData.targetWeightKg, walkAroundAuto]);

  const wizardSteps = useMemo(() => [
    { key: "name",                label: "Name your camp",                  placeholder: "e.g. Smith fight" },
    { key: "fightDate",           label: "Fight date",                      placeholder: "" },
    { key: "targetWeightKg",      label: "Fight day weight (kg)",           placeholder: "e.g. 70" },
    { key: "walkAroundWeightKg",  label: "Walk-around weight (kg)",         placeholder: "" },
    { key: "weighInTiming",       label: "Weigh-in style",                  placeholder: "" },
    { key: "currentWeightKg",     label: "Current weight (kg)",             placeholder: "e.g. 76" },
  ] as const, []);

  const currentStep = wizardSteps[step];
  const isLastStep = step === wizardSteps.length - 1;

  const canAdvance = () => {
    const v = wizardData[currentStep.key as keyof typeof wizardData];
    return typeof v === "string" && v.trim().length > 0;
  };

  const advance = () => {
    triggerHapticSelection();
    if (isLastStep) submitWizard();
    else setStep((s) => s + 1);
  };

  const submitWrapUp = async (skip: boolean) => {
    if (!activeCamp) {
      setStage("wizard");
      return;
    }
    setWrappingUp(true);
    try {
      if (!skip) {
        // Cut breakdown → camp fields. Total is the sum of the two reported
        // components (water + diet) so the camp's CUT total and its breakdown
        // stay self-consistent.
        const dehy = parseFloat(dehydrationKg);
        const diet = parseFloat(dietKg);
        const hasDehy = Number.isFinite(dehy) && dehy >= 0;
        const hasDiet = Number.isFinite(diet) && diet >= 0;
        const breakdownTotal =
          (hasDehy ? dehy : 0) + (hasDiet ? diet : 0);
        await completeCampMut({
          id: activeCamp._id,
          endWeightKg: endWeight ? parseFloat(endWeight) : undefined,
          performanceFeeling: performance || undefined,
          rehydrationNotes: notes.trim() || undefined,
          ...(hasDehy ? { weightViaDehydration: +dehy.toFixed(1) } : {}),
          ...(hasDiet ? { weightViaCarbReduction: +diet.toFixed(1) } : {}),
          ...(hasDehy || hasDiet
            ? { totalWeightCut: +breakdownTotal.toFixed(1) }
            : {}),
        });
      } else {
        await completeCampMut({ id: activeCamp._id });
      }
      setStage("wizard");
    } catch (err) {
      logger.warn("Wrap-up camp failed", { error: err });
      toast({ title: "Couldn't save", description: "Check your connection and try again.", variant: "destructive" });
    } finally {
      setWrappingUp(false);
    }
  };

  const submitWizard = async () => {
    // Guard against NaN coercion before doing any writes — an empty or
    // non-numeric input here would silently propagate to the cut plan
    // generator and the profile mutation as NaN, polluting both.
    const currentWeight = parseFloat(wizardData.currentWeightKg);
    const targetWeight = parseFloat(wizardData.targetWeightKg);
    const walkAroundWeightRaw = parseFloat(wizardData.walkAroundWeightKg);
    if (!Number.isFinite(currentWeight) || !Number.isFinite(targetWeight)) {
      toast({
        title: "Missing weights",
        description: "Please enter both your current weight and your fight-day target before continuing.",
        variant: "destructive",
      });
      return;
    }

    // If walk-around is empty/non-numeric or somehow lower than the target,
    // fall back to the 5.5% buffer so plan generation has a meaningful
    // pre-cut number rather than the goal weight (which would skip the
    // dehydration/carb phase entirely).
    const safeWalkAround = Number.isFinite(walkAroundWeightRaw) && walkAroundWeightRaw >= targetWeight
      ? walkAroundWeightRaw
      : Math.round(targetWeight * 1.055 * 10) / 10;

    const campName = wizardData.name.trim();

    setCreating(true);
    try {
      // (a) Create the camp first — cheap, transactional.
      const newId = await createCampMut({
        name: campName,
        fightDate: wizardData.fightDate,
        weighInTiming: wizardData.weighInTiming || undefined,
        startingWeightKg: wizardData.currentWeightKg ? currentWeight : undefined,
      });
      celebrateSuccess();
      onCreated?.(newId as Id<"fight_camps">);
    } catch (err) {
      logger.warn("Create camp from wizard failed", { error: err });
      toast({ title: "Couldn't start camp", description: "Check your connection and try again.", variant: "destructive" });
      setCreating(false);
      return;
    }
    setCreating(false);

    // Camp exists — compute the headline targets from the wizard inputs (all
    // available immediately) and hand off to the full-screen welcome cutscene.
    // The cut plan keeps generating in the background; the cutscene's CTA
    // enables once `planReady` flips true.
    const daysToFight = Math.max(
      1,
      Math.ceil((Date.parse(wizardData.fightDate) - Date.now()) / 86400000),
    );
    const weeks = Math.max(1, Math.min(20, Math.ceil(daysToFight / 7)));
    const weightToCut = Math.max(0, Math.round((currentWeight - targetWeight) * 10) / 10);
    const targets = { currentWeight, targetWeight, weightToCut, daysToFight, weeks };

    setPlanReady(false);
    setWelcome({ campName, targets });
    onOpenChange(false); // close the sheet so the cutscene takes over

    const age = profile?.age ?? 25;
    const sex: "male" | "female" = (profile?.sex === "female" ? "female" : "male");
    const heightCm = profile?.height_cm ?? 175;
    const activityLevel = profile?.activity_level ?? "moderately_active";

    try {
      // (b) Generate the cut plan BEFORE writing new targets to the profile.
      // If this fails, we don't want the profile to be left pointing at the
      // new fight while still carrying the old plan — better to keep the
      // profile in sync with the data the rest of the app will read.
      let planData: any = null;
      try {
        planData = await generateCutPlanAction({
          currentWeight,
          goalWeight: targetWeight,
          fightWeekTargetKg: safeWalkAround,
          targetDate: wizardData.fightDate,
          age,
          sex,
          heightCm,
          activityLevel,
          weighInTiming: wizardData.weighInTiming || undefined,
        });
      } catch (planError) {
        logger.warn("Cut plan generation failed in NextCampFlow", { error: planError });
      }

      const plan = planData?.plan || planData;
      const planPayload = plan?.weeklyPlan
        ? {
            ...plan,
            campName,
            currentWeight,
            goalWeight: targetWeight,
            targetDate: wizardData.fightDate,
          }
        : null;

      if (planPayload) {
        try {
          localStorage.setItem("wcw_cut_plan", JSON.stringify(planPayload));
        } catch { /* iOS WebView may block; non-fatal */ }
      }

      // (c) ONE consolidated profile write — targets AND plan together so
      // they can never end up in a "new targets, stale plan" state. If the
      // plan failed we still write the new targets (camp already exists),
      // but we DON'T clobber `cutPlanJson` with null.
      const week1 = planPayload?.weeklyPlan?.[0];
      try {
        await updateGoalsMut({
          goalWeightKg: targetWeight,
          fightWeekTargetKg: safeWalkAround,
          targetDate: wizardData.fightDate,
          ...(planPayload ? { cutPlanJson: planPayload } : {}),
          ...(week1
            ? {
                aiRecommendedCalories: week1.calories,
                aiRecommendedProteinG: week1.protein_g,
                aiRecommendedCarbsG: week1.carbs_g,
                aiRecommendedFatsG: week1.fats_g,
              }
            : {}),
        });
        if (planPayload) {
          toast({
            title: "Targets and cut plan saved",
            description: "Your new fight weights and plan are on your profile.",
          });
        } else {
          // Plan generation failed — camp + targets are saved, user can re-run
          // generation from the Goals page.
          toast({
            title: "New camp started",
            description: `${campName} — ${wizardData.fightDate}`,
          });
        }
      } catch (saveErr) {
        logger.warn("Save targets + cut plan to profile failed", { error: saveErr });
      }
    } finally {
      // Enable the cutscene's "See plan" CTA whether the plan succeeded or
      // failed — the camp + targets are already saved either way.
      setPlanReady(true);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] p-0 border-t border-border/50 bg-card/95 backdrop-blur-xl gap-0"
      >
        <div className="px-5 pt-5 pb-2">
          <SheetHeader>
            <SheetTitle className="text-[17px] font-semibold tracking-tight text-center">
              {stage === "wrapup" ? "Wrap up your camp" : "Start your next camp"}
            </SheetTitle>
          </SheetHeader>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {stage === "wrapup" && activeCamp && (
            <motion.div
              key="wrapup"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="px-5 pb-5 space-y-4"
            >
              <p className="text-[12px] text-muted-foreground text-center leading-snug">
                Quick reflection on <span className="font-semibold text-foreground">{activeCamp.name}</span>.
                Helps the app learn what worked. Skip anything you don't want to share.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                    End weight (kg)
                  </label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={endWeight}
                    onChange={(e) => setEndWeight(e.target.value)}
                    placeholder="What you weighed on fight day"
                    className="h-11 rounded-xs"
                  />
                </div>

                {/* Cut breakdown — auto-fills the camp's "Breakdown" field. */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                      Via dehydration (kg)
                    </label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={dehydrationKg}
                      onChange={(e) => setDehydrationKg(e.target.value)}
                      placeholder="Water cut"
                      className="h-11 rounded-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                      Via diet (kg)
                    </label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={dietKg}
                      onChange={(e) => setDietKg(e.target.value)}
                      placeholder="Carbs, fibre, sodium"
                      className="h-11 rounded-xs"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground/70 -mt-1 leading-snug">
                  Splits your total cut into water vs diet, saved to the camp breakdown.
                </p>

                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                    How did it go?
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PERFORMANCE_CHIPS.map((p) => {
                      const active = performance === p.value;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => { triggerHapticSelection(); setPerformance(p.value); }}
                          aria-pressed={active}
                          className={`h-9 rounded-xs text-[12px] font-semibold transition-colors ${
                            active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/85 active:bg-muted/60"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                    Notes (optional)
                  </label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What worked? What to change next time?"
                    className="h-11 rounded-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={wrappingUp}
                  onClick={() => submitWrapUp(true)}
                  className="flex-1 h-11 rounded-xs"
                >
                  Skip
                </Button>
                <Button
                  type="button"
                  disabled={wrappingUp}
                  onClick={() => submitWrapUp(false)}
                  className="flex-1 h-11 rounded-xs"
                >
                  {wrappingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save & continue"}
                </Button>
              </div>
            </motion.div>
          )}

          {stage === "wizard" && (
            <motion.div
              key="wizard"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="px-5 pb-5 space-y-4"
            >
              {/* Slim gradient progress bar + step counter */}
              <div className="space-y-1.5">
                <div className="h-1.5 w-full rounded-full bg-muted-foreground/15 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-brand-spirit-blue to-primary"
                    initial={false}
                    animate={{ width: `${((step + 1) / wizardSteps.length) * 100}%` }}
                    transition={{ type: "spring", damping: 24, stiffness: 280 }}
                  />
                </div>
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70 text-center">
                  Step {step + 1} of {wizardSteps.length}
                </p>
              </div>

              {/* Mascot companion + encouraging one-liner */}
              <div className="flex items-center gap-3">
                <div className="relative h-[76px] w-[76px] shrink-0 overflow-visible">
                  <div className="absolute inset-0 flex items-center justify-center scale-[0.52] origin-center">
                    <WizardCharacter pose={step === wizardSteps.length - 1 ? "point" : "idle"} />
                  </div>
                </div>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={currentStep.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22 }}
                    className="text-[14px] font-semibold text-foreground/90 leading-snug"
                  >
                    {STEP_PROMPTS[currentStep.key] ?? currentStep.label}
                  </motion.p>
                </AnimatePresence>
              </div>

              <div className="min-h-[120px] flex flex-col justify-center">
                <h3 className="text-[20px] font-bold tracking-tight text-foreground text-center">
                  {currentStep.label}
                </h3>

                <div className="mt-4">
                  {currentStep.key === "fightDate" ? (
                    <Input
                      type="date"
                      min={todayIso}
                      value={wizardData.fightDate}
                      onChange={(e) => setWizardData((d) => ({ ...d, fightDate: e.target.value }))}
                      className="h-12 rounded-xs text-center"
                    />
                  ) : currentStep.key === "weighInTiming" ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      {WEIGH_IN_CHIPS.map((w) => {
                        const active = wizardData.weighInTiming === w.value;
                        return (
                          <button
                            key={w.value}
                            type="button"
                            onClick={() => {
                              triggerHapticSelection();
                              setWizardData((d) => ({ ...d, weighInTiming: w.value }));
                            }}
                            aria-pressed={active}
                            className={`h-11 rounded-xs text-[13px] font-semibold transition-colors ${
                              active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/85 active:bg-muted/60"
                            }`}
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : currentStep.key === "name" ? (
                    <Input
                      autoFocus
                      value={wizardData.name}
                      onChange={(e) => setWizardData((d) => ({ ...d, name: e.target.value }))}
                      placeholder={currentStep.placeholder}
                      className="h-12 rounded-xs text-center text-[16px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canAdvance()) advance();
                      }}
                    />
                  ) : currentStep.key === "walkAroundWeightKg" ? (
                    <div className="space-y-2">
                      <p className="text-[12px] text-muted-foreground text-center leading-snug px-2">
                        This is your weight at the start of fight week, before
                        any water or carb cut. We've estimated it from your
                        fight-day target. Tweak it if your usual walk-around
                        weight runs higher or lower.
                      </p>
                      <Input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        value={wizardData.walkAroundWeightKg}
                        onChange={(e) => {
                          setWalkAroundAuto(false);
                          setWizardData((d) => ({ ...d, walkAroundWeightKg: e.target.value }));
                        }}
                        placeholder="kg"
                        className="h-12 rounded-xs text-center text-[16px] tabular-nums"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && canAdvance()) advance();
                        }}
                      />
                      <div className="flex items-center justify-center gap-2 pt-0.5">
                        {walkAroundAuto ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
                            <Sparkles className="h-3 w-3" />
                            Auto estimate
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticSelection();
                              setWalkAroundAuto(true);
                              const t = parseFloat(wizardData.targetWeightKg);
                              if (Number.isFinite(t) && t > 0) {
                                const estimate = Math.round(t * 1.055 * 10) / 10;
                                setWizardData((d) => ({ ...d, walkAroundWeightKg: String(estimate) }));
                              }
                            }}
                            className="text-[11px] font-semibold text-primary/80 active:text-primary uppercase tracking-wider"
                          >
                            Reset to auto
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={wizardData[currentStep.key as keyof typeof wizardData]}
                      onChange={(e) =>
                        setWizardData((d) => ({ ...d, [currentStep.key]: e.target.value }))
                      }
                      placeholder={currentStep.placeholder}
                      className="h-12 rounded-xs text-center text-[16px] tabular-nums"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canAdvance()) advance();
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { triggerHapticSelection(); setStep((s) => s - 1); }}
                    className="h-11 rounded-xs px-5"
                  >
                    Back
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={!canAdvance() || creating}
                  onClick={advance}
                  className={`flex-1 rounded-xs ${
                    isLastStep ? "h-12 text-[15px] font-bold shadow-lg shadow-primary/20" : "h-11"
                  }`}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isLastStep ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" />
                      Create my camp
                    </span>
                  ) : (
                    "Next"
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>

    {/* Full-screen welcome cutscene — renders its own fixed portal and takes
        over once the sheet closes. CTA enables when `planReady` flips true. */}
    {welcome && (
      <NewCampWelcomeCutscene
        campName={welcome.campName}
        targets={welcome.targets}
        planReady={planReady}
        onSeePlan={handleSeePlan}
      />
    )}
    </>
  );
}
