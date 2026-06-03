import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { Capacitor } from "@capacitor/core";
import { format } from "date-fns";
import { api } from "@/../convex/_generated/api";
import { runHealthKitSync } from "@/services/healthKitSync";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { FightFormRing } from "@/components/dashboard/FightFormRing";
import { FightFormInsightStrip } from "@/components/dashboard/FightFormInsightStrip";
import { FightFormDeltaBanner } from "@/components/dashboard/FightFormDeltaBanner";
import TodayStrip from "@/components/dashboard/TodayStrip";
import CompletenessMeter from "@/components/dashboard/CompletenessMeter";
import { FightFormScoreSheet } from "@/components/dashboard/FightFormScoreSheet";
// Lazy-load recharts wrapper so the ~100KB charts bundle defers until first paint.
const DashboardWeightChart = lazy(() => import("@/components/charts/DashboardWeightChart"));
import Sparkline from "@/components/charts/Sparkline";
import { Icon } from "@/components/ui/Icon";
import { TrainingWeekWidget, preloadTrainingWeek } from "@/components/dashboard/TrainingWeekWidget";
import { SleepCard } from "@/components/dashboard/SleepCard";
import { ReadinessCard } from "@/components/dashboard/ReadinessCard";
import { WeightProgressRing } from "@/components/dashboard/WeightProgressRing";
import { StreakBadge } from "@/components/dashboard/StreakBadge";
import { CutPaceForecast, type PlanData } from "@/components/dashboard/CutPaceForecast";
import { PhaseCoachCard } from "@/components/dashboard/PhaseCoachCard";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardCampStatusSection } from "@/components/dashboard/DashboardCampStatusSection";
import { useGamification } from "@/hooks/useGamification";
import { useUser, useProfile } from "@/contexts/UserContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { Button } from "@/components/ui/button";
import { calculateCalorieTarget } from "@/lib/calorieCalculation";
import { AIPersistence } from "@/lib/aiPersistence";
import { localCache } from "@/lib/localCache";
import { nutritionCache } from "@/lib/nutritionCache";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WeightIncreaseQuestionnaire } from "@/components/dashboard/WeightIncreaseQuestionnaire";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";
import { trackInstallDate, maybeRequestReview } from "@/lib/appReview";
import { SleepLogger } from "@/components/dashboard/SleepLogger";
import { ProfileSheet } from "@/components/dashboard/ProfileSheet";
import NewAnnouncementWidget from "@/components/dashboard/NewAnnouncementWidget";
import { GymInvitesBanner } from "@/components/dashboard/GymInvitesBanner";
import { NextCampFlow } from "@/components/fightcamp/NextCampFlow";
import { CatchUpSheet } from "@/components/dashboard/CatchUpSheet";
import { isFighter } from "@/lib/goalType";

// Module-level dedupe so re-mounts within the session don't re-fire identical
// queries while one is still in flight. Mirrors the pattern in
// TrainingWeekWidget / TrainingCalendar.
const dashboardInflight = new Map<string, Promise<unknown>>();
const DASHBOARD_FRESH_WINDOW_MS = 30 * 1000;
const dashboardLastFetchedAt = new Map<string, number>();

// Cross-mount cooldown for the Fight Form recompute fallback. Without this,
// every dashboard navigation re-fires the action when the engine row is
// stale, which thrashes the recompute lane if a data-quality issue keeps
// producing `state: calibrating`. 30 s matches the dashboard freshness
// window so it's effectively "at most once per page-visibility cycle."
const FF_RECOMPUTE_COOLDOWN_MS = 30 * 1000;
const ffLastRecomputeAt = new Map<string, number>();

interface DailyWisdom {
  summary: string;
  riskLevel: "green" | "orange";
  riskReason: string;
  daysToFight: number;
  weeklyPaceKg: number;
  requiredWeeklyKg: number;
  paceStatus: "on_track" | "ahead" | "behind" | "at_target";
  adviceParagraph: string;
  actionItems: string[];
  nutritionStatus: string;
}

// Probe that owns the fullRitualDaysCount query in isolation. If the query
// isn't deployed to Convex yet (pre `npx convex dev`), the surrounding
// ErrorBoundary catches the failure and ritualDaysTotal stays at 0 — the
// rest of the Dashboard renders normally.
function RitualDaysProbe({ enabled, onTotal }: { enabled: boolean; onTotal: (n: number) => void }) {
  const res = useQuery(api.fightFormScore.fullRitualDaysCount, enabled ? {} : "skip");
  const total = res?.total ?? 0;
  useEffect(() => { onTotal(total); }, [total, onTotal]);
  return null;
}

// Isolated probes for the sub-score decoration queries. Same pattern as
// RitualDaysProbe — if the function isn't deployed yet (or the row is
// missing), the surrounding ErrorBoundary swallows the error and the
// parent simply doesn't receive the optional data. The sheet falls back
// to a tile grid with no delta chips / no sparklines, which is still
// a valid state by design.
function YesterdaySubScoresProbe({
  enabled,
  onResult,
}: {
  enabled: boolean;
  onResult: (value: Record<string, number> | undefined) => void;
}) {
  const res = useQuery(api.fightFormScore.getYesterdaysSubScores, enabled ? {} : "skip");
  useEffect(() => {
    if (res === undefined) return; // loading
    onResult(res?.subScores ?? undefined);
  }, [res, onResult]);
  return null;
}

function SubScoreTrendProbe({
  enabled,
  onResult,
}: {
  enabled: boolean;
  onResult: (value: Record<string, Array<{ date: string; value: number }>> | undefined) => void;
}) {
  const res = useQuery(
    api.fightFormScore.getSubScoreTrend,
    enabled ? { days: 7 } : "skip",
  );
  useEffect(() => {
    if (res === undefined) return; // loading
    onResult(res ?? undefined);
  }, [res, onResult]);
  return null;
}

// Probe for weeklyCompleteness — isolated so a missing server function
// (pre `npx convex dev`) can't crash the Dashboard via the outer ErrorBoundary.
// Once deployed, the probe writes real data into parent state and the
// CompletenessMeter renders. Until then it stays undefined → meter renders nothing.
function WeeklyCompletenessProbe({
  enabled,
  onResult,
}: {
  enabled: boolean;
  onResult: (value: import("@/components/dashboard/CompletenessMeter").WeeklyDay[] | null | undefined) => void;
}) {
  const res = useQuery(
    api.fightFormScore.weeklyCompleteness,
    enabled ? {} : "skip",
  );
  useEffect(() => {
    if (res === undefined) return; // still loading
    onResult(res);
  }, [res, onResult]);
  return null;
}

export default function Dashboard() {
  const { userName, currentWeight, userId, profile, loadCutPlan } = useUser();
  const { avatarUrl } = useProfile();
  const convex = useConvex();
  const dailyWisdomAction = useAction(api.actions.dailyWisdom.run);
  const [weightLogs, setWeightLogs] = useState<any[]>(() => {
    if (!userId) return [];
    return localCache.get<any[]>(userId, 'dashboard_weight_logs') || [];
  });
  const [loading, setLoading] = useState(() => {
    if (!userId) return true;
    return localCache.get(userId, 'dashboard_weight_logs') === null;
  });
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(() => {
    return (localStorage.getItem('wcw_weight_unit') as 'kg' | 'lb') || 'kg';
  });
  const [todayCalories, setTodayCalories] = useState(0);
  const [todayHydration, setTodayHydration] = useState(0);
  const [wisdom, setWisdom] = useState<DailyWisdom | null>(null);
  const [wisdomLoading, setWisdomLoading] = useState(false);
  const [wisdomSheetOpen, setWisdomSheetOpen] = useState(false);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [hasCutPlan, setHasCutPlan] = useState<boolean>(() => !!localStorage.getItem("wcw_cut_plan"));
  const [expandedInfo, setExpandedInfo] = useState<'risk' | 'pace' | null>(null);
  const [frequentMeals, setFrequentMeals] = useState<Array<{ name: string; count: number; avgCalories: number }>>([]);
  const [scoreSheetOpen, setScoreSheetOpen] = useState(false);
  const [nextCampOpen, setNextCampOpen] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  // Active camp drives the post-fight "wrap up + start next camp" banner.
  // Skip the query while userId is unresolved to avoid an extra round trip.
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");
  const ffScoreData = useQuery(api.fightFormScore.getToday, FEATURE_FLAGS.enableFightFormScore ? {} : "skip");
  // Local-time date string. Anchors every "today" subscription below so all
  // TodayStrip pills (meals, weight, training, sleep, wellness) share one
  // source of truth and reset together when the user crosses local midnight.
  // Re-runs at midnight + on visibility resume to survive backgrounded apps.
  const [liveTodayStr, setLiveTodayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleNextRoll = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 100); // 100ms past midnight to clear edge cases
      const msUntilMidnight = nextMidnight.getTime() - now.getTime();
      timeoutId = setTimeout(() => {
        setLiveTodayStr(format(new Date(), "yyyy-MM-dd"));
        scheduleNextRoll();
      }, msUntilMidnight);
    };
    // Also catch the case where the app was backgrounded across midnight —
    // browsers throttle setTimeout in background tabs / iOS WebView freezes
    // entirely, so on visibility-resume we re-sync the date string.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setLiveTodayStr((prev) => {
          const fresh = format(new Date(), "yyyy-MM-dd");
          return prev === fresh ? prev : fresh;
        });
      }
    };
    scheduleNextRoll();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Compute yesterday's date string from liveTodayStr (local date math).
  // Uses the same approach as the app-wide date utilities: parse the local
  // ISO string, subtract one day, reformat. Declared here so catchUpOpen
  // effect below can close over it.
  const yesterday = (() => {
    const d = new Date(liveTodayStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    // Format from LOCAL parts — `toISOString()` would shift to UTC and yield
    // two-days-ago for UTC+ users (e.g. BST). Matches the app's local-date convention.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // "Yesterday in 10 seconds" catch-up sheet. Fires once per calendar day
  // (keyed on liveTodayStr so it re-arms at local midnight), skipped when
  // the user has already dismissed it for yesterday. Gated on userId so it
  // only fires after auth resolves.
  useEffect(() => {
    if (!userId) return;
    const today = liveTodayStr;
    const lastOpen = localStorage.getItem("catchup_last_open");
    const dismissed = localStorage.getItem("catchup_dismissed_" + yesterday);
    if (lastOpen !== today && !dismissed) {
      setCatchUpOpen(true);
    }
    localStorage.setItem("catchup_last_open", today);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Tutorial bridge: a step in the onboarding flow can request the Fight
  // Form Score sheet open declaratively via `actionEventName`. We listen
  // for that event here and flip the open state — the tutorial's
  // spotlight resolver (ResizeObserver + retry-on-measure) picks up the
  // target inside the sheet once it has mounted + finished its slide-up.
  useEffect(() => {
    function handleOpen() {
      setScoreSheetOpen(true);
    }
    window.addEventListener("tutorial:open-fight-form-sheet", handleOpen);
    return () => window.removeEventListener("tutorial:open-fight-form-sheet", handleOpen);
  }, []);
  const ffAdherence = useQuery(
    api.fightFormScore.loggedTodayBundle,
    FEATURE_FLAGS.enableFightFormScore ? { date: liveTodayStr } : "skip",
  );
  const ffCalibration = useQuery(
    api.fightFormScore.calibrationProgress,
    FEATURE_FLAGS.enableFightFormScore ? {} : "skip",
  );
  // Count of days where the user lit up all five TodayStrip ritual pills.
  // Drives the ring's "Day N completed" animation (fires when this number
  // ticks up). Independent of `ffCalibration`, which counts any-signal days
  // for the engine's cold-start gate.
  //
  // Wrapped in a probe + ErrorBoundary below — if the new query isn't deployed
  // to Convex yet (before `npx convex dev` runs), the failure stays isolated
  // instead of bringing the whole Dashboard down via the route ErrorBoundary.
  const [ritualDaysTotal, setRitualDaysTotal] = useState(0);
  // Sub-score decorations for the FightFormScoreSheet. Both are optional —
  // the sheet degrades cleanly when missing (no delta chips, no sparklines).
  // Sourced via isolated probes below so a missing-from-server query can't
  // crash the dashboard.
  const [yesterdaySubScores, setYesterdaySubScores] = useState<
    Record<string, number> | undefined
  >(undefined);
  const [subScoreTrend, setSubScoreTrend] = useState<
    Record<string, Array<{ date: string; value: number }>> | undefined
  >(undefined);
  const ffDelta = useQuery(
    api.fightFormScore.getDeltaInfo,
    FEATURE_FLAGS.enableFightFormScore ? {} : "skip",
  );
  const ffTrend = useQuery(
    api.fightFormScore.getRecentScores,
    FEATURE_FLAGS.enableFightFormScore ? { days: 14 } : "skip",
  );
  // weeklyCompleteness is fetched via WeeklyCompletenessProbe (wrapped in its
  // own ErrorBoundary below) so a missing server function can't crash the page.
  const [weeklyCompletenessData, setWeeklyCompletenessData] = useState<
    import("@/components/dashboard/CompletenessMeter").WeeklyDay[] | null | undefined
  >(undefined);
  const handleWeeklyCompleteness = useCallback(
    (value: import("@/components/dashboard/CompletenessMeter").WeeklyDay[] | null | undefined) => {
      setWeeklyCompletenessData(value);
    },
    [],
  );
  const ffRecompute = useMutation(api.fightFormScore.recomputeNow);
  const markRestDayMutation = useMutation(api.fight_camp.createCalendarEntry);
  // One-shot Sharp crossing celebration. Fires once per calendar date when
  // the user transitions from below 80 to 80+; expires automatically after
  // the animation runs so it doesn't loop on re-renders.
  const [celebrateSharp, setCelebrateSharp] = useState(false);
  // Once-per-mount guard: if the engine still says `calibrating` but our live
  // per-source query says the cold-start threshold is already met, the score
  // row for today simply hasn't been computed yet. Fire one recompute so the
  // ring flips from "calibrating · computing…" to a real score without the
  // user having to write a fresh log to trigger it.
  const recomputeFiredRef = useRef(false);
  const navigate = useNavigate();
  const { safeAsync, isMounted } = useSafeAsync();
  const { streak, streakIncludesToday } = useGamification(userId, weightLogs, todayCalories, profile);

  const lastFetchRef = useRef(0);

  // ── Live reactivity bridge ──
  // The imperative `loadDashboardData()` below handles cold-start + cache, but
  // does NOT auto-update when the user logs data on a separate page. These
  // `useQuery` subscriptions piggyback on the same Convex queries so mutations
  // from WeightTracker / Nutrition / Hydration / TrainingCalendar invalidate
  // these reads → the useEffects below copy fresh data into the existing
  // state setters → widgets re-render without any cache-bust dance.
  const liveWeightLogs = useQuery(
    api.weight_logs.listForUser,
    userId ? { limit: 30 } : "skip",
  );
  const liveTodayMeals = useQuery(
    api.meals.listWithTotals,
    userId ? { date: liveTodayStr } : "skip",
  );
  const liveTodayHydration = useQuery(
    api.hydration_logs.listForUser,
    userId ? { from: liveTodayStr, to: liveTodayStr, limit: 50 } : "skip",
  );

  useEffect(() => {
    if (!userId || liveWeightLogs == null) return;
    const data = liveWeightLogs.map((r: any) => ({ date: r.date, weight_kg: String(r.weight_kg) }));
    setWeightLogs(data);
    localCache.set(userId, "dashboard_weight_logs", data);
  }, [userId, liveWeightLogs]);

  useEffect(() => {
    if (!userId || liveTodayMeals == null) return;
    const total = liveTodayMeals.reduce((sum: number, r: any) => sum + (r.total_calories ?? 0), 0);
    setTodayCalories(total);
  }, [userId, liveTodayMeals]);

  useEffect(() => {
    if (!userId || liveTodayHydration == null) return;
    const total = liveTodayHydration.reduce((sum: number, r: any) => sum + (r.amount_ml ?? 0), 0);
    setTodayHydration(total);
  }, [userId, liveTodayHydration]);

  // Redirect to cut plan if it hasn't been seen yet. Same plan blob is used
  // for both fight-camp and weight-loss flows — route by planType so the
  // weight-loss user lands on /weight-plan (which reuses CutPlanReview with
  // adjusted labels).
  useEffect(() => {
    const cutPlan = localStorage.getItem("wcw_cut_plan");
    const cutPlanSeen = localStorage.getItem("wcw_cut_plan_seen");
    if (cutPlan && !cutPlanSeen) {
      let route = "/cut-plan";
      try {
        const parsed = JSON.parse(cutPlan);
        if (parsed?.planType === "weight_loss") route = "/weight-plan";
      } catch {
        // ignore malformed payload — fall back to /cut-plan
      }
      navigate(route, { replace: true });
    }
  }, [navigate]);

  // Rehydrate cut plan from DB if localStorage is empty (iOS WebView can wipe it).
  // cut_plan_json is no longer in PROFILE_COLUMNS, so we lazy-fetch it via
  // loadCutPlan() — keeps the cold-start profile query small.
  useEffect(() => {
    if (localStorage.getItem("wcw_cut_plan")) {
      if (!hasCutPlan) setHasCutPlan(true);
      return;
    }
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const dbPlan = await loadCutPlan();
      if (cancelled) return;
      if (dbPlan && typeof dbPlan === "object" && dbPlan.weeklyPlan) {
        localStorage.setItem("wcw_cut_plan", JSON.stringify(dbPlan));
        setHasCutPlan(true);
      } else if (hasCutPlan) {
        setHasCutPlan(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, hasCutPlan, loadCutPlan]);

  useEffect(() => { trackInstallDate(); }, []);

  // Dashboard-mount HealthKit sync.
  //
  // Fires once per mount, gated to:
  //   1. Native platform (web/Android short-circuits inside the helper
  //      anyway, but skipping the call keeps the dashboard's first-paint
  //      profile cleaner).
  //   2. A connected profile (`healthKitConnectedAt`). Unconnected users
  //      would just see the helper return null after `isAvailable()`.
  //
  // The helper's module-level 60s throttle is shared with the App.tsx
  // foreground listener so the typical "open app → land on Dashboard"
  // flow only triggers one sync, not two.
  const insertHealthSamples = useMutation(api.health.insertSamples);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!profile?.healthKitConnectedAt) return;
    runHealthKitSync(insertHealthSamples).catch((err) => {
      logger.error("dashboard-mount HealthKit sync failed", err);
    });
  }, [profile?.healthKitConnectedAt, insertHealthSamples]);

  // Sharp crossing celebration. Conditions for firing:
  //   1. State is "ok" and the displayed score is in Sharp territory (>=80).
  //   2. Yesterday's score (from the delta query) was below 80, or unknown
  //      (e.g. first day after calibration unlocks).
  //   3. We haven't already celebrated today on this device.
  // The localStorage flag is keyed by date so the celebration can re-fire on
  // a new crossing event after a dip below Sharp.
  useEffect(() => {
    if (!ffScoreData || ffScoreData.state !== "ok") return;
    if (ffScoreData.displayedScore < 80) return;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("wcw_ff_last_sharp_date") === today) return;
    const yesterdayLow = !ffDelta?.yesterdayScore || ffDelta.yesterdayScore < 80;
    if (!yesterdayLow) return;
    localStorage.setItem("wcw_ff_last_sharp_date", today);
    setCelebrateSharp(true);
    triggerHaptic(ImpactStyle.Heavy);
    const t = setTimeout(() => setCelebrateSharp(false), 2400);
    return () => clearTimeout(t);
  }, [ffScoreData, ffDelta]);

  // Persist weight-unit preference asynchronously — synchronous localStorage
  // writes in click handlers block the main thread 20-50ms on iOS WebView.
  useEffect(() => {
    const id = (window as any).requestIdleCallback
      ? (window as any).requestIdleCallback(() => localStorage.setItem('wcw_weight_unit', weightUnit))
      : setTimeout(() => localStorage.setItem('wcw_weight_unit', weightUnit), 0);
    return () => {
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id);
      else clearTimeout(id as number);
    };
  }, [weightUnit]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  useEffect(() => {
    if (userId) {
      loadDashboardData();
    }
  }, [userId]);

  // Refetch when user navigates back to this page — but respect the same 30s
  // freshness window as cache-first loads. The previous 2s throttle re-fired
  // 3 queries on every tab-back, causing 3-6s hangs on iOS Capacitor.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !userId) return;
      const lastDone = dashboardLastFetchedAt.get(userId);
      if (lastDone && Date.now() - lastDone < DASHBOARD_FRESH_WINDOW_MS) return;
      if (Date.now() - lastFetchRef.current < 2000) return;
      loadDashboardData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [userId]);

  // No warmup needed under Convex — actions are co-located with the deployment.

  // Frequent meals (last 14 days). Derived from cached per-day nutrition pages
  // — the legacy `nutrition_logs` view was retired in the Convex migration and
  // walking 14 days × 1 query is wasteful for the wisdom sheet. Cache covers
  // anything the user has scrolled this week (which is the typical case).
  useEffect(() => {
    if (!userId || !wisdomSheetOpen) return;
    const counts = new Map<string, { count: number; totalCal: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const dayMeals = localCache.getForDate<any[]>(userId, 'nutrition_logs', d) ?? [];
      for (const m of dayMeals) {
        const name = (m.meal_name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = counts.get(key) || { count: 0, totalCal: 0 };
        entry.count++;
        entry.totalCal += m.calories || 0;
        counts.set(key, entry);
      }
    }
    const top = Array.from(counts.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([name, v]) => ({
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        count: v.count,
        avgCalories: Math.round(v.totalCal / v.count),
      }));
    setFrequentMeals(top);
  }, [userId, wisdomSheetOpen]);

  const generateWisdom = async (profileData: any, logs: any[], calories: number, hydration: number) => {
    if (!userId || !profileData) return;
    safeAsync(setWisdomLoading)(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `daily_wisdom_${today}`;
      const calorieGoal = calculateCalorieTarget(profileData);
      const last7 = logs.slice(-7).map((l: any) => ({ date: l.date, weight_kg: l.weight_kg }));

      // Touch `hydration` so the optimistic readout above is still tracked,
      // even though Convex's daily-wisdom action doesn't take hydration inputs.
      void hydration;

      const payload = {
        currentWeight: profileData.current_weight_kg,
        goalWeight: profileData.goal_weight_kg,
        fightWeekTarget: profileData.goal_type === 'losing' ? undefined : profileData.fight_week_target_kg,
        targetDate: profileData.target_date,
        tdee: profileData.tdee,
        bmr: profileData.bmr,
        activityLevel: profileData.activity_level,
        age: profileData.age,
        sex: profileData.sex,
        heightCm: profileData.height_cm,
        aiRecommendedCalories: profileData.ai_recommended_calories,
        todayCalories: calories,
        dailyCalorieGoal: calorieGoal,
        weightHistory: last7,
      };

      let data: any = null;
      try {
        data = await dailyWisdomAction(payload);
      } catch (error) {
        logger.error("daily-wisdom error", error);
        return;
      }
      if (!isMounted()) return;
      if (!data?.wisdom) return;
      AIPersistence.save(userId, cacheKey, data.wisdom, 25);
      setWisdom(data.wisdom);
    } catch (err) {
      logger.error("generateWisdom error", err);
    } finally {
      safeAsync(setWisdomLoading)(false);
    }
  };

  const checkAndGenerateWisdom = async (profileData: any, logs: any[], calories: number, hydration: number) => {
    if (!userId || !profileData) return;
    const today = new Date().toISOString().split('T')[0];
    const hasTodayLog = logs.some((l: any) => l.date === today);
    if (!hasTodayLog) {
      safeAsync(setWisdom)(null);
      safeAsync(setWisdomLoading)(false);
      return;
    }
    const cacheKey = `daily_wisdom_${today}`;
    const cached = AIPersistence.load(userId, cacheKey);
    if (cached) {
      safeAsync(setWisdom)(cached);
      return;
    }
    await generateWisdom(profileData, logs, calories, hydration);
  };

  const loadDashboardData = async () => {
    if (!userId) {
      safeAsync(setLoading)(false);
      return;
    }

    lastFetchRef.current = Date.now();
    // Local date — must match `liveTodayStr` (and `useNutritionState.selectedDate`)
    // so the cache keys this function reads/writes line up with what the meal-
    // logging path persists. Mixing UTC here with LOCAL there caused the
    // dashboard to overwrite a freshly-logged meal's `todayCalories` with 0.
    const today = liveTodayStr;

    // --- Cache-first: serve cached data instantly, then refresh in background ---
    const cachedWeightLogs = localCache.get<any[]>(userId, 'dashboard_weight_logs');
    const cachedNutrition = localCache.getForDate<any[]>(userId, 'nutrition_logs', today);
    const cachedHydration = localCache.getForDate<any[]>(userId, 'hydration_logs', today);

    const hasCachedData = cachedWeightLogs !== null || cachedNutrition !== null || cachedHydration !== null;

    if (hasCachedData) {
      const cachedCalories = cachedNutrition?.reduce((sum: number, log: any) => sum + (log?.calories || 0), 0) || 0;
      const cachedHydrationTotal = cachedHydration?.reduce((sum: number, log: any) => sum + (log?.amount_ml || 0), 0) || 0;

      if (cachedWeightLogs) safeAsync(setWeightLogs)(cachedWeightLogs);
      safeAsync(setTodayCalories)(cachedCalories);
      safeAsync(setTodayHydration)(cachedHydrationTotal);
      safeAsync(setLoading)(false);

      // Fire-and-forget wisdom with cached data
      if (cachedWeightLogs) checkAndGenerateWisdom(profile, cachedWeightLogs, cachedCalories, cachedHydrationTotal);
    }

    // --- Skip refetch if a previous run completed within the freshness window ---
    const lastDone = dashboardLastFetchedAt.get(userId);
    if (hasCachedData && lastDone && Date.now() - lastDone < DASHBOARD_FRESH_WINDOW_MS) {
      safeAsync(setLoading)(false);
      return;
    }

    // --- Inflight dedupe: if a Dashboard fetch is already in flight for this
    // user, await its result instead of firing a parallel set of queries. ---
    const inflightKey = userId;
    const existing = dashboardInflight.get(inflightKey);
    if (existing) {
      try { await existing; } catch { /* error handled by original caller */ }
      return;
    }

    // --- Fetch fresh data from Convex (3 core queries — gamification handled by useGamification) ---
    // Weight logs → live list (last 30). Nutrition for today → derived from
    // meals.listWithTotals. Hydration for today → hydration_logs filtered by date.
    const fetchPromise = Promise.allSettled([
      convex.query(api.weight_logs.listForUser, { limit: 30 }).then((rows) => ({
        data: (rows ?? []).map((r: any) => ({ date: r.date, weight_kg: String(r.weight_kg) })),
      })),
      convex.query(api.meals.listWithTotals, { date: today }).then((rows) => ({
        data: (rows ?? []).map((r: any) => ({ calories: r.total_calories ?? 0 })),
      })),
      convex.query(api.hydration_logs.listForUser, { from: today, to: today, limit: 50 }).then((rows) => ({
        data: (rows ?? []).map((r: any) => ({ amount_ml: r.amount_ml ?? 0 })),
      })),
    ]);
    dashboardInflight.set(inflightKey, fetchPromise);

    try {
      const results = await fetchPromise;
      dashboardLastFetchedAt.set(inflightKey, Date.now());

      if (!isMounted()) return;

      // Only update state and cache for queries that succeeded — don't overwrite cached data with empty arrays on failure
      const logsOk = results[0].status === 'fulfilled';
      const nutritionOk = results[1].status === 'fulfilled';
      const hydrationOk = results[2].status === 'fulfilled';

      let anyRejected = false;
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          anyRejected = true;
          // Demote to warn when cache covered the user — they don't see broken
          // numbers, so this is operational noise, not a user-facing failure.
          if (hasCachedData) {
            logger.warn(`Dashboard query ${index} timed out (cache served)`, { reason: result.reason });
          } else {
            logger.error(`Dashboard query ${index} failed`, result.reason);
          }
        }
      });

      // Convex auto-reconnects its WebSocket; nothing to do on rejection beyond logging.
      void anyRejected;

      if (logsOk) {
        const logsData = (results[0] as PromiseFulfilledResult<any>).value.data || [];
        setWeightLogs(logsData);
        localCache.set(userId, 'dashboard_weight_logs', logsData);
      }

      if (nutritionOk) {
        const nutritionData = (results[1] as PromiseFulfilledResult<any>).value.data || [];
        const totalCalories = nutritionData.reduce((sum: number, log: any) => sum + (log?.calories || 0), 0) || 0;
        setTodayCalories(totalCalories);
        localCache.setForDate(userId, 'nutrition_logs', today, nutritionData);
      }

      if (hydrationOk) {
        const hydrationData = (results[2] as PromiseFulfilledResult<any>).value.data || [];
        const totalHydration = hydrationData.reduce((sum: number, log: any) => sum + (log?.amount_ml || 0), 0) || 0;
        setTodayHydration(totalHydration);
        localCache.setForDate(userId, 'hydration_logs', today, hydrationData);
      }

      // Fire-and-forget wisdom with best available data (use fresh values, fall back to current state)
      const wisdomLogs = logsOk ? (results[0] as PromiseFulfilledResult<any>).value.data ?? [] : weightLogs;
      const wisdomCals = nutritionOk
        ? ((results[1] as PromiseFulfilledResult<any>).value.data || []).reduce((s: number, l: any) => s + (l?.calories || 0), 0)
        : todayCalories;
      const wisdomHydration = hydrationOk
        ? ((results[2] as PromiseFulfilledResult<any>).value.data || []).reduce((s: number, l: any) => s + (l?.amount_ml || 0), 0)
        : todayHydration;
      checkAndGenerateWisdom(profile, wisdomLogs, wisdomCals, wisdomHydration);

      // Warm training-week cache so widget paints instantly on mount / next visit
      if (userId) preloadTrainingWeek(userId);

      // Prefetch macro goals from profile so Nutrition page skips loading
      if (profile?.ai_recommended_calories) {
        const macroData = {
          macroGoals: {
            proteinGrams: (profile as any).ai_recommended_protein_g || 0,
            carbsGrams: (profile as any).ai_recommended_carbs_g || 0,
            fatsGrams: (profile as any).ai_recommended_fats_g || 0,
            recommendedCalories: profile.ai_recommended_calories,
          },
          dailyCalorieTarget: profile.ai_recommended_calories,
        };
        nutritionCache.setMacroGoals(userId, macroData);
        localCache.set(userId, 'macro_goals', macroData);
      }
    } catch (error) {
      // Only escalate to error when we have nothing cached to show — otherwise
      // the user sees their numbers and this is just network flake.
      if (hasCachedData) {
        logger.warn("Dashboard refresh failed (cache served)", { error });
      } else {
        logger.error("Error loading dashboard data", error);
        safeAsync(setWeightLogs)([]);
        safeAsync(setTodayCalories)(0);
        safeAsync(setTodayHydration)(0);
      }
    } finally {
      dashboardInflight.delete(inflightKey);
      safeAsync(setLoading)(false);
      maybeRequestReview();
    }
  };

  const daysUntilTarget = useMemo(() => profile?.target_date ? Math.ceil((new Date(profile.target_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0, [profile?.target_date]);
  const currentWeightValue = currentWeight ?? profile?.current_weight_kg ?? 0;
  const weightToLose = useMemo(() => profile ? (currentWeightValue - (profile.fight_week_target_kg || profile.goal_weight_kg || 0)).toFixed(1) : 0, [currentWeightValue, profile?.fight_week_target_kg, profile?.goal_weight_kg]);
  const dailyCalorieGoal = useMemo(() => profile ? calculateCalorieTarget(profile) : 0,
    [profile?.ai_recommended_calories, profile?.tdee, profile?.bmr,
     profile?.current_weight_kg, profile?.goal_weight_kg,
     profile?.manual_nutrition_override]);

  const convertWeight = useCallback((kg: number) => {
    return weightUnit === 'kg' ? kg : kg * 2.20462;
  }, [weightUnit]);

  const chartData = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString().split('T')[0];
    return weightLogs
      .filter((log) => !isNaN(parseFloat(log.weight_kg)) && log.date >= cutoff)
      .map((log) => ({
        date: new Date(log.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        weight: convertWeight(parseFloat(log.weight_kg)),
      }));
  }, [weightLogs, convertWeight]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  // Fallback static wisdom (kept for when AI fails)
  const getWizardWisdom = () => {
    const caloriePercentage = dailyCalorieGoal > 0 ? (todayCalories / dailyCalorieGoal) * 100 : 0;

    if (caloriePercentage < 50) {
      return "You're starting slow today! Make sure to fuel up. Your body needs energy to perform at its best.";
    } else if (caloriePercentage > 110) {
      return "You've exceeded your calorie target today. Don't worry, consistency matters more than perfection! Get back on track tomorrow.";
    } else if (caloriePercentage < 80) {
      return "You're under your calorie target. Make sure you're eating enough to maintain your energy and support recovery.";
    } else if (caloriePercentage >= 90 && caloriePercentage <= 110) {
      return "Outstanding! You're hitting your targets perfectly. This is exactly the kind of consistency that leads to success!";
    } else {
      return "You're making excellent progress! Trust the process. Your body is adapting to this journey.";
    }
  };

  const hasTodayLog = weightLogs.some((l: any) => l.date === liveTodayStr);

  const riskColors: Record<string, string> = {
    green: "bg-green-500/20 text-green-400 border-green-500/30",
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };

  const todayStr = liveTodayStr;
  const todayLog = weightLogs.find((l: any) => l.date === todayStr);
  const prevLogs = weightLogs.filter((l: any) => l.date < todayStr).sort((a: any, b: any) => b.date.localeCompare(a.date));
  const latestPrevLog = prevLogs.length > 0 ? prevLogs[0] : null;

  const trendIsUp = todayLog && latestPrevLog && parseFloat(todayLog.weight_kg) > parseFloat(latestPrevLog.weight_kg);

  const handleWisdomClick = () => {
    triggerHaptic(ImpactStyle.Light);
    const dismissedKey = `wcw_questionnaire_dismissed_${todayStr}`;
    if (trendIsUp && !sessionStorage.getItem(dismissedKey)) {
      setQuestionnaireOpen(true);
    } else {
      setWisdomSheetOpen(true);
    }
  };

  const getFoodSwap = (name: string): string => {
    const n = name.toLowerCase();
    const swaps: Array<[RegExp, string]> = [
      [/\brice\b(?! cake)/, 'Try cauliflower rice or cut portion by ¼'],
      [/pasta|spaghetti|noodle|linguine|penne|ramen/, 'Swap for zucchini noodles or shirataki'],
      [/bread|toast|bagel|bun|wrap/, 'Use thin-sliced bread or a lettuce wrap'],
      [/chicken thigh|fried chicken|wings/, 'Switch to grilled chicken breast'],
      [/beef|burger|steak|mince/, 'Use 95% lean mince or turkey'],
      [/cheese|brie|mozzarella|cheddar/, 'Try cottage cheese or reduced-fat versions'],
      [/fries|fried/, 'Bake or air-fry instead'],
      [/mayo|mayonnaise/, 'Swap for Greek yogurt or mustard'],
      [/butter|cream|ghee|oil/, 'Use spray oil or measure 1 tsp'],
      [/peanut butter|nutella|spread/, 'Use PB2 powdered or a thinner layer'],
      [/chips|crisps|pretzel/, 'Switch to popcorn or roasted chickpeas'],
      [/pizza/, 'Try cauliflower crust or thin base'],
      [/soda|cola|coke|sprite|fanta|pepsi/, 'Switch to sparkling water or diet'],
      [/juice|smoothie|shake/, 'Eat whole fruit or make it protein-first'],
      [/chocolate|candy|cake|cookie|dessert|ice cream/, 'Portion to one square or swap for fruit'],
      [/avocado/, 'Halve the portion'],
      [/sugar|syrup|honey|jam/, 'Swap for a zero-calorie sweetener'],
    ];
    for (const [re, advice] of swaps) if (re.test(n)) return advice;
    return 'Reduce portion by ¼ or add extra veg';
  };

  const paceLabels: Record<string, string> = {
    on_track: "On Track",
    ahead: "Ahead",
    behind: "Behind",
    at_target: "At Target",
  };

  const paceColors: Record<string, string> = {
    on_track: "text-green-400",
    ahead: "text-blue-400",
    behind: "text-yellow-400",
    at_target: "text-green-400",
  };

  // --- Fight Form Score hero (feature-flagged) -----------------------------
  // Renders a new dashboard hero behind VITE_FF_FIGHT_FORM_SCORE. When the
  // flag is on we ALWAYS take this branch so we never briefly flash the
  // legacy layout while the score query is loading (which caused a flicker
  // when navigating to /dashboard from other pages). The flag-off path
  // below still serves users with the env var unset, and unauthenticated
  // callers are gated upstream by ProtectedRoute. While the query is
  // loading we use a calibrating placeholder so the structural layout
  // stays stable across the resolve.
  if (FEATURE_FLAGS.enableFightFormScore) {
    // Shadow the query value with a defaulted local so the JSX below
    // never sees `undefined` while the score query is still loading. This
    // is what prevents the legacy layout from briefly flashing on first
    // navigation into /dashboard.
    const ffScore = ffScoreData ?? {
      displayedScore: 0,
      rawScore: 0,
      label: "off_pace" as const,
      state: "calibrating" as const,
      phase: null,
      campAge: null,
      subScores: null,
      appliedCeiling: null,
      topDriver: null,
      topLimiter: null,
      algorithmVersion: "1.0.0",
      dataConfidence: 0,
      dataAgeDays: 0,
      activePillars: 0,
      totalPillars: 0,
    };
    const startingWeight = weightLogs.length > 0 ? parseFloat(weightLogs[0].weight_kg) : currentWeightValue;
    const goalWeight = profile?.goal_weight_kg ?? 0;
    const totalCut = startingWeight - goalWeight;
    const pctComplete = totalCut > 0
      ? Math.max(0, Math.min(1, (startingWeight - currentWeightValue) / totalCut))
      : 0;
    const weightChip = profile
      ? { start: startingWeight, current: currentWeightValue, goal: goalWeight, pctComplete }
      : null;
    // Ring's calibrating mini-counter mirrors the union-of-sources progress
    // surfaced by `calibrationProgress` (which matches the scoring engine's
    // own cold-start gate). We only pass the fraction while the user is
    // genuinely short of the threshold — once met, the ring center swaps
    // to "Calibrating · computing…" while the recompute below fires.
    // Always surface the day-count to the ring during calibration so the
    // tiny "Day N of M" badge stays visible while the user is still logging
    // toward their first score (was previously gated to `< daysNeeded` which
    // hid the count once they hit the threshold).
    const ringCalibratingDays =
      ffScore.state === "calibrating" && ffCalibration
        ? { current: ffCalibration.daysWithAnyLog, needed: ffCalibration.daysNeeded }
        : undefined;

    // Auto-recompute when the engine row is stale (state still calibrating
    // but we have enough data). Layered guards: a per-mount ref AND a
    // cross-mount 30 s cooldown so navigating away and back to /dashboard
    // doesn't re-fire the action if a data-quality issue keeps the engine
    // returning `state: calibrating` post-recompute.
    if (
      !recomputeFiredRef.current
      && ffScore.state === "calibrating"
      && ffCalibration?.unlocked
      && userId
    ) {
      const lastAt = ffLastRecomputeAt.get(userId) ?? 0;
      if (Date.now() - lastAt >= FF_RECOMPUTE_COOLDOWN_MS) {
        recomputeFiredRef.current = true;
        ffLastRecomputeAt.set(userId, Date.now());
        ffRecompute({}).catch((err) => {
          recomputeFiredRef.current = false;
          ffLastRecomputeAt.delete(userId);
          logger.error("Fight Form recompute failed", err);
        });
      }
    }
    // Today-adherence booleans. Sourced from `loggedTodayBundle` (one Convex
    // round-trip for all four checks). Falls back to the locally-derived
    // `hasTodayLog` while the query is still loading on first render so the
    // weight dot isn't briefly off when we already know it's on.
    const adherence = {
      weight: ffAdherence?.weight ?? hasTodayLog,
      training: ffAdherence?.training ?? false,
      sleep: ffAdherence?.sleep ?? false,
      wellnessCheckin: ffAdherence?.wellnessCheckin ?? false,
    };

    return (
      <ErrorBoundary>
        {/* Isolated probes for the optional sub-score decoration queries.
            Each is wrapped in its own ErrorBoundary so a missing query on
            the server (e.g. before `npx convex dev` ships the new code)
            can't crash the entire Dashboard. The probes write to local
            state; consumers read defaults when state is undefined. */}
        <ErrorBoundary fallback={null} silent>
          <YesterdaySubScoresProbe
            enabled={FEATURE_FLAGS.enableFightFormScore}
            onResult={setYesterdaySubScores}
          />
        </ErrorBoundary>
        <ErrorBoundary fallback={null} silent>
          <SubScoreTrendProbe
            enabled={FEATURE_FLAGS.enableFightFormScore}
            onResult={setSubScoreTrend}
          />
        </ErrorBoundary>
        <ErrorBoundary fallback={null} silent>
          <WeeklyCompletenessProbe
            enabled={FEATURE_FLAGS.enableFightFormScore}
            onResult={handleWeeklyCompleteness}
          />
        </ErrorBoundary>
        <div className="dashboard-zoom dashboard-enter-stagger space-y-5 px-5 py-3 sm:p-5 md:p-6 w-full max-w-7xl mx-auto">
          {/* Top row — three columns at the same 40px height:
              [Profile avatar] [Dashboard title] [Days-left tab].
              The avatar is now a direct nav to the edit-profile page
              (/goals); the old ProfileSheet bottom-sheet is no longer
              opened from here. Days-left tab uses the v1 glass recipe
              over a Void surface so it reads as on-brand chrome. */}
          <DashboardHeader
            avatarUrl={avatarUrl}
            userName={userName}
            daysUntilTarget={daysUntilTarget}
            kgRemaining={
              profile
                ? currentWeightValue - (profile.fight_week_target_kg || profile.goal_weight_kg || 0)
                : null
            }
            targetDateISO={profile?.target_date ?? null}
            campStartISO={
              weightLogs.length > 0
                ? weightLogs.reduce(
                    (min: string, l: { date: string }) => (l.date < min ? l.date : min),
                    weightLogs[0].date,
                  )
                : null
            }
            onAvatarClick={() => navigate('/goals')}
          />

          {/* Post-fight banner — auto-prompts the user to wrap up the camp
              and start the next one once the fight date has passed. The
              wrap-up is part of the NextCampFlow so the user moves through
              reflection → new camp in one stream. */}
          {activeCamp && !activeCamp.isCompleted && activeCamp.fightDate.slice(0, 10) < new Date().toISOString().slice(0, 10) && (
            <button
              type="button"
              onClick={() => setNextCampOpen(true)}
              className="w-full text-left rounded-2xl card-surface p-3 card-press"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xs bg-primary/15 flex items-center justify-center shrink-0">
                  <Icon name="trophyOutline" size={20} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-bold tracking-tight text-foreground leading-tight">
                    How did {activeCamp.name} go?
                  </p>
                  <p className="text-note text-muted-foreground mt-0.5 leading-snug">
                    Wrap it up and line up your next fight camp.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-note font-semibold text-primary shrink-0">
                  <Icon name="sparklesOutline" size={14} />
                  Start next
                </span>
              </div>
            </button>
          )}

          {/* Fight Form Score ring + educational insight strip */}
          <div className="flex flex-col items-center pt-1">
            <div data-tutorial="fight-form-ring-only">
              <FightFormRing
                score={ffScore.displayedScore}
                label={ffScore.label}
                state={ffScore.state}
                calibratingDays={ringCalibratingDays}
                rawScore={ffScore.rawScore}
                appliedCeiling={ffScore.appliedCeiling}
                phase={ffScore.phase}
                celebrateSharp={celebrateSharp}
                ritualDaysCount={ritualDaysTotal}
                dataConfidence={ffScore.dataConfidence}
                dataAgeDays={ffScore.dataAgeDays}
                activePillars={ffScore.activePillars}
                totalPillars={ffScore.totalPillars}
                onTap={() =>
                  ffScore.state === "no_camp"
                    ? navigate("/goals")
                    : setScoreSheetOpen(true)
                }
              />
            </div>
            <FightFormInsightStrip
              state={ffScore.state}
              label={ffScore.label}
              phase={ffScore.phase}
              topDriver={ffScore.topDriver}
              topLimiter={ffScore.topLimiter}
              appliedCeiling={ffScore.appliedCeiling}
              adherence={adherence}
              calibration={ffCalibration ?? null}
              onHeadlineTap={() => setScoreSheetOpen(true)}
            />
            {/* Calibration countdown — slim cyan card sitting under the ring
                while the score is still being calibrated. Pairs the day
                countdown with what unlocks at completion so the wait feels
                purposeful. Hidden once the engine flips state to "ok". */}
            {ffScore.state === "calibrating"
              && ffCalibration
              && !ffCalibration.unlocked
              && (() => {
                const remaining = Math.max(0, ffCalibration.daysNeeded - ffCalibration.daysWithAnyLog);
                const pct = Math.min(100, Math.round((ffCalibration.daysWithAnyLog / Math.max(1, ffCalibration.daysNeeded)) * 100));
                return (
                  <div className="mt-3 w-full max-w-sm rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center justify-center min-w-[42px]">
                        <span className="text-2xl font-bold text-sky-300 leading-none tabular-nums">
                          {remaining === 0 ? "—" : remaining}
                        </span>
                        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-300/70 mt-1">
                          {remaining === 1 ? "day" : "days"}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground leading-tight">
                          {remaining === 0
                            ? "Computing your first score…"
                            : remaining === 1
                              ? "One more day until your score"
                              : "Until your Fight Form Score"}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-1">
                          Unlocks score, top driver &amp; weight-cut pacing
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 h-1 rounded-full bg-sky-400/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-400/70 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
            {(ffScore.state === "ok" || ffScore.state === "stale") && (() => {
              const SUBSCORE_HUMAN_DASH: Record<string, string> = {
                trainingLoad: "training load",
                sleep: "sleep",
                weightCut: "weight cut",
                wellness: "wellness",
                nutritionAdherence: "nutrition",
                recovery: "recovery",
              };
              const ffHeld =
                ffScoreData &&
                (ffScoreData.state === "stale" || (ffScoreData.dataAgeDays ?? 0) >= 2) &&
                ffScoreData.topLimiter
                  ? {
                      pillarLabel: SUBSCORE_HUMAN_DASH[ffScoreData.topLimiter] ?? ffScoreData.topLimiter,
                      score: ffScoreData.displayedScore,
                      sinceLabel: undefined,
                    }
                  : null;
              return (
                <FightFormDeltaBanner
                  delta={ffDelta?.delta ?? null}
                  topDriver={ffScore.topDriver}
                  topLimiter={ffScore.topLimiter}
                  held={ffHeld}
                  onTap={() => setScoreSheetOpen(true)}
                />
              );
            })()}
            {ffScore.campAge && (
              <p className="text-micro text-muted-foreground/80 mt-2">
                {ffScore.campAge.weeksAhead === 0
                  ? "Camp pace: on schedule"
                  : `Camp pace: ${Math.abs(ffScore.campAge.weeksAhead).toFixed(0)} ${Math.abs(ffScore.campAge.weeksAhead) === 1 ? "week" : "weeks"} ${ffScore.campAge.weeksAhead > 0 ? "ahead of" : "behind"} schedule`}
              </p>
            )}
          </div>

          {/* Gym invites + announcements — below the hero ring so they
              don't push Fight Form Score below the fold. */}
          {userId && <GymInvitesBanner />}
          {userId && <NewAnnouncementWidget userId={userId} />}

          <CompletenessMeter days={weeklyCompletenessData ?? undefined} />

          <TodayStrip
            adherence={adherence}
            mealsLoggedToday={todayCalories > 0}
            onMarkRestDay={async () => {
              await markRestDayMutation({
                date: liveTodayStr,
                sessionType: "Rest",
                intensity: "Rest",
                durationMinutes: 0,
                rpe: 0,
              });
            }}
          />

          <div className="pt-3 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Your Stats</p>
          </div>

          <div className="grid grid-cols-2 gap-3 items-stretch -mt-2">
            {/* Weight metric card — Design System v1 Metric Card layout
                (Figma node 67:725). Eyebrow → big bold value → smaller
                chart → date + trend at the bottom. The kg/lb toggle
                lives in the expanded weight tracker now; this card
                follows whatever unit was last selected there. The
                whole card is a button so tapping anywhere opens the
                expanded /weight view (the chevron in the top-right is
                a visual affordance for that tap). */}
            <button
              type="button"
              onClick={() => { triggerHapticSelection(); navigate('/weight'); }}
              className="card-surface rounded-2xl p-3 aspect-square flex flex-col text-left card-press min-w-0 w-full overflow-hidden"
            >
              <div className="flex items-start justify-between w-full">
                <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
                  WEIGHT
                </span>
                <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40" />
              </div>

              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-display font-bold text-[40px] leading-none text-foreground tabular-nums">
                  {currentWeightValue
                    ? convertWeight(currentWeightValue).toFixed(1)
                    : "—"}
                </span>
                <span className="text-note font-light text-muted-foreground">
                  {weightUnit}
                </span>
              </div>

              <div className="flex-1 min-h-0 mt-2">
                {chartData.length >= 2 ? (
                  <Sparkline data={chartData.map((d) => d.weight)} className="h-full w-full" />
                ) : (
                  <div className="flex flex-col items-center justify-end h-full text-center pb-0.5">
                    <Icon name="trendingDownOutline" size={20} className="text-muted-foreground/40 mb-1" />
                    <p className="text-note text-muted-foreground">No data yet</p>
                  </div>
                )}
              </div>

              {/* Footer — date left, trend arrow + delta + chevron grouped at bottom-right */}
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-micro text-muted-foreground">
                  {chartData.length >= 2 ? chartData[chartData.length - 1].date : ""}
                </span>
                <div className="flex items-center gap-1.5">
                  {chartData.length >= 2 && (() => {
                    const last = chartData[chartData.length - 1];
                    const prev = chartData[chartData.length - 2];
                    const delta = last.weight - prev.weight;
                    const isDown = delta < 0;
                    return (
                      <div className={`flex items-center gap-0.5 text-micro font-medium tabular-nums ${isDown ? "text-func-recovery-green" : "text-func-danger-red"}`}>
                        <Icon
                          name="trendingDownOutline"
                          size={12}
                          className={isDown ? "" : "rotate-180"}
                        />
                        <span>{Math.abs(delta).toFixed(1)}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </button>
            {userId && <TrainingWeekWidget userId={userId} compact />}
            {userId && <SleepCard userId={userId} />}
            {userId && <ReadinessCard userId={userId} />}
          </div>

          {/* CAMP STATUS — forward-looking guidance. Hidden unless the user
              has an active camp with a weigh-in date set. */}
          {activeCamp && !activeCamp.isCompleted && profile?.target_date && (
            <div data-tutorial="camp-status">
              <DashboardCampStatusSection
                weightLogs={weightLogs}
                currentWeight={currentWeightValue}
                goalWeight={profile.fight_week_target_kg ?? profile.goal_weight_kg ?? 0}
                targetDate={profile.target_date}
                phase={ffScore.phase}
                daysUntilFight={daysUntilTarget || null}
                plan={profile?.cut_plan_json as PlanData | null | undefined}
              />
            </div>
          )}
        </div>

        <ProfileSheet open={profileSheetOpen} onOpenChange={setProfileSheetOpen} />

        <FightFormScoreSheet
          open={scoreSheetOpen}
          onClose={() => setScoreSheetOpen(false)}
          score={ffScore.displayedScore}
          label={ffScore.label}
          phase={ffScore.phase}
          daysToFight={daysUntilTarget || null}
          campAge={ffScore.campAge}
          subScores={ffScore.subScores}
          topDriver={ffScore.topDriver}
          topLimiter={ffScore.topLimiter}
          appliedCeiling={ffScore.appliedCeiling}
          trend={ffTrend ?? null}
          yesterdaySubScores={yesterdaySubScores}
          subScoreTrend={subScoreTrend}
          state={ffScore.state}
          activePillars={ffScore.activePillars}
          totalPillars={ffScore.totalPillars}
          loggedToday={{
            // Map adherence (which uses `wellnessCheckin`) → the sheet's
            // canonical shape (`wellness`). Meals is sourced from the
            // calorie counter so it lines up with TodayStrip.
            training: adherence.training,
            sleep: adherence.sleep,
            weight: adherence.weight,
            wellness: adherence.wellnessCheckin,
            meals: todayCalories > 0,
          }}
          calibration={
            ffCalibration
              ? {
                  current: ffCalibration.daysWithAnyLog,
                  needed: ffCalibration.daysNeeded,
                }
              : undefined
          }
        />

        <NextCampFlow
          open={nextCampOpen}
          onOpenChange={setNextCampOpen}
          activeCamp={activeCamp ?? null}
        />

        <ErrorBoundary fallback={null} silent>
          <CatchUpSheet
            targetDate={yesterday}
            open={catchUpOpen}
            onOpenChange={(o) => {
              if (!o) {
                localStorage.setItem("catchup_dismissed_" + yesterday, "1");
              }
              setCatchUpOpen(o);
            }}
            onEmpty={() => setCatchUpOpen(false)}
          />
        </ErrorBoundary>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ErrorBoundary fallback={null} silent>
        <RitualDaysProbe enabled={FEATURE_FLAGS.enableFightFormScore} onTotal={setRitualDaysTotal} />
      </ErrorBoundary>
      <div className="dashboard-zoom animate-page-in space-y-3.5 px-5 py-3 sm:p-5 md:p-6 w-full max-w-7xl mx-auto">
        {/* Greeting header — avatar + name stacked left, days/streak right */}
        <header className="flex items-center justify-between gap-3 pt-1">
          <div className="flex flex-col items-start gap-1 min-w-0">
            <button
              onClick={() => setProfileSheetOpen(true)}
              className="active:opacity-70 transition-opacity"
              aria-label="View profile"
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={avatarUrl ?? undefined} />
                <AvatarFallback
                  className="text-note font-semibold"
                  style={{ backgroundColor: '#7B31EA', color: '#8B7EEA' }}
                >
                  {userName?.[0]?.toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
            </button>
            <h1 className="text-value font-semibold leading-tight truncate max-w-[180px]">
              {userName ? `${getGreeting()}, ${userName}` : "Today"}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {daysUntilTarget > 0 && (
              <div className="rounded-xs px-2.5 py-1.5 text-center backdrop-blur-md bg-white/10 border border-white/20">
                <p className="text-body-sm font-bold tabular-nums leading-none">{daysUntilTarget}</p>
                <p className="text-micro uppercase tracking-wider text-muted-foreground mt-0.5">Days left</p>
              </div>
            )}
            {streak > 0 && <StreakBadge streak={streak} isActive={streakIncludesToday} />}
          </div>
        </header>

        {weightLogs.length === 0 && (
          <button onClick={() => navigate('/weight')} className="w-full card-surface rounded-2xl p-3 flex items-center gap-2.5 active:scale-[0.99] transition-all">
            <div className="h-9 w-9 rounded-xs bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon name="speedometerOutline" size={16} className="text-primary" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-note font-semibold">Welcome{userName ? `, ${userName}` : ''}</p>
              <p className="text-note text-muted-foreground leading-snug">Log your first weigh-in to get started</p>
            </div>
            <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground shrink-0" />
          </button>
        )}

        {/* Hero: Weight Progress Ring — primary metric, top of fold */}
        {profile && (
          <div data-tutorial="weight-progress-ring">
            <WeightProgressRing
              currentWeight={currentWeightValue}
              startingWeight={weightLogs.length > 0 ? parseFloat(weightLogs[0].weight_kg) : currentWeightValue}
              goalWeight={profile.goal_weight_kg ?? 0}
            />
          </div>
        )}

        {/* Wizard's Daily Wisdom card — conditional states */}
        <div data-tutorial="daily-wisdom-card">
        {!hasTodayLog ? (
          <button onClick={() => navigate('/weight')} className="w-full card-surface rounded-2xl p-3 flex items-center gap-2.5 active:scale-[0.99] transition-all">
            <div className="h-8 w-8 rounded-xs bg-muted/40 flex items-center justify-center flex-shrink-0">
              <Icon name="lockClosedOutline" size={14} className="text-muted-foreground" />
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-note font-semibold">Daily Insight</p>
              <p className="text-micro text-muted-foreground mt-0.5 leading-snug">
                Log today's weight to unlock
              </p>
            </div>
            <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground shrink-0" />
          </button>
        ) : wisdomLoading ? (
          <div className="card-surface rounded-2xl p-3 flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xs bg-muted/40 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-2.5 rounded shimmer-skeleton w-1/3" />
              <div className="h-2.5 rounded shimmer-skeleton w-full" />
            </div>
          </div>
        ) : wisdom ? (
          <button className="w-full text-left card-surface rounded-2xl p-3 flex items-center gap-2.5 active:scale-[0.99] transition-all" onClick={handleWisdomClick}>
            <div className="h-8 w-8 rounded-xs bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon name="flashOutline" size={14} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-note font-semibold">Daily Insight</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-micro px-1.5 py-0.5 rounded-full font-medium ${riskColors[wisdom.riskLevel]}`}>
                    {wisdom.riskLevel.charAt(0).toUpperCase() + wisdom.riskLevel.slice(1)}
                  </span>
                  <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground" />
                </div>
              </div>
              <p className="text-micro text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                {wisdom.summary.replace(/[—–]/g, ',').replace(/\s*,\s*/g, ', ').replace(/\s{2,}/g, ' ').split(/\s+/).slice(0, 12).join(' ').replace(/[.,;:]+$/, '')}
              </p>
            </div>
          </button>
        ) : (
          <div className="card-surface rounded-2xl p-3 flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xs bg-muted/40 flex items-center justify-center flex-shrink-0">
              <Icon name="flashOutline" size={14} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-note font-semibold">Daily Insight</p>
              <p className="text-micro text-muted-foreground mt-0.5 leading-snug line-clamp-2">{getWizardWisdom()}</p>
            </div>
          </div>
        )}
        </div>

        {/* Gym invites + announcements — below the hero metrics so they
            don't push the primary content below the fold for the 95%
            of sessions where there's nothing pending. */}
        {userId && <GymInvitesBanner />}
        {userId && <NewAnnouncementWidget userId={userId} />}

        {/* Weight History + Training — side by side */}
        <div className="grid grid-cols-2 gap-2">
          {/* Weight History Chart */}
          <div className="card-surface rounded-2xl p-2.5 aspect-square flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <span className="section-header text-foreground font-bold">Weight</span>
              <div className="flex gap-0.5 bg-muted rounded-full p-0.5">
                <Button
                  variant={weightUnit === 'kg' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setWeightUnit('kg'); triggerHapticSelection(); }}
                  className="h-3 min-h-0 text-micro px-1 rounded-full leading-none"
                >
                  kg
                </Button>
                <Button
                  variant={weightUnit === 'lb' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => { setWeightUnit('lb'); triggerHapticSelection(); }}
                  className="h-3 min-h-0 text-micro px-1 rounded-full leading-none"
                >
                  lb
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {chartData.length > 0 ? (
                <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/20 rounded-xs" />}>
                  <DashboardWeightChart data={chartData} weightUnit={weightUnit} />
                </Suspense>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Icon name="trendingDownOutline" size={20} className="text-muted-foreground/40 mb-1" />
                  <p className="text-note text-muted-foreground">No data yet</p>
                  <Button variant="ghost" size="sm" className="h-6 text-note px-2" onClick={() => navigate('/weight')}>
                    Log Weight
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Training Week Widget */}
          {userId && (
            <TrainingWeekWidget userId={userId} compact />
          )}
        </div>

        {/* Daily logging row — Cut Plan + Sleep, or Sleep full-width */}
        {isFighter(profile?.goal_type) && hasCutPlan ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                // Route to the canonical CutPlanReview screen. planType lives on
                // the stored payload; fall back to /cut-plan (fighter copy) when
                // the field is missing on legacy plans.
                let route = "/cut-plan";
                try {
                  const raw = localStorage.getItem("wcw_cut_plan");
                  if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.planType === "weight_loss") route = "/weight-plan";
                  }
                } catch { /* malformed — default route stands */ }
                navigate(route);
              }}
              className="card-surface rounded-2xl p-3 flex items-center gap-2.5 active:scale-[0.98] transition-all text-left"
            >
              <div className="h-9 w-9 rounded-xs bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon name="flashOutline" size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-note font-semibold leading-tight">Cut Plan</p>
                <p className="text-micro text-muted-foreground mt-0.5 leading-snug">View your plan</p>
              </div>
              <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground shrink-0" />
            </button>
            {userId && <SleepLogger userId={userId} compact />}
          </div>
        ) : (
          userId && <SleepLogger userId={userId} compact />
        )}

        {/* Camp Status — forward-looking guidance. Hidden unless an active
            camp + weigh-in date are present. */}
        {activeCamp && !activeCamp.isCompleted && profile?.target_date && (
          <>
            <p className="font-display text-value font-bold text-white pt-2">Camp Status</p>
            <div className="space-y-2">
              <CutPaceForecast
                weightLogs={weightLogs}
                currentWeight={currentWeightValue}
                goalWeight={profile.fight_week_target_kg ?? profile.goal_weight_kg ?? 0}
                targetDate={profile.target_date}
              />
              <PhaseCoachCard
                phase={null}
                daysUntilFight={daysUntilTarget || null}
                weightLogs={weightLogs}
                currentWeight={currentWeightValue}
                targetWeight={profile.fight_week_target_kg ?? profile.goal_weight_kg ?? null}
                targetDateISO={profile.target_date}
              />
            </div>
          </>
        )}
      </div>

      <ProfileSheet open={profileSheetOpen} onOpenChange={setProfileSheetOpen} />

      {/* Wisdom Detail Bottom Sheet */}
      {wisdom && (
        <Sheet open={wisdomSheetOpen} onOpenChange={setWisdomSheetOpen}>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-xl border-0 bg-card/95 backdrop-blur-xl overflow-y-auto p-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
            <div className="px-4 pt-4 pb-2">
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <div>
                    <SheetTitle className="text-note font-semibold">Daily Insight</SheetTitle>
                    <p className="text-note text-muted-foreground">
                      {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                    </p>
                  </div>
                </div>
              </SheetHeader>
            </div>

            <div className="px-4 space-y-2.5">
              {/* 3-col status grid */}
              <div className="grid grid-cols-3 gap-1.5">
                <button onClick={() => setExpandedInfo(expandedInfo === 'risk' ? null : 'risk')} className={`rounded-xs py-2 text-center transition-colors ${expandedInfo === 'risk' ? 'bg-muted/40' : 'bg-muted/20 active:bg-muted/30'}`}>
                  <span className={`text-note font-medium ${riskColors[wisdom.riskLevel]}`}>
                    {wisdom.riskLevel.charAt(0).toUpperCase() + wisdom.riskLevel.slice(1)}
                  </span>
                  <p className="text-note text-muted-foreground mt-0.5">Risk</p>
                </button>
                <div className="rounded-xs bg-muted/20 py-2 text-center">
                  <p className="text-value font-bold tabular-nums">{wisdom.daysToFight}</p>
                  <p className="text-note text-muted-foreground">Days Left</p>
                </div>
                <button onClick={() => setExpandedInfo(expandedInfo === 'pace' ? null : 'pace')} className={`rounded-xs py-2 text-center transition-colors ${expandedInfo === 'pace' ? 'bg-muted/40' : 'bg-muted/20 active:bg-muted/30'}`}>
                  <p className={`text-note font-semibold ${paceColors[wisdom.paceStatus] ?? 'text-foreground'}`}>
                    {paceLabels[wisdom.paceStatus] ?? wisdom.paceStatus}
                  </p>
                  <p className="text-note text-muted-foreground mt-0.5">Pace</p>
                </button>
              </div>
              {expandedInfo === 'risk' && (
                <div className="rounded-md bg-muted/30 px-2.5 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <p className="text-note font-semibold mb-1">Risk Level</p>
                  <p className="text-note text-muted-foreground leading-snug mb-1">How aggressive your current cut rate is.</p>
                  <p className="text-note text-muted-foreground"><span className="text-green-400 font-medium">Green</span> — Safe, sustainable pace</p>
                  <p className="text-note text-muted-foreground"><span className="text-orange-400 font-medium">Orange</span> — High pace, may affect performance</p>
                </div>
              )}
              {expandedInfo === 'pace' && (
                <div className="rounded-md bg-muted/30 px-2.5 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <p className="text-note font-semibold mb-1">Pace</p>
                  <p className="text-note text-muted-foreground leading-snug mb-1">Is your weekly loss on track to hit your target?</p>
                  <p className="text-note text-muted-foreground"><span className="text-green-400 font-medium">On Track</span> — On schedule</p>
                  <p className="text-note text-muted-foreground"><span className="text-green-400 font-medium">At Target</span> — Already at goal</p>
                  <p className="text-note text-muted-foreground"><span className="text-blue-400 font-medium">Ahead</span> — Faster than needed</p>
                  <p className="text-note text-muted-foreground"><span className="text-yellow-400 font-medium">Behind</span> — May need to adjust</p>
                </div>
              )}

              {/* Weight Pace */}
              <div className="rounded-xs bg-muted/20 p-3">
                <h4 className="text-body-sm font-semibold mb-2">Weight Pace</h4>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <p className="text-note text-muted-foreground">Actual / week</p>
                    <p className="text-value font-bold tabular-nums">{wisdom.weeklyPaceKg.toFixed(2)} kg</p>
                  </div>
                  <div>
                    <p className="text-note text-muted-foreground">Needed / week</p>
                    <p className="text-value font-bold tabular-nums">{wisdom.requiredWeeklyKg.toFixed(2)} kg</p>
                  </div>
                </div>
                <p className="text-body-sm text-muted-foreground leading-relaxed">{wisdom.riskReason}</p>
              </div>

              {/* Guidance — current/goal weight + calories + macros */}
              {(() => {
                const cur = profile?.current_weight_kg ?? 0;
                const goal = profile?.goal_weight_kg ?? 0;
                const calorieTarget = profile ? calculateCalorieTarget(profile) : 0;
                const proteinG = profile?.ai_recommended_protein_g ?? Math.round((calorieTarget * 0.30) / 4);
                const carbsG = profile?.ai_recommended_carbs_g ?? Math.round((calorieTarget * 0.40) / 4);
                const fatsG = profile?.ai_recommended_fats_g ?? Math.round((calorieTarget * 0.30) / 9);
                const proteinCal = proteinG * 4;
                const carbsCal = carbsG * 4;
                const fatsCal = fatsG * 9;
                const mTotal = proteinCal + carbsCal + fatsCal || 1;
                const raw = [proteinCal, carbsCal, fatsCal].map((c) => (c / mTotal) * 100);
                const floors = raw.map((v) => Math.floor(v));
                let rem = 100 - floors.reduce((s, v) => s + v, 0);
                const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f);
                const pcts = [...floors];
                for (let k = 0; k < order.length && rem > 0; k++, rem--) pcts[order[k].i] += 1;
                return (
                  <div className="rounded-xs bg-muted/20 p-3 space-y-3">
                    <h4 className="text-body-sm font-semibold">Guidance</h4>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xs bg-background/40 p-2 text-center">
                        <p className="text-micro uppercase tracking-wider text-muted-foreground">Current</p>
                        <p className="text-value font-bold tabular-nums">{cur.toFixed(1)}<span className="text-micro text-muted-foreground font-normal"> kg</span></p>
                      </div>
                      <div className="rounded-xs bg-background/40 p-2 text-center">
                        <p className="text-micro uppercase tracking-wider text-muted-foreground">Goal</p>
                        <p className="text-value font-bold tabular-nums">{goal.toFixed(1)}<span className="text-micro text-muted-foreground font-normal"> kg</span></p>
                      </div>
                      <div className="rounded-xs bg-primary/10 p-2 text-center">
                        <p className="text-micro uppercase tracking-wider text-primary/80">Daily</p>
                        <p className="text-value font-bold tabular-nums text-primary">{calorieTarget}<span className="text-micro font-normal"> kcal</span></p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Protein', g: proteinG, pct: pcts[0], color: 'text-func-protein-blue' },
                        { label: 'Carbs', g: carbsG, pct: pcts[1], color: 'text-func-carbs-orange' },
                        { label: 'Fats', g: fatsG, pct: pcts[2], color: 'text-func-fats-purple' },
                      ].map((m) => (
                        <div key={m.label} className="rounded-xs bg-background/40 p-2 text-center">
                          <p className={`text-body-sm font-bold tabular-nums ${m.color}`}>{m.g}g</p>
                          <p className="text-micro text-muted-foreground">{m.label} · {m.pct}%</p>
                        </div>
                      ))}
                    </div>

                    <p className="text-body-sm text-muted-foreground leading-relaxed">{wisdom.adviceParagraph}</p>
                  </div>
                );
              })()}

              {/* Action Items — includes concrete numeric target */}
              {(() => {
                const calorieTarget = profile ? calculateCalorieTarget(profile) : 0;
                const proteinG = profile?.ai_recommended_protein_g ?? Math.round((calorieTarget * 0.30) / 4);
                const carbsG = profile?.ai_recommended_carbs_g ?? Math.round((calorieTarget * 0.40) / 4);
                const fatsG = profile?.ai_recommended_fats_g ?? Math.round((calorieTarget * 0.30) / 9);
                const numericAction = `Hit ${calorieTarget} kcal today · ${proteinG}P / ${carbsG}C / ${fatsG}F`;
                const items = [numericAction, ...wisdom.actionItems];
                return (
                  <div className="rounded-xs bg-muted/20 p-3">
                    <h4 className="text-body-sm font-semibold mb-2">Action Items</h4>
                    <ol className="space-y-2">
                      {items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-body-sm">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-note font-bold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed text-foreground/90">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })()}

              {/* Nutrition — foods you eat often + swap ideas */}
              <div className="rounded-xs bg-muted/20 p-3 space-y-2.5">
                <h4 className="text-body-sm font-semibold">Nutrition</h4>
                <p className="text-body-sm text-muted-foreground leading-relaxed">{wisdom.nutritionStatus}</p>
                {frequentMeals.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-micro uppercase tracking-wider text-muted-foreground/80">Foods you eat often</p>
                    <ul className="divide-y divide-border/20 rounded-xs bg-background/40 overflow-hidden">
                      {frequentMeals.map((m) => (
                        <li key={m.name} className="flex items-start gap-3 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-body-sm font-medium truncate">{m.name}</p>
                            <p className="text-note text-muted-foreground/80 mt-0.5 leading-snug">{getFoodSwap(m.name)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-note font-semibold tabular-nums text-foreground/80">{m.avgCalories}<span className="text-micro text-muted-foreground font-normal"> kcal</span></p>
                            <p className="text-micro text-muted-foreground">×{m.count}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <WeightIncreaseQuestionnaire
        open={questionnaireOpen}
        onOpenChange={setQuestionnaireOpen}
        onComplete={() => { sessionStorage.setItem(`wcw_questionnaire_dismissed_${todayStr}`, '1'); setWisdomSheetOpen(true); }}
      />

      <ErrorBoundary fallback={null} silent>
        <CatchUpSheet
          targetDate={yesterday}
          open={catchUpOpen}
          onOpenChange={(o) => {
            if (!o) {
              localStorage.setItem("catchup_dismissed_" + yesterday, "1");
            }
            setCatchUpOpen(o);
          }}
          onEmpty={() => setCatchUpOpen(false)}
        />
      </ErrorBoundary>

    </ErrorBoundary>
  );
}
