import { cn } from "@/lib/utils";

interface WeeklyTimelineProps {
  weeks: string[];          // YYYY-MM-DD strings sorted DESC (newest first)
  currentWeek: string;      // YYYY-MM-DD of the active selection
  onSelectWeek: (weekStart: string) => void;
}

/**
 * Compute the ISO 8601 week number for a YYYY-MM-DD date string.
 * Inline helper — small enough that pulling in date-fns just for `getISOWeek`
 * isn't worth the bytes here.
 */
function isoWeekNumber(weekStartDate: string): number {
  const d = new Date(weekStartDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 0;
  // ISO: Thursday in the same week determines the year.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function WeeklyTimeline({ weeks, currentWeek, onSelectWeek }: WeeklyTimelineProps) {
  if (weeks.length === 0) return null;

  return (
    <div className="overflow-x-auto flex gap-2 -mx-5 px-5 pb-1 scrollbar-none">
      {weeks.map(weekStart => {
        const isActive = weekStart === currentWeek;
        return (
          <button
            key={weekStart}
            type="button"
            onClick={() => onSelectWeek(weekStart)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-note font-bold transition-colors min-h-[32px] tabular-nums",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted/20 text-muted-foreground/80 hover:bg-muted/30"
            )}
          >
            Wk {isoWeekNumber(weekStart)}
          </button>
        );
      })}
    </div>
  );
}
