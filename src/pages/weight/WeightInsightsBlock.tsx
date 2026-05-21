import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Minus, Sparkles } from "lucide-react";
import type { WeightLog } from "@/pages/weight/types";

interface Props {
  weightLogs: WeightLog[];
  currentWeight: number;
  targetWeight: number;
  targetDate: string;
  /** True for fight-camp cutters or non-fighters whose goal is below current weight. */
  isCutting: boolean;
}

// Least-squares linear regression slope over the supplied logs, using
// real elapsed-days on the x-axis so irregular logging intervals
// don't distort the projection.
function leastSquaresSlopeKgPerDay(logs: WeightLog[]): number | null {
  if (logs.length < 2) return null;
  const t0 = new Date(logs[0].date).getTime();
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of logs) {
    const x = (new Date(l.date).getTime() - t0) / 86_400_000;
    const y = typeof l.weight_kg === "number" ? l.weight_kg : parseFloat(l.weight_kg as unknown as string);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  const n = xs.length;
  if (n < 2) return null;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function toKg(v: WeightLog["weight_kg"]): number {
  return typeof v === "number" ? v : parseFloat(v as unknown as string);
}

export function WeightInsightsBlock({
  weightLogs,
  currentWeight,
  targetWeight,
  targetDate,
  isCutting,
}: Props) {
  const reduced = useReducedMotion();

  const { sevenAvg, weekDelta, projectedKg, deltaVsTarget, daysToTarget, slopeKgPerWeek } = useMemo(() => {
    const recent = weightLogs.slice(-7).map((l) => toKg(l.weight_kg)).filter(Number.isFinite);
    const prior = weightLogs.slice(-14, -7).map((l) => toKg(l.weight_kg)).filter(Number.isFinite);
    const sevenAvg = recent.length >= 3 ? mean(recent) : null;
    const weekDelta = sevenAvg !== null && prior.length >= 3 ? sevenAvg - mean(prior) : null;

    // Use a wider window (last 14 logs) so short-term noise — water
    // retention, post-workout dehydration, a single bad day — doesn't
    // dominate the slope. Then require the window to span at least 5
    // calendar days so we're not extrapolating from a noisy 48-hour
    // blip into a future month.
    const window = weightLogs.slice(-14);
    const firstDate = window.length ? new Date(window[0].date).getTime() : null;
    const lastDate = window.length ? new Date(window[window.length - 1].date).getTime() : null;
    const windowDays = firstDate !== null && lastDate !== null ? (lastDate - firstDate) / 86_400_000 : 0;

    const rawSlope = leastSquaresSlopeKgPerDay(window);
    // Physiological clamp on weekly weight change.
    //   loss : sustained athlete losses cap around ~1.0 kg/week
    //          (more than that is usually water, not real weight)
    //   gain : ~0.3 kg/week is the realistic ceiling for someone
    //          who isn't actively bulking
    // Anything outside this range is almost certainly a measurement
    // artefact (different scale, time-of-day shift, hydration spike)
    // not a real trajectory worth extrapolating over weeks.
    const MIN_SLOPE_PER_DAY = -1.0 / 7;
    const MAX_SLOPE_PER_DAY = 0.3 / 7;
    const slope =
      rawSlope === null || windowDays < 5
        ? null
        : Math.max(MIN_SLOPE_PER_DAY, Math.min(MAX_SLOPE_PER_DAY, rawSlope));

    const target = targetDate ? new Date(targetDate) : null;
    const days = target ? Math.ceil((target.getTime() - Date.now()) / 86_400_000) : null;

    const projected = slope !== null && days !== null && days > 0 ? currentWeight + slope * days : null;
    const delta = projected !== null && Number.isFinite(targetWeight) ? projected - targetWeight : null;

    return {
      sevenAvg,
      weekDelta,
      projectedKg: projected,
      deltaVsTarget: delta,
      daysToTarget: days,
      slopeKgPerWeek: slope !== null ? slope * 7 : null,
    };
  }, [weightLogs, currentWeight, targetWeight, targetDate]);

  // Tint logic for the 7-day delta line. For cutters, losing = green,
  // flat = amber, gaining = red. For weight-gain goals, invert.
  const deltaTint = (() => {
    if (weekDelta === null) return "muted";
    const losing = weekDelta < -0.1;
    const flat = Math.abs(weekDelta) <= 0.1;
    if (isCutting) return losing ? "emerald" : flat ? "amber" : "rose";
    return weekDelta > 0.1 ? "emerald" : flat ? "amber" : "rose";
  })();

  // Status for the projection card.
  const projectionStatus = (() => {
    if (deltaVsTarget === null) return "muted";
    if (isCutting) {
      if (deltaVsTarget <= 0) return "emerald";
      if (deltaVsTarget <= 0.5) return "amber";
      return "rose";
    }
    if (deltaVsTarget >= 0) return "emerald";
    if (deltaVsTarget >= -0.5) return "amber";
    return "rose";
  })();

  const tintClass: Record<string, { text: string; bg: string; ring: string; from: string; to: string }> = {
    emerald: {
      text: "text-func-recovery-green",
      bg: "bg-func-recovery-green/15",
      ring: "ring-func-recovery-green/30",
      from: "from-func-recovery-green/15",
      to: "to-func-recovery-green/[0.02]",
    },
    amber: {
      text: "text-func-warning-yellow",
      bg: "bg-func-warning-yellow/15",
      ring: "ring-func-warning-yellow/30",
      from: "from-func-warning-yellow/15",
      to: "to-func-warning-yellow/[0.02]",
    },
    rose: {
      text: "text-func-danger-red",
      bg: "bg-func-danger-red/15",
      ring: "ring-func-danger-red/30",
      from: "from-func-danger-red/15",
      to: "to-func-danger-red/[0.02]",
    },
    muted: {
      text: "text-muted-foreground",
      bg: "bg-muted/30",
      ring: "ring-border/30",
      from: "from-white/[0.04]",
      to: "to-white/[0.01]",
    },
  };

  const showProjection =
    projectedKg !== null && deltaVsTarget !== null && daysToTarget !== null && daysToTarget > 0 && weightLogs.length >= 4;

  if (sevenAvg === null && !showProjection) return null;

  return (
    <div className="space-y-3">
      {/* ── 7-day rolling average banner ─────────────────────────── */}
      {sevenAvg !== null && (
        <motion.div
          initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className={`rounded-xs border border-border/50 bg-gradient-to-br ${tintClass[deltaTint].from} ${tintClass[deltaTint].to} backdrop-blur-xl p-5`}
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-bold">
            7-day average
          </p>
          <p className="text-[40px] font-black tabular-nums tracking-tight leading-none text-foreground mt-1">
            {sevenAvg.toFixed(1)}
            <span className="text-[16px] text-muted-foreground font-semibold ml-1">kg</span>
          </p>
          {weekDelta !== null ? (
            <div className={`mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold ${tintClass[deltaTint].text}`}>
              {weekDelta < -0.1 ? (
                <ArrowDown className="h-3.5 w-3.5" />
              ) : weekDelta > 0.1 ? (
                <ArrowUp className="h-3.5 w-3.5" />
              ) : (
                <Minus className="h-3.5 w-3.5" />
              )}
              <span className="tabular-nums">
                {Math.abs(weekDelta).toFixed(1)} kg this week
              </span>
              <span className="text-muted-foreground/60 font-medium">vs prior 7 days</span>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground/70 mt-2">
              Log another week to see your trend.
            </p>
          )}
        </motion.div>
      )}

      {/* ── Predictive trend card ────────────────────────────────── */}
      {showProjection && (
        <motion.div
          initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
          className="rounded-xs border border-border/50 bg-card/40 backdrop-blur-xl p-5"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary/80" strokeWidth={2.4} />
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-bold">
                Projection
              </p>
            </div>
            <span className={`h-2 w-2 rounded-full ${tintClass[projectionStatus].bg.replace("/15", "")} ring-2 ${tintClass[projectionStatus].ring}`} aria-hidden />
          </div>
          <p className="text-[15px] leading-snug text-foreground/90">
            At this pace you'll weigh{" "}
            <span className="font-bold tabular-nums text-foreground">{projectedKg!.toFixed(1)} kg</span>{" "}
            on <span className="font-semibold text-foreground">{format(new Date(targetDate), "MMM d")}</span>.
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-full ${tintClass[projectionStatus].bg} ${tintClass[projectionStatus].text}`}
            >
              {projectionStatus === "emerald" ? "On track" : projectionStatus === "amber" ? "Close" : "Off pace"}
              <span className="tabular-nums font-semibold">
                {deltaVsTarget! > 0 ? "+" : ""}
                {deltaVsTarget!.toFixed(1)} kg
              </span>
            </span>
            {slopeKgPerWeek !== null && (
              <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                {slopeKgPerWeek > 0 ? "+" : ""}
                {slopeKgPerWeek.toFixed(2)} kg/week
              </span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
