import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection, celebrateSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";

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

type Stage = "wrapup" | "wizard" | "generating" | "done";

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
        await completeCampMut({
          id: activeCamp._id,
          endWeightKg: endWeight ? parseFloat(endWeight) : undefined,
          performanceFeeling: performance || undefined,
          rehydrationNotes: notes.trim() || undefined,
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

    setCreating(true);
    try {
      // (a) Create the camp first — cheap, transactional.
      const newId = await createCampMut({
        name: wizardData.name.trim(),
        fightDate: wizardData.fightDate,
        weighInTiming: wizardData.weighInTiming || undefined,
        startingWeightKg: wizardData.currentWeightKg ? currentWeight : undefined,
      });
      celebrateSuccess();
      onCreated?.(newId as Id<"fight_camps">);

      // Switch to the generating screen so the user has visible feedback
      // while the Convex action does its run (~5-8s typically). The dialog
      // stays open through the whole sequence so the user can tap the plan
      // preview the moment it lands.
      setStage("generating");
      setCreating(false);

      const age = profile?.age ?? 25;
      const sex: "male" | "female" = (profile?.sex === "female" ? "female" : "male");
      const heightCm = profile?.height_cm ?? 175;
      const activityLevel = profile?.activity_level ?? "moderately_active";

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
        });
      } catch (planError) {
        logger.warn("Cut plan generation failed in NextCampFlow", { error: planError });
      }

      const plan = planData?.plan || planData;
      const planPayload = plan?.weeklyPlan
        ? {
            ...plan,
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
        }
      } catch (saveErr) {
        logger.warn("Save targets + cut plan to profile failed", { error: saveErr });
      }

      if (planPayload) {
        setStage("done");
        // Close the dialog and drop the user on /cut-plan so they actually
        // see the freshly-generated plan. A brief delay lets the success
        // animation play before the route change.
        setTimeout(() => {
          onOpenChange(false);
          navigate("/cut-plan");
        }, 800);
      } else {
        // Plan generation failed — camp + targets are saved, user can re-run
        // generation from the Goals page.
        toast({
          title: "New camp started",
          description: `${wizardData.name} — ${wizardData.fightDate}`,
        });
        setStage("done");
        setTimeout(() => onOpenChange(false), 1100);
      }
    } catch (err) {
      logger.warn("Create camp from wizard failed", { error: err });
      toast({ title: "Couldn't start camp", description: "Check your connection and try again.", variant: "destructive" });
      setCreating(false);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[420px] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-[28px] p-0 border-0 bg-card/95 backdrop-blur-xl shadow-2xl gap-0">
        <div className="px-5 pt-5 pb-2">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold tracking-tight text-center">
              {stage === "wrapup" ? "Wrap up your camp" : stage === "wizard" ? "Start your next camp" : "All set"}
            </DialogTitle>
          </DialogHeader>
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
              {/* Progress dots */}
              <div className="flex items-center justify-center gap-1.5">
                {wizardSteps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i < step ? "w-6 bg-primary" : i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/25"
                    }`}
                  />
                ))}
              </div>

              <div className="min-h-[120px] flex flex-col justify-center">
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70 text-center">
                  {step + 1} of {wizardSteps.length}
                </p>
                <h3 className="text-[20px] font-bold tracking-tight text-foreground text-center mt-1">
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
                  className="flex-1 h-11 rounded-xs"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isLastStep ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" />
                      Start camp
                    </span>
                  ) : (
                    "Next"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {stage === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="px-5 pb-7 pt-2 flex flex-col items-center gap-3 text-center"
            >
              <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-primary animate-spin" strokeWidth={2.4} />
              </div>
              <div className="space-y-0.5">
                <p className="text-[15px] font-semibold text-foreground">Generating your cut plan</p>
                <p className="text-[12px] text-muted-foreground">Tailored to your fight date and target weight. Saving to your profile.</p>
              </div>
            </motion.div>
          )}

          {stage === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", damping: 22, stiffness: 320 }}
              className="px-5 pb-7 pt-2 flex flex-col items-center gap-2 text-center"
            >
              <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="h-6 w-6 text-emerald-400" strokeWidth={2.6} />
              </div>
              <p className="text-[15px] font-semibold text-foreground">Camp ready</p>
              <p className="text-[12px] text-muted-foreground">Targets and dashboard are updated.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
