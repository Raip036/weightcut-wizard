// DriverRow — a single collapsible row for one of the 4 readiness drivers
// (Sleep, How you feel, Soreness, Training load). Whoop-style "instrument"
// row: data-forward, divided, with an inline horizontal score meter.
//
// Collapsed: driver icon · full label (never truncates) · tone one-liner ·
//            inline score meter · score number + delta pill · chevron
// Expanded:  big /100 score · 7d sparkline · 1-sentence "why this is X"
//
// Null score (e.g. wellness before today's check-in): NEUTRAL state — a muted
// "—", no red, no delta arrow, an inline "Tap to check in" affordance, and an
// empty/muted meter. Never a red 0.

import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";
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
  /** 0-100 driver score, or `null` when there's no data yet (neutral state). */
  score: number | null;
  /** Last 7d daily values for the sparkline. */
  sparkline7d: number[];
  /** Optional ionicon name for the leading instrument chip. */
  icon?: IonIconName;
  /** One-sentence "why this is X" detail string, shown when expanded. */
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
}

// ── Null-safe color helpers ─────────────────────────────────────────────
// Reused/extended from the original thresholds; `null` always returns a
// muted neutral tone — never red.
function sparklineColorForScore(score: number | null): string {
  if (score == null) return "text-muted-foreground/40";
  if (score >= 80) return "text-func-recovery-green";
  if (score >= 55) return "text-emerald-400";
  if (score >= 35) return "text-func-warning-yellow";
  return "text-func-danger-red";
}

function scoreColorForScore(score: number | null): string {
  if (score == null) return "text-muted-foreground/50";
  if (score >= 80) return "text-func-recovery-green";
  if (score >= 55) return "text-foreground";
  if (score >= 35) return "text-func-warning-yellow";
  return "text-func-danger-red";
}

function DeltaPill({ delta }: { delta: number }) {
  // > 2 → up green · < -2 → down red · otherwise muted "flat". Slot is always
  // occupied to keep row heights consistent across drivers.
  if (delta > 2) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-func-recovery-green"
        aria-label={`Up ${delta.toFixed(0)} vs 7d average`}
      >
        <Icon name="trendingUpOutline" size={11} />
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
        <Icon name="trendingDownOutline" size={11} />
        {Math.abs(delta).toFixed(0)}
      </span>
    );
  }
  return (
    <span
      className="text-[11px] font-semibold text-muted-foreground/50"
      aria-label="No change vs 7d average"
    >
      flat
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

// Inline horizontal score meter, in the score's color. Renders empty/muted
// when score is null.
function ScoreMeter({
  score,
  label,
  animate,
}: {
  score: number | null;
  label: string;
  animate: boolean;
}) {
  const pct = score == null ? 0 : Math.max(4, Math.min(100, score));
  return (
    <div
      className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score ?? undefined}
      aria-label={
        score == null ? `${label} not checked in yet` : `${label} score ${Math.round(score)} of 100`
      }
    >
      {score != null && (
        <motion.div
          className={`h-full rounded-full bg-current ${sparklineColorForScore(score)}`}
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}
    </div>
  );
}

export function DriverRow({
  label,
  weight,
  oneLiner,
  delta,
  score,
  sparkline7d,
  icon,
  detail,
  expanded,
  onToggle,
}: DriverRowProps) {
  const prefersReduced = useReducedMotion();
  const isNull = score == null;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left active:bg-muted/10 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {icon ? (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04]">
              <Icon name={icon} size={15} className="text-muted-foreground/80" />
            </span>
          ) : (
            <WeightDots weight={weight} />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {/* Label never truncates — only the tone one-liner may ellipsize. */}
              <span className="text-[13px] font-semibold text-foreground whitespace-nowrap shrink-0">
                {label}
              </span>
              <span className="min-w-0 truncate text-[12px] text-muted-foreground/70">
                {oneLiner}
              </span>
            </div>
            <div className="mt-1.5">
              <ScoreMeter score={score} label={label} animate={!prefersReduced} />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            {isNull ? (
              <span
                className="text-[18px] font-bold leading-none text-muted-foreground/50"
                aria-label={`${label} not checked in yet`}
              >
                —
              </span>
            ) : (
              <span
                className={`text-[18px] font-bold tabular-nums leading-none ${scoreColorForScore(score)}`}
                aria-label={`${label} score ${Math.round(score)} of 100`}
              >
                {Math.round(score)}
              </span>
            )}
            {isNull ? (
              <span className="text-[10px] font-semibold text-primary">Tap to check in</span>
            ) : (
              <DeltaPill delta={delta} />
            )}
          </div>

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
                {isNull ? (
                  <span
                    className="text-[28px] leading-none font-bold text-muted-foreground/50"
                    aria-label={`${label} not checked in yet`}
                  >
                    —
                  </span>
                ) : (
                  <span
                    className={`text-[28px] leading-none font-bold tabular-nums ${scoreColorForScore(score)}`}
                    aria-label={`${label} score ${Math.round(score)} of 100`}
                  >
                    {Math.round(score)}
                  </span>
                )}
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
