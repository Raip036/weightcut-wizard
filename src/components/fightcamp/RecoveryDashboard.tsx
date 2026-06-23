// T12: RecoveryDashboard rewrite — composes the new components
// (GasTankBar, DriverStack, RecoveryPillarAccordion) into a redesigned page.
// Hero card has been redesigned to surface the action-line + 3 pillar
// mini-scores at-a-glance. The 4 legacy ExpandableMetricCards, the standalone
// BalanceMetricsCard, ReadinessBreakdownCard, WeeklyLoadPlan and the
// caloric-deficit banner have all been folded into the new components.
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  useId,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { AIPersistence } from "@/lib/aiPersistence";
import { WellnessCheckIn } from "./WellnessCheckIn";
import { RecoveryHelpSheet } from "./RecoveryHelpSheet";
import { GasTankBar, toneFromReadiness } from "./GasTankBar";
import { DriverStack } from "./DriverStack";
import {
  RecoveryPillarAccordion,
  type PillarKey,
} from "./RecoveryPillarAccordion";
import { CampCompassCard } from "./CampCompassCard";
import { ReadinessFlexSheet } from "@/components/share/cards/ReadinessFlexSheet";
import { ComebackSheet } from "@/components/share/cards/ComebackSheet";
import { FightWeekFormSheet } from "@/components/share/cards/FightWeekFormSheet";
import type { ReadinessTone } from "@/components/share/cards/ReadinessFlexCard";
import {
  useComebackTrigger,
  computeProtocolsCompleted,
} from "@/hooks/recovery/useComebackTrigger";
import { useFightWeekTrigger } from "@/hooks/recovery/useFightWeekTrigger";
import {
  computeAllMetrics,
  type SessionRow,
  type AllMetrics,
  type WellnessCheckIn as WellnessCheckInData,
  type PersonalBaseline,
} from "@/utils/performanceEngine";
import {
  loadOrComputeBaseline,
  computeAndStoreBaseline,
  storeReadinessScore,
} from "@/utils/baselineComputer";
import { useUser } from "@/contexts/UserContext";
import { useModelMigrationToast } from "@/hooks/recovery/useModelMigrationToast";
import { logger } from "@/lib/logger";
import ErrorBoundary from "@/components/ErrorBoundary";

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

// ── Readiness rings (Trio Rings) ───────────────────────────────────────
// Three concentric Apple-Fitness-style arcs for the recovery / body / load
// pillars, drawn around the central readiness number (rendered by HeroCard).
// Slim strokes + a wide inner clear zone (~134px) keep the centre number and
// tier badge clear of the innermost arc. Cheap + composited: only
// stroke-dashoffset animates; the thin arc drop-shadow is enhancement-only
// (.native-app strips it — visuals read fine without it).
const RING_SIZE = 248;
const RING_CENTER = RING_SIZE / 2;
const RING_STROKE = 13;
const RING_GAP = 7;
const RING_PAD = 4;
const RING_RADII = [
  RING_CENTER - RING_STROKE / 2 - RING_PAD, // outer (recovery)
  RING_CENTER - RING_STROKE / 2 - RING_PAD - (RING_STROKE + RING_GAP), // middle (body)
  RING_CENTER - RING_STROKE / 2 - RING_PAD - 2 * (RING_STROKE + RING_GAP), // inner (load)
];
const RING_TRACK = "rgba(255,255,255,0.055)";

// Ring + legend colours. The outer readiness ring uses the tier accent
// (passed in per-render); the two inner rings are the recovery + load
// pillars. Body lives in the RecoveryPillarAccordion below the hero.
const RING_RECOVERY_COLOR = "#12CAE6"; // func-hydration-cyan
const RING_LOAD_COLOR = "#2A5BDD"; // func-protein-blue

function PillarRing({
  radius,
  color,
  value,
  index,
  reducedMotion,
}: {
  radius: number;
  color: string;
  value: number | null;
  index: number;
  reducedMotion: boolean;
}) {
  const circumference = 2 * Math.PI * radius;
  const fraction = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const id = `rd-ring-grad-${index}`;
  return (
    <g transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}>
      <circle
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={radius}
        fill="none"
        stroke={RING_TRACK}
        strokeWidth={RING_STROKE}
      />
      {value != null && (
        <>
          <defs>
            <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity={0.65} />
              <stop offset="60%" stopColor={color} stopOpacity={0.95} />
              <stop offset="100%" stopColor={color} stopOpacity={1} />
            </linearGradient>
          </defs>
          <motion.circle
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={radius}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ filter: `drop-shadow(0 0 5px ${color}55)` }}
            initial={reducedMotion ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - fraction) }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : {
                    duration: 1.2,
                    delay: 0.15 + index * 0.16,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
          />
        </>
      )}
    </g>
  );
}

function ReadinessRings({
  score,
  accent,
  pillars,
  reducedMotion,
}: {
  score: number;
  accent: string;
  pillars: { recovery: number | null; body: number | null; load: number | null };
  reducedMotion: boolean;
}) {
  // outer → inner: readiness (tier accent), recovery (cyan), load (blue).
  const rings = [
    { value: score as number | null, color: accent },
    { value: pillars.recovery, color: RING_RECOVERY_COLOR },
    { value: pillars.load, color: RING_LOAD_COLOR },
  ];
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="relative block"
      aria-hidden
    >
      {rings.map((r, i) => (
        <PillarRing
          key={i}
          radius={RING_RADII[i]}
          color={r.color}
          value={r.value}
          index={i}
          reducedMotion={reducedMotion}
        />
      ))}
    </svg>
  );
}

// Tier → hex for the centre glow + badge tint (CSS vars can't be used in
// inline-style colour math). GREEN→recovery-green, AMBER→warning-yellow,
// RED→danger-red.
function tierHex(tier: string): string {
  if (tier === "GREEN") return "#23C599";
  if (tier === "AMBER") return "#FAC146";
  if (tier === "RED") return "#F7403F";
  return "#9CA3AF";
}
function tierHexDark(tier: string): string {
  if (tier === "GREEN") return "#1AA37E";
  if (tier === "AMBER") return "#D99A1F";
  if (tier === "RED") return "#C92F2E";
  return "#6B7280";
}

// Isolated streak query — if the function isn't deployed yet (or fails), the
// surrounding ErrorBoundary swallows it and `streak` stays 0.
function StreakProbe({ onStreak }: { onStreak: (n: number) => void }) {
  const res = useQuery(api.wellness.getCheckInStreak, {});
  const value = res?.streak ?? 0;
  useEffect(() => {
    onStreak(value);
  }, [value, onStreak]);
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
  sessionLoggedAt?: number;
  athleteProfile?: AthleteBaseline;
  tdee?: number | null;
}

// ── Plain-language verdict ─────────────────────────────────────────────
// Single source of truth for readiness → user-facing copy. Thresholds match
// the engine's label boundaries (80/55/35 in performanceEngine/readiness.ts).
function readinessVerdict(score: number): { line: string; tone: string; tier: string } {
  if (score >= 80)
    return { line: "You're locked in - push.", tone: "text-func-recovery-green", tier: "GREEN" };
  if (score >= 60)
    return { line: "Solid base - train smart.", tone: "text-blue-300", tier: "GREEN" };
  if (score >= 40)
    return { line: "Run easy and watch fatigue.", tone: "text-func-warning-yellow", tier: "AMBER" };
  return { line: "Recover hard today.", tone: "text-func-danger-red", tier: "RED" };
}

// Border-top stripe colour per tier — 2px coloured line, no flood.
function tierBorderColor(tier: string): string {
  if (tier === "GREEN") return "border-t-func-recovery-green/80";
  if (tier === "AMBER") return "border-t-func-warning-yellow/80";
  if (tier === "RED") return "border-t-func-danger-red/80";
  return "border-t-border/50";
}

// Gas-tank one-liner copy (kept here so we don't bloat GasTankBar's API).
function gasTankOneLiner(score: number): string {
  if (score >= 80) return "Full tank - push it.";
  if (score >= 60) return "Plenty in the tank - train smart.";
  if (score >= 40) return "Half-full - keep it controlled.";
  if (score >= 25) return "Low fuel - easy day.";
  return "Tank's empty - recover hard.";
}

// T19: Last-5-days readiness curve for FightWeekFormCard. Takes the
// existing `readiness_7d` history (the rolling array T12 maintains via
// AIPersistence) plus today's live score, and returns oldest → newest
// {date, score|null} pairs anchored on `today`. Pads with nulls when the
// stored history is shorter than 5 — the card renders those as dim empty
// bars so a partial week still ships.
//
// History semantics: `readiness_7d` is a flat number[] appended in time
// order. We don't know the original timestamps, so we treat the last 4
// entries as the 4 days preceding today (today - 4d .. today - 1d) and
// use today's live score for the 5th slot. Good enough for the share
// card — the bars are a narrative, not a forensic record.
function buildLast5DaysCurve(
  history: number[],
  todayScore: number,
  today: Date,
): Array<{ date: Date; score: number | null }> {
  const recent4 = history.slice(-4); // up to 4 prior days
  const padded: Array<number | null> = [
    ...Array(Math.max(0, 4 - recent4.length)).fill(null),
    ...recent4,
    todayScore,
  ];
  return padded.map((score, i) => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (4 - i));
    return { date: d, score };
  });
}

// Milestone streaks that trigger confetti.
const CONFETTI_MILESTONES = [3, 7, 14, 30, 60, 100];

async function fireConfetti() {
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

// ── Long-press hook ───────────────────────────────────────────────────
// Returns pointer handlers that fire `onLongPress` after `ms` of contact
// (default 500ms). Cancels on pointer move > 10px or pointer up/leave.
function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cbRef = useRef(onLongPress);
  useEffect(() => {
    cbRef.current = onLongPress;
  }, [onLongPress]);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        cbRef.current();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
    },
    onPointerUp: () => clear(),
    onPointerLeave: () => clear(),
    onPointerCancel: () => clear(),
  };
}

export const RecoveryDashboard = memo(function RecoveryDashboard({
  sessions28d,
  userId,
  athleteProfile,
  tdee,
}: RecoveryDashboardProps) {
  const { profile, userName } = useUser();
  const [metrics, setMetrics] = useState<AllMetrics | null>(null);
  const prefersReduced = useReducedMotion();

  // Wellness state
  const [wellnessCheckIn, setWellnessCheckIn] = useState<WellnessCheckInData | null>(null);
  const [baseline, setBaseline] = useState<PersonalBaseline | null>(null);
  const [todayCheckedIn, setTodayCheckedIn] = useState(false);
  const [checkInDaysCount, setCheckInDaysCount] = useState(0);
  const [sleepLogs, setSleepLogs] = useState<{ date: string; hours: number }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [wellnessSheetOpen, setWellnessSheetOpen] = useState(false);
  const [openPillar, setOpenPillar] = useState<PillarKey | null>(null);
  const baselineLoadedRef = useRef(false);
  const pillarRefs = useRef<Partial<Record<PillarKey, HTMLDivElement | null>>>({});
  const helpId = useId();

  const uniqueDays = new Set(sessions28d.map((s) => s.date)).size;
  const hasEnoughData = uniqueDays >= 1;

  // T7: one-time toast announcing the training-load model upgrade.
  useModelMigrationToast(userId, sessions28d.length > 0);

  // ── Active fight camp → daysToFight (passed to engine for camp-phase calc) ──
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");
  const daysToFight = useMemo<number | null>(() => {
    if (!activeCamp || activeCamp.isCompleted || !activeCamp.fightDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fight = new Date(activeCamp.fightDate);
    fight.setHours(0, 0, 0, 0);
    const days = Math.ceil((fight.getTime() - today.getTime()) / 86_400_000);
    return days >= 0 ? days : null;
  }, [activeCamp]);

  // ── Live-reactive Convex subscriptions for wellness + sleep ──
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const from28dStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().split("T")[0];
  }, []);

  const checkinsRows = useQuery(
    api.wellness.listCheckins,
    userId ? { from: todayStr, to: todayStr, limit: 1 } : "skip",
  );
  const checkinHistoryRows = useQuery(
    api.wellness.listCheckins,
    userId ? { limit: 90 } : "skip",
  );
  const sleepRows = useQuery(api.sleep_logs.listForUser, userId ? { limit: 90 } : "skip");
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    baselineLoadedRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (baselineLoadedRef.current) return;
    baselineLoadedRef.current = true;
    loadOrComputeBaseline(userId, tdee)
      .then((b) => {
        if (b) setBaseline(b);
      })
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
    () =>
      sessions28d
        .map(
          (s: any) =>
            `${s.id ?? s._id ?? ""}:${s.date ?? ""}:${s.updatedAt ?? s.updated_at ?? ""}`,
        )
        .join("|"),
    [sessions28d],
  );

  useEffect(() => {
    const prevReadiness: number | null = AIPersistence.load(userId, "prev_readiness");
    if (sessions28d.length > 0) {
      setMetrics(
        computeAllMetrics(
          sessions28d,
          athleteProfile?.trainingFrequency,
          athleteProfile?.activityLevel,
          wellnessCheckIn,
          baseline,
          prevReadiness,
          sleepLogs,
          daysToFight,
        ),
      );
    } else {
      setMetrics(
        computeAllMetrics(
          [],
          undefined,
          undefined,
          wellnessCheckIn,
          baseline,
          prevReadiness,
          sleepLogs,
          daysToFight,
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessions28dFingerprint,
    athleteProfile?.trainingFrequency,
    athleteProfile?.activityLevel,
    wellnessCheckIn,
    baseline,
    userId,
    sleepLogs,
    daysToFight,
  ]);

  // Persist readiness for delta-tracking + Convex history.
  const lastStoredScoreRef = useRef<number | null>(null);
  useEffect(() => {
    const score = metrics?.readiness.score;
    if (score == null) return;
    if (lastStoredScoreRef.current === score) return;
    lastStoredScoreRef.current = score;

    AIPersistence.save(userId, "prev_readiness", score, 48);

    // 7-day readiness history for hero delta — cap at 7 entries.
    const prev7d: number[] = AIPersistence.load(userId, "readiness_7d") || [];
    const next7d = [...prev7d, score].slice(-7);
    AIPersistence.save(userId, "readiness_7d", next7d, 48);

    if (todayCheckedIn) {
      const today = new Date().toISOString().split("T")[0];
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

  const handleWellnessSubmit = useCallback(
    async (data: WellnessCheckInData) => {
      setWellnessCheckIn(data);
      setTodayCheckedIn(true);
      setCheckInDaysCount((prev) => prev + 1);
      computeAndStoreBaseline(userId, tdee)
        .then((b) => {
          if (b) setBaseline(b);
        })
        .catch(() => {});
    },
    [userId, tdee],
  );

  // Tap a hero mini-pillar → smoothly scroll to that pillar + auto-expand.
  const handlePillarTap = useCallback((key: PillarKey) => {
    setOpenPillar(key);
    // Defer scroll so the accordion has a frame to expand.
    requestAnimationFrame(() => {
      const el = pillarRefs.current[key];
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, []);

  // ── Long-press tooltip state ─────────────────────────────────────────
  const [rawOpen, setRawOpen] = useState(false);
  const longPress = useLongPress(() => setRawOpen(true), 500);

  // ── Flex-card share sheet state ──────────────────────────────────────
  // Sheet opens from the hero's "Flex today" button; only renders when
  // readiness ≥ 85 (gated below, in HeroCard render). We hold the open
  // state up here so the sheet can close cleanly when the dashboard
  // re-renders for any reason.
  const [flexSheetOpen, setFlexSheetOpen] = useState(false);

  // T18: Comeback-card auto-trigger. Watches readiness over 72h; fires a
  // toast with "View" action when current jumps +20 vs the earliest score
  // logged within the prior 48h. Rate-limited to once per ISO-week per
  // user inside the hook. We open ComebackSheet via the toast action and
  // hand it the same window the hook detected.
  const [comebackSheetOpen, setComebackSheetOpen] = useState(false);
  const { triggeredWindow: comebackWindow } = useComebackTrigger({
    userId,
    currentScore: metrics?.readiness.score ?? null,
    onView: () => setComebackSheetOpen(true),
  });

  // T19: Fight-week form-card auto-trigger. Fires a single "Fight week —
  // Form card ready" toast when daysToFight === 7 (idempotency keyed per
  // camp inside the hook). Tapping "View" opens FightWeekFormSheet with
  // the same camp's data the toast referenced.
  const [fightWeekSheetOpen, setFightWeekSheetOpen] = useState(false);
  useFightWeekTrigger({
    userId,
    daysToFight,
    fightDateIso: activeCamp?.fightDate ?? null,
    onView: () => setFightWeekSheetOpen(true),
  });

  if (!metrics) return null;

  // ── Empty state (no sessions yet, no check-in yet) ───────────────────
  if (!hasEnoughData && !todayCheckedIn) {
    return (
      <div className="space-y-4 mb-6">
        {userId && (
          <ErrorBoundary fallback={null} silent>
            <StreakProbe onStreak={setStreak} />
          </ErrorBoundary>
        )}
        <FirstReadCard onStart={() => setWellnessSheetOpen(true)} />
        <LockedPillarsList />
        <WellnessCheckInSheet
          open={wellnessSheetOpen}
          onOpenChange={setWellnessSheetOpen}
          userId={userId}
          onSubmit={handleWellnessSubmit}
        />
        <RecoveryHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    );
  }

  const score = metrics.readiness.score;
  const verdict = readinessVerdict(score);
  const tone = toneFromReadiness(score);
  const fillPct = Math.max(0, Math.min(1, score / 100));
  const { pillars } = metrics;

  // ── Delta vs 7d average readiness ──────────────────────────────────
  const prev7d: number[] = AIPersistence.load(userId, "readiness_7d") || [];
  const mean7d =
    prev7d.length > 0 ? prev7d.reduce((a, b) => a + b, 0) / prev7d.length : score;
  const delta = Math.round(score - mean7d);

  // ── Day-over-day drop → warning shimmer on tier badge ──────────────
  const prevReadiness: number | null = AIPersistence.load(userId, "prev_readiness");
  const droppedHard = prevReadiness != null && prevReadiness - score > 15;

  // ── 7-day readiness sparkline (fallback synth if no history) ──────
  // Timestamp on the hero — HH:MM (24h) for today's call.
  const now = new Date();
  const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const breath = !prefersReduced && score >= 80;

  // Long-press tooltip raw components.
  const b = metrics.readiness.breakdown;

  // ── Flex-card eligibility + tone mapping ───────────────────────────
  // Spec §7.3.a — Flex card only fires at readiness ≥ 85.
  const canFlex = score >= 85;
  const flexTone: ReadinessTone =
    verdict.tier === "GREEN" ? "green" : verdict.tier === "AMBER" ? "amber" : "red";
  // Prefer the live display name; fall back to profile.display_name; finally
  // an empty handle so the card just omits it rather than rendering "@".
  const handleSource = userName?.trim() || profile?.display_name?.trim() || "";
  const flexHandle = handleSource ? `@${handleSource.split(/\s+/)[0].toLowerCase()}` : undefined;

  return (
    <div className="space-y-4 mb-6">
      {/* Isolated streak query — failures stay silent. */}
      {userId && (
        <ErrorBoundary fallback={null} silent>
          <StreakProbe onStreak={setStreak} />
        </ErrorBoundary>
      )}

      {/* ── Hero card ─────────────────────────────────────────────── */}
      <HeroCard
        score={score}
        delta={delta}
        verdict={verdict}
        actionLine={metrics.actionLine}
        pillars={pillars}
        droppedHard={droppedHard}
        breath={breath}
        timeLabel={timeLabel}
        helpId={helpId}
        rawOpen={rawOpen}
        setRawOpen={setRawOpen}
        longPress={longPress}
        onHelp={() => setHelpOpen(true)}
        onPillarTap={handlePillarTap}
        rawSleepScore={b.sleepScore}
        rawStrain={metrics.strain}
        rawHooperIndex={metrics.hooperIndex ?? null}
        canFlex={canFlex}
        onFlex={() => setFlexSheetOpen(true)}
      />

      {/* ── Flex card share sheet — opened from HeroCard's "Flex today" ── */}
      <ReadinessFlexSheet
        open={flexSheetOpen}
        onOpenChange={setFlexSheetOpen}
        userId={userId}
        date={new Date()}
        readiness={score}
        pillars={pillars}
        tone={flexTone}
        userHandle={flexHandle}
      />

      {/* T18: Comeback share sheet — opened by the auto-trigger toast.
          Only rendered when a window has been detected; protocols-completed
          math is deterministic and reads from data already in scope. */}
      {comebackWindow && (
        <ComebackSheet
          open={comebackSheetOpen}
          onOpenChange={setComebackSheetOpen}
          userId={userId}
          oldDate={comebackWindow.oldDate}
          oldScore={comebackWindow.oldScore}
          newDate={comebackWindow.newDate}
          newScore={comebackWindow.newScore}
          protocolsCompleted={computeProtocolsCompleted({
            oldDate: comebackWindow.oldDate,
            newDate: comebackWindow.newDate,
            checkinRows: checkinHistoryRows as Array<{ date: string }> | null | undefined,
            sleepLogs,
            sessions28d,
          })}
          userHandle={flexHandle}
        />
      )}

      {/* T19: Fight-week form-card share sheet — opened by the auto-trigger
          toast 7 days before the fight. The last-5-days array is built
          oldest → newest from today's readiness + the prior 4 entries in
          readiness_7d (T12 already maintains that history). Missing days
          render as dim empty bars in the card. The active camp schema
          carries `eventName` but not an opponent handle; pass `eventName`
          through as the opponent label when present. */}
      {activeCamp?.fightDate && daysToFight != null && (
        <FightWeekFormSheet
          open={fightWeekSheetOpen}
          onOpenChange={setFightWeekSheetOpen}
          fightDate={new Date(activeCamp.fightDate)}
          daysOut={daysToFight}
          last5Days={buildLast5DaysCurve(prev7d, score, new Date())}
          opponentHandle={activeCamp.eventName?.trim() || undefined}
          userHandle={flexHandle}
        />
      )}


      {/* ── Gas Tank bar ────────────────────────────────────────── */}
      <GasTankBar fillPct={fillPct} tone={tone} oneLiner={gasTankOneLiner(score)} />

      {/* ── Daily check-in CTA ───────────────────────────────────── */}
      {!todayCheckedIn && hasEnoughData && (
        <DailyCheckInCTA streak={streak} onOpen={() => setWellnessSheetOpen(true)} />
      )}

      {/* ── DriverStack — "Why · 4 drivers" ──────────────────────── */}
      <DriverStack metrics={metrics} prevReadiness={prevReadiness} />

      {/* ── Pillar accordion (Recovery / Body / Load) ─────────────── */}
      <RecoveryPillarAccordion
        metrics={metrics}
        sleepLogs={sleepLogs}
        open={openPillar}
        onOpenChange={setOpenPillar}
        pillarRefs={pillarRefs}
      />

      {/* ── Camp Compass — weekly Sunday AI recap (Pro-gated) ────── */}
      <CampCompassCard userId={userId} />

      {/* (Streak chip footnote — preserves the count for habit feedback.) */}
      {streak > 0 && (
        <div className="flex justify-center pt-1">
          <div className="inline-flex items-center gap-1 rounded-full border border-primary/30 text-primary px-2.5 py-1 text-[11px] font-bold">
            <Icon name="flameOutline" size={12} />
            {streak}-day streak · {checkInDaysCount} total
          </div>
        </div>
      )}

      {/* ── Wellness check-in sheet ─────────────────────────────── */}
      <WellnessCheckInSheet
        open={wellnessSheetOpen}
        onOpenChange={setWellnessSheetOpen}
        userId={userId}
        onSubmit={handleWellnessSubmit}
      />

      <RecoveryHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
});

// ── HeroCard ────────────────────────────────────────────────────────
// Extracted from the inline JSX so the dashboard body stays focused on
// orchestration. Owns: the big readiness number, breath pulse, long-press
// popover, tier badge w/ warning shimmer, action line, pillar mini-row,
// and 7-day sparkline.
interface HeroCardProps {
  score: number;
  delta: number;
  verdict: { line: string; tone: string; tier: string };
  actionLine: string;
  pillars: { recovery: number | null; body: number | null; load: number | null };
  droppedHard: boolean;
  breath: boolean;
  timeLabel: string;
  helpId: string;
  rawOpen: boolean;
  setRawOpen: (open: boolean) => void;
  longPress: ReturnType<typeof useLongPress>;
  onHelp: () => void;
  onPillarTap: (key: PillarKey) => void;
  rawSleepScore: number;
  rawStrain: number;
  rawHooperIndex: number | null;
  /** Spec §7.3.a — show "Flex today" CTA only when readiness ≥ 85. */
  canFlex: boolean;
  onFlex: () => void;
}

function HeroCard({
  score,
  delta,
  verdict,
  actionLine,
  pillars,
  droppedHard,
  breath,
  timeLabel,
  helpId,
  rawOpen,
  setRawOpen,
  longPress,
  onHelp,
  onPillarTap,
  rawSleepScore,
  rawStrain,
  rawHooperIndex,
  canFlex,
  onFlex,
}: HeroCardProps) {
  const prefersReduced = useReducedMotion();
  const reduce = !!prefersReduced;
  const accent = tierHex(verdict.tier);
  const accentDark = tierHexDark(verdict.tier);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 260 }}
      className={`relative overflow-hidden card-surface rounded-2xl border border-border/50 border-t-2 ${tierBorderColor(verdict.tier)} p-6`}
    >
      {/* Ambient glow — behind everything, clipped by overflow-hidden. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }}
      />

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {!reduce && (
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-60"
                style={{
                  backgroundColor: accent,
                  animation: "ping 1.8s cubic-bezier(0,0,0.2,1) infinite",
                }}
              />
            )}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] tabular-nums text-muted-foreground/70">
            Today's call · {timeLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onHelp}
            aria-label="How to read this page"
            aria-describedby={helpId}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border/50 text-muted-foreground transition-colors active:text-foreground"
          >
            <Icon name="helpCircleOutline" size={16} />
          </button>
          {canFlex && (
            <button
              type="button"
              onClick={onFlex}
              aria-label="Share today's readiness"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border/50 text-muted-foreground transition-colors active:text-foreground"
            >
              <Icon name="shareOutline" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Rings + centre cluster (long-press → raw breakdown) ── */}
      <div
        className="relative mx-auto mt-5"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
          style={{ background: `radial-gradient(circle, ${accent}22, transparent 72%)` }}
        />
        <Popover open={rawOpen} onOpenChange={setRawOpen}>
          <PopoverTrigger asChild>
            <motion.button
              type="button"
              aria-label={`Readiness ${Math.round(score)} out of 100. Long-press for breakdown.`}
              className="relative block h-full w-full rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              animate={breath && !reduce ? { scale: [1, 1.012, 1] } : { scale: 1 }}
              transition={
                breath && !reduce
                  ? { duration: 4, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0 }
              }
              {...longPress}
            >
              <ReadinessRings
                score={score}
                accent={accent}
                pillars={pillars}
                reducedMotion={reduce}
              />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <AnimatedNumber
                  value={score}
                  className="font-display text-[54px] font-bold leading-none tabular-nums text-foreground"
                />
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${droppedHard ? "animate-warning-shimmer" : ""}`}
                    style={{ backgroundColor: `${accent}22`, color: accent }}
                  >
                    {verdict.tier}
                  </span>
                  {delta !== 0 && (
                    <span
                      className="flex items-center gap-0.5 text-[11px] font-semibold tabular-nums"
                      style={{ color: delta > 0 ? "#23C599" : "#F7403F" }}
                    >
                      <Icon name={delta > 0 ? "arrowUp" : "arrowDown"} size={11} />
                      {Math.abs(delta)}
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 text-[11px] leading-snug">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Raw components
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">HRV</span>
              <span className="text-right">-</span>
              <span className="text-muted-foreground">RHR</span>
              <span className="text-right">-</span>
              <span className="text-muted-foreground">Sleep</span>
              <span className="text-right">{Math.round(rawSleepScore)}</span>
              <span className="text-muted-foreground">Strain</span>
              <span className="text-right">{rawStrain.toFixed(1)}</span>
              <span className="text-muted-foreground">Hooper</span>
              <span className="text-right">
                {rawHooperIndex != null ? `${rawHooperIndex}/28` : "-"}
              </span>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Legend (tappable drill-downs) ───────────────────────── */}
      <div className="relative mt-6 flex items-stretch">
        {[
          { label: "Readiness", value: score as number | null, color: accent, onTap: onHelp },
          {
            label: "Recovery",
            value: pillars.recovery,
            color: RING_RECOVERY_COLOR,
            onTap: () => onPillarTap("recovery"),
          },
          {
            label: "Load",
            value: pillars.load,
            color: RING_LOAD_COLOR,
            onTap: () => onPillarTap("load"),
          },
        ].map((item, i) => {
          const building = item.value == null;
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onTap}
              aria-label={`${item.label} - ${building ? "building" : `score ${Math.round(item.value as number)}`}`}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 px-1 py-1 transition-colors active:bg-muted/20 ${i > 0 ? "border-l border-border/40" : ""}`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: building ? "rgba(255,255,255,0.22)" : item.color,
                    boxShadow: building ? undefined : `0 0 6px ${item.color}aa`,
                  }}
                />
                <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {item.label}
                </span>
              </span>
              {building ? (
                <span className="flex h-[26px] items-center">
                  <span
                    aria-hidden
                    className="h-1 w-3.5 rounded-full bg-muted-foreground/30"
                  />
                </span>
              ) : (
                <span
                  className="font-display text-[26px] font-bold leading-none tabular-nums"
                  style={{ color: item.color }}
                >
                  {Math.round(item.value as number)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Verdict ─────────────────────────────────────────────── */}
      <p
        className={`relative mt-6 text-center text-[15px] font-semibold leading-snug ${verdict.tone}`}
      >
        {verdict.line}
      </p>

      {/* ── Action — full-width directive banner ────────────────── */}
      <div
        className="relative mt-5 w-full overflow-hidden rounded-2xl px-5 py-3.5 shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${accent}, ${accentDark})`,
          boxShadow: `0 8px 24px -8px ${accent}99`,
        }}
      >
        {!reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg] bg-white/20 blur-md"
            initial={{ x: 0 }}
            animate={{ x: ["0%", "420%"] }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              repeatDelay: 2.4,
              ease: "easeInOut",
            }}
          />
        )}
        <div className="relative flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/15 text-black">
            <Icon name="flash" size={18} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-black/55">
              Today's action
            </span>
            <span className="text-[15px] font-bold leading-tight text-black">
              {actionLine}
            </span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ── DailyCheckInCTA ─────────────────────────────────────────────────
// Watch-complication treatment (Whoop-instrument design): the bulb sits
// inside a circular streak progress ring (streak/7), wrapped by a gradient
// hairline edge. One big tap target. Only stroke-dashoffset (ring) +
// opacity/transform (mount) animate — no blur layers or infinite loops.
function DailyCheckInCTA({ streak, onOpen }: { streak: number; onOpen: () => void }) {
  const prefersReduced = useReducedMotion();
  const R = 19;
  const C = 2 * Math.PI * R;
  const ring = Math.min(1, streak / 7);
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, type: "spring", damping: 24, stiffness: 260 }}
      className="group relative w-full overflow-hidden rounded-2xl card-surface card-glow text-left active:scale-[0.99] transition-transform"
      aria-label="Open daily check-in"
    >
      {/* Gradient hairline edge — masked 1px border, no blur. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--primary)/0.5), transparent 40%, hsl(var(--primary)/0.18))",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: 1,
        }}
      />
      <div className="flex items-center gap-4 rounded-2xl px-4 py-4">
        <div className="relative h-[52px] w-[52px] shrink-0">
          <svg viewBox="0 0 52 52" className="h-full w-full -rotate-90" aria-hidden>
            <circle
              cx="26"
              cy="26"
              r={R}
              fill="none"
              strokeWidth="4"
              className="stroke-white/[0.07]"
            />
            <motion.circle
              cx="26"
              cy="26"
              r={R}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={C}
              initial={prefersReduced ? false : { strokeDashoffset: C }}
              animate={{ strokeDashoffset: C - C * ring }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.2 }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-primary">
            <Icon name="bulbOutline" size={22} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
            Daily check-in {streak > 0 ? `· keep your ${streak}-day streak` : ""}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold leading-tight text-foreground">
            How are you feeling today?
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground leading-snug">
            <span className="inline-flex items-center gap-1">
              <Icon name="checkmarkCircleOutline" size={12} />4 quick taps
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>~20s</span>
          </div>
        </div>
        <Icon
          name="chevronForwardOutline"
          size={18}
          className="shrink-0 text-primary group-hover:translate-x-0.5 transition-transform"
        />
      </div>
    </motion.button>
  );
}

// ── FirstReadCard / LockedPillarsList ────────────────────────────────
// Empty state — replaces the old "log session / log sleep" CTAs.
function FirstReadCard({ onStart }: { onStart: () => void }) {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 260 }}
      className="relative overflow-hidden card-surface rounded-2xl border border-border/50 border-t-2 p-6 text-center"
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
        First read
      </div>
      <div className="mt-4 text-[48px] leading-none font-display font-bold tabular-nums text-muted-foreground/50">
        – –
      </div>
      <p className="mt-2 text-[14px] text-muted-foreground">Tap below</p>
      <p className="mt-4 text-[13px] text-foreground/80 leading-snug max-w-[34ch] mx-auto">
        We learn your body in 7 days. Check in daily - get your call.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold uppercase tracking-wider text-primary-foreground active:scale-[0.98] transition-transform"
      >
        Start 60-sec check-in
        <Icon name="chevronForwardOutline" size={14} />
      </button>
    </motion.div>
  );
}

function LockedPillarsList() {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold px-1">
        3 pillars
      </div>
      {(["Recovery", "Body", "Load"] as const).map((label) => (
        <div
          key={label}
          className="card-surface rounded-2xl border border-border/50 p-4 flex items-center gap-3 opacity-50"
        >
          <div className="h-10 w-10 shrink-0 rounded-xl border border-border/40 flex items-center justify-center text-muted-foreground">
            <Icon name="lockClosedOutline" size={18} />
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
              {label}
            </div>
            <div className="text-[13px] text-muted-foreground">unlock</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── WellnessCheckInSheet ────────────────────────────────────────────
function WellnessCheckInSheet({
  open,
  onOpenChange,
  userId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSubmit: (data: WellnessCheckInData) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <VisuallyHidden>
          <SheetTitle>Daily check-in</SheetTitle>
        </VisuallyHidden>
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
              Recovery
            </p>
            <h2 className="text-[19px] font-bold tracking-tight">Daily check-in</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
          >
            <Icon name="closeOutline" size={16} />
          </button>
        </div>
        <div className="px-5 pb-5">
          <WellnessCheckIn
            userId={userId}
            onSubmit={(data) => {
              onSubmit(data);
              onOpenChange(false);
            }}
            isSubmitting={false}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
