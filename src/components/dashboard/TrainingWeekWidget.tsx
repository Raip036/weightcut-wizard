import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import { convex } from "@/integrations/convex/client";
import { api } from "@/../convex/_generated/api";
import { localCache } from "@/lib/localCache";
import { getSessionColor, getUserColors } from "@/lib/sessionColors";
import { AnimatedRing } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * Animates a number from 0 → target on mount, and from previous → next
 * whenever `value` changes. ~600ms ease-out-cubic by default. Honours
 * `prefers-reduced-motion` by jumping straight to the final value.
 */
function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState<number>(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return value;
    }
    return 0;
  });
  const fromRef = useRef<number>(display);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") { setDisplay(value); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // Persist whatever we last rendered as the starting point for the next animation
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return display;
}

interface WeekSession {
  id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const CACHE_KEY = "training_week_sessions";

// Module-level in-memory cache, avoids JSON.parse on every mount,
// survives component unmount/remount within a session
const memCache = new Map<string, { data: WeekSession[]; fetchedAt: number }>();
const inflightRequests = new Map<string, Promise<WeekSession[]>>();
const FRESH_WINDOW_MS = 30 * 1000; // dedupe refetches within 30s

async function fetchWeekFromServer(userId: string): Promise<WeekSession[]> {
  const inflight = inflightRequests.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
    const now = new Date();
    const ws = startOfWeek(now, { weekStartsOn: 1 });
    const we = endOfWeek(now, { weekStartsOn: 1 });
    const raw = (await convex.query(api.fight_camp.listCalendar, {
      from: format(ws, "yyyy-MM-dd"),
      to: format(we, "yyyy-MM-dd"),
    })) ?? [];
    const result: WeekSession[] = (raw as any[])
      .filter((r) => r.sessionType !== "Rest")
      .map((r) => ({
        id: r._id,
        date: r.date,
        session_type: r.sessionType,
        duration_minutes: r.durationMinutes,
        rpe: r.rpe,
      }));
    memCache.set(userId, { data: result, fetchedAt: Date.now() });
    localCache.set(userId, CACHE_KEY, result);
    return result;
  })();

  inflightRequests.set(userId, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(userId);
  }
}

// Exported preload, callable from Dashboard/UserContext before mount
export function preloadTrainingWeek(userId: string): void {
  if (!userId) return;
  const mem = memCache.get(userId);
  if (mem && Date.now() - mem.fetchedAt < FRESH_WINDOW_MS) return;
  fetchWeekFromServer(userId).catch(() => { /* non-critical */ });
}

interface TrainingWeekWidgetProps {
  userId: string;
  compact?: boolean;
}

export const TrainingWeekWidget = memo(function TrainingWeekWidget({ userId, compact }: TrainingWeekWidgetProps) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<WeekSession[]>(() => {
    const mem = memCache.get(userId);
    if (mem) return mem.data;
    // Fall back to localStorage regardless of age, stale-while-revalidate
    const cached = localCache.get<WeekSession[]>(userId, CACHE_KEY);
    if (cached) {
      memCache.set(userId, { data: cached, fetchedAt: 0 });
      return cached;
    }
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (memCache.has(userId)) return false;
    return !localCache.get<WeekSession[]>(userId, CACHE_KEY);
  });
  const [customColors] = useState(() => getUserColors(userId));

  useEffect(() => {
    let cancelled = false;
    const mem = memCache.get(userId);
    // Skip network if we fetched within the dedupe window
    if (mem && Date.now() - mem.fetchedAt < FRESH_WINDOW_MS) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const result = await fetchWeekFromServer(userId);
        if (!cancelled) setSessions(result);
      } catch {
        // keep stale, widget is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Live reactivity bridge: subscribes to the same Convex query, so any
  // create/update/delete from TrainingCalendar (or anywhere else) propagates
  // here without a manual refetch.
  const { fromStr, toStr } = useMemo(() => {
    const now = new Date();
    return {
      fromStr: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      toStr: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }, []);
  const liveCalendar = useQuery(
    api.fight_camp.listCalendar,
    userId ? { from: fromStr, to: toStr } : "skip",
  );
  useEffect(() => {
    if (!userId || liveCalendar == null) return;
    const result: WeekSession[] = (liveCalendar as any[])
      .filter((r) => r.sessionType !== "Rest")
      .map((r) => ({
        id: r._id,
        date: r.date,
        session_type: r.sessionType,
        duration_minutes: r.durationMinutes,
        rpe: r.rpe,
      }));
    setSessions(result);
    memCache.set(userId, { data: result, fetchedAt: Date.now() });
    localCache.set(userId, CACHE_KEY, result);
    setLoading(false);
  }, [userId, liveCalendar]);

  // Previous-week totals, fetched once per userId, separate from the current
  // week so we don't disturb the existing caching pipeline. Compact-only.
  const [prevWeekTotals, setPrevWeekTotals] = useState<{ sessions: number; minutes: number } | null>(null);
  useEffect(() => {
    if (!userId || !compact) return;
    let cancelled = false;
    const now = new Date();
    const prevWs = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    const prevWe = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
    (async () => {
      try {
        const raw = (await convex.query(api.fight_camp.listCalendar, {
          from: format(prevWs, "yyyy-MM-dd"),
          to: format(prevWe, "yyyy-MM-dd"),
        })) ?? [];
        if (cancelled) return;
        const items = (raw as any[]).filter((r) => r.sessionType !== "Rest");
        const minutes = items.reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
        setPrevWeekTotals({ sessions: items.length, minutes });
      } catch {
        // Non-critical, leave delta unrendered
      }
    })();
    return () => { cancelled = true; };
  }, [userId, compact]);

  // Build day-of-week map (Mon=0..Sun=6)
  const dayMap = new Map<number, WeekSession[]>();
  const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
  for (const s of sessions) {
    const d = new Date(s.date + "T12:00:00");
    const dayIdx = Math.round((d.getTime() - ws.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIdx >= 0 && dayIdx < 7) {
      if (!dayMap.has(dayIdx)) dayMap.set(dayIdx, []);
      dayMap.get(dayIdx)!.push(s);
    }
  }

  // Stats
  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((s, x) => s + x.duration_minutes, 0);

  // Count-up animated values (compact-only, kept here for both branches
  // so the hook order stays stable, only consumed in the compact branch)
  const animatedSessions = useCountUp(totalSessions);
  const totalDisplayRaw = totalMinutes >= 60 ? Math.round(totalMinutes / 60) : totalMinutes;
  const animatedTotal = useCountUp(totalDisplayRaw);

  // Delta vs previous week (in same unit as the displayed total)
  const deltaMin = prevWeekTotals ? totalMinutes - prevWeekTotals.minutes : null;
  const deltaDisplay = deltaMin == null
    ? null
    : (totalMinutes >= 60 || (prevWeekTotals?.minutes ?? 0) >= 60)
      ? Math.round(deltaMin / 60)
      : deltaMin;
  const deltaUnitSuffix = totalMinutes >= 60 ? "h" : "m";

  // Type breakdown for the ring segments
  const typeCounts = new Map<string, number>();
  for (const s of sessions) {
    typeCounts.set(s.session_type, (typeCounts.get(s.session_type) ?? 0) + 1);
  }
  const typeEntries = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Today's day index (Mon=0)
  const todayIdx = (new Date().getDay() + 6) % 7;
  // Days that have passed (including today)
  const daysElapsed = todayIdx + 1;
  // Ring progress: sessions logged / days elapsed (cap at 1)
  const activeDays = new Set(sessions.map(s => s.date)).size;
  const ringProgress = Math.min(activeDays / daysElapsed, 1);

  // Dominant session color for ring
  const dominantType = typeEntries[0]?.[0] ?? "Other";
  const ringColor = getSessionColor(dominantType, customColors);

  if (loading && sessions.length === 0) {
    // Compact skeleton: mimics exact final layout, clipped by overflow-hidden
    if (compact) {
      return (
        <div className="card-surface rounded-2xl overflow-hidden p-3.5 aspect-square flex flex-col">
          <div className="flex items-center gap-2.5 min-w-0">
            <Skeleton className="w-11 h-11 rounded-full shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-2.5 w-16 max-w-full rounded" />
              <Skeleton className="h-4 w-10 max-w-full rounded" />
            </div>
          </div>
          <div className="flex items-end justify-between mt-auto gap-1 px-0.5">
            {DAY_LABELS.map((_, i) => (
              <Skeleton key={i} className="h-5 flex-1 max-w-[20px] rounded-sm" />
            ))}
          </div>
        </div>
      );
    }
    // Full skeleton
    return (
      <div className="card-surface rounded-2xl overflow-hidden p-5">
        <div className="flex items-center gap-4 min-w-0">
          <Skeleton className="w-20 h-20 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-3 w-28 max-w-full rounded" />
            <Skeleton className="h-6 w-14 max-w-full rounded" />
            <Skeleton className="h-3 w-20 max-w-full rounded" />
          </div>
        </div>
        <div className="flex items-end justify-between mt-4 gap-1.5 px-1">
          {DAY_LABELS.map((_, i) => (
            <Skeleton key={i} className="h-8 flex-1 max-w-[28px] rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className="card-surface p-3.5 rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-all duration-200 aspect-square flex flex-col min-w-0 w-full"
        onClick={() => { triggerHapticSelection(); navigate("/training-calendar?openLogSession=true"); }}
      >
        {/* Title top-left, expand chevron top-right, matches the WEIGHT card */}
        <div className="flex items-start justify-between">
          <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
            TRAINING
          </span>
          <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40" />
        </div>

        {/* Ring + stats */}
        <div className="flex items-center gap-2.5 mt-2">
          <div className="relative w-11 h-11 flex-shrink-0">
            <AnimatedRing
              progress={ringProgress}
              size={44}
              strokeWidth={4}
              gradientColors={[ringColor, ringColor]}
              id="training-week-ring"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="display-number text-xs font-bold tabular-nums">{Math.round(animatedSessions)}</span>
            </div>
          </div>
          {/* Single baseline row so the whole text block centres vertically
              against the ring. The week-over-week delta now lives in the
              bottom-right footer to match the Weight/Sleep/Recovery cards. */}
          <div className="flex-1 min-w-0 flex items-baseline gap-1">
            <span className="display-number text-lg font-bold tabular-nums">
              {Math.round(animatedTotal)}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">
              {totalMinutes >= 60 ? "hrs" : "min"}
            </span>
            {/* Week-over-week delta sits in line with the hours value: the
                bottom-right footer used elsewhere gets clipped under this
                card's aspect-square + overflow-hidden. */}
            {deltaMin != null && deltaDisplay != null && (
              deltaMin === 0 ? (
                <span className="ml-auto text-micro font-semibold tabular-nums leading-none text-muted-foreground/70">
                  ±0{deltaUnitSuffix}
                </span>
              ) : (
                <span className={`ml-auto text-micro font-semibold tabular-nums leading-none ${deltaMin > 0 ? "text-func-recovery-green" : "text-func-danger-red"}`}>
                  {deltaMin > 0 ? "+" : "−"}{Math.abs(deltaDisplay)}{deltaUnitSuffix}
                </span>
              )
            )}
          </div>
        </div>

        {/* Week bar chart, fills remaining space. Each session renders as
            its own rounded segment within the day's column, stacked from
            bottom-up. Per-segment height = (duration / 120) * columnH. */}
        <div className="flex-1 flex items-end justify-between mt-2 px-0.5 gap-1">
          {DAY_LABELS.map((label, i) => {
            const daySessions = dayMap.get(i) ?? [];
            const isToday = i === todayIdx;
            const isFuture = i > todayIdx;
            const maxMin = 120;
            const columnH = 30;
            // Render longest segment first so it visually anchors the day
            const ordered = [...daySessions].sort((a, b) => b.duration_minutes - a.duration_minutes);

            return (
              <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                <div className="w-full flex flex-col justify-end items-center gap-[2px]" style={{ height: columnH, maxWidth: 20 }}>
                  {ordered.length > 0 ? ordered.map((s) => {
                    const segH = Math.max(4, Math.min(columnH, Math.round((s.duration_minutes / maxMin) * columnH)));
                    return (
                      <div
                        key={s.id}
                        className="w-full rounded-[3px] transition-all duration-500"
                        style={{
                          height: segH,
                          background: getSessionColor(s.session_type, customColors),
                        }}
                      />
                    );
                  }) : (
                    <div
                      className="w-full rounded-sm"
                      style={{ height: 3, background: isFuture ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)" }}
                    />
                  )}
                </div>
                <span className={`text-[9px] font-medium ${isToday ? "text-foreground" : isFuture ? "text-foreground/20" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

      </div>
    );
  }

  // Full-size (non-compact) layout
  return (
    <div
      className="card-surface p-3 rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-all duration-200"
      onClick={() => { triggerHapticSelection(); navigate("/training-calendar?openLogSession=true"); }}
    >
      {/* Header row, eyebrow label + chevron, matches Weight/Sleep cards */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
          TRAINING
        </span>
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/60 -mr-1 -mt-0.5" />
      </div>

      {/* Two-column body: ring+stats left, day bars right */}
      <div className="flex items-end gap-4">
        {/* Left: ring with session count + hours + days active */}
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <div className="relative w-14 h-14">
            <AnimatedRing
              progress={ringProgress}
              size={56}
              strokeWidth={5}
              gradientColors={[ringColor, ringColor]}
              id="training-week-ring"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="display-number text-sm font-bold">{totalSessions}</span>
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-baseline gap-1 justify-center">
              <span className="display-number text-xl font-bold">
                {totalMinutes >= 60 ? Math.round(totalMinutes / 60) : totalMinutes}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium">
                {totalMinutes >= 60 ? "hrs" : "min"}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {totalSessions === 0 ? "No sessions" : `${activeDays} day${activeDays !== 1 ? "s" : ""} active`}
            </p>
          </div>
        </div>

        {/* Right: Mon-Sun bar chart */}
        <div className="flex-1 flex items-end justify-between gap-1">
          {DAY_LABELS.map((label, i) => {
            const daySessions = dayMap.get(i) ?? [];
            const isToday = i === todayIdx;
            const isFuture = i > todayIdx;
            const totalDayMin = daySessions.reduce((s, x) => s + x.duration_minutes, 0);
            const maxMin = 120;
            const barH = daySessions.length > 0 ? Math.max(6, Math.round((totalDayMin / maxMin) * 36)) : 0;

            return (
              <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                <div className="w-full flex flex-col justify-end items-center" style={{ height: 36 }}>
                  {daySessions.length > 0 ? (
                    <div
                      className="w-full rounded-sm transition-all duration-500"
                      style={{
                        height: barH,
                        background: daySessions.length === 1
                          ? getSessionColor(daySessions[0].session_type, customColors)
                          : `linear-gradient(to top, ${daySessions.map(s => getSessionColor(s.session_type, customColors)).join(", ")})`,
                        maxWidth: 24,
                      }}
                    />
                  ) : (
                    <div
                      className="w-full rounded-sm"
                      style={{ height: 3, maxWidth: 24, background: isFuture ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)" }}
                    />
                  )}
                </div>
                <span className={`text-[9px] font-medium ${isToday ? "text-foreground" : isFuture ? "text-foreground/20" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Type legend pills, single-line carousel. ≤3 pills fit
          comfortably on most widths so we render them static. With more,
          we duplicate the row and run the `animate-marquee` keyframe so
          every session type scrolls into view without ever wrapping or
          being clipped by the card's `overflow-hidden`. Pauses on
          hover (desktop); on touch we let it loop. */}
      {typeEntries.length > 0 && (
        typeEntries.length <= 3 ? (
          <div className="flex items-center gap-2 mt-3 whitespace-nowrap overflow-hidden">
            {typeEntries.map(([type, count]) => (
              <span
                key={type}
                className="inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full"
                style={{
                  background: `${getSessionColor(type, customColors)}15`,
                  color: getSessionColor(type, customColors),
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: getSessionColor(type, customColors) }} />
                {type} {count}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-3 overflow-hidden" aria-label="Session types this week">
            <div className="flex items-center gap-2 w-max animate-marquee hover:[animation-play-state:paused] pr-2">
              {[...typeEntries, ...typeEntries].map(([type, count], i) => (
                <span
                  key={`${type}-${i}`}
                  aria-hidden={i >= typeEntries.length}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full"
                  style={{
                    background: `${getSessionColor(type, customColors)}15`,
                    color: getSessionColor(type, customColors),
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: getSessionColor(type, customColors) }} />
                  {type} {count}
                </span>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
});
