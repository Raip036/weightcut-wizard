// ProtocolSummaryCard
// At-a-glance summary card for the Weight Protocol screen. Pairs a
// circular cut-depth ring (SVG stroke progress, --primary accent) with a
// headline ("{category} cut"), a subline (kg-to-lose · days-to-weigh-in),
// a small descending taper sparkline, and a green "ON TRACK" pill showing
// the current → target weight.
//
// Pure presentational: no Convex, no data fetching. All numbers are
// supplied by the caller.
//
// Visual conventions mirror the rest of the protocol surface
// (ProtocolHeader / OrsRecipeCard / TodaysActionHero):
//   - card-surface rounded-2xl border border-border/50 p-5
//   - 10px uppercase tracker for the section label
//   - tabular-nums on every numeric value
//   - accent = the CSS --primary token (text-primary / currentColor),
//     never a hardcoded hex
//   - mount: fade + slide-up (16px, 320ms spring), guarded by
//     useReducedMotion
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface ProtocolSummaryCardProps {
  /** Cut depth as a percentage of bodyweight, e.g. 10.3. Drives the ring. */
  cutDepthPct: number;
  /** Total kg to lose, e.g. 8.0. */
  cutDepthKg: number;
  /** Whole days remaining until weigh-in, e.g. 5. */
  daysToWeighIn: number;
  /** Latest logged weight in kg, e.g. 69.9. */
  currentWeightKg: number;
  /** Weigh-in target in kg, e.g. 70.0. */
  targetWeightKg: number;
  /** Tier label rendered as the headline "{categoryLabel} cut", e.g. "Moderate". */
  categoryLabel: string;
  /** Raw taper values; normalised internally to draw descending bars. */
  sparkline: number[];
  className?: string;
}

// SVG ring geometry. A 56px viewBox with a generous stroke reads well at
// the ~64px rendered size used across the protocol cards.
const RING_SIZE = 56;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Clamp a percentage into [0, 100] so a stray value can never overdraw the
// dash offset or invert the ring.
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

// Countdown copy ("today" / "1 day" / "N days"), kept compact so the
// subline never wraps on a 320px viewport.
function countdownLabel(days: number): string {
  if (days <= 0) return "weigh-in today";
  if (days === 1) return "1 day to weigh-in";
  return `${days} days to weigh-in`;
}

export function ProtocolSummaryCard({
  cutDepthPct,
  cutDepthKg,
  daysToWeighIn,
  currentWeightKg,
  targetWeightKg,
  categoryLabel,
  sparkline,
  className = "",
}: ProtocolSummaryCardProps) {
  const prefersReduced = useReducedMotion();

  const safePct = clampPct(cutDepthPct);
  // Dash offset draws the filled arc clockwise from 12 o'clock (the -90deg
  // rotation on the progress circle handles the start position).
  const dashOffset = RING_CIRCUMFERENCE * (1 - safePct / 100);

  // Normalise sparkline against its own max so the tallest bar is full
  // height regardless of the source unit (kg, % loss, etc.). A non-positive
  // max collapses every bar to a minimum sliver so the row still renders.
  const sparkMax = sparkline.reduce((m, v) => Math.max(m, v), 0);
  const sparkHeights = sparkline.map((v) =>
    sparkMax > 0 ? Math.max(8, Math.round((v / sparkMax) * 100)) : 8,
  );

  return (
    <motion.section
      role="region"
      aria-label={`${categoryLabel} cut summary`}
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={cn(
        "card-surface rounded-2xl border border-border/50 p-5",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {/* Cut-depth ring: SVG stroke progress, --primary accent */}
        <div
          className="relative shrink-0 text-primary"
          style={{ width: RING_SIZE, height: RING_SIZE }}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
            aria-hidden
          >
            {/* Track */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE}
              className="text-border/60"
            />
            {/* Progress */}
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums text-foreground"
            aria-label={`${safePct.toFixed(1)} percent cut depth`}
          >
            {safePct.toFixed(1)}%
          </span>
        </div>

        {/* Headline + subline + sparkline */}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-foreground leading-tight">
            {categoryLabel} cut
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {cutDepthKg.toFixed(1)} kg to lose
            <span aria-hidden className="opacity-60"> · </span>
            {countdownLabel(daysToWeighIn)}
          </p>

          {sparkHeights.length > 0 && (
            <div
              className="mt-2 flex h-5 items-end gap-1"
              aria-hidden
            >
              {sparkHeights.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-[2px] bg-primary/70"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* On-track pill: green-toned current to target weight */}
      <div className="mt-3">
        <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-emerald-400 tabular-nums">
          On track
          <span aria-hidden className="px-1 opacity-60">·</span>
          {currentWeightKg.toFixed(1)} → {targetWeightKg.toFixed(1)} kg
        </span>
      </div>
    </motion.section>
  );
}
