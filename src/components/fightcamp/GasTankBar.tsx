import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";

// ── Public types ──────────────────────────────────────────────────────────
export type GasTankTone = "green" | "amber" | "red";

export interface GasTankBarProps {
  /** 0..1 — clamped defensively inside the component. */
  fillPct: number;
  tone: GasTankTone;
  /** Short brutal one-liner shown beneath the bar (12px muted). */
  oneLiner: string;
  /** Optional class for the outer wrapper. */
  className?: string;
}

/**
 * Derive a GasTank tone from a 0-100 readiness score.
 *  - 70..100 → green
 *  - 40..69  → amber
 *  - 0..39   → red
 */
export function toneFromReadiness(readiness: number): GasTankTone {
  if (readiness >= 70) return "green";
  if (readiness >= 40) return "amber";
  return "red";
}

// ── Tone → CSS colour var ─────────────────────────────────────────────────
// Maps each tone to its func-* design token (referenced via the CSS var so
// lit segments + the percentage + icon all share one colour). The unlit
// segment colour is a low-opacity white so the track reads in dark mode.
const TONE_VAR: Record<GasTankTone, string> = {
  green: "rgb(var(--func-recovery-green))",
  amber: "rgb(var(--func-warning-yellow))",
  red: "rgb(var(--func-danger-red))",
};

const SEGMENTS = 24;

/**
 * Segmented "fuel tank" bar (Whoop-instrument design). A row of lit/unlit
 * pills fills to fillPct, with a tone-coloured header (battery icon + label +
 * percentage). Only opacity/scaleY animate on the segments — cheap, composited,
 * and honours reduced-motion. The one-liner stays beneath, unchanged.
 */
export function GasTankBar({ fillPct, tone, oneLiner, className }: GasTankBarProps) {
  const prefersReduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, fillPct));
  const pct100 = Math.round(clamped * 100);
  const lit = Math.round(clamped * SEGMENTS);
  const color = TONE_VAR[tone];

  return (
    <div className={className}>
      <div className="card-surface rounded-2xl px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex" style={{ color }}>
              <Icon name="batteryChargingOutline" size={15} />
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
              Fuel tank
            </span>
          </div>
          <span
            className="font-display font-bold tabular-nums text-[13px]"
            style={{ color }}
          >
            {pct100}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct100}
          className="flex h-3.5 items-center gap-[3px]"
        >
          {Array.from({ length: SEGMENTS }).map((_, i) => (
            <motion.span
              key={i}
              aria-hidden
              className="h-full flex-1 rounded-full"
              style={{ background: i < lit ? color : "rgba(255,255,255,0.06)" }}
              initial={prefersReduced ? false : { opacity: 0, scaleY: 0.4 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ delay: 0.4 + i * 0.014, duration: 0.25 }}
            />
          ))}
        </div>

        <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">{oneLiner}</p>
      </div>
    </div>
  );
}
