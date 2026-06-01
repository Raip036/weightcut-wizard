// DriverRow — a single collapsible row for one of the 4 readiness drivers
// (Sleep, How you feel, Soreness, Training load). Visually denser than
// ExpandableMetricCard — designed to live inside a divided stack.
//
// Collapsed: weight dots · label · tone-band one-liner · delta arrow
// Expanded:  raw 0-100 score · 7d sparkline · 1-sentence "why this is X"

import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { MiniSparkline } from "./_MiniSparkline";

export interface DriverRowProps {
  /** Driver label, e.g. "Sleep" / "How you feel" / "Soreness" / "Training load". */
  label: string;
  /** Dots count (relative contribution to today's readiness). 3 = top, 1 = minor. */
  weight: 1 | 2 | 3;
  /** Pre-formatted tone-band copy, e.g. "Slept like a champ". */
  oneLiner: string;
  /** Numeric delta vs 7d avg (positive = up). 0 renders as muted dash. */
  delta: number;
  /** 0-100 driver score (shown large in expanded view). */
  score: number;
  /** Last 7d daily values for the sparkline. */
  sparkline7d: number[];
  /** One-sentence "why this is X" detail string, shown when expanded. */
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
}

function DeltaArrow({ delta }: { delta: number }) {
  // > 2 → up green · < -2 → down red · otherwise muted dash. Slot is always
  // occupied to keep row heights consistent across drivers.
  if (delta > 2) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-func-recovery-green"
        aria-label={`Up ${delta.toFixed(0)} vs 7d average`}
      >
        <span aria-hidden>▲</span>
        {Math.abs(delta).toFixed(0)}
      </span>
    );
  }
  if (delta < -2) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-func-danger-red"
        aria-label={`Down ${Math.abs(delta).toFixed(0)} vs 7d average`}
      >
        <span aria-hidden>▼</span>
        {Math.abs(delta).toFixed(0)}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center text-[11px] font-semibold text-muted-foreground/50"
      aria-label="No change vs 7d average"
    >
      –
    </span>
  );
}

function WeightDots({ weight }: { weight: 1 | 2 | 3 }) {
  // Render 3 small dots, fill `weight` of them with foreground, rest muted.
  return (
    <span
      className="inline-flex items-center gap-[2px] shrink-0"
      title="Relative contribution to today's readiness."
      aria-label={`Contribution weight ${weight} of 3`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`block h-[5px] w-[5px] rounded-full ${
            i < weight ? "bg-foreground" : "bg-muted-foreground/30"
          }`}
        />
      ))}
    </span>
  );
}

function sparklineColorForScore(score: number): string {
  if (score >= 80) return "text-func-recovery-green";
  if (score >= 55) return "text-emerald-400";
  if (score >= 35) return "text-func-warning-yellow";
  return "text-func-danger-red";
}

function scoreColorForScore(score: number): string {
  if (score >= 80) return "text-func-recovery-green";
  if (score >= 55) return "text-foreground";
  if (score >= 35) return "text-func-warning-yellow";
  return "text-func-danger-red";
}

export function DriverRow({
  label,
  weight,
  oneLiner,
  delta,
  score,
  sparkline7d,
  detail,
  expanded,
  onToggle,
}: DriverRowProps) {
  const prefersReduced = useReducedMotion();

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left active:bg-muted/10 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <WeightDots weight={weight} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-foreground truncate">{label}</span>
              <span className="text-[12px] text-muted-foreground truncate">{oneLiner}</span>
            </div>
          </div>
          <DeltaArrow delta={delta} />
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 text-muted-foreground/70"
          >
            <Icon name="chevronDownOutline" size={14} />
          </motion.div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="content"
            initial={prefersReduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.25 }, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-border/30">
              <div className="flex items-center gap-3 pt-2">
                <span
                  className={`text-[28px] leading-none font-bold tabular-nums ${scoreColorForScore(score)}`}
                >
                  {Math.round(score)}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
                  / 100
                </span>
                <div className="flex-1" />
                <MiniSparkline
                  values={sparkline7d}
                  color={sparklineColorForScore(score)}
                  className="shrink-0"
                />
              </div>
              {detail && (
                <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{detail}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
