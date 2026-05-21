import { memo, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, Dumbbell } from "lucide-react";
import { springs } from "@/lib/motion";
import { formatVolume } from "@/lib/gymCalculations";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { SessionWithSets } from "@/pages/gym/types";

interface SessionHistoryCalendarProps {
  sessions: SessionWithSets[];
  loading: boolean;
  onSessionTap: (session: SessionWithSets) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const SessionHistoryCalendar = memo(function SessionHistoryCalendar({
  sessions, loading, onSessionTap,
}: SessionHistoryCalendarProps) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(() => toYmd(new Date()));

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, SessionWithSets[]>();
    for (const s of sessions) {
      // session.date is 'YYYY-MM-DD' already
      const key = s.date.slice(0, 10);
      const existing = map.get(key);
      if (existing) existing.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [sessions]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = lastDay.getDate();

    const result: Array<{ date: Date | null; ymd: string | null }> = [];
    for (let i = 0; i < startOffset; i++) {
      result.push({ date: null, ymd: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      result.push({ date, ymd: toYmd(date) });
    }
    // Pad trailing to complete last row
    while (result.length % 7 !== 0) {
      result.push({ date: null, ymd: null });
    }
    return result;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayYmd = toYmd(new Date());
  const selectedSessions = selectedDate ? (sessionsByDate.get(selectedDate) ?? []) : [];

  const changeMonth = (delta: number) => {
    triggerHaptic(ImpactStyle.Light);
    setCursor(prev => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + delta);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="card-surface rounded-xs border border-border/50 p-4">
        <div className="h-5 w-32 rounded shimmer-skeleton mb-4" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xs shimmer-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card-surface rounded-xs border border-border/50 p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => changeMonth(-1)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground active:bg-muted/60 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold">{monthLabel}</h3>
          <button
            onClick={() => changeMonth(1)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground active:bg-muted/60 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Weekday row */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="text-center text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell.date || !cell.ymd) {
              return <div key={i} className="aspect-square" />;
            }
            const hasSession = sessionsByDate.has(cell.ymd);
            const isToday = cell.ymd === todayYmd;
            const isSelected = cell.ymd === selectedDate;

            return (
              <button
                key={i}
                onClick={() => {
                  setSelectedDate(cell.ymd);
                  triggerHaptic(ImpactStyle.Light);
                }}
                className={`aspect-square rounded-xs flex flex-col items-center justify-center text-xs font-medium relative transition-all active:scale-95 ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : hasSession
                      ? "bg-primary/12 text-primary active:bg-primary/20"
                      : isToday
                        ? "text-foreground border border-primary/30"
                        : "text-muted-foreground/70 active:bg-muted/40"
                }`}
              >
                <span className="tabular-nums">{cell.date.getDate()}</span>
                {hasSession && !isSelected && (
                  <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day sessions */}
      <AnimatePresence mode="wait">
        {selectedDate && (
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={springs.snappy}
            className="space-y-2"
          >
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "long", month: "short", day: "numeric",
                })}
              </h4>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {selectedSessions.length} {selectedSessions.length === 1 ? "workout" : "workouts"}
              </span>
            </div>

            {selectedSessions.length === 0 ? (
              <div className="card-surface rounded-xs border border-border/50 p-5 text-center">
                <div className="h-10 w-10 rounded-xs bg-muted/50 flex items-center justify-center mx-auto mb-2">
                  <Dumbbell className="h-5 w-5 text-muted-foreground/30" />
                </div>
                <p className="text-xs text-muted-foreground">No workout on this day</p>
              </div>
            ) : (
              selectedSessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => onSessionTap(session)}
                  className="w-full card-surface rounded-xs border border-border/50 p-3.5 text-left active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2.5 py-1 rounded-full bg-primary/12 text-primary text-xs font-semibold">
                      {session.session_type}
                    </span>
                    {session.duration_minutes != null && session.duration_minutes > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {session.duration_minutes}m
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="tabular-nums font-medium text-foreground/80">{session.exerciseCount}</span>
                      <span>exercises</span>
                    </span>
                    {session.totalVolume > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums font-medium text-foreground/80">{formatVolume(session.totalVolume)} kg</span>
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
