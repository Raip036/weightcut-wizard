// WP-T13: WeightLossBreakdownChart
// Educational breakdown of where the cut weight actually goes
// (glycogen / water / gut content / sauna+sweat / fat). Pure
// presentational: takes a totalKg and a list of segments, draws a
// stacked horizontal-bar list. Visible to free + Pro alike.
//
// Bars are sized by `kg / maxKg` (the largest segment, NOT the total).
// This means a set of segments summing to more than `totalKg` still
// renders sensibly: the largest one fills the row and the others
// scale proportionally beside it. We chose max-normalisation over
// total-normalisation so that the visual conveys *relative magnitude
// between segments* rather than fraction-of-whole; the total is
// already shown numerically in the sub-header.
import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

export type WeightLossBreakdownSegmentTone =
  | "primary"
  | "blue"
  | "amber"
  | "green"
  | "muted";

export interface WeightLossBreakdownSegment {
  label: "Glycogen" | "Water load" | "Gut content" | "Sauna / sweat" | "Fat";
  kg: number;
  tone: WeightLossBreakdownSegmentTone;
}

export interface WeightLossBreakdownChartProps {
  totalKg: number;
  /** Expected ~4 segments. Segments with kg <= 0 are skipped. */
  segments: WeightLossBreakdownSegment[];
  className?: string;
}

// Tailwind background class per tone. Kept as a static map so the JIT
// compiler picks each class up (it won't see runtime-built strings).
const TONE_BAR_BG: Record<WeightLossBreakdownSegmentTone, string> = {
  primary: "bg-primary/70",
  blue: "bg-blue-300/70",
  amber: "bg-func-warning-yellow/70",
  green: "bg-func-recovery-green/70",
  muted: "bg-muted-foreground/40",
};

// Stagger is capped at 5 rows so a long segment list doesn't produce
// a perceptibly slow cascade.
const MAX_STAGGER_INDEX = 4;
const STAGGER_STEP_MS = 80;
const BAR_ANIM_MS = 700;

export function WeightLossBreakdownChart({
  totalKg,
  segments,
  className = "",
}: WeightLossBreakdownChartProps) {
  const prefersReduced = useReducedMotion();
  const headerId = useId();

  // Drop zero/negative segments; they shouldn't render a row.
  const visibleSegments = segments.filter((s) => s.kg > 0);

  // Max-normalise so segments that sum > totalKg still scale sensibly
  // (see comment at top of file).
  const maxKg = visibleSegments.reduce((m, s) => (s.kg > m ? s.kg : m), 0);

  // Re-key the motion divs by the current segments fingerprint so the
  // width animation re-runs whenever segments change (e.g. user toggles
  // cut approach). Without this, motion would see the same component
  // identity and skip the transition.
  const segmentsKey = visibleSegments
    .map((s) => `${s.label}:${s.kg.toFixed(2)}:${s.tone}`)
    .join("|");

  const isEmpty = totalKg === 0 || visibleSegments.length === 0;

  return (
    <section
      role="img"
      aria-label="Weight loss breakdown chart"
      aria-describedby={headerId}
      className={`card-surface rounded-2xl border border-border/50 p-4 ${className}`}
    >
      <div className="flex flex-col gap-0.5">
        <p
          id={headerId}
          className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold"
        >
          Expected loss breakdown
        </p>
        <p className="text-[13px] text-foreground tabular-nums">
          Total to cut: {totalKg.toFixed(1)} kg
        </p>
      </div>

      {isEmpty ? (
        <p className="mt-4 text-[12px] text-muted-foreground">No cut planned</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {visibleSegments.map((seg, i) => {
            const pct = maxKg > 0 ? (seg.kg / maxKg) * 100 : 0;
            const delayMs = Math.min(i, MAX_STAGGER_INDEX) * STAGGER_STEP_MS;
            return (
              <li
                key={`${seg.label}-${i}`}
                aria-label={`${seg.label}: ${seg.kg.toFixed(1)} kilograms`}
                className="grid grid-cols-[1fr_110px_52px] items-center gap-3"
              >
                {/* Bar track */}
                <div className="relative h-2 rounded-full bg-muted/20 overflow-hidden">
                  <motion.div
                    key={`${segmentsKey}-${i}`}
                    aria-hidden
                    className={`h-full rounded-full ${TONE_BAR_BG[seg.tone]}`}
                    initial={prefersReduced ? { width: `${pct}%` } : { width: "0%" }}
                    animate={{ width: `${pct}%` }}
                    transition={
                      prefersReduced
                        ? { duration: 0 }
                        : {
                            duration: BAR_ANIM_MS / 1000,
                            delay: delayMs / 1000,
                            ease: [0.215, 0.61, 0.355, 1], // ease-out-cubic
                          }
                    }
                  />
                </div>
                <span className="text-[12px] text-muted-foreground truncate">
                  {seg.label}
                </span>
                <span className="text-[12px] text-foreground tabular-nums text-right">
                  {seg.kg.toFixed(1)} kg
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
