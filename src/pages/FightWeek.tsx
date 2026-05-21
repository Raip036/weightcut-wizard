import { useEffect, useState, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { addDays, differenceInDays, format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/contexts/UserContext";
import { AIPersistence } from "@/lib/aiPersistence";
import { createAIAbortController } from "@/lib/timeoutWrapper";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { localCache } from "@/lib/localCache";
import { computeFightWeekPlan, type FightWeekProjection, type DayProjection } from "@/utils/fightWeekEngine";
import { WeightCutBreakdownCard } from "@/components/fightweek/WeightCutBreakdownCard";
import { DehydrationRingPanel } from "@/components/fightweek/DehydrationRingPanel";
import { ProjectionChart } from "@/components/fightweek/ProjectionChart";
import { DayTimelineCard } from "@/components/fightweek/DayTimelineCard";
import { WaterLoadingCard, type WaterLoadingData } from "@/components/fightweek/WaterLoadingCard";
import { ManipulationCard, type SodiumStrategy, type FibreStrategy } from "@/components/fightweek/ManipulationCard";
import { DehydrationTacticsCard, type DehydrationTactic } from "@/components/fightweek/DehydrationTacticsCard";
import { PostWeighInCard, type PostWeighInData } from "@/components/fightweek/PostWeighInCard";
import { sanitizeAIText } from "@/lib/sanitizeAIText";
import { Activity, Shield, CheckCircle, AlertTriangle, Info, Trash2, Crown, Sparkles, Minus, Plus, ChevronRight } from "lucide-react";
import wizardLogo from "@/assets/wizard-tutorial.png";
import { triggerHapticSelection } from "@/lib/haptics";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { FightWeekSummaryCard } from "@/components/share/cards/FightWeekSummaryCard";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { ToastAction } from "@/components/ui/toast";
import { createElement } from "react";
import { logger } from "@/lib/logger";
import { FightWeekSkeleton } from "@/components/fight-week/FightWeekSkeleton";

interface DBPlan {
  id: string;
  fight_date: string;
  starting_weight_kg: number;
  target_weight_kg: number;
}

export interface FightWeekAIPlan {
  summary: string;
  riskLevel: "green" | "orange" | "red";
  safetyWarning: string | null;
  breakdown: {
    totalToCut: number;
    percentBW: number;
    glycogenLoss: number;
    fibreLoss: number;
    sodiumLoss: number;
    waterLoadingLoss: number;
    dietTotal: number;
    dehydrationNeeded: number;
  };
  dehydration: {
    percentBW: number;
    safety: "green" | "orange" | "red";
    saunaSessions: number;
  };
  timeline: DayProjection[];
  // Derived client-side from bodyweight; AI no longer returns these.
  waterLoading?: WaterLoadingData;
  sodiumStrategy?: SodiumStrategy;
  fibreStrategy?: FibreStrategy;
  dehydrationTactics: DehydrationTactic[];
  postWeighIn: PostWeighInData;
  medicalRedFlags: string[];
}

/**
 * Merge an AI-produced timeline with the deterministic engine timeline.
 * AI entries win where they exist; missing days are filled from the engine
 * with a calorieTarget derived from TDEE using the same rules in the system prompt.
 */
function mergeTimelines(
  aiTimeline: DayProjection[],
  engineTimeline: DayProjection[],
  tdee: number | undefined,
): DayProjection[] {
  const byDay = new Map<number, DayProjection>();
  for (const d of aiTimeline || []) byDay.set(d.day, d);
  return engineTimeline.map((eng) => {
    const ai = byDay.get(eng.day);
    if (ai) return ai;
    const daysOutAbs = Math.abs(eng.day);
    const baseline = tdee ?? 2000;
    const calorieTarget = daysOutAbs >= 4
      ? Math.round(baseline - 400)
      : Math.max(1500, Math.round(baseline * 0.7));
    return { ...eng, calorieTarget };
  });
}

export default function FightWeek() {
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [daysUntilWeighIn, setDaysUntilWeighIn] = useState("");
  const [normalDailyCarbs, setNormalDailyCarbs] = useState("");

  const [dbPlan, setDbPlan] = useState<DBPlan | null>(null);
  const [aiPlan, setAiPlan] = useState<FightWeekAIPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deletePlanDialogOpen, setDeletePlanDialogOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const handleDeletePlan = () => {
    if (!userId) return;
    setAiPlan(null);
    setLastError(null);
    try { AIPersistence.remove(userId, "fight_week_plan_ai"); } catch { /* swallow */ }
    try { localCache.remove(userId, "fight_week_plan"); } catch { /* swallow */ }
    setDeletePlanDialogOpen(false);
    toast({ title: "Plan deleted", description: "Tweak your stats and generate a fresh protocol." });
  };
  const [lastError, setLastError] = useState<string | null>(null);

  const { toast } = useToast();
  const { userId, profile, refreshProfile } = useUser();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_FIGHT_WEEK_ANALYSIS");
  const { tasks: aiTasks, dismissTask: aiDismiss, addTask, completeTask, failTask } = useAITask();
  const { safeAsync, isMounted } = useSafeAsync();
  const fightWeekAnalysisAction = useAIAction(api.actions.fightWeekAnalysis.run, "AI_FIGHT_WEEK_ANALYSIS");
  const upsertFightWeekPlan = useMutation(api.fight_camp.upsertPlan);
  const updateProfileGoals = useMutation(api.profiles.updateGoals);
  const activePlan = useQuery(api.fight_camp.getActivePlan, userId ? {} : "skip");
  const aiAbortRef = useRef<AbortController | null>(null);

  // Deterministic strategies derived from bodyweight + research thresholds.
  // We compute these client-side instead of asking the AI, since they're simple
  // formulas (saves ~600 tokens per request and prevents LLM number-formatting bugs).
  const derivedStrategies = useMemo(() => {
    const cw = parseFloat(currentWeight);
    const days = parseInt(daysUntilWeighIn);
    if (isNaN(cw) || cw <= 0) return null;

    // Water loading: 100 ml/kg for ~3 load days, then 15 ml/kg taper, then sips on weigh-in.
    // Pull load days from the AI window so a 4-day cut still loads, a 7-day cut loads more.
    const totalDays = isNaN(days) ? 5 : days;
    const loadDays = Math.max(1, Math.min(3, totalDays - 2));
    const dailyMl = Array.from({ length: loadDays }, () => Math.round(cw * 100));
    const taperMl = Math.round(cw * 15);
    const waterLoading = {
      loadDays,
      dailyMl,
      taperMl,
      rationale: `Load at 100 ml per kg (${(cw * 100 / 1000).toFixed(1)} L) for ${loadDays} day${loadDays === 1 ? "" : "s"} to flush aldosterone, then taper to 15 ml per kg the day before weigh-in and sip only on the day. This drives ~0.8% extra body-weight loss on weigh-in morning (Reid et al.).`,
    };

    // Sodium: hold below 2300 mg/day during fight week, never below 1500 mg.
    // 2000 mg/day is the safe middle for an 80 kg fighter and scales gently with size.
    const restrictionMg = Math.max(1500, Math.min(2300, Math.round(25 * cw)));
    const sodiumStrategy = {
      restrictionMg,
      rationale: `Hold sodium under ${restrictionMg} mg per day across the cut. Don't go below 1500 mg, you still sweat sodium. Yields 0.5 to 1% body weight over 3 to 5 days (ISSN 2025).`,
    };

    // Fibre: drop under 10 g/day starting 4 days out (3 if window is short).
    const fibreStart = Math.max(2, Math.min(4, totalDays - 1));
    const fibreStrategy = {
      restrictionG: 8,
      startDaysOut: fibreStart,
      rationale: `Drop fibre under 10 g per day from D-${fibreStart} to clear gut bulk. Expect 0.4 to 0.7% body weight over 4 days, up to 1% over a full week.`,
    };

    return { waterLoading, sodiumStrategy, fibreStrategy };
  }, [currentWeight, daysUntilWeighIn]);

  // Engine projection is kept ONLY as a silent sanity check against the AI output.
  // It is never rendered directly. If the AI drifts we surface a warning banner.
  const engineProjection: FightWeekProjection | null = useMemo(() => {
    const cw = parseFloat(currentWeight);
    const tw = parseFloat(targetWeight);
    const days = parseInt(daysUntilWeighIn);
    if (isNaN(cw) || isNaN(tw) || isNaN(days) || cw <= 0 || tw <= 0 || days < 1 || cw <= tw || days > 14) return null;
    const sex = (profile?.sex as "male" | "female") || "male";
    return computeFightWeekPlan({ currentWeight: cw, targetWeight: tw, daysUntilWeighIn: days, sex });
  }, [currentWeight, targetWeight, daysUntilWeighIn, profile?.sex]);

  const inputsValid = engineProjection !== null;

  // Pre-fill from profile only if no plan exists
  useEffect(() => {
    if (profile && !dbPlan && !currentWeight && !targetWeight) {
      const cw = profile.current_weight_kg;
      const tw = profile.goal_weight_kg;
      if (cw) setCurrentWeight(cw.toString());
      if (tw) setTargetWeight(tw.toString());
    }
  }, [profile?.current_weight_kg, profile?.goal_weight_kg, dbPlan?.id]);

  // Pre-fill carbs from profile
  useEffect(() => {
    if (profile?.normal_daily_carbs_g && !normalDailyCarbs) {
      setNormalDailyCarbs(profile.normal_daily_carbs_g.toString());
    }
  }, [profile?.normal_daily_carbs_g]);

  // Hydrate from Convex reactive query; fall back to cached AI plan body.
  useEffect(() => {
    if (!userId) return;
    if (activePlan !== undefined) {
      if (activePlan) {
        const plan: DBPlan = {
          id: (activePlan as any)._id,
          fight_date: (activePlan as any).fightDate,
          starting_weight_kg: (activePlan as any).startingWeightKg,
          target_weight_kg: (activePlan as any).targetWeightKg,
        };
        hydrateFromPlan(plan);
        localCache.set(userId, "fight_week_plan", plan);
      } else {
        const cached = localCache.get<DBPlan>(userId, "fight_week_plan");
        if (cached) hydrateFromPlan(cached);
      }
      safeAsync(setInitialLoading)(false);
    }
    loadPersistedPlan();
  }, [userId, activePlan, safeAsync]);

  const hydrateFromPlan = (plan: DBPlan) => {
    setDbPlan(plan);
    const daysLeft = Math.max(1, differenceInDays(new Date(plan.fight_date), new Date()));
    setCurrentWeight(plan.starting_weight_kg.toString());
    setTargetWeight(plan.target_weight_kg.toString());
    setDaysUntilWeighIn(Math.min(daysLeft, 14).toString());
  };

  const loadPersistedPlan = () => {
    if (!userId) return;
    const persisted = AIPersistence.load(userId, "fight_week_plan_ai") as FightWeekAIPlan | null;
    if (persisted) setAiPlan(persisted);
  };

  const savePlan = async () => {
    if (!userId || !inputsValid) return;
    safeAsync(setSaving)(true);

    const cw = parseFloat(currentWeight);
    const tw = parseFloat(targetWeight);
    const days = parseInt(daysUntilWeighIn);
    const fightDate = format(addDays(new Date(), days), "yyyy-MM-dd");

    try {
      const planId = await upsertFightWeekPlan({
        fightDate,
        startingWeightKg: cw,
        targetWeightKg: tw,
      });
      if (!isMounted()) return;
      const plan: DBPlan = {
        id: planId as unknown as string,
        fight_date: fightDate,
        starting_weight_kg: cw,
        target_weight_kg: tw,
      };
      setDbPlan(plan);
      localCache.set(userId, "fight_week_plan", plan);
    } catch (err: any) {
      toast({ title: "Error saving plan", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Toast helper with a "Try again" action that re-runs generation.
  const showFailureToast = (title: string, description: string) => {
    toast({
      title,
      description,
      variant: "destructive",
      action: createElement(
        ToastAction,
        { altText: "Try again", onClick: () => { void generateProtocol(); } },
        "Try again",
      ),
    });
  };

  const generateProtocol = async () => {
    if (!userId || !inputsValid) return;

    if (!hasAiAccess) {
      openPaywall();
      return;
    }

    aiAbortRef.current?.abort();
    const controller = createAIAbortController();
    aiAbortRef.current = controller;

    safeAsync(setIsGenerating)(true);
    safeAsync(setLastError)(null);
    // Note: do NOT clear `aiPlan` here — on failure the previous result stays visible.
    const taskId = addTask({
      id: `fight-week-${Date.now()}`,
      type: "fight-week",
      label: "Building Fight Week Protocol",
      steps: [
        { icon: Activity, label: "Reading your profile" },
        { icon: Shield, label: "Applying ISSN research" },
        { icon: CheckCircle, label: "Generating day-by-day plan" },
      ],
      returnPath: "/weight-cut",
    });

    const carbs = parseInt(normalDailyCarbs);

    try {
      const cwArg = parseFloat(currentWeight);
      const twArg = parseFloat(targetWeight);
      const daysArg = parseInt(daysUntilWeighIn);
      let data: any;
      try {
        data = await fightWeekAnalysisAction({
          currentWeightKg: Number.isFinite(cwArg) && cwArg > 0 ? cwArg : undefined,
          targetWeightKg: Number.isFinite(twArg) && twArg > 0 ? twArg : undefined,
          daysUntilWeighIn: Number.isFinite(daysArg) && daysArg > 0 ? daysArg : undefined,
          normalDailyCarbsG: Number.isFinite(carbs) && carbs > 0 ? carbs : undefined,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (!isMounted()) return;
        if (await handlePaywallError(err)) { failTask(taskId, "Pro required"); return; }
        const msg = err?.message || "Protocol generation unavailable";
        failTask(taskId, msg);
        setLastError(msg);
        showFailureToast("Protocol unavailable", msg);
        return;
      }

      if (controller.signal.aborted) return;
      if (!isMounted()) return;

      // No-camp branch — informational, not a failure.
      if (data?.ok === false && typeof data?.reason === "string") {
        completeTask(taskId, null);
        toast({ title: "No fight scheduled", description: data.reason });
        return;
      }

      if (data?.plan) {
        const plan = data.plan as FightWeekAIPlan;

        // Safety net: if the AI returned fewer timeline days than requested,
        // merge with the deterministic engine so the UI always shows the full plan.
        if (engineProjection && Array.isArray(plan.timeline)) {
          plan.timeline = mergeTimelines(plan.timeline, engineProjection.timeline, profile?.tdee);
        }

        setAiPlan(plan);
        setLastError(null);
        // Only persist on success — failed/partial responses never reach this branch.
        // Persist effectively forever (1 year). The plan only clears when the user regenerates.
        AIPersistence.save(userId, "fight_week_plan_ai", plan, 24 * 365);
        completeTask(taskId, plan);

        // Persist the carbs baseline so next visit pre-fills it
        if (!isNaN(carbs) && carbs !== profile?.normal_daily_carbs_g) {
          updateProfileGoals({ normalDailyCarbsG: carbs })
            .then(() => refreshProfile())
            .catch(() => { /* non-critical */ });
        }

        // Silently persist the weights/days so they auto-rehydrate next visit.
        // Previously this was behind a manual "Save Plan" button which is now gone.
        savePlan();
        return;
      }

      // Defensive: 200 OK but envelope is missing. Surface + log to Sentry.
      const partialMsg = "We had a partial response. Please try again.";
      logger.error("Fight week plan envelope missing", undefined, { data });
      failTask(taskId, partialMsg);
      setLastError(partialMsg);
      showFailureToast("AI didn't complete", partialMsg);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      const msg = err?.message || "Something went wrong";
      failTask(taskId, msg);
      setLastError(msg);
      showFailureToast("Protocol unavailable", msg);
    } finally {
      safeAsync(setIsGenerating)(false);
    }
  };

  // Sanity check: does the AI plan drift from the deterministic engine?
  const sanityWarning = useMemo(() => {
    if (!aiPlan || !engineProjection) return null;
    const aiTotal = aiPlan.breakdown.totalToCut;
    const engTotal = engineProjection.totalToCut;
    const drift = Math.abs(aiTotal - engTotal) / Math.max(engTotal, 0.1);
    if (aiTotal > engineProjection.maxSafeAWL) {
      return `This plan targets ${aiTotal.toFixed(1)}kg, above the ${engineProjection.maxSafeAWL.toFixed(1)}kg ISSN safe threshold for ${daysUntilWeighIn} days. Review carefully.`;
    }
    if (drift > 0.2) {
      return `The AI projection (${aiTotal.toFixed(1)}kg) differs from our calculator (${engTotal.toFixed(1)}kg). Review the breakdown.`;
    }
    return null;
  }, [aiPlan, engineProjection, daysUntilWeighIn]);

  // Build a projection-shaped object for the share card reuse.
  const shareProjection: FightWeekProjection | null = useMemo(() => {
    if (!aiPlan) return engineProjection;
    const percentBW = aiPlan.breakdown.percentBW;
    const safety = aiPlan.riskLevel;
    return {
      totalToCut: aiPlan.breakdown.totalToCut,
      glycogenLoss: aiPlan.breakdown.glycogenLoss,
      fibreLoss: aiPlan.breakdown.fibreLoss,
      sodiumLoss: aiPlan.breakdown.sodiumLoss,
      waterLoadingLoss: aiPlan.breakdown.waterLoadingLoss,
      dietTotal: aiPlan.breakdown.dietTotal,
      dehydrationNeeded: aiPlan.breakdown.dehydrationNeeded,
      dehydrationPercentBW: aiPlan.dehydration.percentBW,
      dehydrationSafety: aiPlan.dehydration.safety,
      overallSafety: safety,
      maxSafeAWL: engineProjection?.maxSafeAWL ?? aiPlan.breakdown.totalToCut,
      percentBW,
      saunaSessions: aiPlan.dehydration.saunaSessions,
      timeline: aiPlan.timeline,
    };
  }, [aiPlan, engineProjection]);

  const handleAICancel = () => {
    aiAbortRef.current?.abort();
    safeAsync(setIsGenerating)(false);
  };

  if (initialLoading) {
    return (
      <div className="space-y-2.5">
        <div className="space-y-1">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <div className="card-surface rounded-xs p-3 border border-border space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-9 w-full rounded-xs" />
            <Skeleton className="h-9 w-full rounded-xs" />
            <Skeleton className="h-9 w-full rounded-xs" />
            <Skeleton className="h-9 w-full rounded-xs" />
          </div>
        </div>
        <Skeleton className="h-48 rounded-xs" />
        <Skeleton className="h-56 rounded-xs" />
      </div>
    );
  }

  const safetyBadge = aiPlan
    ? aiPlan.riskLevel === "green"
      ? { label: "ON TRACK", cls: "bg-green-500/10 text-green-400 border-green-500/20" }
      : aiPlan.riskLevel === "orange"
        ? { label: "CAUTION", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" }
        : { label: "CRITICAL", cls: "bg-red-500/10 text-red-400 border-red-500/20" }
    : null;

  const fwAiTask = aiTasks.find(t => t.status === "running" && t.type === "fight-week");

  const summaryRaw = (aiPlan?.summary ?? "").trim();
  const summaryIsFallback = !!aiPlan && (summaryRaw.length === 0 || summaryRaw.toLowerCase().includes("ai commentary is temporarily unavailable"));

  return (
    <div className="space-y-2.5 text-foreground">
      {fwAiTask && (
        <AICompactOverlay
          isOpen={true}
          isGenerating={true}
          steps={fwAiTask.steps}
          startedAt={fwAiTask.startedAt}
          title={fwAiTask.label}
          onCancel={() => aiDismiss(fwAiTask.id)}
        />
      )}
      <div className="space-y-3">
        {/* Header — slim eyebrow + title + chip/safety badge */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary/80">
              Fight Week
            </p>
            <h1 className="text-[22px] font-bold tracking-tight leading-tight">
              Protocol generator
            </h1>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/12 ring-1 ring-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              Evidence-based
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {aiPlan && (
              <>
                <ShareButton onClick={() => setShareOpen(true)} />
                <button
                  type="button"
                  onClick={() => setDeletePlanDialogOpen(true)}
                  aria-label="Delete plan"
                  title="Delete plan"
                  className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </>
            )}
            {safetyBadge && (
              <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${safetyBadge.cls}`}>
                {safetyBadge.label}
              </div>
            )}
          </div>
        </div>

        {/* ── Wizard-led "How it works" tile — replaces the big onboarding
            hero with a slim coach-voice prompt + chip that opens the full
            3-step explainer in a sheet. */}
        {!aiPlan && !isGenerating && (
          <button
            type="button"
            onClick={() => setHowItWorksOpen(true)}
            className="group w-full text-left card-surface rounded-3xl p-4 border border-primary/20 hover:border-primary/35 active:scale-[0.99] transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 shrink-0 flex items-center justify-center bg-transparent">
                <img src={wizardLogo} alt="" className="h-full w-full object-contain pointer-events-none select-none" draggable={false} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                  Coach
                </p>
                <p className="mt-0.5 text-[14px] font-semibold leading-snug text-foreground">
                  Tell me your stats. I'll build a day-by-day protocol with safety checks.
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                  How it works · risk flags · safe pacing →
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:translate-x-0.5 transition-transform self-center" />
            </div>
          </button>
        )}

        {/* ── Stats card — inline pill steppers replace the 2x2 input grid ─── */}
        <div className="card-surface rounded-3xl p-5 space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/60">
              Your stats
            </p>
            <p className="text-[13px] text-foreground/85 mt-0.5">
              {aiPlan ? "Tweak any input and regenerate." : "Tell me where you're starting from."}
            </p>
          </div>
          <div className="space-y-2.5">
            <StepperPill
              label="Current weight"
              hint="What you weigh today"
              unit="kg"
              value={parseFloat(currentWeight) || 0}
              step={0.5}
              min={30}
              max={200}
              onChange={(v) => setCurrentWeight(v.toString())}
              decimals={1}
            />
            <StepperPill
              label="Weigh-in target"
              hint="Number on the scale at weigh-in"
              unit="kg"
              value={parseFloat(targetWeight) || 0}
              step={0.5}
              min={30}
              max={200}
              onChange={(v) => setTargetWeight(v.toString())}
              decimals={1}
            />
            <StepperPill
              label="Days until weigh-in"
              hint="5–7 is typical fight-week"
              unit="days"
              value={parseInt(daysUntilWeighIn) || 0}
              step={1}
              min={1}
              max={14}
              onChange={(v) => setDaysUntilWeighIn(v.toString())}
              decimals={0}
            />
            <StepperPill
              label="Normal carbs/day"
              hint="Your usual training-day intake"
              unit="g"
              value={parseInt(normalDailyCarbs) || 0}
              step={25}
              min={0}
              max={800}
              onChange={(v) => setNormalDailyCarbs(v.toString())}
              decimals={0}
            />
          </div>
          {inputsValid && (
            <Button
              onClick={generateProtocol}
              disabled={isGenerating || !normalDailyCarbs}
              className={`relative w-full h-13 min-h-[52px] rounded-xs text-[15px] font-bold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40 shadow-lg shadow-primary/30 ${lastError && !isGenerating ? "ring-2 ring-red-500/40" : ""}`}
            >
              {isGenerating ? (
                <CastingMessage />
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" strokeWidth={2.4} />
                  {lastError ? "Try again" : aiPlan ? "Regenerate plan" : "Build my fight-week plan"}
                </span>
              )}
              {!isGenerating && !hasAiAccess && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-primary-foreground/70 pointer-events-none">
                  <Crown className="h-3 w-3" />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
                </span>
              )}
            </Button>
          )}
          {!inputsValid && (
            <p className="text-[12px] text-center text-muted-foreground/70 px-2">
              Fill in all four stats to unlock the plan.
            </p>
          )}
        </div>

        {/* How-it-works detail sheet — opened from the wizard tile above */}
        <Sheet open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-3xl p-0 max-h-[88vh] overflow-y-auto [&>button]:hidden"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
          >
            <VisuallyHidden><SheetTitle>How it works</SheetTitle></VisuallyHidden>
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
            </div>
            <div className="px-5 pt-2 pb-6 space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">Fight Week</p>
                <h2 className="text-[19px] font-bold tracking-tight mt-0.5">How this protocol works</h2>
                <p className="mt-2 text-[13px] text-foreground/85 leading-snug">
                  An evidence-based fight-week protocol built around your bodyweight, weigh-in date and normal diet. It staggers carb depletion, sodium drop, water-load and cut, plus the final sweat so you make weight safely.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { n: 1, title: "Enter stats", body: "Current weight, target, days out" },
                  { n: 2, title: "Build plan", body: "AI runs the protocol math + risk check" },
                  { n: 3, title: "Follow daily", body: "Day-by-day steps with safety flags" },
                ].map((s) => (
                  <div key={s.n}>
                    <div className="h-6 w-6 rounded-full bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center mb-2 tabular-nums">
                      {s.n}
                    </div>
                    <p className="text-[12px] font-semibold leading-tight text-foreground">{s.title}</p>
                    <p className="text-[11px] text-muted-foreground/70 leading-snug mt-1">{s.body}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-xs bg-amber-500/10 ring-1 ring-amber-500/20 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                  <p className="text-[11px] text-foreground/80 leading-snug">
                    Cuts over 8% of bodyweight in &lt;7 days carry serious health risk. The plan flags this and suggests safer pacing.
                  </p>
                </div>
                <div className="flex items-start gap-2 rounded-xs bg-muted/30 ring-1 ring-border/30 px-3 py-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground/80 mt-0.5 flex-shrink-0" strokeWidth={2.2} />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Science-backed but not perfectly accurate. For a high-stakes cut, working with a sports nutritionist is still the gold standard.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHowItWorksOpen(false)}
                className="w-full h-11 rounded-xs bg-primary text-primary-foreground font-semibold text-[14px] active:scale-[0.98] transition-transform shadow-md shadow-primary/30"
              >
                Got it
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Skeleton while generating — gives shape to the wait. */}
        {isGenerating && !aiPlan && <FightWeekSkeleton />}

        {/* Nothing below renders until the AI returns a plan */}
        {aiPlan && (
          <>
            {/* Summary narrative — falls back to a muted banner when AI text is empty */}
            {summaryIsFallback ? (
              <div className="rounded-xs border border-border/40 bg-muted/30 p-3 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-[12px] text-muted-foreground leading-relaxed">AI commentary unavailable — showing computed plan.</p>
              </div>
            ) : (
              <div className="card-surface rounded-xs border border-border/50 p-4">
                <p className="text-sm text-foreground/90 leading-relaxed">{sanitizeAIText(summaryRaw)}</p>
              </div>
            )}

            {/* Summary tiles */}
            <div className="grid grid-cols-3 gap-2">
              <div className="card-surface rounded-xs p-2.5 border border-border text-center">
                <span className="text-lg font-bold block">{aiPlan.breakdown.totalToCut.toFixed(1)}</span>
                <span className="text-[9px] text-muted-foreground uppercase">kg to cut</span>
              </div>
              <div className="card-surface rounded-xs p-2.5 border border-border text-center">
                <span className={`text-lg font-bold block ${
                  aiPlan.breakdown.percentBW <= 5 ? "text-green-400" :
                  aiPlan.breakdown.percentBW <= 8 ? "text-yellow-400" : "text-red-400"
                }`}>
                  {aiPlan.breakdown.percentBW.toFixed(1)}%
                </span>
                <span className="text-[9px] text-muted-foreground uppercase">% bodyweight</span>
              </div>
              <div className="card-surface rounded-xs p-2.5 border border-border text-center">
                <span className="text-lg font-bold block">{daysUntilWeighIn}</span>
                <span className="text-[9px] text-muted-foreground uppercase">days</span>
              </div>
            </div>

            {/* Safety warning */}
            {aiPlan.safetyWarning && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xs p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-300 leading-relaxed">{sanitizeAIText(aiPlan.safetyWarning)}</p>
              </div>
            )}

            <WeightCutBreakdownCard
              glycogenLoss={aiPlan.breakdown.glycogenLoss}
              fibreLoss={aiPlan.breakdown.fibreLoss}
              sodiumLoss={aiPlan.breakdown.sodiumLoss}
              waterLoadingLoss={aiPlan.breakdown.waterLoadingLoss}
              dehydrationNeeded={aiPlan.breakdown.dehydrationNeeded}
              dietTotal={aiPlan.breakdown.dietTotal}
              totalToCut={aiPlan.breakdown.totalToCut}
            />

            {/* Sanity warning surfaced gently near the breakdown it relates to. */}
            {sanityWarning && (
              <div className="rounded-xs border border-yellow-500/30 bg-yellow-500/10 p-3 flex items-start gap-2" role="alert">
                <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-200 leading-relaxed">{sanityWarning}</p>
              </div>
            )}

            <DehydrationRingPanel
              dehydrationPercentBW={aiPlan.dehydration.percentBW}
              dehydrationNeeded={aiPlan.breakdown.dehydrationNeeded}
              dehydrationSafety={aiPlan.dehydration.safety}
              saunaSessions={aiPlan.dehydration.saunaSessions}
            />

            {aiPlan.timeline.length > 0 && (
              <ProjectionChart
                timeline={aiPlan.timeline}
                targetWeight={parseFloat(targetWeight)}
              />
            )}

            <DayTimelineCard timeline={aiPlan.timeline} />

            {derivedStrategies && (
              <>
                <WaterLoadingCard data={derivedStrategies.waterLoading} />
                <ManipulationCard sodium={derivedStrategies.sodiumStrategy} fibre={derivedStrategies.fibreStrategy} />
              </>
            )}

            <DehydrationTacticsCard tactics={aiPlan.dehydrationTactics} />

            <PostWeighInCard data={aiPlan.postWeighIn} />

            {aiPlan.medicalRedFlags?.length > 0 && (
              <div className="card-surface rounded-xs border border-red-500/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Stop if you see any of these</h3>
                </div>
                <ul className="space-y-1">
                  {aiPlan.medicalRedFlags.map((flag, i) => (
                    <li key={i} className="text-[12px] text-muted-foreground flex gap-2 leading-relaxed">
                      <span className="text-red-400 mt-0.5">·</span>
                      {sanitizeAIText(flag)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {aiPlan && shareProjection && (
        <ShareCardDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          title="Share Fight Week"
          shareTitle="Fight Week Plan"
          shareText="Check out my weight cut protocol on FightCamp Wizard"
        >
          {({ cardRef, aspect }) => (
            <FightWeekSummaryCard
              ref={cardRef}
              projection={shareProjection}
              currentWeight={parseFloat(currentWeight)}
              targetWeight={parseFloat(targetWeight)}
              daysOut={parseInt(daysUntilWeighIn)}
              aspect={aspect}
            />
          )}
        </ShareCardDialog>
      )}

      <DeleteConfirmDialog
        open={deletePlanDialogOpen}
        onOpenChange={setDeletePlanDialogOpen}
        onConfirm={handleDeletePlan}
        title="Delete fight-week plan"
        itemName="this protocol — you'll go back to a blank slate"
      />
    </div>
  );
}

// ── StepperPill ──────────────────────────────────────────────────────
// Premium inline pill input with −/+ steppers + a centered editable
// number. Replaces the basic input fields with a more tactile feel,
// matching the food-search serving picker pattern.
function StepperPill({
  label,
  hint,
  unit,
  value,
  step,
  min,
  max,
  onChange,
  decimals = 0,
}: {
  label: string;
  hint?: string;
  unit: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  decimals?: number;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const fmt = (n: number) => (decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals));
  return (
    <div className="flex items-center gap-3 rounded-xs bg-muted/30 dark:bg-white/[0.04] border border-border/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground/80 leading-tight">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 truncate">{hint}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => { triggerHapticSelection(); onChange(clamp(value - step)); }}
          aria-label={`Decrease ${label}`}
          className="h-8 w-8 rounded-full bg-card/60 border border-border/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition disabled:opacity-40"
          disabled={value <= min}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-[68px] text-center">
          <input
            type="number"
            inputMode="decimal"
            value={value || ""}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n)) onChange(clamp(n));
              else if (e.target.value === "") onChange(0);
            }}
            className="w-full bg-transparent text-center text-[15px] font-bold tabular-nums text-foreground outline-none focus:ring-2 focus:ring-primary/40 rounded-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {unit}
          </span>
          {/* Hide the formatted value when input has focus — display attribute can't render alongside input, so just keep input as canonical */}
          <span className="sr-only">{fmt(value)}</span>
        </div>
        <button
          type="button"
          onClick={() => { triggerHapticSelection(); onChange(clamp(value + step)); }}
          aria-label={`Increase ${label}`}
          className="h-8 w-8 rounded-full bg-card/60 border border-border/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition disabled:opacity-40"
          disabled={value >= max}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── CastingMessage ───────────────────────────────────────────────────
// Multi-stage coach-voice loading copy that cycles through 4 stages
// while the AI generates the protocol. Educates while it waits.
function CastingMessage() {
  const stages = useMemo(
    () => [
      "Analysing inputs…",
      "Modeling glycogen depletion…",
      "Drafting daily targets…",
      "Cross-checking safe limits…",
    ],
    [],
  );
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStage((s) => Math.min(s + 1, stages.length - 1)), 1200);
    return () => clearInterval(id);
  }, [stages.length]);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      <span className="tabular-nums">{stages[stage]}</span>
    </span>
  );
}
