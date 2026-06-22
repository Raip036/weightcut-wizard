import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

// ─── ISO week helper (ported from WeeklyTimeline.tsx) ───────────────────────
function isoWeekNumber(weekStartDate: string): number {
  const d = new Date(weekStartDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 0;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ─── Shapes ──────────────────────────────────────────────────────────────────
interface PastWeekStats {
  sessionsLogged: number;
  totalMinutes: number;
  topDiscipline: string;
  avgRpe?: number;
  avgSleepHours?: number;
}

interface PastWeekDebrief {
  takeaways?: { discipline?: string; technique?: string; cue?: string; detail?: string }[];
  watchOut?: string;
}

interface PastWeekData {
  weekHeadline?: string;
  stats?: PastWeekStats;
  debrief?: PastWeekDebrief;
  // legacy shape fields — ignored for display
  sportSections?: unknown;
  weekOverview?: string;
}

interface PastWeekCardProps {
  weekStart: string;      // YYYY-MM-DD
  summaryData: PastWeekData | null;
  isSelected: boolean;
  onSelectWeek: (weekStart: string) => void;
  index: number;          // for stagger
}

// ─── Single card ─────────────────────────────────────────────────────────────
export function PastWeekCard({ weekStart, summaryData, isSelected, onSelectWeek, index }: PastWeekCardProps) {
  const prefersReduced = useReducedMotion();

  // Date range label: "Jun 9-15" or "Jun 28 - Jul 4" when month changes
  const ws = new Date(weekStart + "T00:00:00");
  const we = new Date(ws);
  we.setDate(ws.getDate() + 6);
  const sameMonth = ws.getMonth() === we.getMonth();
  const dateRange = sameMonth
    ? `${format(ws, "MMM d")}-${format(we, "d")}`
    : `${format(ws, "MMM d")} - ${format(we, "MMM d")}`;
  const wkNum = isoWeekNumber(weekStart);

  // Shape detection: new vs legacy vs empty
  const data = summaryData as Record<string, unknown> | null;
  const isNewShape = !!(
    data &&
    typeof data.weekHeadline === "string" &&
    data.stats &&
    typeof data.stats === "object" &&
    data.debrief &&
    typeof data.debrief === "object"
  );

  const headline: string | null = isNewShape
    ? (data!.weekHeadline as string)
    : null;

  const stats = isNewShape
    ? (data!.stats as PastWeekStats)
    : null;

  const debrief = isNewShape
    ? (data!.debrief as PastWeekDebrief)
    : null;

  const hasWatchOut = !!(debrief?.watchOut);

  // Top technique fallback for preview when headline is absent
  const topTechnique = debrief?.takeaways?.[0]?.technique ?? null;
  const previewText = headline ?? topTechnique ?? null;

  // Discipline chip
  const topDiscipline = stats?.topDiscipline ?? "";
  const token = disciplineToken(topDiscipline);
  const label = topDiscipline ? disciplineLabel(topDiscipline) : null;

  const sessions = stats?.sessionsLogged ?? null;

  // Staggered entrance, capped at index 7 to keep timing tight
  const staggerDelay = Math.min(index, 7) * 0.05;

  return (
    <motion.button
      type="button"
      onClick={() => onSelectWeek(weekStart)}
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: staggerDelay, ease: "easeOut" }}
      className={cn(
        "w-full text-left card-surface rounded-2xl overflow-hidden transition-colors duration-150 active:scale-[0.98]",
        isSelected ? "border border-primary/60" : "border border-border/50"
      )}
      style={
        // Subtle inset highlight using radial gradient (iOS-safe, no box-shadow)
        {
          background: isSelected
            ? `radial-gradient(ellipse at 50% 0%, hsl(var(${token}) / 0.10) 0%, transparent 70%)`
            : `radial-gradient(ellipse at 50% 0%, hsl(var(${token}) / 0.05) 0%, transparent 70%)`,
        }
      }
    >
      {/* Discipline-colored top accent stripe */}
      <div
        className={cn("h-[2px] w-full", isSelected ? "opacity-80" : "opacity-40")}
        style={{ background: `hsl(var(${token}))` }}
      />

      <div className="px-4 py-3 space-y-1.5">
        {/* Meta row */}
        <div className="flex items-center gap-2">
          <span className="text-note font-semibold text-foreground tabular-nums">
            {dateRange}
          </span>
          <span className="text-micro text-muted-foreground/60 font-bold uppercase tracking-wider tabular-nums">
            Wk {wkNum}
          </span>
          {hasWatchOut && (
            <span
              className="ml-auto h-2 w-2 rounded-full bg-amber-400/80 flex-shrink-0"
              aria-label="Watch-out noted"
            />
          )}
        </div>

        {/* Stat line + discipline chip */}
        {isNewShape && stats ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-micro text-muted-foreground tabular-nums">
              {sessions} {sessions === 1 ? "session" : "sessions"}
            </span>
            {label && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                style={{
                  color: `hsl(var(${token}))`,
                  background: `hsl(var(${token}) / 0.12)`,
                  border: `1px solid hsl(var(${token}) / 0.25)`,
                }}
              >
                {label}
              </span>
            )}
          </div>
        ) : (
          // Legacy or empty shape: no stats available
          <span className="text-micro text-muted-foreground/50 italic">
            Recap available
          </span>
        )}

        {/* Preview line: headline or top technique, 1-line clamped */}
        {previewText && (
          <p className="text-note text-muted-foreground/80 line-clamp-1 leading-snug">
            {previewText}
          </p>
        )}
        {!previewText && !isNewShape && (
          <p className="text-note text-muted-foreground/50 italic line-clamp-1">
            Older format
          </p>
        )}
      </div>
    </motion.button>
  );
}

// ─── List wrapper ─────────────────────────────────────────────────────────────
const INITIAL_VISIBLE = 8;

interface SavedSummaryRow {
  week_start: string;
  summary_data: PastWeekData | null;
}

interface PastWeekListProps {
  summaries: SavedSummaryRow[];        // DESC (newest first)
  selectedWeekStart: string;
  onSelectWeek: (weekStart: string) => void;
}

export function PastWeekList({ summaries, selectedWeekStart, onSelectWeek }: PastWeekListProps) {
  const [showAll, setShowAll] = useState(false);

  if (summaries.length === 0) return null;

  const visible = showAll ? summaries : summaries.slice(0, INITIAL_VISIBLE);
  const hasMore = summaries.length > INITIAL_VISIBLE;

  return (
    <div className="space-y-2">
      {visible.map((row, i) => (
        <PastWeekCard
          key={row.week_start}
          weekStart={row.week_start}
          summaryData={row.summary_data}
          isSelected={row.week_start === selectedWeekStart}
          onSelectWeek={onSelectWeek}
          index={i}
        />
      ))}
      {hasMore && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full text-center text-note font-semibold text-muted-foreground/70 hover:text-foreground py-2 transition-colors"
        >
          Show earlier weeks
        </button>
      )}
    </div>
  );
}
