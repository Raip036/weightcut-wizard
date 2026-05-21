import { memo, useMemo, useState } from "react";
import { Calendar, HelpCircle } from "lucide-react";
import { motion } from "motion/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AllMetrics } from "@/utils/performanceEngine";

interface WeeklyLoadPlanProps {
  metrics: AllMetrics;
}

type DayPlan = {
  shortName: string;
  isToday: boolean;
  isPast: boolean;
  load: number;          // 0..maxLoad (actual for past, suggested for future)
  intent: "rest" | "easy" | "steady" | "hard";
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
): Array<DayPlan["intent"]> {
  const plan: Array<DayPlan["intent"]> = [];

  if (loadRatio > 1.3) {
    const pool: Array<DayPlan["intent"]> = ["rest", "easy", "easy", "steady", "rest", "easy", "steady"];
    for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
    return plan;
  }
  if (loadRatio < 0.8) {
    const pool: Array<DayPlan["intent"]> = ["steady", "hard", "easy", "steady", "hard", "easy", "steady"];
    for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
    return plan;
  }
  const startsEasy = forecastStrain >= 14;
  const pool: Array<DayPlan["intent"]> = startsEasy
    ? ["easy", "steady", "hard", "easy", "steady", "rest", "hard"]
    : ["steady", "hard", "easy", "steady", "rest", "hard", "easy"];
  for (let i = 0; i < daysRemaining; i++) plan.push(pool[i % pool.length]);
  return plan;
}

const INTENT_STYLE: Record<DayPlan["intent"], { color: string; bg: string; pct: number; label: string }> = {
  rest:   { color: "text-blue-300",    bg: "bg-blue-500/30",    pct: 8,  label: "Rest" },
  easy:   { color: "text-func-recovery-green", bg: "bg-func-recovery-green/40", pct: 35, label: "Easy" },
  steady: { color: "text-func-warning-yellow",   bg: "bg-func-warning-yellow/55",   pct: 65, label: "Steady" },
  hard:   { color: "text-func-danger-red",     bg: "bg-func-danger-red/75",     pct: 95, label: "Hard" },
};

function loadIntent(load: number, max: number): DayPlan["intent"] {
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
  if (ratio > 1.3) return { label: "Heavy week",    color: "text-func-danger-red" };
  if (ratio < 0.8) return { label: "Light week",    color: "text-blue-300" };
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

export const WeeklyLoadPlan = memo(function WeeklyLoadPlan({ metrics }: WeeklyLoadPlanProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  const today = new Date();
  const dayOfWeek = (today.getDay() + 6) % 7; // 0..6, where 0 = Monday

  // Build a date-keyed map of historical strain so each calendar day pulls
  // the load that ACTUALLY occurred on that ISO date — previously we sliced
  // the last 7 entries and rendered them positionally, which misattributed
  // load to wrong weekdays whenever the user skipped a day.
  const strainByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of metrics.strainHistory) {
      map.set(entry.date, entry.strain);
    }
    return map;
  }, [metrics.strainHistory]);

  // Compute Monday-of-this-week as the anchor for the 7-day strip.
  const mondayOfWeek = useMemo(() => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOfWeek);
    return d;
  }, [today, dayOfWeek]);

  const isoForOffset = (offset: number): string => {
    const d = new Date(mondayOfWeek);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // maxLoad spans both this week's actual loads AND any recent history so
  // the bars stay on a stable scale even on light days.
  const maxLoad = useMemo(() => {
    const candidates: number[] = [21];
    for (const entry of metrics.strainHistory) candidates.push(entry.strain);
    candidates.push(metrics.strain);
    return Math.max(...candidates);
  }, [metrics.strainHistory, metrics.strain]);

  const daysRemaining = 6 - dayOfWeek;
  const futureIntents = useMemo(
    () => planRemainingDays(metrics.loadRatio, daysRemaining, metrics.forecast.predictedStrain),
    [metrics.loadRatio, daysRemaining, metrics.forecast.predictedStrain],
  );

  const days: DayPlan[] = [];
  const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Past days: Mon..(today-1). Look up real load by ISO date; default to 0
  // for any day where no training was logged.
  for (let i = 0; i < dayOfWeek; i++) {
    const iso = isoForOffset(i);
    const load = strainByDate.get(iso) ?? 0;
    days.push({
      shortName: SHORT[i],
      isToday: false,
      isPast: true,
      load,
      intent: loadIntent(load, maxLoad),
    });
  }

  // Today: prefer the live `metrics.strain` (which reflects in-progress
  // sessions today) over whatever made it into strainHistory.
  const todayIso = isoForOffset(dayOfWeek);
  const todayLoad = metrics.strain || strainByDate.get(todayIso) || 0;
  days.push({
    shortName: SHORT[dayOfWeek],
    isToday: true,
    isPast: false,
    load: todayLoad,
    intent: loadIntent(todayLoad, maxLoad),
  });

  // Future days: suggested intent only — no real data yet.
  for (let i = 0; i < daysRemaining; i++) {
    const intent = futureIntents[i] ?? "easy";
    const pct = INTENT_STYLE[intent].pct;
    days.push({
      shortName: SHORT[dayOfWeek + 1 + i],
      isToday: false,
      isPast: false,
      load: (pct / 100) * maxLoad,
      intent,
    });
  }

  const isReliable = metrics.loadConfidence.isReliable;
  const status = isReliable
    ? loadStatus(metrics.loadRatio)
    : { label: "Building baseline", color: "text-func-warning-yellow" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card-surface rounded-xs p-4 border border-border"
    >
      {/* Title row — plain-English status word, info button, no jargon. */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-[15px] font-bold truncate">This week's training load</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold ${status.color}`}>{status.label}</span>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="What does this mean?"
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground/70 active:text-foreground active:bg-muted/40 transition-colors"
          >
            <HelpCircle className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* 7-day strip */}
      <div className="grid grid-cols-7 gap-1.5 items-end h-[88px]">
        {days.map((d, i) => {
          const style = INTENT_STYLE[d.intent];
          const heightPct = Math.max(4, (d.load / maxLoad) * 100);
          return (
            <div key={i} className="flex flex-col items-center justify-end h-full">
              <div className="flex-1 w-full flex items-end">
                <div
                  className={`w-full rounded-md ${style.bg} ${d.isToday ? "ring-2 ring-foreground/70" : ""} ${d.isPast ? "opacity-55" : ""}`}
                  style={{ height: `${heightPct}%` }}
                  aria-label={`${d.shortName}: ${style.label}`}
                />
              </div>
              <span className={`text-[9px] mt-1 uppercase tracking-wide ${d.isToday ? "text-foreground font-bold" : "text-muted-foreground/70"}`}>
                {d.shortName}
              </span>
            </div>
          );
        })}
      </div>

      {/* Headline — falls back to a "still learning" message when there's
          not enough chronic data for the ratio to be meaningful. */}
      <p className="text-[12px] text-foreground/85 leading-snug mt-3">
        {isReliable
          ? headlineFor(metrics.loadRatio, daysRemaining)
          : buildingBaselineHeadline(metrics.loadConfidence.trainingDaysIn28d, metrics.loadConfidence.required)}
      </p>

      {/* Legend — moved to its own row so it can't collide with anything else.
          Wraps gracefully on narrow widths. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500/60" />Rest</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-func-recovery-green/60" />Easy</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-func-warning-yellow/60" />Steady</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-func-danger-red/70" />Hard</span>
        <span className="inline-flex items-center gap-1 ml-auto">
          <span className="h-2 w-2 rounded-sm ring-2 ring-foreground/70" />
          Today
        </span>
      </div>

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
          <SheetTitle className="text-xl text-center">This week's training load</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5 text-[13px] leading-snug text-foreground/90">
          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              What it shows
            </p>
            <p>
              Each bar is one day of the week. The taller the bar, the harder the training
              was (or is suggested to be) that day. Days that have already passed are dimmed.
              Today is the bar with a ring around it. The remaining days are suggestions for
              how to round out your week.
            </p>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              The four colors
            </p>
            <ul className="space-y-1.5">
              <li><span className="font-semibold text-blue-300">Rest</span> means a full day off training.</li>
              <li><span className="font-semibold text-func-recovery-green">Easy</span> is light movement: mobility, technique, slow rounds.</li>
              <li><span className="font-semibold text-func-warning-yellow">Steady</span> is a normal training session at your usual effort.</li>
              <li><span className="font-semibold text-func-danger-red">Hard</span> is a tough session, sparring, conditioning, or strength.</li>
            </ul>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              What "Heavy" or "Light" week means
            </p>
            <ul className="space-y-1.5">
              <li><span className="font-semibold text-func-danger-red">Heavy week</span>: you've trained more than usual in the last 7 days compared to your normal. The risk of getting hurt or burnt out goes up if you keep pushing. The plan suggests easier sessions to let you recover.</li>
              <li><span className="font-semibold text-blue-300">Light week</span>: you've trained less than usual. You can add a few harder sessions without overdoing it.</li>
              <li><span className="font-semibold text-func-recovery-green">Balanced</span>: this week's training matches what your body is used to. Keep doing what you're doing.</li>
            </ul>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-1.5">
              How to use it
            </p>
            <p>
              Glance at it before deciding your next session. If the next day's bar is suggesting
              <span className="font-semibold"> Easy</span>, take it as a real cue — don't go all-out.
              If it's suggesting <span className="font-semibold">Hard</span>, your body has room
              for it. The goal is a steady rhythm, not maxing out every day. That's how athletes
              improve without breaking down.
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
