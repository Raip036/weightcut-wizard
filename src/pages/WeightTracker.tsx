import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
// Lazy-load recharts wrapper so the ~100KB charts bundle defers until first paint.
const WeightTrackerChart = lazy(() => import("@/components/charts/WeightTrackerChart"));
import { format } from "date-fns";
import { TrendingDown, TrendingUp, Calendar, CalendarClock, Target, AlertTriangle, Activity, Trash2, ChevronDown, CheckCircle2, Minus, Plus, Loader2, Check } from "lucide-react";
import { ProGate } from "@/components/subscription/ProGate";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useUser } from "@/contexts/UserContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { WeightTrackerCard } from "@/components/share/cards/WeightTrackerCard";
import { WeighInResultCard } from "@/components/share/cards/WeighInResultCard";
import { InlinePlanDisplay } from "@/components/onboarding/InlinePlanDisplay";
import type { Profile } from "@/pages/weight/types";
import { isFighter } from "@/lib/goalType";
import { useWeightData } from "@/hooks/weight/useWeightData";
import { useWeightAnalysis } from "@/hooks/weight/useWeightAnalysis";
import { triggerHapticSelection } from "@/lib/haptics";
import { WeightInsightsBlock } from "@/pages/weight/WeightInsightsBlock";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useMyGyms } from "@/hooks/coach/useMyGyms";
import { MadeWeightShareSheet } from "@/components/community/MadeWeightShareSheet";
import type { MadeWeightInput } from "@/lib/madeWeightCard";
import { track, EVENTS } from "@/lib/analytics";

export default function WeightTracker() {
  const { userId, profile: contextProfile, userName, avatarUrl, refreshProfile } = useUser();
  const profile = contextProfile as unknown as Profile;
  const { toast } = useToast();
  const updateProfile = useMutation(api.profiles.updateProfile);
  // Gym branding + active camp inputs for the Made Weight share card.
  // Both queries skip when userId hasn't resolved, so cold-launch is a no-op.
  const { gyms } = useMyGyms(userId);
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");
  const [madeWeightOpen, setMadeWeightOpen] = useState(false);
  const [madeWeightInput, setMadeWeightInput] = useState<MadeWeightInput | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeFilter, setTimeFilter] = useState<"1W" | "1M" | "ALL">("1M");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [showProjected, setShowProjected] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [weighInShareOpen, setWeighInShareOpen] = useState(false);
  const [showWeightSuccess, setShowWeightSuccess] = useState(false);
  const [savePlanDialogOpen, setSavePlanDialogOpen] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  const {
    weightLogs, newWeight, setNewWeight, newDate, setNewDate,
    loading, editingLogId, deleteDialogOpen, setDeleteDialogOpen,
    logToDelete, weightInputRef,
    fetchData, handleAddWeight: rawHandleAddWeight, handleDeleteLog, handleEditLog, initiateDelete,
    getCurrentWeight,
  } = useWeightData({ profile });

  const {
    analyzingWeight,
    analysisPlan,
    analysisOpen, setAnalysisOpen,
    unsafeGoalDialogOpen, setUnsafeGoalDialogOpen,
    loadPersistedAnalysis, clearAnalysis, getAIAnalysis, handleAICancel,
    targetsApplied, applyingTargets, applyNutritionTargets,
  } = useWeightAnalysis({ profile });

  const adjustWeight = (delta: number) => {
    setNewWeight((prev: string) => {
      const current = parseFloat(prev) || 0;
      return Math.max(0, current + delta).toFixed(1);
    });
    triggerHapticSelection();
  };

  useEffect(() => {
    if (!userId) return;
    fetchData();
    loadPersistedAnalysis();
    const stored = localStorage.getItem(`weight_tracker_show_projected_${userId}`);
    if (stored !== null) setShowProjected(JSON.parse(stored));
  }, [userId]);

  // No warmup needed under Convex — actions are co-located with the deployment.

  const handleAddWeight = async (e: React.FormEvent) => {
    const loggedWeight = await rawHandleAddWeight(e);
    // Fire only after the DB write resolves (rawHandleAddWeight returns the
    // logged number post-await, not on the optimistic insert), so one event
    // per successfully persisted entry.
    if (loggedWeight) {
      track(EVENTS.WEIGHT_LOGGED, { method: "manual", is_edit: !!editingLogId });
    }
    if (loggedWeight && profile) {
      setShowWeightSuccess(true);
      setTimeout(() => setShowWeightSuccess(false), 1500);
      const fwt = profile.fight_week_target_kg ?? profile.goal_weight_kg;
      if (fwt && loggedWeight <= fwt && !editingLogId) {
        // Resolve "Made Weight" inputs from camp + recent logs. Falls back
        // to the onboarding starting weight if no recent log exists.
        const earliestRecent = (() => {
          const cutoffMs = Date.now() - 30 * 86400000;
          const within = weightLogs.filter(
            (l) => new Date(l.date).getTime() >= cutoffMs,
          );
          const earliest = (within[0] ?? weightLogs[0]);
          // weight_kg may be string-typed when arriving from older callers;
          // coerce via Number() so we don't depend on a specific shape.
          return earliest ? Number(earliest.weight_kg) : undefined;
        })();
        const startingWeightKg =
          activeCamp?.startingWeightKg ?? earliestRecent ?? profile.current_weight_kg;
        const campStartDate = activeCamp
          ? new Date(activeCamp._creationTime).toISOString().slice(0, 10)
          : undefined;
        const gym = gyms[0];
        setMadeWeightInput({
          startingWeightKg: startingWeightKg ?? loggedWeight,
          finalWeightKg: loggedWeight,
          weighInDate: new Date().toISOString().slice(0, 10),
          campStartDate,
          displayName: userName || profile.display_name || "Fighter",
          gymName: gym?.gym_name,
          gymLogoUrl: gym?.gym_logo_url ?? null,
          avatarUrl: avatarUrl ?? profile.avatar_url ?? null,
          weightUnit: "kg",
        });
        setMadeWeightOpen(true);
      }
    }
  };

  /** Derived: weekly loss target encoded in the AI plan, in kg/week. The new
   *  plan shape doesn't expose a top-level `requiredWeeklyLoss` like the old
   *  protocol JSON did, so we derive it from the first vs second week of the
   *  plan, falling back to start-to-final divided by total weeks. Used purely
   *  to drive the chart's projection overlay. */
  const getPlanWeeklyLoss = (): number => {
    if (!analysisPlan?.weeklyPlan?.length) return 0;
    const rows = analysisPlan.weeklyPlan;
    const first = Number(rows[0]?.targetWeight);
    const last = Number(rows[rows.length - 1]?.targetWeight);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return 0;
    const weeks = Math.max(1, rows.length);
    const perWeek = (first - last) / weeks;
    return perWeek > 0 ? perWeek : 0;
  };

  const getChartData = () => {
    if (!profile) return [];
    const fightWeekTarget = profile.fight_week_target_kg || profile.goal_weight_kg;

    if (!weightLogs.length) {
      if (profile.current_weight_kg) {
        return [{
          date: "Start",
          weight: profile.current_weight_kg,
          projected: null as number | null,
          fightWeekGoal: fightWeekTarget,
          fightNightGoal: profile.goal_weight_kg,
          logId: null,
          fullDate: "Onboarding weight",
        }];
      }
      return [];
    }

    let filteredLogs = [...weightLogs];
    const now = new Date();

    if (timeFilter === "1W") {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filteredLogs = filteredLogs.filter(log => new Date(log.date) >= oneWeekAgo);
    } else if (timeFilter === "1M") {
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filteredLogs = filteredLogs.filter(log => new Date(log.date) >= oneMonthAgo);
    }

    if (filteredLogs.length === 0 && weightLogs.length > 0) {
      filteredLogs = [weightLogs[weightLogs.length - 1]];
    }

    const data: { date: string; weight: number | null; projected: number | null; fightWeekGoal: number | undefined; fightNightGoal: number | undefined; logId: string | null; fullDate: string }[] = filteredLogs.map((log, idx) => ({
      date: format(new Date(log.date), "MMM dd"),
      weight: log.weight_kg,
      projected: (analysisPlan && idx === filteredLogs.length - 1) ? log.weight_kg : null as number | null,
      fightWeekGoal: fightWeekTarget,
      fightNightGoal: profile.goal_weight_kg,
      logId: log.id,
      fullDate: log.date,
    }));

    const planWeeklyLoss = getPlanWeeklyLoss();
    if (analysisPlan && planWeeklyLoss > 0 && filteredLogs.length > 0 && profile.target_date) {
      const lastLog = filteredLogs[filteredLogs.length - 1];
      const lastWeight = lastLog.weight_kg;
      const lastDate = new Date(lastLog.date);
      const targetDate = new Date(profile.target_date);
      const maxWeeks = 8;

      for (let week = 1; week <= maxWeeks; week++) {
        const futureDate = new Date(lastDate.getTime() + week * 7 * 24 * 60 * 60 * 1000);
        if (futureDate > targetDate) break;

        const projectedWeight = Math.max(
          fightWeekTarget,
          lastWeight - (week * planWeeklyLoss),
        );

        data.push({
          date: format(futureDate, "MMM dd"),
          weight: null as number | null,
          projected: projectedWeight,
          fightWeekGoal: fightWeekTarget,
          fightNightGoal: profile.goal_weight_kg,
          logId: null,
          fullDate: format(futureDate, "yyyy-MM-dd"),
        });

        if (projectedWeight <= fightWeekTarget) break;
      }
    }

    return data;
  };

  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const payload = data.activePayload[0].payload;
      const log = weightLogs.find(l => l.id === payload.logId);
      if (log) {
        initiateDelete(log);
      }
    }
  };

  const getWeightProgress = () => {
    if (!profile) return 0;
    const current = getCurrentWeight();
    const start = weightLogs.length > 0 ? weightLogs[0].weight_kg : profile.current_weight_kg;
    const target = profile.fight_week_target_kg || profile.goal_weight_kg;
    if (!target) return 0;
    const total = start - target;
    const progress = start - current;
    return Math.min(100, Math.max(0, (progress / total) * 100));
  };

  const getInsight = () => {
    if (!weightLogs.length || !profile) {
      return { message: "Start logging your weight to receive personalized insights.", icon: Target, color: "text-muted-foreground" };
    }

    const current = getCurrentWeight();
    const target = profile.fight_week_target_kg || profile.goal_weight_kg;
    if (!target) {
      return { message: "Please set a target weight in Goals to see insights.", icon: Target, color: "text-muted-foreground" };
    }
    if (!profile.target_date) {
      return { message: "Set a target date in Goals to see deadline insights.", icon: Target, color: "text-muted-foreground" };
    }
    const targetDate = new Date(profile.target_date);
    const today = new Date();
    const daysRemaining = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weightRemaining = current - target;

    const recentLogs = weightLogs.slice(-7);
    if (recentLogs.length >= 2) {
      const weekAgo = recentLogs[0].weight_kg;
      const weeklyLoss = weekAgo - current;
      const weeklyLossPercent = (weeklyLoss / current) * 100;

      if (weeklyLossPercent > 1.5) return { message: "Warning: Weight loss pace is too aggressive. Reduce deficit to maintain performance and safety.", icon: AlertTriangle, color: "text-danger" };
      if (weeklyLoss > 1.0) return { message: "Caution: Losing weight slightly fast. Monitor energy levels and adjust if needed.", icon: TrendingDown, color: "text-warning" };
      if (weeklyLoss >= 0.5 && weeklyLoss <= 1.0) return { message: "", icon: TrendingDown, color: "text-success" };
      if (weeklyLoss > 0 && weeklyLoss < 0.5) return { message: "Steady progress. Consider slight calorie reduction if deadline is approaching.", icon: TrendingDown, color: "text-primary" };
      if (weeklyLoss <= 0) return { message: "No weight loss detected. Review calorie intake and increase activity if possible.", icon: TrendingUp, color: "text-warning" };
    }

    const requiredWeeklyLoss = weightRemaining / (daysRemaining / 7);
    if (requiredWeeklyLoss > 1.0) return { message: "Target requires >1kg/week loss. Consider extending timeline for safety.", icon: AlertTriangle, color: "text-danger" };

    return { message: "Stay consistent with your plan. Track daily for best results.", icon: Target, color: "text-primary" };
  };

  const insight = getInsight();

  const { tasks: aiTasks, dismissTask: aiDismiss } = useAITask();
  const aiTask = aiTasks.find(t => t.status === "running" && t.type === "weight-analysis");

  /** Promote the freshly generated AI plan to be the user's canonical plan
   *  by writing it to `profiles.cutPlanJson`. Camp.tsx reads that field and
   *  renders the "Your plan" card from it, so this single mutation is enough
   *  to swap the active plan everywhere. Stamps `planType: "weight_loss"`
   *  when absent so Camp's plan-type router lands on `/weight-plan`. */
  const handleSavePlan = async () => {
    if (!analysisPlan) return;
    setSavingPlan(true);
    try {
      const planToSave = {
        ...analysisPlan,
        planType: (analysisPlan as any).planType ?? "weight_loss",
        savedAt: Date.now(),
        source: "weight_tracker",
      };
      await updateProfile({ cutPlanJson: planToSave });
      // Refresh the in-app profile so /camp picks up the change immediately
      // without a hard reload. Convex's reactive queries would catch up on
      // their own; this just makes the swap feel instant on navigation.
      if (typeof refreshProfile === "function") {
        await refreshProfile();
      }
      toast({ title: "Plan saved", description: "Your new plan is now active on Camp." });
      setSavePlanDialogOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't save",
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setSavingPlan(false);
    }
  };

  // Pick up completed weight analysis from task context (e.g. when the user
  // navigated away and back while it was running).
  const handledWeightTaskRef = useRef<string | null>(null);
  useEffect(() => {
    const done = aiTasks.find(t => t.status === "done" && t.type === "weight-analysis" && t.result && handledWeightTaskRef.current !== t.id);
    if (done) {
      handledWeightTaskRef.current = done.id;
      loadPersistedAnalysis();
      setAnalysisOpen(true);
      aiDismiss(done.id);
    }
  }, [aiTasks, aiDismiss]);

  return (
    <>
      {aiTask && (
        <div className="px-5 sm:px-6 pt-3 max-w-2xl mx-auto">
          <AICompactOverlay
            isOpen={true}
            isGenerating={true}
            steps={aiTask.steps}
            startedAt={aiTask.startedAt}            title={aiTask.label}
            onCancel={() => aiDismiss(aiTask.id)}
          />
        </div>
      )}
      <div className="animate-page-in space-y-4 px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto">
        <header className="pt-1">
          <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
          <h1 className="text-title font-semibold leading-tight">Weight Tracker</h1>
        </header>
        {/* ── Hero log form — primary action, prominent ───────── */}
        <div className="card-surface rounded-xs px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/60">
                {editingLogId ? "Editing" : "Log weight"}
              </p>
              <p className="text-[15px] font-semibold text-foreground mt-0.5">
                {editingLogId ? "Update this entry" : "How much do you weigh today?"}
              </p>
            </div>
            {showWeightSuccess && (
              <span className="text-success animate-[fadeSlideUp_0.3s_ease-out_both] inline-flex items-center gap-1 text-[12px] font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Logged
              </span>
            )}
          </div>

          <form onSubmit={handleAddWeight} className="space-y-3">
            {/* Big stepper row */}
            <div className="flex items-center justify-center gap-3 py-2">
              <button
                type="button"
                onClick={() => adjustWeight(-0.1)}
                aria-label="Decrease weight by 0.1"
                className="h-12 w-12 shrink-0 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 hover:bg-muted/60 active:scale-95 transition-all touch-manipulation"
              >
                <Minus className="h-5 w-5" strokeWidth={2.4} />
              </button>
              <div className="flex-1 flex items-baseline justify-center gap-2 min-w-0">
                <Input
                  ref={weightInputRef}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  placeholder={weightLogs.length > 0
                    ? parseFloat(weightLogs[weightLogs.length - 1].weight_kg).toFixed(1)
                    : "0.0"}
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                  required
                  className="text-center font-bold tabular-nums tracking-tight text-[40px] h-14 px-0 bg-transparent border-0 focus-visible:ring-0 placeholder:text-muted-foreground/30 w-full max-w-[180px]"
                />
                <span className="text-[14px] font-semibold text-muted-foreground/60">kg</span>
              </div>
              <button
                type="button"
                onClick={() => adjustWeight(0.1)}
                aria-label="Increase weight by 0.1"
                className="h-12 w-12 shrink-0 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 hover:bg-muted/60 active:scale-95 transition-all touch-manipulation"
              >
                <Plus className="h-5 w-5" strokeWidth={2.4} />
              </button>
            </div>

            {/* Date + log button row */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  required
                  className="h-12 pl-9 pr-3 text-[14px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-foreground"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !newWeight}
                className="h-12 px-6 rounded-xs text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingLogId ? "Update" : "Log weight"}
              </Button>
            </div>
          </form>
        </div>

        {/* Chart + History */}
        <div className="card-surface rounded-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 p-1">
              {(["1W", "1M", "ALL"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-3.5 h-7 rounded-full text-[12px] font-semibold transition-all ${timeFilter === filter
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground/80 active:text-foreground"
                    }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            {weightLogs.length >= 2 && <ShareButton onClick={() => setShareOpen(true)} />}
          </div>
          {(() => { const chartData = getChartData(); const xTicks = chartData.length > 1 ? [chartData[0].date, chartData[chartData.length - 1].date] : chartData.map(d => d.date); return chartData.length > 0 ? (
            <>
              <Suspense fallback={<div className="h-[160px] w-full animate-pulse bg-muted/20 rounded-xs" />}>
                <WeightTrackerChart
                  data={chartData}
                  xTicks={xTicks}
                  fightWeekTarget={profile?.fight_week_target_kg}
                  goalWeight={profile?.goal_weight_kg}
                  hasFightWeekTarget={!!profile?.fight_week_target_kg}
                  showProjected={showProjected}
                  hasAiAnalysis={!!analysisPlan}
                  onChartClick={handleChartClick}
                />
              </Suspense>
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <span className="w-3 border-t border-dashed border-primary/50" />Target
                  </span>
                  {profile?.fight_week_target_kg && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                      <span className="w-3 border-t border-dashed border-destructive/50" />{isFighter(profile?.goal_type) ? "Fight Night" : "Goal"}
                    </span>
                  )}
                </div>
                {analysisPlan && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 text-[10px] gap-1 px-2 ${showProjected ? 'text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => {
                      const next = !showProjected;
                      setShowProjected(next);
                      if (userId) localStorage.setItem(`weight_tracker_show_projected_${userId}`, JSON.stringify(next));
                    }}
                  >
                    <TrendingDown className="h-3 w-3" />
                    Projected {showProjected ? 'On' : 'Off'}
                  </Button>
                )}
              </div>
              <div className="border-t border-border/20 pt-2">
                <Collapsible open={isHistoryOpen} onOpenChange={setIsHistoryOpen} className="w-full space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Recent Entries</p>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground">
                        {isHistoryOpen ? "Hide" : "View & Edit"}
                        <ChevronDown className={`h-3 w-3 ml-1 transition-transform duration-200 ${isHistoryOpen ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="pt-2">
                    <div
                      className="flex gap-2.5 overflow-x-auto pb-2 pr-1 snap-x snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {weightLogs.slice().reverse().map((log) => (
                        <div
                          key={log.id}
                          className="relative snap-start shrink-0 aspect-square w-[104px] flex flex-col items-center justify-center rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30"
                        >
                          <span className="text-[20px] font-bold tabular-nums text-foreground leading-none">
                            {parseFloat(log.weight_kg).toFixed(1)}
                          </span>
                          <span className="text-[10px] font-medium text-muted-foreground/70 mt-1">kg</span>
                          <span className="text-[11px] text-muted-foreground/80 mt-2 tabular-nums font-medium">
                            {format(new Date(log.date), "MMM dd")}
                          </span>
                          <button
                            type="button"
                            onClick={() => initiateDelete(log)}
                            aria-label="Delete log"
                            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground/50 active:text-destructive active:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              Log your first weight to see progress
              <Button variant="outline" size="sm" className="text-xs" onClick={() => weightInputRef.current?.focus()}>
                Log Now
              </Button>
            </div>
          ); })()}
        </div>

        {/* Days-to-fight chip — only shown for fighters with a future
            target date. Persistent context anchor that doubles as a
            countdown without competing with the hero log card. */}
        {profile && isFighter(profile.goal_type) && profile.target_date && (() => {
          const daysToFight = Math.ceil((new Date(profile.target_date).getTime() - Date.now()) / 86400000);
          if (daysToFight < 0) return null;
          return (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500/15 to-blue-500/15 border border-sky-500/30 px-4 py-1.5 text-[12px] font-semibold text-sky-200/90 backdrop-blur-sm">
                <CalendarClock className="h-3.5 w-3.5" />
                {daysToFight === 0 ? "Fight day" : `${daysToFight} ${daysToFight === 1 ? "morning" : "mornings"} until fight`}
              </div>
            </div>
          );
        })()}

        {/* Stats Overview — Current / Target / Δ / Deadline.
            Each cell is forced square via aspect-square so the grid
            stays visually consistent and text never overflows. Value
            text trimmed from 20→17px and labels from 10→9px so even
            long ones like "Deadline" / "To lose" fit comfortably. */}
        {profile && (
          <div className="grid grid-cols-4 gap-2">
            <div className="card-surface rounded-none aspect-square p-2 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">Current</p>
              <p className="text-[17px] font-bold tabular-nums text-foreground leading-none">{getCurrentWeight().toFixed(1)}</p>
              <p className="text-[9px] text-muted-foreground/60 leading-none">kg</p>
            </div>
            <div className="card-surface rounded-none aspect-square p-2 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">Target</p>
              <p className="text-[17px] font-bold tabular-nums text-foreground leading-none">{(profile.fight_week_target_kg || profile.goal_weight_kg).toFixed(1)}</p>
              <p className="text-[9px] text-muted-foreground/60 leading-none">kg</p>
            </div>
            <div className="card-surface rounded-none aspect-square p-2 flex flex-col items-center justify-center gap-1 text-center">
              {(() => {
                const current = getCurrentWeight();
                const target = profile.fight_week_target_kg || profile.goal_weight_kg;
                const diff = target - current;
                if (diff > 0) return (<><p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">To gain</p><p className="text-[17px] font-bold tabular-nums text-emerald-500 leading-none">+{diff.toFixed(1)}</p><p className="text-[9px] text-muted-foreground/60 leading-none">kg</p></>);
                if (diff < 0) return (<><p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">To lose</p><p className="text-[17px] font-bold tabular-nums text-primary leading-none">{Math.abs(diff).toFixed(1)}</p><p className="text-[9px] text-muted-foreground/60 leading-none">kg</p></>);
                return (<><p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">Status</p><p className="text-[17px] font-bold tabular-nums text-emerald-500 leading-none">✓</p><p className="text-[9px] text-muted-foreground/60 leading-none">At target</p></>);
              })()}
            </div>
            <div className="card-surface rounded-none aspect-square p-2 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold leading-tight">Deadline</p>
              <p className="text-[13px] font-bold text-foreground leading-none">{format(new Date(profile.target_date), "MMM dd")}</p>
              <p className="text-[9px] text-muted-foreground/60 leading-none">{format(new Date(profile.target_date), "yyyy")}</p>
            </div>
          </div>
        )}

        {/* 7-day rolling average banner + predictive trend card.
            Both gated separately by data-availability so the page
            degrades gracefully for new users with few logs. */}
        {profile && weightLogs.length >= 3 && (
          <WeightInsightsBlock
            weightLogs={weightLogs}
            currentWeight={getCurrentWeight()}
            targetWeight={profile.fight_week_target_kg || profile.goal_weight_kg}
            targetDate={profile.target_date}
            isCutting={(isFighter(profile.goal_type) && profile.goal_type !== "maintaining") || (profile.goal_weight_kg ?? Infinity) < getCurrentWeight()}
          />
        )}

        {/* Progress + Insight */}
        {profile && (
          <div className="card-surface rounded-xs p-4 space-y-2">
            <div className="flex justify-between items-center text-[12px]">
              <div className="flex items-center gap-1.5">
                <insight.icon className={`h-3.5 w-3.5 ${insight.color}`} strokeWidth={2.4} />
                <span className="text-muted-foreground/80 font-medium">Progress to target</span>
              </div>
              <span className="font-bold tabular-nums text-foreground">{getWeightProgress().toFixed(0)}%</span>
            </div>
            <Progress value={getWeightProgress()} className="h-2 rounded-full" />
            {insight.message && (
              <p className="text-[12px] text-muted-foreground/85 leading-relaxed pt-1">{insight.message}</p>
            )}
          </div>
        )}

        {/* AI Plan — compact summary card. Tapping opens the full plan sheet
            (same `InlinePlanDisplay` used by the post-onboarding finale). */}
        {!analyzingWeight && analysisPlan && (() => {
          const weeklyPlan = Array.isArray(analysisPlan.weeklyPlan) ? analysisPlan.weeklyPlan : [];
          const week1 = weeklyPlan[0];
          const targetCal: number | undefined =
            typeof analysisPlan.targetCalories === "number"
              ? analysisPlan.targetCalories
              : typeof week1?.calories === "number"
                ? week1.calories
                : undefined;
          const proteinG = typeof week1?.protein_g === "number" ? week1.protein_g : undefined;
          const carbsG = typeof week1?.carbs_g === "number" ? week1.carbs_g : undefined;
          const fatsG = typeof week1?.fats_g === "number" ? week1.fats_g : undefined;
          const planWeeks: number =
            typeof analysisPlan.totalWeeks === "number" ? analysisPlan.totalWeeks : weeklyPlan.length;

          return (
            <div className="card-surface rounded-xs p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary/70">
                    Your Plan
                  </p>
                  <p className="text-[14px] font-semibold text-foreground mt-1">
                    {planWeeks} week timeline ready
                  </p>
                </div>
                <button
                  onClick={clearAnalysis}
                  className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/40 active:text-destructive active:bg-destructive/10 transition-colors"
                  title="Clear plan"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 4-tile macro/cal strip — same colors InlinePlanDisplay uses */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Calories", value: targetCal, unit: "kcal", color: "text-foreground" },
                  { label: "Protein", value: proteinG, unit: "g", color: "text-func-protein-blue" },
                  { label: "Carbs", value: carbsG, unit: "g", color: "text-func-carbs-orange" },
                  { label: "Fats", value: fatsG, unit: "g", color: "text-func-fats-purple" },
                ].map((m) => (
                  <div key={m.label} className="rounded-xs bg-muted/20 px-2 py-2.5 text-center">
                    <p className={`text-[16px] font-bold tabular-nums ${m.color}`}>
                      {typeof m.value === "number" ? Math.round(m.value).toLocaleString() : "-"}
                    </p>
                    <p className="text-[10px] text-foreground">{m.unit}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setAnalysisOpen(true)}
                  className="flex-1 rounded-xs text-xs h-9 bg-primary text-primary-foreground"
                >
                  View full plan
                </Button>
                <Button
                  variant={targetsApplied ? "ghost" : "outline"}
                  size="sm"
                  className="flex-1 rounded-xs text-xs h-9"
                  disabled={applyingTargets || targetsApplied}
                  onClick={applyNutritionTargets}
                >
                  {targetsApplied ? <><Check className="h-3 w-3 mr-1" />Applied</> : applyingTargets ? "Applying..." : "Apply to Nutrition"}
                </Button>
              </div>

              <Button
                onClick={() => setSavePlanDialogOpen(true)}
                variant="outline"
                size="sm"
                className="w-full rounded-xs text-xs h-9 border-primary/40 text-primary hover:bg-primary/10"
                disabled={savingPlan}
              >
                {savingPlan ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  "Save as my plan"
                )}
              </Button>

              <Button
                onClick={getAIAnalysis}
                disabled={analyzingWeight}
                variant="ghost"
                size="sm"
                className="w-full rounded-xs text-[11px] h-7 text-muted-foreground hover:text-foreground"
              >
                Refresh plan
              </Button>
            </div>
          );
        })()}

        {/* AI Analysis Loading skeleton (shown when a refresh is in flight
            and the sheet is closed; the sheet itself shows its own state). */}
        {analyzingWeight && !analysisOpen && (
          <div className="card-surface rounded-xs p-6 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
            <div className="space-y-2 w-full max-w-xs">
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-3/4 mx-auto rounded-full" />
            </div>
            <p className="text-[12px] text-muted-foreground/80">Refreshing your weight plan…</p>
          </div>
        )}

        {/* Get AI Button — primary entry when no plan exists yet. */}
        {!analysisPlan && profile && (
          <ProGate feature="AI_WEIGHT_ANALYSIS" className="w-full">
            <Button
              onClick={getAIAnalysis}
              disabled={analyzingWeight}
              className="w-full rounded-xs h-12 text-[14px] font-semibold bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground hover:bg-muted/60 active:scale-[0.98] transition-all"
            >
              {analyzingWeight ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" strokeWidth={2.4} />
                  Get AI weight strategy
                </span>
              )}
            </Button>
          </ProGate>
        )}

        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleDeleteLog}
          title="Delete Weight Log"
          itemName={logToDelete ? `${logToDelete.weight_kg}kg on ${format(new Date(logToDelete.date), "MMM dd, yyyy")}` : undefined}
        />

        <AlertDialog open={unsafeGoalDialogOpen} onOpenChange={setUnsafeGoalDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aggressive Weight Loss Goal</AlertDialogTitle>
              <AlertDialogDescription>
                This goal requires losing more than 1.5kg per week, which carries serious health risks including performance degradation, muscle loss, and metabolic damage. Please consult a doctor or sports nutritionist before following this plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="justify-center sm:justify-center">
              <AlertDialogAction onClick={() => setUnsafeGoalDialogOpen(false)}>I understand</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Confirmation for promoting the AI plan to the user's canonical plan.
            Destructive — replaces whatever Camp.tsx currently surfaces from
            `profiles.cutPlanJson` (onboarding plan or a prior save). */}
        <AlertDialog open={savePlanDialogOpen} onOpenChange={setSavePlanDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your current plan?</AlertDialogTitle>
              <AlertDialogDescription>
                This becomes your new active plan and replaces the one from onboarding. You can always generate a new one later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={savingPlan}>Keep current</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleSavePlan}
                disabled={savingPlan}
                className="bg-primary text-primary-foreground"
              >
                {savingPlan ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  "Replace plan"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>

      {/* Full plan sheet — bottom-anchored, scrollable, hosts the shared
          `InlinePlanDisplay`. The sheet auto-opens when the user kicks off
          a new analysis (see `getAIAnalysis`) and on completion of a
          background task picked up by the AITask effect above. */}
      <Sheet
        open={analysisOpen}
        onOpenChange={(open) => {
          if (!open && analyzingWeight) {
            // Allow closing the sheet while a refresh is in flight; cancel
            // the inflight request so we don't waste tokens.
            handleAICancel();
          }
          setAnalysisOpen(open);
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[92vh] max-h-[92vh] overflow-y-auto rounded-t-3xl border-t border-border/40 p-0"
        >
          <SheetHeader className="px-4 pt-4 pb-2 text-left">
            <SheetTitle className="text-[15px] font-semibold">
              Your AI Weight Plan
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-8">
            {analyzingWeight && !analysisPlan ? (
              <div className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
                <p className="text-[12px] text-muted-foreground">
                  Building your plan…
                </p>
              </div>
            ) : analysisPlan ? (
              <InlinePlanDisplay
                plan={analysisPlan}
                planType="weight_loss"
                onContinue={() => setAnalysisOpen(false)}
              />
            ) : (
              <div className="py-12 text-center text-[12px] text-muted-foreground">
                No plan yet. Tap "Get AI weight strategy" to generate one.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ShareCardDialog open={shareOpen} onOpenChange={setShareOpen} title="Share Weight Progress" shareTitle="Weight Journey" shareText="Check out my weight progress on FightCamp Wizard">
        {({ cardRef, aspect }) => (
          <WeightTrackerCard ref={cardRef} weightLogs={weightLogs} goalWeight={profile?.fight_week_target_kg ?? profile?.goal_weight_kg} timeFilter={timeFilter} aspect={aspect} />
        )}
      </ShareCardDialog>

      <ShareCardDialog open={weighInShareOpen} onOpenChange={setWeighInShareOpen} title="Share Weigh-In Result" shareTitle="Made Weight!" shareText="I made weight on FightCamp Wizard">
        {({ cardRef, aspect }) => (
          <WeighInResultCard
            ref={cardRef}
            startWeight={weightLogs.length > 0 ? weightLogs[0].weight_kg : profile?.current_weight_kg ?? 0}
            endWeight={weightLogs.length > 0 ? weightLogs[weightLogs.length - 1].weight_kg : 0}
            targetWeight={profile?.fight_week_target_kg ?? profile?.goal_weight_kg ?? 0}
            aspect={aspect}
          />
        )}
      </ShareCardDialog>

      {/* Auto-opens when a logged weigh-in meets or beats the user's target.
          Polaroid-style 1080² card with gym branding for off-platform shares. */}
      <MadeWeightShareSheet
        open={madeWeightOpen}
        onOpenChange={setMadeWeightOpen}
        input={madeWeightInput}
      />
    </>
  );
}
