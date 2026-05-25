import { useState, useEffect, useCallback, useRef, useMemo, memo, lazy, Suspense } from "react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Icon, type IonIconName } from "@/components/ui/Icon";

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
// Lazy-load the recharts-backed StrainChart so the ~100KB charts bundle defers until first paint.
const StrainChart = lazy(() => import("./StrainChart").then(m => ({ default: m.StrainChart })));
import { ReadinessBreakdownCard } from "./ReadinessBreakdownCard";
import { BalanceMetricsCard } from "./BalanceMetricsCard";
import { WellnessCheckIn } from "./WellnessCheckIn";
import { WeeklyLoadPlan } from "./WeeklyLoadPlan";
import { RecoveryHelpSheet } from "./RecoveryHelpSheet";
import { computeAllMetrics, type SessionRow, type AllMetrics, type ReadinessResult, type WellnessCheckIn as WellnessCheckInData, type PersonalBaseline } from "@/utils/performanceEngine";
import { loadOrComputeBaseline, computeAndStoreBaseline, storeReadinessScore } from "@/utils/baselineComputer";
import { useUser } from "@/contexts/UserContext";
import { logger } from "@/lib/logger";
import ErrorBoundary from "@/components/ErrorBoundary";

// Probe component: reads the streak query in isolation so an
// undeployed-function error (e.g. local Convex not pushed yet) can be
// swallowed by the surrounding ErrorBoundary without crashing the whole
// dashboard. Reports the latest streak back to the parent via callback.
function StreakProbe({ onStreak }: { onStreak: (n: number) => void }) {
  const res = useQuery(api.wellness.getCheckInStreak, {});
  const value = res?.streak ?? 0;
  useEffect(() => { onStreak(value); }, [value, onStreak]);
  return null;
}

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

// ── Plain-language verdict ─────────────────────────────────────────────
// Single source of truth for readiness → user-facing copy. Thresholds match
// the engine's label boundaries (80/55/35 in performanceEngine/readiness.ts),
// nudged slightly toward the design brief.
function readinessVerdict(score: number): { line: string; tone: string; tag: string } {
  if (score >= 80) return { line: "You're locked in — push today.",   tone: "text-func-recovery-green", tag: "Push session" };
  if (score >= 60) return { line: "Solid base — train smart.",        tone: "text-blue-300",            tag: "Steady session" };
  if (score >= 40) return { line: "Run easy and watch fatigue.",      tone: "text-func-warning-yellow", tag: "Take it light" };
  return                  { line: "Recover hard today.",              tone: "text-func-danger-red",     tag: "Recover today" };
}

// Sub-line ("why") shown under the verdict in smaller text.
function contextLine(metrics: AllMetrics, checkedInToday: boolean): string {
  const { readiness, overtrainingRisk, loadZone, weeklySessionCount, loadConfidence } = metrics;
  const loadReliable = loadConfidence.isReliable;
  if (overtrainingRisk.zone === "critical") return "Real signs of overdoing it — a day off pays off the rest of the week.";
  if (overtrainingRisk.zone === "high") return "You've been pushing hard. Keep today light or skill-based.";
  if (readiness.label === "strained") return "Run down — focus on sleep, food, and stretching today.";
  if (readiness.label === "recovering") return "Still catching up from recent work — a moderate session is the smart call.";
  if (loadReliable && loadZone.zone === "overreaching") return "Much harder than usual this week. Ease off so your body can adapt.";
  if (loadReliable && loadZone.zone === "detraining") return `Only ${weeklySessionCount} session${weeklySessionCount === 1 ? "" : "s"} this week. A solid effort today gets you back into rhythm.`;
  if (!loadReliable) return "Still learning your normal training pattern. Train how your body feels.";
  if (!checkedInToday) return "Based on your recent training. Do a quick check-in for a more personalised read.";
  return "Training and recovery are well balanced. A normal session is the right call.";
}

function strainInterp(strain: number): string {
  if (strain < 7)  return "Building";
  if (strain < 12) return "Moderate";
  if (strain < 17) return "Above your norm";
  return            "All-out";
}

function strainColor(strain: number): string {
  if (strain < 7)  return "text-foreground";
  if (strain < 12) return "text-func-recovery-green";
  if (strain < 17) return "text-func-warning-yellow";
  return            "text-func-danger-red";
}

function otBadge(zone: 'low' | 'moderate' | 'high' | 'critical'): { label: string; tone: string; iconTone: string } {
  if (zone === "low")      return { label: "Low risk",      tone: "text-func-recovery-green border border-func-recovery-green/30", iconTone: "text-func-recovery-green" };
  if (zone === "moderate") return { label: "Watch fatigue", tone: "text-func-warning-yellow border border-func-warning-yellow/30", iconTone: "text-func-warning-yellow" };
  if (zone === "high")     return { label: "High risk",     tone: "text-func-danger-red border border-func-danger-red/30",        iconTone: "text-func-danger-red" };
  return                          { label: "Critical",      tone: "text-func-danger-red border border-func-danger-red/40",        iconTone: "text-func-danger-red" };
}

function loadZoneStyle(zone: string) {
  switch (zone) {
    case 'optimal':     return 'text-func-recovery-green';
    case 'detraining':  return 'text-blue-400';
    case 'pushing':     return 'text-func-warning-yellow';
    case 'overreaching':return 'text-func-danger-red';
    default:            return 'text-muted-foreground';
  }
}

// Milestone streaks that trigger confetti. Chosen to feel rewarding but not
// spammy — 3 is the "you're starting a habit" moment.
const CONFETTI_MILESTONES = [3, 7, 14, 30, 60, 100];

async function fireConfetti() {
  // Dynamic import so canvas-confetti only loads when actually needed.
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.3 },
      ticks: 90,
      scalar: 0.9,
    });
  } catch (err) {
    logger.warn("RecoveryDashboard: confetti failed to load", { err });
  }
}

export const RecoveryDashboard = memo(function RecoveryDashboard({ sessions28d, userId, athleteProfile, tdee }: RecoveryDashboardProps) {
  const { profile: _profile } = useUser();
  void _profile;
  const [metrics, setMetrics] = useState<AllMetrics | null>(null);
  const prefersReduced = useReducedMotion();

  // Enhanced wellness state
  const [wellnessCheckIn, setWellnessCheckIn] = useState<WellnessCheckInData | null>(null);
  const [baseline, setBaseline] = useState<PersonalBaseline | null>(null);
  const [todayCheckedIn, setTodayCheckedIn] = useState(false);
  const [checkInDaysCount, setCheckInDaysCount] = useState(0);
  const [sleepLogs, setSleepLogs] = useState<{ date: string; hours: number }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wellnessSheetOpen, setWellnessSheetOpen] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
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

  const checkinsRows = useQuery(api.wellness.listCheckins, userId ? { from: todayStr, to: todayStr, limit: 1 } : "skip");
  const checkinHistoryRows = useQuery(api.wellness.listCheckins, userId ? { limit: 90 } : "skip");
  const sleepRows = useQuery(api.sleep_logs.listForUser, userId ? { limit: 90 } : "skip");
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    baselineLoadedRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (baselineLoadedRef.current) return;
    baselineLoadedRef.current = true;
    loadOrComputeBaseline(userId, tdee)
      .then((b) => { if (b) setBaseline(b); })
      .catch((err) => logger.warn("RecoveryDashboard: baseline fetch failed", { err }));
  }, [userId, tdee]);

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

  const sessions28dFingerprint = useMemo(
    () => sessions28d.map((s: any) => `${s.id ?? s._id ?? ''}:${s.date ?? ''}:${s.updatedAt ?? s.updated_at ?? ''}`).join('|'),
    [sessions28d],
  );

  useEffect(() => {
    const prevReadiness: number | null = AIPersistence.load(userId, 'prev_readiness');
    if (sessions28d.length > 0) {
      setMetrics(computeAllMetrics(
        sessions28d, athleteProfile?.trainingFrequency, athleteProfile?.activityLevel,
        wellnessCheckIn, baseline, prevReadiness, sleepLogs,
      ));
    } else {
      setMetrics(computeAllMetrics(
        [], undefined, undefined, wellnessCheckIn, baseline, prevReadiness, sleepLogs,
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions28dFingerprint, athleteProfile?.trainingFrequency, athleteProfile?.activityLevel, wellnessCheckIn, baseline, userId, sleepLogs]);

  const lastStoredScoreRef = useRef<number | null>(null);
  useEffect(() => {
    const score = metrics?.readiness.score;
    if (score == null) return;
    if (lastStoredScoreRef.current === score) return;
    lastStoredScoreRef.current = score;

    AIPersistence.save(userId, 'prev_readiness', score, 48);

    if (todayCheckedIn) {
      const today = new Date().toISOString().split('T')[0];
      storeReadinessScore(userId, today, score);
    }
  }, [metrics?.readiness.score, userId, todayCheckedIn]);

  // ── Confetti on milestone streak ─────────────────────────────────────
  useEffect(() => {
    if (!userId || streak === 0) return;
    if (prefersReduced) return;
    if (!CONFETTI_MILESTONES.includes(streak)) return;
    const storageKey = `recovery-streak-celebrated:${userId}`;
    const lastCelebrated = Number(localStorage.getItem(storageKey) ?? "0");
    if (lastCelebrated >= streak) return;
    localStorage.setItem(storageKey, String(streak));
    fireConfetti();
  }, [streak, userId, prefersReduced]);

  const handleWellnessSubmit = useCallback(async (data: WellnessCheckInData) => {
    setWellnessCheckIn(data);
    setTodayCheckedIn(true);
    setCheckInDaysCount(prev => prev + 1);
    computeAndStoreBaseline(userId, tdee).then(b => {
      if (b) setBaseline(b);
    }).catch(() => {});
  }, [userId, tdee]);

  if (!metrics) return null;

  const verdict = readinessVerdict(metrics.readiness.score);
  const why = contextLine(metrics, todayCheckedIn);
  const ot = otBadge(metrics.overtrainingRisk.zone);

  const toggleCard = (id: string) => setExpandedCard(prev => prev === id ? null : id);

  return (
    <div className="space-y-4 mb-6">
      {/* Isolated streak query — if the function isn't deployed yet
          (or fails), the ErrorBoundary swallows it and `streak` stays 0. */}
      {userId && (
        <ErrorBoundary fallback={null} silent>
          <StreakProbe onStreak={setStreak} />
        </ErrorBoundary>
      )}
      {/* ── Hero card ─────────────────────────────────────────────────── */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", damping: 22, stiffness: 260 }}
        className="relative overflow-hidden card-surface rounded-2xl border border-border/50 p-5"
      >
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="How to read this page"
          className="absolute top-3 right-3 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground/70 active:text-foreground transition-colors"
        >
          <Icon name="helpCircleOutline" size={18} />
        </button>

        {/* Top row: streak chip + today's-call tag */}
        <div className="flex items-center gap-2 pr-9">
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, type: "spring", damping: 22, stiffness: 280 }}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 text-primary px-2.5 py-1 text-[11px] font-bold"
          >
            <Icon name="flameOutline" size={12} />
            {streak > 0 ? `${streak}-day streak` : "Start a streak"}
          </motion.div>
          <div className="ml-auto text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
            Today's call · <span className="text-foreground/80 normal-case tracking-normal font-bold">{verdict.tag}</span>
          </div>
        </div>

        {/* Center: huge readiness number */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, type: "spring", damping: 24, stiffness: 240 }}
          className="mt-4 flex flex-col items-center text-center"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Readiness</span>
          <AnimatedNumber
            value={metrics.readiness.score}
            className="text-[72px] leading-none font-display font-bold tabular-nums text-foreground"
          />
          <p className={`mt-3 text-[18px] font-semibold leading-snug ${verdict.tone}`}>
            {verdict.line}
          </p>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-snug max-w-[34ch]">
            {why}
          </p>
        </motion.div>
      </motion.div>

      {/* ── Daily check-in tile (above the stack so it's prominent) ─── */}
      {!todayCheckedIn && hasEnoughData && (
        <motion.button
          type="button"
          onClick={() => setWellnessSheetOpen(true)}
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, type: "spring", damping: 24, stiffness: 260 }}
          className="group w-full text-left card-surface rounded-2xl p-4 border border-primary/30 hover:border-primary/50 active:scale-[0.99] transition-all"
          aria-label="Open daily check-in"
        >
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 shrink-0 rounded-2xl border border-primary/30 flex items-center justify-center text-primary">
              <Icon name="bulbOutline" size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Daily check-in {streak > 0 ? `· keep your ${streak}-day streak` : ""}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold leading-tight text-foreground">
                How are you feeling today?
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                4 quick taps
              </p>
            </div>
            <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wider text-primary group-hover:translate-x-0.5 transition-transform">
              <span>~20s</span>
              <Icon name="chevronForwardOutline" size={14} />
            </span>
          </div>
        </motion.button>
      )}

      {/* ── Expandable card stack ────────────────────────────────────── */}
      <div className="space-y-2.5">
        <ExpandableMetricCard
          id="strain"
          index={0}
          iconName="pulseOutline"
          iconTone="text-primary border border-primary/30"
          title="Strain"
          summary={
            <>
              <AnimatedNumber value={metrics.strain} format={(n) => n.toFixed(1)} className={`text-[18px] font-bold tabular-nums ${strainColor(metrics.strain)}`} />
              <span className="text-muted-foreground text-[12px] ml-1">/ 21</span>
              <span className="ml-2 text-[12px] text-muted-foreground">{strainInterp(metrics.strain)}</span>
            </>
          }
          expanded={expandedCard === "strain"}
          onToggle={() => toggleCard("strain")}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
            7-day strain trend
          </div>
          <Suspense fallback={<div className="h-[180px] w-full animate-pulse bg-muted/20 rounded-xs" />}>
            <StrainChart strainHistory={metrics.strainHistory} forecast={metrics.forecast} />
          </Suspense>
          <div className="mt-4 pt-3 grid grid-cols-3 gap-3 border-t border-border/30">
            <ProjectedStat label="Strain" value={<AnimatedNumber value={metrics.forecast.predictedStrain} format={(n) => n.toFixed(1)} className="text-[22px] font-bold display-number text-foreground tabular-nums" />} />
            <ProjectedStat label="Load" value={
              metrics.loadConfidence.isReliable ? (
                <div className={`text-[18px] font-bold ${loadZoneStyle(metrics.forecast.predictedLoadZone.zone)}`}>
                  {metrics.forecast.predictedLoadZone.label}
                </div>
              ) : (
                <div className="text-[18px] font-bold text-muted-foreground">Building</div>
              )
            } />
            <ProjectedStat label="OT score" value={<AnimatedNumber value={Math.round(metrics.forecast.predictedOvertrainingScore)} className="text-[22px] font-bold display-number text-foreground tabular-nums" />} />
          </div>
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="sleep"
          index={1}
          iconName="bedOutline"
          iconTone="text-blue-300 border border-blue-300/30"
          title="Sleep"
          summary={
            <>
              <AnimatedNumber value={metrics.sleepScore} className="text-[18px] font-bold tabular-nums text-foreground" />
              <span className="text-muted-foreground text-[12px] ml-1">/ 100</span>
              <span className="ml-2 text-[12px] text-muted-foreground">
                3-night avg: {metrics.avgSleepLast3 > 0 ? `${metrics.avgSleepLast3.toFixed(1)}h` : "—"}
              </span>
            </>
          }
          expanded={expandedCard === "sleep"}
          onToggle={() => toggleCard("sleep")}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Last night</div>
              <div className="mt-1 text-[24px] font-bold tabular-nums text-foreground">
                {metrics.latestSleep > 0 ? `${metrics.latestSleep.toFixed(1)}h` : "—"}
              </div>
            </div>
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">3-night average</div>
              <div className="mt-1 text-[24px] font-bold tabular-nums text-foreground">
                {metrics.avgSleepLast3 > 0 ? `${metrics.avgSleepLast3.toFixed(1)}h` : "—"}
              </div>
            </div>
          </div>
          {sleepLogs.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Last 7 nights</div>
              <SleepSparkline logs={sleepLogs.slice(-7)} />
            </div>
          )}
          <div className="mt-3 text-[12px] text-muted-foreground leading-snug">
            Sleep score blends duration vs. your needs and recent consistency. Aim for 7-9 hours, consistent bed-time.
          </div>
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="risk"
          index={2}
          iconName="alertCircleOutline"
          iconTone={`${ot.iconTone} border border-border/40`}
          title="Overtraining risk"
          summary={
            <>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${ot.tone}`}>
                {ot.label}
              </span>
              <span className="ml-2 text-[12px] text-muted-foreground tabular-nums">
                {Math.round(metrics.overtrainingRisk.score)} / 100
              </span>
            </>
          }
          expanded={expandedCard === "risk"}
          onToggle={() => toggleCard("risk")}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">7d avg RPE</div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{metrics.avgRPE7d.toFixed(1)}</div>
            </div>
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">7d sessions</div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{metrics.sessionsLast7d}</div>
            </div>
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Consecutive high days</div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{metrics.consecutiveHighDays}</div>
            </div>
            <div className="rounded-xs bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">7d soreness</div>
              <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{metrics.avgSoreness7d.toFixed(1)}</div>
            </div>
          </div>
          {metrics.balanceMetrics && metrics.balanceMetrics.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border/30">
              <BalanceMetricsCard balanceMetrics={metrics.balanceMetrics} />
            </div>
          )}
        </ExpandableMetricCard>

        <ExpandableMetricCard
          id="weekly"
          index={3}
          iconName="barChartOutline"
          iconTone="text-func-recovery-green border border-func-recovery-green/30"
          title="Weekly load"
          summary={
            <>
              {metrics.loadConfidence.isReliable ? (
                <span className={`text-[14px] font-bold ${loadZoneStyle(metrics.loadZone.zone)}`}>{metrics.loadZone.label}</span>
              ) : (
                <span className="text-[14px] font-bold text-muted-foreground">Building baseline</span>
              )}
              <span className="ml-2 text-[12px] text-muted-foreground">{metrics.weeklySessionCount} session{metrics.weeklySessionCount === 1 ? "" : "s"} this week</span>
            </>
          }
          expanded={expandedCard === "weekly"}
          onToggle={() => toggleCard("weekly")}
        >
          <WeeklyLoadPlan metrics={metrics} />
        </ExpandableMetricCard>
      </div>

      {/* Readiness Breakdown Card (kept standalone — has its own collapse) */}
      <ReadinessBreakdownCard
        breakdown={metrics.readiness.breakdown}
        totalCheckInDays={checkInDaysCount}
      />

      {/* Caloric Deficit Banner */}
      {metrics.deficitImpactScore != null && metrics.deficitImpactScore < 60 && baseline?.avg_deficit_7d != null && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, type: "spring", damping: 24, stiffness: 260 }}
          className="card-surface rounded-2xl p-3 border border-func-warning-yellow/30"
        >
          <div className="flex items-center gap-2">
            <Icon name="warningOutline" size={16} className="text-func-warning-yellow shrink-0" />
            <div>
              <p className="text-xs font-semibold text-func-warning-yellow">
                Caloric Deficit Impacting Recovery
              </p>
              <p className="text-[10px] text-func-warning-yellow/70 mt-0.5">
                {Math.abs(baseline.avg_deficit_7d).toFixed(0)}kcal avg deficit (7d) — recovery impact score {metrics.deficitImpactScore}/100
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Wellness check-in sheet */}
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
              <Icon name="closeOutline" size={16} />
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

      <RecoveryHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
});

// ── Helpers ────────────────────────────────────────────────────────────

function ProjectedStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-center">
      {value}
      <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function SleepSparkline({ logs }: { logs: { date: string; hours: number }[] }) {
  if (logs.length === 0) return null;
  const max = Math.max(9, ...logs.map(l => l.hours));
  return (
    <div className="flex items-end gap-1 h-12">
      {logs.map((l) => {
        const pct = Math.max(8, (l.hours / max) * 100);
        const colour = l.hours >= 7 ? "bg-func-recovery-green/60" : l.hours >= 6 ? "bg-func-warning-yellow/60" : "bg-func-danger-red/60";
        return (
          <div key={l.date} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-full rounded-sm ${colour}`} style={{ height: `${pct}%` }} title={`${l.date}: ${l.hours}h`} />
            <span className="text-[9px] text-muted-foreground tabular-nums">{l.hours.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── ExpandableMetricCard ───────────────────────────────────────────────
// Single-line collapsed summary; tap to expand into the children content.
// Uses motion's AnimatePresence + height: "auto" for a smooth reveal.
type ExpandableMetricCardProps = {
  id: string;
  iconName: IonIconName;
  iconTone: string;
  title: string;
  summary: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  index?: number;
};

function ExpandableMetricCard({ iconName, iconTone, title, summary, expanded, onToggle, children, index = 0 }: ExpandableMetricCardProps) {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22 + index * 0.04, type: "spring", damping: 24, stiffness: 260 }}
      className="card-surface rounded-2xl border border-border/50 overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left active:bg-muted/10 transition-colors"
        aria-expanded={expanded}
      >
        <div className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${iconTone}`}>
          <Icon name={iconName} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">{title}</div>
          <div className="mt-0.5 flex items-baseline flex-wrap gap-x-1">{summary}</div>
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-muted-foreground">
          <Icon name="chevronDownOutline" size={16} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.25 }, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border/30">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
