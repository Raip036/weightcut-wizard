import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Icon } from "@/components/ui/Icon";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import type { AllMetrics } from "@/utils/performanceEngine";

interface WeeklyLoadPlanProps {
  metrics: AllMetrics;
}

type Intent = "rest" | "easy" | "steady" | "hard";

type DayCell = {
  iso: string;
  shortName: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  load: number;
  intent: Intent;
  sessions: Array<{ sessionType: string; durationMinutes: number; rpe: number }>;
};

/**
 * Map the ACWR (acute:chronic workload ratio) + recent days' load history to
 * a 7-day suggested intent for each remaining day of the current week. Aims
 * to keep the user's ACWR in the 0.8-1.3 "sweet spot" by end-of-week.
 *
 * Internal math stays accurate; the user-facing copy is plain English and
 * doesn't surface the underlying numbers.
 */
function planRemainingDays(
  loadRatio: number,
  daysRemaining: number,
  forecastStrain: number,
): Intent[] {
  const plan: Intent[] = [];

  if (loadRatio > 1.3) {
    const pool: Intent[] = ["rest", "easy", "easy", "steady", "rest", "easy", "steady"];
    for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
    return plan;
  }
  if (loadRatio < 0.8) {
    const pool: Intent[] = ["steady", "hard", "easy", "steady", "hard", "easy", "steady"];
    for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
    return plan;
  }
  const startsEasy = forecastStrain >= 14;
  const pool: Intent[] = startsEasy
    ? ["easy", "steady", "hard", "easy", "steady", "rest", "hard"]
    : ["steady", "hard", "easy", "steady", "rest", "hard", "easy"];
  for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
  return plan;
}

// Border-only colour treatments — no background fills behind text. Bar fills
// for the day strip still need a solid block of colour, so `bg` is kept for
// the bar rectangles only.
const INTENT_STYLE: Record<Intent, { color: string; bg: string; dot: string; pct: number; label: string }> = {
  rest:   { color: "text-muted-foreground",      bg: "bg-muted/60",                  dot: "bg-muted-foreground/60",      pct: 8,  label: "Rest" },
  easy:   { color: "text-func-recovery-green",   bg: "bg-func-recovery-green/55",    dot: "bg-func-recovery-green",       pct: 35, label: "Easy" },
  steady: { color: "text-func-warning-yellow",   bg: "bg-func-warning-yellow/65",    dot: "bg-func-warning-yellow",       pct: 65, label: "Steady" },
  hard:   { color: "text-func-danger-red",       bg: "bg-func-danger-red/80",        dot: "bg-func-danger-red",           pct: 95, label: "Hard" },
};

function loadIntent(load: number, max: number): Intent {
  if (max === 0) return "rest";
  const pct = (load / max) * 100;
  if (pct < 5) return "rest";
  if (pct < 35) return "easy";
  if (pct < 70) return "steady";
  return "hard";
}

/** Plain-language headline. No jargon, no numbers, no metaphors. */
function headlineFor(ratio: number, daysRemaining: number): string {
  if (ratio > 1.3) {
    return `You've been training hard this week. Keep the next ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} on the lighter side so your body can recover.`;
  }
  if (ratio < 0.8) {
    return `Your training has been a bit light. You can add a couple of harder sessions over the next ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} without overdoing it.`;
  }
  return "Your training load is well balanced. Mix in some steady and harder sessions to keep building.";
}

/** Plain-language status word, replaces the technical A:C number on the card. */
function loadStatus(ratio: number): { label: string; color: string } {
  if (ratio > 1.3) return { label: "Heavy",    color: "text-func-danger-red" };
  if (ratio < 0.8) return { label: "Light",    color: "text-muted-foreground" };
  return { label: "Balanced", color: "text-func-recovery-green" };
}

/** Friendly copy for the cold-start period when ACWR is not yet meaningful. */
function buildingBaselineHeadline(daysLogged: number, required: number): string {
  const remaining = Math.max(0, required - daysLogged);
  if (daysLogged === 0) {
    return `Log a few training sessions and the page will start tracking your weekly load. About ${required} days of training in a month gets you a personalised read.`;
  }
  return `Still learning your normal training pattern. About ${remaining} more training ${remaining === 1 ? "day" : "days"} in the next few weeks and your weekly load will be personalised to you.`;
}

/** "260" → "4h 20m", "45" → "45m", "0" → "0m" */
function formatDuration(min: number): string {
  const total = Math.max(0, Math.round(min));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const WeeklyLoadPlan = memo(function WeeklyLoadPlan({ metrics }: WeeklyLoadPlanProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const thisWeek = metrics.thisWeek;
  const lastWeek = metrics.lastWeek;

  // Compute Monday offset from the engine-provided weekStart/today, so the
  // strip aligns with the same window the engine used to sum sessions.
  const dayOfWeek = useMemo(() => {
    const start = new Date(thisWeek.weekStart + "T00:00:00");
    const today = new Date(thisWeek.today + "T00:00:00");
    const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
    return Math.max(0, Math.min(6, diff));
  }, [thisWeek.weekStart, thisWeek.today]);

  const isoForOffset = (offset: number): string => {
    const d = new Date(thisWeek.weekStart + "T00:00:00");
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const daysRemaining = 6 - dayOfWeek;

  const futureIntents = useMemo(
    () => planRemainingDays(metrics.loadRatio, daysRemaining, metrics.forecast.predictedStrain),
    [metrics.loadRatio, daysRemaining, metrics.forecast.predictedStrain],
  );

  // Build the day cells. Past + today are real; future = suggestion-only.
  // maxLoad is anchored to past+today data only so an empty rest day in the
  // future can't be the implicit ceiling.
  const days = useMemo<DayCell[]>(() => {
    const cells: DayCell[] = [];
    const pastLoads: number[] = [];

    for (let i = 0; i <= dayOfWeek; i++) {
      const iso = isoForOffset(i);
      const sessions = thisWeek.sessionsByDate[iso] ?? [];
      const load = sessions.reduce((acc, s) => acc + s.rpe * s.durationMinutes, 0);
      pastLoads.push(load);
    }
    const max = Math.max(21, ...pastLoads);

    for (let i = 0; i < 7; i++) {
      const iso = isoForOffset(i);
      const isPast = i < dayOfWeek;
      const isToday = i === dayOfWeek;
      const isFuture = i > dayOfWeek;
      const sessions = thisWeek.sessionsByDate[iso] ?? [];

      if (isFuture) {
        const intent = futureIntents[i - dayOfWeek - 1] ?? "easy";
        cells.push({
          iso,
          shortName: SHORT[i],
          isToday: false,
          isPast: false,
          isFuture: true,
          load: 0,
          intent,
          sessions: [],
        });
        continue;
      }

      const load = pastLoads[i] ?? 0;
      cells.push({
        iso,
        shortName: SHORT[i],
        isToday,
        isPast,
        isFuture: false,
        load,
        intent: loadIntent(load, max),
        sessions,
      });
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeek.sessionsByDate, dayOfWeek, futureIntents, thisWeek.weekStart]);

  // Anchor bar heights to past+today data only.
  const maxLoad = useMemo(() => {
    const pastLoads = days.filter((d) => !d.isFuture).map((d) => d.load);
    return Math.max(21, ...pastLoads);
  }, [days]);

  const isReliable = metrics.loadConfidence.isReliable;
  const status = isReliable
    ? loadStatus(metrics.loadRatio)
    : { label: "Building baseline", color: "text-func-warning-yellow" };

  // Hero numbers + delta
  const sessionCount = thisWeek.sessionCount;
  const totalMinutes = thisWeek.totalMinutes;
  const countDelta = sessionCount - lastWeek.sessionCount;

  // Selected-day detail block
  const selected = selectedDay ? days.find((d) => d.iso === selectedDay) ?? null : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card-surface rounded-xs p-4 border border-border"
    >
      {/* ── Header row ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="calendarOutline" size={16} className="text-primary" />
          <h3 className="text-[15px] font-bold truncate">This week</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border border-current/30 ${status.color}`}
          >
            {status.label}
          </span>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="What does this mean?"
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground/70 active:text-foreground transition-colors"
          >
            <Icon name="helpCircleOutline" size={16} />
          </button>
        </div>
      </div>

      {/* ── Hero numbers + delta ─────────────────────────────────────── */}
      <div className="flex items-baseline gap-2 mb-3 text-foreground tabular-nums">
        <span className="text-[22px] font-bold leading-none">
          <AnimatedNumber value={sessionCount} />
        </span>
        <span className="text-[13px] text-foreground/80">
          session{sessionCount === 1 ? "" : "s"}
        </span>
        <span className="text-foreground/30 text-[13px] leading-none">·</span>
        <span className="text-[14px] font-bold leading-none">
          <AnimatedNumber value={totalMinutes} format={(n) => formatDuration(n)} />
        </span>
        {countDelta !== 0 && (
          <>
            <span className="text-foreground/30 text-[13px] leading-none">·</span>
            <span className="text-[11px] text-foreground/60 leading-none">
              {countDelta > 0 ? "▲" : "▼"} {countDelta > 0 ? "+" : ""}
              {countDelta} vs last wk
            </span>
          </>
        )}
      </div>

      {/* ── 7-day strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-1.5 items-end h-[96px]">
        {days.map((d, i) => {
          const style = INTENT_STYLE[d.intent];
          const isEmptyPast = !d.isFuture && d.load === 0;
          const heightPct = d.isFuture
            ? 100
            : isEmptyPast
              ? 0
              : Math.max(8, (d.load / maxLoad) * 100);

          const isSelected = selectedDay === d.iso;

          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => setSelectedDay(isSelected ? null : d.iso)}
              aria-label={`${d.shortName}${d.isToday ? " (today)" : d.isFuture ? " (suggested)" : ""}: ${style.label}`}
              className="flex flex-col items-center justify-end h-full bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
            >
              {/* Today dot marker above the bar */}
              {d.isToday ? (
                <span className="block h-1.5 w-1.5 rounded-full bg-foreground mb-1" />
              ) : (
                <span className="block h-1.5 w-1.5 mb-1" />
              )}

              <div className="flex-1 w-full flex items-end">
                {d.isFuture ? (
                  // Ghost outline — dashed border, no fill.
                  <div
                    className="w-full h-full rounded-md border-2 border-dashed border-border/40 flex items-center justify-center"
                    aria-hidden
                  >
                    <span className="text-border/50 text-[10px] leading-none">·</span>
                  </div>
                ) : isEmptyPast ? (
                  // 4px micro-bar so the cell isn't visually empty.
                  <div className="w-full h-1 rounded-md bg-muted/60" aria-hidden />
                ) : (
                  <motion.div
                    initial={prefersReducedMotion ? false : { height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={
                      prefersReducedMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 320, damping: 26, delay: i * 0.05 }
                    }
                    className={`w-full rounded-md ${style.bg} ${d.isToday ? "ring-2 ring-foreground/70" : ""} ${isSelected ? "ring-2 ring-foreground/40" : ""}`}
                  />
                )}
              </div>

              <span
                className={`text-[10px] mt-1 uppercase tracking-wide ${
                  d.isToday
                    ? "text-foreground font-bold"
                    : d.isFuture
                      ? "text-muted-foreground/40"
                      : "text-muted-foreground/70"
                }`}
              >
                {d.shortName}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Tap-to-reveal session details ────────────────────────────── */}
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            key={selected.iso}
            initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-border/40 text-[12px]">
              {selected.isFuture ? (
                <div className="flex items-center gap-2 text-foreground/85">
                  <span className={`h-2 w-2 rounded-full ${INTENT_STYLE[selected.intent].dot}`} />
                  <span className="font-semibold">{selected.shortName}</span>
                  <span className="text-foreground/50">·</span>
                  <span>Suggested: {INTENT_STYLE[selected.intent].label}</span>
                </div>
              ) : selected.sessions.length === 0 ? (
                <div className="flex items-center gap-2 text-foreground/70">
                  <span className="font-semibold">{selected.shortName}</span>
                  <span className="text-foreground/50">·</span>
                  <span>Rest day</span>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 text-foreground/85 mb-1.5">
                    <span className="font-semibold">{selected.shortName}</span>
                    <span className="text-foreground/50">·</span>
                    <span>
                      {selected.sessions.length} session{selected.sessions.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-foreground/50">·</span>
                    <span>
                      {formatDuration(
                        selected.sessions.reduce((acc, s) => acc + s.durationMinutes, 0),
                      )}
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-foreground/70">
                    {selected.sessions.map((s, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <span className="text-foreground/40">•</span>
                        <span className="text-foreground/85">{s.sessionType}</span>
                        <span className="text-foreground/40">·</span>
                        <span>{formatDuration(s.durationMinutes)}</span>
                        <span className="text-foreground/40">·</span>
                        <span>RPE {s.rpe}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Headline ─────────────────────────────────────────────────── */}
      <p className="text-[12px] text-foreground/85 leading-snug mt-3">
        {isReliable
          ? headlineFor(metrics.loadRatio, daysRemaining)
          : buildingBaselineHeadline(metrics.loadConfidence.trainingDaysIn28d, metrics.loadConfidence.required)}
      </p>

      {/* ── Suggested for the rest of the week (collapsible) ─────────── */}
      {daysRemaining > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setSuggestionsOpen((v) => !v)}
            aria-expanded={suggestionsOpen}
            className="w-full flex items-center justify-between text-[11px] text-foreground/80 active:text-foreground"
          >
            <span className="font-semibold">
              Suggested for the rest of the week
              <span className="text-muted-foreground/70 font-normal">
                {"  ·  "}
                {daysRemaining} day{daysRemaining === 1 ? "" : "s"}
              </span>
            </span>
            <motion.span
              animate={prefersReducedMotion ? undefined : { rotate: suggestionsOpen ? 180 : 0 }}
              transition={{ duration: 0.18 }}
              className="inline-flex"
            >
              <Icon name="chevronDownOutline" size={14} className="text-muted-foreground/70" />
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {suggestionsOpen && (
              <motion.div
                initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <ul className="mt-2 space-y-1">
                  {days
                    .filter((d) => d.isFuture)
                    .map((d) => {
                      const s = INTENT_STYLE[d.intent];
                      return (
                        <li
                          key={d.iso}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/30 text-[12px]"
                        >
                          <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                          <span className="font-semibold text-foreground/85 w-9">{d.shortName}</span>
                          <span className="text-foreground/40">·</span>
                          <span className={s.color}>{s.label}</span>
                        </li>
                      );
                    })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <WeeklyLoadInfoSheet open={infoOpen} onOpenChange={setInfoOpen} />
    </motion.div>
  );
});

function WeeklyLoadInfoSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] max-h-[85vh] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-xl text-center">This week</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5 text-[13px] leading-snug text-foreground/90">
          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              What it shows
            </p>
            <p>
              At the top: how many sessions you've actually done this week, the total
              time, and how that compares to last week. Below that, a Mon→Sun strip.
              Solid bars are real days you've logged; today has a dot above it and
              a ring around its bar. The dashed outlines are days you haven't reached
              yet - they're placeholders, not predictions. Tap any bar to see exactly
              what you did that day.
            </p>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              The four colors
            </p>
            <ul className="space-y-1.5">
              <li><span className="font-semibold text-muted-foreground">Rest</span> means a full day off training.</li>
              <li><span className="font-semibold text-func-recovery-green">Easy</span> is light movement: mobility, technique, slow rounds.</li>
              <li><span className="font-semibold text-func-warning-yellow">Steady</span> is a normal training session at your usual effort.</li>
              <li><span className="font-semibold text-func-danger-red">Hard</span> is a tough session, sparring, conditioning, or strength.</li>
            </ul>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              What "Heavy" / "Light" / "Balanced" means
            </p>
            <ul className="space-y-1.5">
              <li><span className="font-semibold text-func-danger-red">Heavy</span>: you've trained more than usual in the last 7 days compared to your normal. The risk of getting hurt or burnt out goes up if you keep pushing - easier sessions for the rest of the week let you recover.</li>
              <li><span className="font-semibold text-muted-foreground">Light</span>: you've trained less than usual. You can add a few harder sessions without overdoing it.</li>
              <li><span className="font-semibold text-func-recovery-green">Balanced</span>: this week's training matches what your body is used to. Keep doing what you're doing.</li>
            </ul>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              How to use it
            </p>
            <p>
              Tap a bar to see the sessions you logged on that day. Expand
              <span className="font-semibold"> Suggested for the rest of the week </span>
              to see what each remaining day is pointing toward - treat the colours as
              a real cue. The goal is a steady rhythm, not maxing out every day. That's
              how athletes improve without breaking down.
            </p>
          </section>

          <p className="text-[12px] text-muted-foreground text-center leading-snug pt-1">
            Suggestions update every time you log a session.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
