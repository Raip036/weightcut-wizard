import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { ChevronRight } from "lucide-react";
import { useQuery } from "convex/react";
import { convex } from "@/integrations/convex/client";
import { api } from "@/../convex/_generated/api";
import { localCache } from "@/lib/localCache";
import { getSessionColor, getUserColors } from "@/lib/sessionColors";
import { AnimatedRing } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { triggerHapticSelection } from "@/lib/haptics";

interface WeekSession {
  id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const CACHE_KEY = "training_week_sessions";

// Module-level in-memory cache — avoids JSON.parse on every mount,
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

// Exported preload — callable from Dashboard/UserContext before mount
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
    // Fall back to localStorage regardless of age — stale-while-revalidate
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
        // keep stale — widget is non-critical
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
        <div className="card-surface rounded-2xl border border-border overflow-hidden p-3.5 aspect-square flex flex-col">
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
      <div className="card-surface rounded-2xl border border-border overflow-hidden p-5">
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
        className="card-surface p-3.5 rounded-2xl border border-border overflow-hidden cursor-pointer active:scale-[0.98] transition-all duration-200 aspect-square flex flex-col"
        onClick={() => { triggerHapticSelection(); navigate("/training-calendar?openLogSession=true"); }}
      >
        {/* Header: ring + stats */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-11 h-11 flex-shrink-0">
            <AnimatedRing
              progress={ringProgress}
              size={44}
              strokeWidth={4}
              gradientColors={[ringColor, ringColor]}
              id="training-week-ring"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="display-number text-xs font-bold">{totalSessions}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-foreground">Training</div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="display-number text-lg font-bold">
                {totalMinutes >= 60 ? Math.round(totalMinutes / 60) : totalMinutes}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium">
                {totalMinutes >= 60 ? "hrs" : "min"}
              </span>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
        </div>

        {/* Week bar chart — fills remaining space */}
        <div className="flex items-end justify-between mt-auto px-0.5 gap-1">
          {DAY_LABELS.map((label, i) => {
            const daySessions = dayMap.get(i) ?? [];
            const isToday = i === todayIdx;
            const isFuture = i > todayIdx;
            const totalDayMin = daySessions.reduce((s, x) => s + x.duration_minutes, 0);
            const maxMin = 120;
            const barH = daySessions.length > 0 ? Math.max(6, Math.round((totalDayMin / maxMin) * 28)) : 0;

            return (
              <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                <div className="w-full flex flex-col justify-end items-center" style={{ height: 32 }}>
                  {daySessions.length > 0 ? (
                    <div
                      className="w-full rounded-sm transition-all duration-500"
                      style={{
                        height: barH,
                        background: daySessions.length === 1
                          ? getSessionColor(daySessions[0].session_type, customColors)
                          : `linear-gradient(to top, ${daySessions.map(s => getSessionColor(s.session_type, customColors)).join(", ")})`,
                        maxWidth: 20,
                      }}
                    />
                  ) : (
                    <div
                      className="w-full rounded-sm"
                      style={{ height: 3, maxWidth: 20, background: isFuture ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)" }}
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

        {/* Type pills — single-line carousel. When >2 types we duplicate
            the row and run the `animate-marquee` keyframe (defined in
            tailwind.config) so every label scrolls into view without
            ever wrapping or being clipped. Fewer than that, we just
            render the row statically. */}
        {typeEntries.length > 0 && (
          typeEntries.length <= 2 ? (
            <div className="flex items-center gap-1.5 mt-2 whitespace-nowrap overflow-hidden">
              {typeEntries.map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: `${getSessionColor(type, customColors)}15`,
                    color: getSessionColor(type, customColors),
                  }}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: getSessionColor(type, customColors) }} />
                  {type} {count}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 overflow-hidden" aria-label="Session types this week">
              <div className="flex items-center gap-1.5 w-max animate-marquee hover:[animation-play-state:paused] pr-1.5">
                {[...typeEntries, ...typeEntries].map(([type, count], i) => (
                  <span
                    key={`${type}-${i}`}
                    aria-hidden={i >= typeEntries.length}
                    className="inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      background: `${getSessionColor(type, customColors)}15`,
                      color: getSessionColor(type, customColors),
                    }}
                  >
                    <span className="w-1 h-1 rounded-full" style={{ background: getSessionColor(type, customColors) }} />
                    {type} {count}
                  </span>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    );
  }

  // Full-size (non-compact) layout
  return (
    <div
      className="card-surface p-5 rounded-2xl border border-border overflow-hidden cursor-pointer active:scale-[0.98] transition-all duration-200"
      onClick={() => { triggerHapticSelection(); navigate("/training-calendar?openLogSession=true"); }}
    >
      {/* Top row: ring + stats + chevron */}
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 flex-shrink-0">
          <AnimatedRing
            progress={ringProgress}
            size={80}
            strokeWidth={6}
            gradientColors={[ringColor, ringColor]}
            id="training-week-ring"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="display-number text-lg font-bold">{totalSessions}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Training This Week</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="display-number text-2xl font-bold">
              {totalMinutes >= 60 ? Math.round(totalMinutes / 60) : totalMinutes}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {totalMinutes >= 60 ? "hrs" : "min"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalSessions === 0 ? "No sessions yet" : `${activeDays} day${activeDays !== 1 ? "s" : ""} active`}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
      </div>

      {/* Week day bar chart */}
      <div className="flex items-end justify-between mt-4 px-1 gap-1.5">
        {DAY_LABELS.map((label, i) => {
          const daySessions = dayMap.get(i) ?? [];
          const isToday = i === todayIdx;
          const isFuture = i > todayIdx;
          const totalDayMin = daySessions.reduce((s, x) => s + x.duration_minutes, 0);
          const maxMin = 120;
          const barH = daySessions.length > 0 ? Math.max(8, Math.round((totalDayMin / maxMin) * 36)) : 0;

          return (
            <div key={i} className="flex flex-col items-center gap-1 flex-1">
              <div className="w-full flex flex-col justify-end items-center" style={{ height: 40 }}>
                {daySessions.length > 0 ? (
                  <div
                    className="w-full rounded-md transition-all duration-500"
                    style={{
                      height: barH,
                      background: daySessions.length === 1
                        ? getSessionColor(daySessions[0].session_type, customColors)
                        : `linear-gradient(to top, ${daySessions.map(s => getSessionColor(s.session_type, customColors)).join(", ")})`,
                      maxWidth: 28,
                    }}
                  />
                ) : (
                  <div
                    className="w-full rounded-md"
                    style={{ height: 4, maxWidth: 28, background: isFuture ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)" }}
                  />
                )}
              </div>
              <span className={`text-[10px] font-medium ${isToday ? "text-foreground" : isFuture ? "text-foreground/20" : "text-muted-foreground"}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Type legend pills — single-line carousel. ≤3 pills fit
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
