// T14: CampCompassCard — UI surface for the Sunday weekly AI recovery report
// ("Camp Compass"). The Recovery page itself is free; THIS card is Pro-gated.
//
// States:
//   • subscription resolving / query in-flight → skeleton.
//   • free user                                → amber-border locked preview
//                                                with blurred faux-bullets +
//                                                "Unlock — Pro" CTA. Tap routes
//                                                to the existing paywall via
//                                                `useSubscription().openPaywall`.
//   • pro user, report present                 → verdict (large semibold), a
//                                                "Where you broke down" prose
//                                                block, a "Next 7 days" list
//                                                with day-formatted rows, and
//                                                an optional "Camp arc"
//                                                section. Tapping the card
//                                                opens a bottom sheet with the
//                                                same content laid out larger.
//   • pro user, no report yet                  → informational "Your first
//                                                report drops Sunday at 8pm."
//                                                — no CTA.
//
// Data wiring is self-contained: the component owns its `useQuery` against
// `api.recoveryReports.listRecent` so callers only need to pass the auth'd
// `userId` (or `null` while it resolves). It returns the user's reports
// newest-first; the card renders them as a horizontal swipe carousel (one
// FilledCompass-style page per stored week).
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "convex/react";
import useEmblaCarousel from "embla-carousel-react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import Sparkline from "@/components/charts/Sparkline";
import { getSessionColor } from "@/lib/sessionColors";
import ErrorBoundary from "@/components/ErrorBoundary";

interface CampCompassCardProps {
  userId: string | null;
  className?: string;
}

interface NextWeekAction {
  dayIso: string;
  action: string;
}

interface RecoveryReport {
  _id: string;
  weekStartIso: string;
  verdict: string;
  breakdown: string;
  nextWeekActions: NextWeekAction[];
  campArc?: string;
  createdAt: number;
}

// ── Live-data row shapes (subset of the Convex query returns we read) ──
interface CalendarSession {
  date: string;
  sessionType: string;
  sessionTag?: string;
  durationMinutes: number;
  rpe: number;
  intensity?: string;
}

interface SleepRow {
  date: string;
  hours: number;
}

interface WellnessRow {
  date: string;
  readinessScore?: number;
  hooperIndex?: number;
  sleepHours?: number;
}

// ── Live weekly breakdown shape (from api.recoveryReports.getWeekBreakdown) ──
// Reactive, deterministic recompute of the same week window the report covers.
// Replaces the FROZEN `report.breakdown` prose so the list always matches the
// top cards even after the user edits/deletes sessions. Read defensively with
// optional chaining — field names may shift slightly when the backend lands.
interface WeekBreakdownSession {
  date: string;
  dayLabel?: string;
  type?: string;
  durationMinutes?: number;
  rpe?: number | null;
}

interface WeekBreakdown {
  weekStartIso?: string;
  weekEndIso?: string;
  sessionCount?: number;
  totalMinutes?: number;
  avgRpe?: number | null;
  totalLoad?: number;
  avgSleepH?: number | null;
  hardestDay?: string | null;
  sessions?: WeekBreakdownSession[];
  restOrMissedDays?: string[];
}

// Functional readiness thresholds shared by the trend stroke + delta tint.
const READY_GOOD = "rgb(var(--func-recovery-green))";
const READY_WARN = "rgb(var(--func-warning-yellow))";
const READY_BAD = "rgb(var(--func-danger-red))";

// readinessScore is 0-100; hooperIndex (4-28, higher = better) is rescaled to
// the same 0-100 band so a mixed series colours consistently.
function readinessColor(value: number): string {
  if (value >= 66) return READY_GOOD;
  if (value >= 40) return READY_WARN;
  return READY_BAD;
}

const SECTION_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70";

// Replace em/en dashes with comma-space when they sit between words, otherwise
// drop them, then collapse stray double spaces. Keeps AI prose readable as a
// single clause instead of the model's signature " — " punctuation.
function cleanText(s: string): string {
  if (!s) return s;
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

// week start ISO + n days, returned as YYYY-MM-DD (local, no UTC drift).
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// "Mon · Jun 3" from "2026-06-03". Falls back to the raw ISO if parsing fails.
function formatDayLabel(iso: string): string {
  try {
    // Parse as a local date — splitting on "-" avoids the UTC offset gotcha
    // that `new Date("2026-06-03")` triggers (it's interpreted as UTC midnight
    // and can show the previous day for negative-offset timezones).
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    const monthDay = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${weekday} · ${monthDay}`;
  } catch {
    return iso;
  }
}

// "week of Jun 3" from "2026-06-03". Same UTC caveat as above.
function formatWeekOfLabel(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// "Mon Jun 16" from "2026-06-16" — weekday + month-day, no separator dot.
// Used for the live breakdown week-range header. Same local-parse UTC caveat.
function formatRangeDay(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    const monthDay = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${weekday} ${monthDay}`;
  } catch {
    return iso;
  }
}

// Short weekday ("Mon") from an ISO date or pass-through if it's already a
// label. Used for the "Rest: Tue, Sun" line + per-row day labels when the
// backend hasn't supplied a `dayLabel`.
function shortWeekday(value: string): string {
  // Already a short label (no dashes) — pass through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    const [y, m, d] = value.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return value;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
    });
  } catch {
    return value;
  }
}

// "5 sessions · 3h 40m · RPE 6.8 · load 240" — the summary stat clause under
// the week range. Each segment self-hides when its value is absent so the
// line never shows a stray "·" or null.
function formatBreakdownSummary(b: WeekBreakdown): string {
  const parts: string[] = [];
  const count = b.sessionCount ?? 0;
  parts.push(`${count} ${count === 1 ? "session" : "sessions"}`);

  const mins = b.totalMinutes ?? 0;
  if (mins > 0) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    parts.push(h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`);
  }
  if (typeof b.avgRpe === "number" && b.avgRpe > 0)
    parts.push(`RPE ${b.avgRpe.toFixed(1)}`);
  if (typeof b.totalLoad === "number" && b.totalLoad > 0)
    parts.push(`load ${Math.round(b.totalLoad)}`);

  return parts.join(" · ");
}

// ── Skeleton ───────────────────────────────────────────────────────────
function CampCompassSkeleton() {
  return (
    <div className="card-surface rounded-2xl border border-border/50 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

// ── Free / locked preview ─────────────────────────────────────────────
function LockedCompass({
  onUpgrade,
  className,
  prefersReduced,
}: {
  onUpgrade: () => void;
  className: string;
  prefersReduced: boolean | null;
}) {
  // Faux bullets with redacted headers — kept short so the blur reads as
  // intentional copy redaction rather than broken content.
  const fauxBullets = [
    "Verdict ░░░░░░░░░",
    "Where you broke down ░░░░░░░",
    "Next week's play ░░░░░░",
  ];

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`relative card-surface rounded-2xl border border-amber-400/30 bg-amber-400/[0.03] p-5 overflow-hidden ${className}`}
    >
      <div className="absolute top-3 right-3 text-amber-400/80">
        <Icon name="lockClosedOutline" size={14} aria-label="Pro feature" />
      </div>

      <div className={SECTION_LABEL}>Sunday report · Pro</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        Your Sunday Report
      </h3>

      <div
        aria-hidden
        className="mt-3 space-y-2"
        style={{ filter: "blur(4px)", userSelect: "none" }}
      >
        {fauxBullets.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-[13px] text-muted-foreground leading-snug"
          >
            <span className="text-muted-foreground/60">·</span>
            <span>{line}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground leading-snug">
        Weekly AI recap of your camp - where you broke down and what to fix.
      </p>

      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onUpgrade();
        }}
        className="mt-4 w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      >
        <Icon name="lockClosedOutline" size={14} />
        Unlock - Pro
      </button>
    </motion.div>
  );
}

// ── Pro empty state ───────────────────────────────────────────────────
function EmptyCompass({
  className,
  prefersReduced,
}: {
  className: string;
  prefersReduced: boolean | null;
}) {
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      <div className={SECTION_LABEL}>Sunday report</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        Sunday Report
      </h3>
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
        Your first report drops Sunday at 8pm.
      </p>
    </motion.div>
  );
}

// ── Live-data hook: pulls + shapes the week's sessions / sleep / wellness ─
interface WeekData {
  sessions: CalendarSession[];
  /** 7-slot sleep series (oldest→newest), NaN where a day is missing. */
  sleepSeries: number[];
  sleepValues: number[]; // present-only, for averages
  /** 7-slot readiness series (oldest→newest), present-only filtered for chart. */
  readinessSeries: number[];
  stats: {
    sessionCount: number;
    totalMinutes: number;
    avgRpe: number | null;
    avgSleep: number | null;
    topDiscipline: string | null;
  };
}

function useWeekData(userId: string | null, weekStartIso: string): WeekData {
  const weekEndIso = addDaysIso(weekStartIso, 6);

  const sessionsRaw = useQuery(
    api.fight_camp.listCalendar,
    userId ? { from: weekStartIso, to: weekEndIso } : "skip",
  ) as CalendarSession[] | undefined;

  const sleepRaw = useQuery(
    api.sleep_logs.listForUser,
    userId ? { from: weekStartIso, to: weekEndIso } : "skip",
  ) as SleepRow[] | undefined;

  const wellnessRaw = useQuery(
    api.wellness.listCheckins,
    userId ? { from: weekStartIso, to: weekEndIso, limit: 90 } : "skip",
  ) as WellnessRow[] | undefined;

  return useMemo<WeekData>(() => {
    const weekDays = Array.from({ length: 7 }, (_, i) =>
      addDaysIso(weekStartIso, i),
    );
    const inWeek = new Set(weekDays);

    const sessions = (sessionsRaw ?? [])
      .filter((s) => inWeek.has(s.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Sleep: map by date, build a 7-slot ordered series.
    const sleepByDate = new Map<string, number>();
    (sleepRaw ?? []).forEach((r) => {
      if (inWeek.has(r.date)) sleepByDate.set(r.date, r.hours);
    });
    const sleepSeries = weekDays.map((d) => sleepByDate.get(d) ?? NaN);
    const sleepValues = sleepSeries.filter((v) => !Number.isNaN(v));

    // Readiness: prefer readinessScore, fall back to a rescaled hooperIndex.
    const readyByDate = new Map<string, number>();
    (wellnessRaw ?? []).forEach((r) => {
      if (!inWeek.has(r.date)) return;
      if (typeof r.readinessScore === "number") {
        readyByDate.set(r.date, r.readinessScore);
      } else if (typeof r.hooperIndex === "number") {
        // hooperIndex 4 (best) → 28 (worst); rescale to 0-100 higher=better.
        const pct = ((28 - r.hooperIndex) / 24) * 100;
        readyByDate.set(r.date, Math.max(0, Math.min(100, pct)));
      }
    });
    const readinessSeries = weekDays
      .map((d) => readyByDate.get(d))
      .filter((v): v is number => typeof v === "number");

    // Top discipline = most-frequent sessionType.
    const counts = new Map<string, number>();
    sessions.forEach((s) =>
      counts.set(s.sessionType, (counts.get(s.sessionType) ?? 0) + 1),
    );
    let topDiscipline: string | null = null;
    let topN = 0;
    counts.forEach((n, k) => {
      if (n > topN) {
        topN = n;
        topDiscipline = k;
      }
    });

    const avgRpeRaw = mean(sessions.map((s) => s.rpe).filter((n) => n > 0));

    return {
      sessions,
      sleepSeries,
      sleepValues,
      readinessSeries,
      stats: {
        sessionCount: sessions.length,
        totalMinutes: sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0),
        avgRpe: avgRpeRaw,
        avgSleep: mean(sleepValues),
        topDiscipline,
      },
    };
  }, [sessionsRaw, sleepRaw, wellnessRaw, weekStartIso]);
}

// ── Weekly stats strip ────────────────────────────────────────────────
function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="surface-inset rounded-xl px-3 py-2.5 flex flex-col items-center justify-center text-center">
      <span className="display-number text-[18px] leading-none text-foreground">
        {value}
      </span>
      <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
        {label}
      </span>
    </div>
  );
}

function StatStrip({ stats }: { stats: WeekData["stats"] }) {
  const tiles: { value: string; label: string }[] = [];
  if (stats.sessionCount > 0)
    tiles.push({ value: String(stats.sessionCount), label: "Sessions" });
  if (stats.totalMinutes > 0)
    tiles.push({ value: String(stats.totalMinutes), label: "Minutes" });
  if (stats.avgRpe !== null)
    tiles.push({ value: stats.avgRpe.toFixed(1), label: "Avg RPE" });
  if (stats.avgSleep !== null)
    tiles.push({ value: `${stats.avgSleep.toFixed(1)}h`, label: "Avg Sleep" });
  if (stats.topDiscipline)
    tiles.push({ value: stats.topDiscipline, label: "Top" });

  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.slice(0, 4).map((t) => (
        <StatTile key={t.label} value={t.value} label={t.label} />
      ))}
    </div>
  );
}

// ── Sleep & readiness trend ───────────────────────────────────────────
function TrendBlock({
  label,
  series,
  latestSuffix,
  stroke,
  delta,
}: {
  label: string;
  series: number[];
  latestSuffix: string;
  stroke: string;
  delta: string | null;
}) {
  const latest = series[series.length - 1];
  return (
    <div className="surface-inset rounded-xl px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
          {label}
        </span>
        <span className="display-number text-[15px] text-foreground">
          {Number.isNaN(latest) ? "-" : `${Math.round(latest * 10) / 10}${latestSuffix}`}
        </span>
      </div>
      <div className="mt-2 h-7">
        <Sparkline data={series} stroke={stroke} />
      </div>
      {delta && (
        <div className="mt-1 text-[10px] text-muted-foreground/70">{delta}</div>
      )}
    </div>
  );
}

function SleepReadinessTrend({ data }: { data: WeekData }) {
  const sleepChart = data.sleepValues; // present-only for a clean line
  const readyChart = data.readinessSeries;

  const showSleep = sleepChart.length >= 2;
  const showReady = readyChart.length >= 2;
  if (!showSleep && !showReady) return null;

  const readyLatest = readyChart[readyChart.length - 1];
  const readyAvg = mean(readyChart);
  const readyDelta =
    showReady && readyAvg !== null
      ? readyLatest >= readyAvg
        ? "last vs avg ▲ rebound"
        : "last vs avg ▼ dip"
      : null;

  return (
    <div>
      <div className={SECTION_LABEL}>Sleep &amp; readiness</div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {showSleep && (
          <TrendBlock
            label="Sleep"
            series={sleepChart}
            latestSuffix="h"
            stroke="hsl(var(--primary))"
            delta={
              data.stats.avgSleep !== null
                ? `avg ${data.stats.avgSleep.toFixed(1)}h`
                : null
            }
          />
        )}
        {showReady && (
          <TrendBlock
            label="Readiness"
            series={readyChart}
            latestSuffix=""
            stroke={readinessColor(readyLatest)}
            delta={readyDelta}
          />
        )}
      </div>
    </div>
  );
}

// ── Compact read-only session row ─────────────────────────────────────
function SessionRow({ session }: { session: CalendarSession }) {
  const color = getSessionColor(session.sessionType);
  const name = session.sessionTag
    ? `${session.sessionType} · ${session.sessionTag}`
    : session.sessionType;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white/95"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {session.sessionType.charAt(0).toUpperCase()}
      </span>
      <span className="flex-1 min-w-0 text-[13px] font-medium text-foreground truncate">
        {name}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[12px] text-foreground/85 tabular-nums">
          {session.durationMinutes}m · RPE {session.rpe}
        </span>
        <span className="block text-[10px] text-muted-foreground/70">
          {formatDayLabel(session.date)}
        </span>
      </span>
    </li>
  );
}

function SessionList({
  sessions,
  expanded,
}: {
  sessions: CalendarSession[];
  expanded: boolean;
}) {
  if (sessions.length === 0) return null;
  const shown = expanded ? sessions : sessions.slice(0, 6);
  return (
    <div>
      <div className={SECTION_LABEL}>This week's sessions</div>
      <ul className="mt-1.5 divide-y divide-border/40 rounded-md border border-border/30 overflow-hidden">
        {shown.map((s, i) => (
          <SessionRow key={`${s.date}-${i}`} session={s} />
        ))}
      </ul>
    </div>
  );
}

// ── Live "This week" breakdown ────────────────────────────────────────
// Reactive, deterministic replacement for the stale `report.breakdown` prose.
// Pulls `api.recoveryReports.getWeekBreakdown` for the SAME week window the
// report covers (weekStartIso → +6 days), so its summary line + session list
// always agree with the top stat cards. Handles loading (undefined) and the
// empty (sessionCount === 0) states inline.
//
// NOTE (build): `getWeekBreakdown` may not be in the generated Convex API yet
// (another agent is adding the backend query). We read the function reference
// defensively so this file type-checks before `npx convex codegen`/`deploy`
// regenerates `convex/_generated/api`.
const getWeekBreakdownRef = (
  api.recoveryReports as unknown as {
    getWeekBreakdown?: Parameters<typeof useQuery>[0];
  }
).getWeekBreakdown;

function BreakdownRow({ session }: { session: WeekBreakdownSession }) {
  const type = session.type ?? "Session";
  const color = getSessionColor(type);
  const dayLabel = session.dayLabel ?? shortWeekday(session.date);
  const mins = session.durationMinutes;
  const rpe = session.rpe;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className="shrink-0 h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white/95"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {type.charAt(0).toUpperCase()}
      </span>
      <span className="shrink-0 w-[44px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
        {dayLabel}
      </span>
      <span className="flex-1 min-w-0 text-[13px] font-medium text-foreground truncate">
        {type}
      </span>
      <span className="shrink-0 text-[12px] text-foreground/80 tabular-nums">
        {typeof mins === "number" && mins > 0 ? `${mins}m` : "—"}
        {typeof rpe === "number" && rpe > 0 ? ` · RPE ${rpe}` : ""}
      </span>
    </li>
  );
}

function LiveBreakdownSkeleton({ expanded }: { expanded: boolean }) {
  return (
    <div className="card-surface rounded-xl border border-border/40 p-3.5">
      <div className={SECTION_LABEL}>This week</div>
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: expanded ? 4 : 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

function LiveBreakdown({
  weekStartIso,
  expanded,
}: {
  weekStartIso: string;
  expanded: boolean;
}) {
  // Reactive: edits/deletes to this week's sessions auto-refresh the list.
  // `"skip"` while the ref is missing (backend query not generated yet) so
  // the build/runtime stays safe; the section just renders nothing then.
  const breakdown = useQuery(
    getWeekBreakdownRef ?? api.recoveryReports.listRecent,
    getWeekBreakdownRef ? { weekStartIso } : "skip",
  ) as WeekBreakdown | undefined;

  // Backend query not wired yet — render nothing (the rest of the report,
  // verdict/stats/trend/sessions, still shows). Removed once codegen runs.
  if (!getWeekBreakdownRef) return null;

  // Loading — subtle skeleton, never a layout jump.
  if (breakdown === undefined) return <LiveBreakdownSkeleton expanded={expanded} />;

  const startIso = breakdown.weekStartIso ?? weekStartIso;
  const endIso = breakdown.weekEndIso ?? addDaysIso(weekStartIso, 6);
  const range = `${formatRangeDay(startIso)} – ${formatRangeDay(endIso)}`;
  const summary = formatBreakdownSummary(breakdown);
  const sessions = breakdown.sessions ?? [];
  const restDays = breakdown.restOrMissedDays ?? [];
  const sessionCount = breakdown.sessionCount ?? sessions.length;

  // In the compact card cap rows so the carousel page stays tidy; the sheet
  // shows the full list.
  const shown = expanded ? sessions : sessions.slice(0, 6);
  const moreCount = sessions.length - shown.length;

  return (
    <div className="card-surface rounded-xl border border-border/40 p-3.5">
      {/* Header: week range + summary stat line (consistent with top cards) */}
      <div className="flex items-baseline justify-between gap-3">
        <div className={SECTION_LABEL}>This week</div>
        <div className="text-[10px] font-semibold tracking-tight text-muted-foreground/70 tabular-nums">
          {range}
        </div>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-foreground/90 tabular-nums">
        {summary}
      </p>

      {/* Optional callouts — hardest day / avg sleep */}
      {(breakdown.hardestDay || typeof breakdown.avgSleepH === "number") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {breakdown.hardestDay && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Hardest · {shortWeekday(breakdown.hardestDay)}
            </span>
          )}
          {typeof breakdown.avgSleepH === "number" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              Sleep · {breakdown.avgSleepH.toFixed(1)}h avg
            </span>
          )}
        </div>
      )}

      {/* Empty state */}
      {sessionCount === 0 ? (
        <p className="mt-3 text-[12px] text-muted-foreground/60 leading-snug">
          No sessions logged this week.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/40 rounded-md border border-border/30 overflow-hidden">
          {shown.map((s, i) => (
            <BreakdownRow key={`${s.date}-${i}`} session={s} />
          ))}
          {moreCount > 0 && (
            <li className="px-3 py-2 text-[11px] text-muted-foreground/60">
              +{moreCount} more {moreCount === 1 ? "session" : "sessions"}
            </li>
          )}
        </ul>
      )}

      {/* Rest / missed days */}
      {restDays.length > 0 && (
        <p className="mt-2.5 text-[11px] text-muted-foreground/70">
          Rest: {restDays.map(shortWeekday).join(", ")}
        </p>
      )}
    </div>
  );
}

// ── Shared body (used by card + full sheet) ───────────────────────────
function ReportBody({
  report,
  expanded,
  weekData,
}: {
  report: RecoveryReport;
  expanded: boolean;
  weekData: WeekData;
}) {
  // In the compact card we cap the actions at 3 (per spec); the sheet
  // shows the full list. The action returns at most 3 in current spec
  // but we cap defensively.
  const actions = expanded
    ? report.nextWeekActions
    : report.nextWeekActions.slice(0, 3);

  // Does any data-driven visual section have something to show this week?
  // When nothing was logged, all three self-hide — so we surface one quiet
  // line instead of a silent gap below the verdict.
  const s = weekData.stats;
  const hasStats =
    s.sessionCount > 0 ||
    s.totalMinutes > 0 ||
    s.avgRpe !== null ||
    s.avgSleep !== null ||
    !!s.topDiscipline;
  const hasTrend =
    weekData.sleepValues.length >= 2 || weekData.readinessSeries.length >= 2;
  const hasSessions = weekData.sessions.length > 0;
  const hasAnyData = hasStats || hasTrend || hasSessions;

  return (
    <div className="space-y-4">
      {/* VERDICT — hero line, renders immediately (no dependency on queries) */}
      <p
        className={`${expanded ? "text-[18px]" : "text-[16px]"} font-semibold leading-snug text-foreground`}
      >
        {cleanText(report.verdict)}
      </p>

      {/* WEEKLY STATS STRIP — client-side from live sessions + sleep */}
      <StatStrip stats={weekData.stats} />

      {/* SLEEP & READINESS TREND */}
      <SleepReadinessTrend data={weekData} />

      {/* Low-data fallback — only when no chartable training/sleep this week */}
      {!hasAnyData && (
        <p className="text-[12px] text-muted-foreground/60 leading-snug">
          Not enough logged this week to chart your training. Log sessions,
          sleep, and check-ins to see your weekly trends here.
        </p>
      )}

      {/* THIS WEEK — LIVE deterministic breakdown (replaces stale AI prose).
          Reactive: edits/deletes auto-refresh so it always matches the cards.

          `getWeekBreakdown` may not be deployed yet (Convex deploy is held
          during App Store review). If it errors server-side, silently fall back
          to the live SessionList — which uses the already-deployed
          `listCalendar` query — so the page never crashes. It auto-upgrades to
          the live breakdown the moment the query is deployed. */}
      <ErrorBoundary
        silent
        fallback={<SessionList sessions={weekData.sessions} expanded={expanded} />}
      >
        <LiveBreakdown weekStartIso={report.weekStartIso} expanded={expanded} />
      </ErrorBoundary>

      {actions.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Next 7 days</div>
          <ul className="mt-1.5 divide-y divide-border/40 rounded-md border border-border/30 overflow-hidden">
            {actions.map((a, i) => (
              <li
                key={`${a.dayIso}-${i}`}
                className="flex items-start gap-3 px-3 py-2.5"
              >
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80 w-[88px] tabular-nums">
                  {formatDayLabel(a.dayIso)}
                </span>
                <span
                  className={`flex-1 ${expanded ? "text-[14px]" : "text-[13px]"} text-foreground leading-snug`}
                >
                  {cleanText(a.action)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.campArc && (
        <div className="card-surface rounded-xl border border-border/40 p-3.5">
          <div className={SECTION_LABEL}>Camp arc</div>
          <p
            className={`mt-1.5 ${expanded ? "text-[14px]" : "text-[13px]"} text-foreground/85 leading-relaxed`}
          >
            {cleanText(report.campArc)}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Single carousel page (one stored week) ────────────────────────────────
// Each page owns its OWN `useWeekData` (hooks can't run inside a `.map`) and
// its OWN full-report Sheet. The compact card surfaces the verdict/stats/
// trend/sessions; a big full-width tap bar — not the old 14px chevron — opens
// the expanded report.
function ReportPage({
  report,
  userId,
}: {
  report: RecoveryReport;
  userId: string | null;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Live week data — drives stats / trend / sessions for THIS week. Renders
  // below the verdict + prose as it resolves; never blocks the text.
  const weekData = useWeekData(userId, report.weekStartIso);

  const openSheet = () => {
    triggerHapticSelection();
    setSheetOpen(true);
  };

  return (
    // Embla slide: full-width, scroll-snap handled by the carousel container.
    <div className="min-w-0 flex-[0_0_100%] px-0.5">
      <div className="card-surface rounded-2xl border border-border/50 overflow-hidden">
        <button
          type="button"
          onClick={openSheet}
          aria-label={`Open full Sunday report for week of ${formatWeekOfLabel(report.weekStartIso)}`}
          className="w-full text-left p-5 active:scale-[0.995] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className={`${SECTION_LABEL} mb-3`}>
            Sunday Report · week of {formatWeekOfLabel(report.weekStartIso)}
          </div>
          <ReportBody report={report} expanded={false} weekData={weekData} />
        </button>

        {/* Bigger expand affordance — full-width, ≥44px, large chevron. */}
        <button
          type="button"
          onClick={openSheet}
          aria-label="Read the full report"
          className="flex w-full min-h-[44px] items-center justify-center gap-1.5 border-t border-border/40 py-3.5 text-[13px] font-semibold text-primary active:bg-primary/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Read the full report
          <Icon name="chevronDownOutline" size={20} />
        </button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <VisuallyHidden>
            <SheetTitle>Sunday Report</SheetTitle>
          </VisuallyHidden>
          <div className="flex justify-center pt-2 pb-1">
            <div
              className="w-10 h-1 rounded-full bg-muted-foreground/25"
              aria-hidden
            />
          </div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Camp Compass
              </p>
              <h2 className="text-[19px] font-bold tracking-tight">
                Week of {formatWeekOfLabel(report.weekStartIso)}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close"
              className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
            >
              <Icon name="closeOutline" size={16} />
            </button>
          </div>
          <div className="px-5 pb-5">
            <ReportBody report={report} expanded={true} weekData={weekData} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Pro filled carousel ────────────────────────────────────────────────────
// Horizontal, swipeable pager across the user's stored weeks (newest first).
// Embla drives reliable active-index tracking; dots + the active week label
// give orientation, and prev/next is swipe-driven (dots are tap-to-jump too).
function CompassCarousel({
  reports,
  userId,
  className,
  prefersReduced,
}: {
  reports: RecoveryReport[];
  userId: string | null;
  className: string;
  prefersReduced: boolean | null;
}) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    // Respect reduced-motion: a snappy 0-duration scroll avoids the easing.
    duration: prefersReduced ? 0 : 22,
  });
  const [selected, setSelected] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelected(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollTo = useCallback(
    (i: number) => {
      triggerHapticSelection();
      emblaApi?.scrollTo(i);
    },
    [emblaApi],
  );

  const active = reports[selected] ?? reports[0];
  const showDots = reports.length > 1;

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 260 }}
      className={className}
    >
      {/* Header: prominent active week label + page dots */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="min-w-0">
          <div className={SECTION_LABEL}>Sunday report</div>
          <div className="mt-0.5 text-[15px] font-bold tracking-tight text-foreground truncate">
            Week of {formatWeekOfLabel(active.weekStartIso)}
          </div>
        </div>
        {showDots && (
          <div className="flex shrink-0 items-center gap-1.5" role="tablist">
            {reports.map((r, i) => (
              <button
                key={r._id}
                type="button"
                role="tab"
                aria-selected={i === selected}
                aria-label={`Week of ${formatWeekOfLabel(r.weekStartIso)}`}
                onClick={() => scrollTo(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === selected ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Embla viewport */}
      <div className="overflow-hidden -mx-0.5" ref={emblaRef}>
        <div className="flex">
          {reports.map((report) => (
            <ReportPage key={report._id} report={report} userId={userId} />
          ))}
        </div>
      </div>

      {showDots && (
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground/40">
          <Icon name="chevronBackOutline" size={11} />
          swipe through {reports.length} weeks
          <Icon name="chevronForwardOutline" size={11} />
        </div>
      )}
    </motion.div>
  );
}

// ── Outer ──────────────────────────────────────────────────────────────
export function CampCompassCard({ userId, className = "" }: CampCompassCardProps) {
  const prefersReduced = useReducedMotion();
  const { isSubscriptionResolved, openPaywall, checkFeatureAccess } =
    useSubscription();
  // TEMP: Recovery ungated for now (was `isPremium`). Gate the filled report on
  // the RECOVERY feature flag instead of raw tier, so reverting the gate
  // registry (src/lib/featureGates.ts) re-locks this card too.
  const hasRecoveryAccess = checkFeatureAccess("RECOVERY");

  // Self-contained reactive query against the user's recent weekly reports
  // (newest first). The carousel pages through them; `undefined` = loading.
  const reports = useQuery(
    api.recoveryReports.listRecent,
    userId ? { limit: 12 } : "skip",
  ) as RecoveryReport[] | undefined;

  // Loading: subscription unresolved OR (Pro user with query in flight).
  // For free users we don't need the reports to render the locked state,
  // so we paint as soon as subscription resolves.
  if (!isSubscriptionResolved) {
    return <CampCompassSkeleton />;
  }

  if (!hasRecoveryAccess) {
    return (
      <LockedCompass
        onUpgrade={() => openPaywall("camp_compass")}
        className={className}
        prefersReduced={prefersReduced}
      />
    );
  }

  // Pro user — wait on the query before deciding empty vs filled.
  if (reports === undefined) {
    return <CampCompassSkeleton />;
  }

  if (reports.length === 0) {
    return <EmptyCompass className={className} prefersReduced={prefersReduced} />;
  }

  return (
    <CompassCarousel
      reports={reports}
      userId={userId}
      className={className}
      prefersReduced={prefersReduced}
    />
  );
}
