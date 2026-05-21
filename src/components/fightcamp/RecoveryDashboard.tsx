import { useState, useEffect, useCallback, useRef, useMemo, memo, lazy, Suspense } from "react";
import { Activity, Brain, AlertTriangle, HelpCircle, ChevronRight, X, Check, Sparkles, Zap, BedDouble, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

// ── AnimatedNumber ─────────────────────────────────────────────────────
// Counts up from 0 to `value` over `duration` ms on first mount and whenever
// the target changes. Respects prefers-reduced-motion (jumps straight to
// the final value).
function AnimatedNumber({
  value,
  duration = 700,
  className,
  format,
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState(prefersReduced ? value : 0);
  useEffect(() => {
    if (prefersReduced) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const startVal = display;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(startVal + (value - startVal) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, prefersReduced]);
  return <span className={className}>{format ? format(display) : Math.round(display)}</span>;
}
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { AIPersistence } from "@/lib/aiPersistence";
import { RecoveryRing } from "./RecoveryRing";
// Lazy-load the recharts-backed StrainChart so the ~100KB charts bundle defers until first paint.
const StrainChart = lazy(() => import("./StrainChart").then(m => ({ default: m.StrainChart })));
import { ReadinessBreakdownCard } from "./ReadinessBreakdownCard";
import { BalanceMetricsCard } from "./BalanceMetricsCard";
import { WellnessCheckIn } from "./WellnessCheckIn";
import { RecoveryCoachChat } from "./RecoveryCoachChat";
// DailyVerdictCard + BaselineConfidencePill are intentionally NOT imported —
// their content is now inlined into the unified hero card below.
import { WeeklyLoadPlan } from "./WeeklyLoadPlan";
import { RecoveryHelpSheet } from "./RecoveryHelpSheet";
import { computeAllMetrics, type SessionRow, type AllMetrics, type ReadinessResult, type WellnessCheckIn as WellnessCheckInData, type PersonalBaseline } from "@/utils/performanceEngine";
import { loadOrComputeBaseline, computeAndStoreBaseline, storeReadinessScore } from "@/utils/baselineComputer";
import { useUser } from "@/contexts/UserContext";
import { logger } from "@/lib/logger";

interface AthleteBaseline {
  trainingFrequency: number | null;
  activityLevel: string | null;
  sex?: string | null;
  age?: number | null;
}

interface RecoveryDashboardProps {
  sessions28d: SessionRow[];
  userId: string;
  sessionLoggedAt?: number; // counter that increments on session save
  athleteProfile?: AthleteBaseline;
  tdee?: number | null;
}

// ── Verdict helpers (inlined from DailyVerdict.tsx for the unified hero) ──
type Verdict = "push" | "steady" | "easy" | "recover";
const VERDICT_COPY: Record<Verdict, { headline: string; icon: typeof Zap; color: string; bg: string; ring: string }> = {
  push:    { headline: "Push today",     icon: Zap,        color: "text-func-recovery-green", bg: "bg-func-recovery-green/15", ring: "ring-func-recovery-green/30" },
  steady:  { headline: "Steady session", icon: Activity,   color: "text-blue-300",    bg: "bg-blue-500/15",    ring: "ring-blue-500/30" },
  easy:    { headline: "Take it light",  icon: Sun,        color: "text-func-warning-yellow",   bg: "bg-func-warning-yellow/15",   ring: "ring-func-warning-yellow/30" },
  recover: { headline: "Recover today",  icon: BedDouble,  color: "text-func-danger-red",     bg: "bg-func-danger-red/15",     ring: "ring-func-danger-red/30" },
};
function deriveVerdict(metrics: AllMetrics): Verdict {
  const { readiness, overtrainingRisk, loadZone, loadConfidence } = metrics;
  const loadReliable = loadConfidence.isReliable;
  if (overtrainingRisk.zone === "critical") return "recover";
  if (readiness.label === "strained") return "recover";
  if (overtrainingRisk.zone === "high") return "easy";
  if (loadReliable && loadZone.zone === "overreaching") return "easy";
  if (readiness.label === "recovering") return "easy";
  if (
    readiness.score >= 75 &&
    overtrainingRisk.zone === "low" &&
    (!loadReliable || loadZone.zone !== "overreaching")
  ) {
    return "push";
  }
  return "steady";
}
function whyLine(metrics: AllMetrics, checkedInToday: boolean): string {
  const { readiness, overtrainingRisk, loadZone, weeklySessionCount, loadConfidence } = metrics;
  const loadReliable = loadConfidence.isReliable;
  if (overtrainingRisk.zone === "critical") return "Your body is showing real signs of doing too much. Take today off — it will pay off the rest of the week.";
  if (overtrainingRisk.zone === "high") return "You've been pushing hard. Keep today light or skill-based instead of going all out.";
  if (readiness.label === "strained") return "You're really run down. Focus on sleep, food, and stretching today. Train again tomorrow.";
  if (readiness.label === "recovering") return "Your body is still catching up from recent training. A moderate session is the smart call today.";
  if (loadReliable && loadZone.zone === "overreaching") return "You've trained much harder than usual this week. Take it easier today so your body can adapt.";
  if (loadReliable && loadZone.zone === "detraining") return `Only ${weeklySessionCount} session${weeklySessionCount === 1 ? "" : "s"} this week. A solid session today will get you back into rhythm.`;
  if (readiness.label === "peaked") return "Everything is looking good. This is a great day to push the intensity.";
  if (!loadReliable) return "Still learning your normal training pattern. Train how your body feels today and check back in after a few more sessions.";
  if (!checkedInToday) return "Based on your recent training. Do a quick check-in for a more personalised read.";
  return "Your training and recovery are well balanced. A normal session is the right call.";
}
function baselineConfidence(baseline: PersonalBaseline | null, totalCheckInDays: number): { label: string; detail: string; tone: string } {
  const baselineUnlocked = baseline?.hooper_mean_14d != null;
  const days = baselineUnlocked ? Math.max(totalCheckInDays, 14) : totalCheckInDays;
  if (days >= 14) return { label: "Tuned to you", detail: `${days} days of data`, tone: "text-func-recovery-green bg-func-recovery-green/12 ring-func-recovery-green/30" };
  if (days >= 7) return { label: "Tuning to you", detail: `${days}/14 days`, tone: "text-blue-300 bg-blue-500/12 ring-blue-500/30" };
  return { label: "Learning your patterns", detail: `${days}/14 days`, tone: "text-func-warning-yellow bg-func-warning-yellow/12 ring-func-warning-yellow/30" };
}

function getStrainColor(strain: number) {
  if (strain <= 7) return { color: "hsl(var(--primary))", glow: "hsl(var(--primary))" };
  if (strain <= 14) return { color: "#f59e0b", glow: "#f59e0b" };
  return { color: "#ef4444", glow: "#ef4444" };
}

function getOTColor(zone: 'low' | 'moderate' | 'high' | 'critical') {
  if (zone === 'low') return { color: "#22c55e", glow: "#22c55e" };
  if (zone === 'moderate') return { color: "#f59e0b", glow: "#f59e0b" };
  if (zone === 'high') return { color: "#ef4444", glow: "#ef4444" };
  return { color: "#dc2626", glow: "#dc2626" }; // critical
}

function getLoadZoneStyle(zone: string) {
  switch (zone) {
    case 'optimal':
      return { color: 'text-func-recovery-green', bg: 'bg-func-recovery-green/20' };
    case 'detraining':
      return { color: 'text-blue-400', bg: 'bg-blue-500/20' };
    case 'pushing':
      return { color: 'text-func-warning-yellow', bg: 'bg-func-warning-yellow/20' };
    case 'overreaching':
      return { color: 'text-func-danger-red', bg: 'bg-func-danger-red/20' };
    default:
      return { color: 'text-muted-foreground', bg: 'bg-accent/20' };
  }
}

function getReadinessColor(label: ReadinessResult['label']) {
  if (label === 'peaked') return { color: "#22c55e", glow: "#22c55e" };
  if (label === 'ready') return { color: "hsl(var(--primary))", glow: "hsl(var(--primary))" };
  if (label === 'recovering') return { color: "#f59e0b", glow: "#f59e0b" };
  return { color: "#ef4444", glow: "#ef4444" }; // strained
}

export const RecoveryDashboard = memo(function RecoveryDashboard({ sessions28d, userId, athleteProfile, tdee }: RecoveryDashboardProps) {
  const { profile } = useUser();
  const [metrics, setMetrics] = useState<AllMetrics | null>(null);

  // Enhanced wellness state
  const [wellnessCheckIn, setWellnessCheckIn] = useState<WellnessCheckInData | null>(null);
  const [baseline, setBaseline] = useState<PersonalBaseline | null>(null);
  const [todayCheckedIn, setTodayCheckedIn] = useState(false);
  const [checkInDaysCount, setCheckInDaysCount] = useState(0);
  const [sleepLogs, setSleepLogs] = useState<{ date: string; hours: number }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wellnessSheetOpen, setWellnessSheetOpen] = useState(false);
  const baselineLoadedRef = useRef(false);

  const uniqueDays = new Set(sessions28d.map(s => s.date)).size;
  const hasEnoughData = uniqueDays >= 1;

  // ── Live-reactive Convex subscriptions for wellness + sleep ──
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const from28dStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().split('T')[0];
  }, []);

  // Today's wellness check-in (last 1 day window — `.unique()` enforced server-side).
  const checkinsRows = useQuery(api.wellness.listCheckins, userId ? { from: todayStr, to: todayStr, limit: 1 } : "skip");
  // Total lifetime check-in count for the "consistency" metric. listCheckins
  // caps to 90 by default which matches the prior estimate-count behaviour
  // well enough for beta — past 90d the gradient flattens anyway.
  const checkinHistoryRows = useQuery(api.wellness.listCheckins, userId ? { limit: 90 } : "skip");
  // 28d sleep logs.
  const sleepRows = useQuery(api.sleep_logs.listForUser, userId ? { limit: 90 } : "skip");

  // Reset baselineLoadedRef when userId changes to prevent cross-account data leak
  useEffect(() => {
    baselineLoadedRef.current = false;
  }, [userId]);

  // Load baseline once on mount (still a one-shot — baseline computation is
  // synchronous against the in-memory data and doesn't need to be reactive).
  useEffect(() => {
    if (baselineLoadedRef.current) return;
    baselineLoadedRef.current = true;
    loadOrComputeBaseline(userId, tdee)
      .then((b) => { if (b) setBaseline(b); })
      .catch((err) => logger.warn("RecoveryDashboard: baseline fetch failed", { err }));
  }, [userId, tdee]);

  // Apply Convex subscription results to local state. Convex returns undefined
  // until the first query lands; treat that as "still loading" and don't churn
  // dependent state.
  useEffect(() => {
    if (!checkinsRows) return;
    const todayRow: any = checkinsRows[0];
    if (todayRow) {
      setTodayCheckedIn(true);
      setWellnessCheckIn({
        sleep_quality: todayRow.sleepQuality,
        fatigue_level: todayRow.fatigueLevel,
        soreness_level: todayRow.sorenessLevel,
        stress_level: todayRow.stressLevel,
        energy_level: todayRow.energyLevel,
        motivation_level: todayRow.motivationLevel,
        sleep_hours: todayRow.sleepHours,
        hydration_feeling: todayRow.hydrationFeeling,
        appetite_level: todayRow.appetiteLevel,
        hooper_index: todayRow.hooperIndex,
      } as WellnessCheckInData);
    }
  }, [checkinsRows]);

  useEffect(() => {
    if (!checkinHistoryRows) return;
    setCheckInDaysCount(checkinHistoryRows.length);
  }, [checkinHistoryRows]);

  useEffect(() => {
    if (!sleepRows) return;
    const filtered = sleepRows
      .filter((r: any) => r.date >= from28dStr)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .map((r: any) => ({ date: r.date, hours: r.hours }));
    setSleepLogs(filtered);
  }, [sleepRows, from28dStr]);

  // Stable fingerprint for sessions28d so the metrics effect doesn't re-fire
  // every Convex tick when the parent re-renders with a fresh-but-equivalent
  // array reference. Joining id+date+updatedAt is enough: any meaningful
  // session change touches one of those fields.
  const sessions28dFingerprint = useMemo(
    () => sessions28d.map((s: any) => `${s.id ?? s._id ?? ''}:${s.date ?? ''}:${s.updatedAt ?? s.updated_at ?? ''}`).join('|'),
    [sessions28d],
  );

  // Compute metrics whenever sessions or wellness data changes
  useEffect(() => {
    const prevReadiness: number | null = AIPersistence.load(userId, 'prev_readiness');

    if (sessions28d.length > 0) {
      setMetrics(computeAllMetrics(
        sessions28d,
        athleteProfile?.trainingFrequency,
        athleteProfile?.activityLevel,
        wellnessCheckIn,
        baseline,
        prevReadiness,
        sleepLogs,
      ));
    } else {
      setMetrics(computeAllMetrics(
        [],
        undefined,
        undefined,
        wellnessCheckIn,
        baseline,
        prevReadiness,
        sleepLogs,
      ));
    }
    // sessions28d intentionally excluded — sessions28dFingerprint is the
    // stable proxy. Same for sleepLogs (driven by sleepRows query).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions28dFingerprint, athleteProfile?.trainingFrequency, athleteProfile?.activityLevel, wellnessCheckIn, baseline, userId, sleepLogs]);

  // Store readiness for autoregressive smoothing when it changes (deduplicated)
  const lastStoredScoreRef = useRef<number | null>(null);
  useEffect(() => {
    const score = metrics?.readiness.score;
    if (score == null) return;
    // Only write if score actually changed (avoids duplicate PATCH calls)
    if (lastStoredScoreRef.current === score) return;
    lastStoredScoreRef.current = score;

    AIPersistence.save(userId, 'prev_readiness', score, 48);

    // Write back to check-in row if we checked in today
    if (todayCheckedIn) {
      const today = new Date().toISOString().split('T')[0];
      storeReadinessScore(userId, today, score);
    }
  }, [metrics?.readiness.score, userId, todayCheckedIn]);

  // Handle wellness check-in submission
  const handleWellnessSubmit = useCallback(async (data: WellnessCheckInData) => {
    setWellnessCheckIn(data);
    setTodayCheckedIn(true);
    setCheckInDaysCount(prev => prev + 1);

    // Recompute baseline in background after submission
    computeAndStoreBaseline(userId, tdee).then(b => {
      if (b) setBaseline(b);
    }).catch(() => {});
  }, [userId, tdee]);

  if (!metrics) return null;

  const readinessColors = getReadinessColor(metrics.readiness.label);
  const strainColors = getStrainColor(metrics.strain);
  const otColors = getOTColor(metrics.overtrainingRisk.zone);

  // ── Unified hero — derived values ───────────────────────────────────
  const rawVerdict = deriveVerdict(metrics);
  const verdict: Verdict = !metrics.loadConfidence.isReliable ? "steady" : rawVerdict;
  const verdictCopy = VERDICT_COPY[verdict];
  const VerdictIcon = verdictCopy.icon;
  const why = whyLine(metrics, todayCheckedIn);
  const confidence = baselineConfidence(baseline, checkInDaysCount);

  return (
    <div className="space-y-4 mb-6">
      {/* Unified hero — verdict + baseline pill + 3 rings + 4-stat strip,
          all inside one card. Animated number count-up on the headline
          readiness score; ring stroke draws on via the existing 800ms
          transition. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 280 }}
        className={`relative overflow-hidden card-surface rounded-xs border border-border ring-1 ${verdictCopy.ring} p-4`}
      >
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="How to read this page"
          className="absolute top-3 right-3 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground/70 active:text-foreground active:bg-muted/40 transition-colors"
        >
          <HelpCircle className="h-4 w-4" strokeWidth={2.2} />
        </button>

        {/* Row 1 — verdict header + animated Readiness number */}
        <div className="flex items-start gap-3 pr-9">
          <div className={`h-12 w-12 shrink-0 rounded-xs flex items-center justify-center ${verdictCopy.bg}`}>
            <VerdictIcon className={`h-6 w-6 ${verdictCopy.color}`} strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
              Today's call
            </p>
            <h2 className="text-[20px] font-bold tracking-tight text-foreground leading-tight">
              {verdictCopy.headline}
            </h2>
          </div>
          <div className="flex flex-col items-center leading-none shrink-0 min-w-[60px]">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Readiness</span>
            <AnimatedNumber
              value={metrics.readiness.score}
              className="mt-1.5 text-[26px] font-bold tabular-nums text-foreground"
            />
          </div>
        </div>
        <p className="text-[13px] text-foreground/85 leading-snug mt-2.5">{why}</p>

        {/* Baseline confidence — slim inline chip */}
        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full ring-1 px-2.5 py-1 text-[11px] font-semibold ${confidence.tone}`}>
          <Sparkles className="h-3 w-3" />
          {confidence.label}
          <span className="opacity-70 font-medium">· {confidence.detail}</span>
        </div>

        {/* Divider */}
        <div className="my-4 h-px bg-border/30" aria-hidden />

        {/* 3 rings — equal size, larger and clearer */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex justify-center">
            <RecoveryRing
              value={metrics.readiness.score}
              max={100}
              color={readinessColors.color}
              glowColor={readinessColors.glow}
              label="Readiness"
              size={92}
              strokeWidth={9}
              displayValue={`${metrics.readiness.score}`}
              sublabel={metrics.readiness.label}
            />
          </div>
          <div className="flex justify-center">
            <RecoveryRing
              value={metrics.strain}
              max={21}
              color={strainColors.color}
              glowColor={strainColors.glow}
              label="Strain"
              size={92}
              strokeWidth={9}
              displayValue={metrics.strain.toFixed(1)}
              sublabel="/ 21"
            />
          </div>
          <div className="flex justify-center">
            <RecoveryRing
              value={metrics.overtrainingRisk.score}
              max={100}
              color={otColors.color}
              glowColor={otColors.glow}
              label="OT Risk"
              size={92}
              strokeWidth={9}
              displayValue={`${Math.round(metrics.overtrainingRisk.score)}`}
              sublabel={metrics.overtrainingRisk.zone}
            />
          </div>
        </div>

        {/* Stats strip — bottom of the hero, with a divider */}
        <div className="mt-4 pt-3 grid grid-cols-4 gap-1.5 border-t border-border/30">
          <div className="text-center">
            <div className="text-sm font-bold display-number text-foreground tabular-nums">{metrics.weeklySessionCount}</div>
            <div className="text-[8px] text-muted-foreground uppercase tracking-wider leading-tight">Sessions/wk</div>
          </div>
          <div className="text-center">
            {metrics.loadConfidence.isReliable ? (
              <div className={`text-sm font-bold display-number truncate ${getLoadZoneStyle(metrics.loadZone.zone).color}`}>{metrics.loadZone.label}</div>
            ) : (
              <div className="text-sm font-bold display-number truncate text-muted-foreground">Building</div>
            )}
            <div className="text-[8px] text-muted-foreground uppercase tracking-wider leading-tight">Training Load</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold display-number text-foreground tabular-nums">{metrics.sleepScore}</div>
            <div className="text-[8px] text-muted-foreground uppercase tracking-wider leading-tight">Sleep Score</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold display-number text-foreground tabular-nums">
              {metrics.avgSleepLast3 > 0 ? `${metrics.avgSleepLast3.toFixed(1)}h` : "—"}
            </div>
            <div className="text-[8px] text-muted-foreground uppercase tracking-wider leading-tight">3-Night Avg</div>
          </div>
        </div>
      </motion.div>

      {/* Readiness Breakdown Card (toggleable, default closed) — kept
          separate from the hero so it doesn't bloat the primary view. */}
      <ReadinessBreakdownCard
        breakdown={metrics.readiness.breakdown}
        totalCheckInDays={checkInDaysCount}
      />

      {/* 2.6) Wellness check-in / Recovery Coach.
          When not yet checked in today, show a compact tile that opens the
          full 4-step form in a bottom sheet (was inline — took a screen).
          Once submitted, the coach chat replaces it. */}
      {!hasEnoughData ? (
        <div className="card-surface rounded-xs p-4 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">Recovery Coach</h2>
          </div>
          <div className="text-center py-6 text-sm text-muted-foreground">
            Log a session to unlock the coach.
          </div>
        </div>
      ) : !todayCheckedIn ? (
        <button
          type="button"
          onClick={() => setWellnessSheetOpen(true)}
          className="group w-full text-left card-surface rounded-xs p-4 border border-primary/25 hover:border-primary/40 active:scale-[0.99] transition-all"
          aria-label="Open daily check-in"
        >
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 rounded-xs bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Daily check-in
              </p>
              <p className="mt-0.5 text-[15px] font-semibold leading-tight text-foreground">
                How are you feeling today?
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                4 quick taps · unlocks the recovery coach
              </p>
            </div>
            <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wider text-primary group-hover:translate-x-0.5 transition-transform">
              <span>~20s</span>
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </button>
      ) : (
        <RecoveryCoachChat userId={userId} userName={profile?.full_name ?? null} />
      )}

      {/* Wellness check-in sheet — opens from the tile above */}
      <Sheet open={wellnessSheetOpen} onOpenChange={setWellnessSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
        >
          <VisuallyHidden><SheetTitle>Daily check-in</SheetTitle></VisuallyHidden>
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
          </div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">Recovery</p>
              <h2 className="text-[19px] font-bold tracking-tight">Daily check-in</h2>
            </div>
            <button
              type="button"
              onClick={() => setWellnessSheetOpen(false)}
              aria-label="Close"
              className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 pb-5">
            <WellnessCheckIn
              userId={userId}
              onSubmit={(data) => { handleWellnessSubmit(data); setWellnessSheetOpen(false); }}
              isSubmitting={false}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Caloric Deficit Banner — promoted ABOVE the Trends card because
          it's a state alert, not historical data. */}
      {metrics.deficitImpactScore != null && metrics.deficitImpactScore < 60 && baseline?.avg_deficit_7d != null && (
        <div className="card-surface rounded-xs p-3 border border-func-warning-yellow/30 bg-func-warning-yellow/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-func-warning-yellow shrink-0" />
            <div>
              <p className="text-xs font-semibold text-func-warning-yellow">
                Caloric Deficit Impacting Recovery
              </p>
              <p className="text-[10px] text-func-warning-yellow/70 mt-0.5">
                {Math.abs(baseline.avg_deficit_7d).toFixed(0)}kcal avg deficit (7d) — recovery impact score {metrics.deficitImpactScore}/100
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unified Trends card — internal tabs swap between the 4 data
          views (Week plan · Strain chart · Tomorrow forecast · Balance
          metrics). Replaces 4 separate stacked cards. */}
      <TrendsCard
        metrics={metrics}
        hasBalanceMetrics={!!(metrics.balanceMetrics && metrics.balanceMetrics.length > 0)}
      />

      {/* Single help sheet — triggered from the ? on the Performance card. */}
      <RecoveryHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
});

// ── Trends card — tabbed shell ─────────────────────────────────────────
// Merges Weekly Load Plan, 7-day Strain Chart, Tomorrow's projection, and
// Balance Metrics into a single card with tab pills at the top. Cuts the
// page footprint by ~4 cards.
type TrendsTab = "week" | "strain" | "tomorrow" | "balance";

function TrendsCard({
  metrics,
  hasBalanceMetrics,
}: {
  metrics: AllMetrics;
  hasBalanceMetrics: boolean;
}) {
  const [tab, setTab] = useState<TrendsTab>("week");
  const tabs: Array<{ id: TrendsTab; label: string; visible: boolean }> = [
    { id: "week",     label: "Week",     visible: true },
    { id: "strain",   label: "Strain",   visible: true },
    { id: "tomorrow", label: "Tomorrow", visible: true },
    { id: "balance",  label: "Balance",  visible: hasBalanceMetrics },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  return (
    <div className="card-surface rounded-xs border border-border overflow-hidden">
      {/* Tab pills */}
      <div className="flex items-center gap-1 p-1.5 bg-muted/20">
        {visibleTabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative flex-1 h-8 rounded-full text-[12px] font-semibold transition-colors ${
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="trends-tab-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      <div className="p-4">
        {activeTab === "week" && <WeeklyLoadPlan metrics={metrics} />}
        {activeTab === "strain" && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
              7-day strain trend
            </div>
            <Suspense fallback={<div className="h-[180px] w-full animate-pulse bg-muted/20 rounded-xs" />}>
              <StrainChart strainHistory={metrics.strainHistory} forecast={metrics.forecast} />
            </Suspense>
          </>
        )}
        {activeTab === "tomorrow" && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
              Projected tomorrow
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <AnimatedNumber
                  value={metrics.forecast.predictedStrain}
                  format={(n) => n.toFixed(1)}
                  className="text-[22px] font-bold display-number text-foreground tabular-nums"
                />
                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Strain</div>
              </div>
              <div className="text-center">
                {metrics.loadConfidence.isReliable ? (
                  <div className={`text-[18px] font-bold ${getLoadZoneStyle(metrics.forecast.predictedLoadZone.zone).color}`}>
                    {metrics.forecast.predictedLoadZone.label}
                  </div>
                ) : (
                  <div className="text-[18px] font-bold text-muted-foreground">Building</div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Load</div>
              </div>
              <div className="text-center">
                <AnimatedNumber
                  value={Math.round(metrics.forecast.predictedOvertrainingScore)}
                  className="text-[22px] font-bold display-number text-foreground tabular-nums"
                />
                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">OT score</div>
              </div>
            </div>
          </>
        )}
        {activeTab === "balance" && metrics.balanceMetrics && (
          <BalanceMetricsCard balanceMetrics={metrics.balanceMetrics} />
        )}
      </div>
    </div>
  );
}

