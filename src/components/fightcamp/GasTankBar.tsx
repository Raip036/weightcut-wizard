import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

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

// ── Tone → tailwind class map ─────────────────────────────────────────────
const TONE_CLASSES: Record<
  GasTankTone,
  { fill: string; stroke: string; dot: string }
> = {
  green: {
    fill: "bg-func-recovery-green/70",
    stroke: "stroke-func-recovery-green/60",
    dot: "fill-func-recovery-green",
  },
  amber: {
    fill: "bg-func-warning-yellow/70",
    stroke: "stroke-func-warning-yellow/60",
    dot: "fill-func-warning-yellow",
  },
  red: {
    fill: "bg-func-danger-red/70",
    stroke: "stroke-func-danger-red/60",
    dot: "fill-func-danger-red",
  },
};

// 8 eyelets — 4 per side, symmetric across the bar's vertical centerline.
// Coordinates are in % of the SVG viewBox (100 x 16).
const EYELET_POSITIONS: Array<{ cx: number; cy: number }> = [
  // top row (y = 4)
  { cx: 8, cy: 4 },
  { cx: 33, cy: 4 },
  { cx: 67, cy: 4 },
  { cx: 92, cy: 4 },
  // bottom row (y = 12)
  { cx: 8, cy: 12 },
  { cx: 33, cy: 12 },
  { cx: 67, cy: 12 },
  { cx: 92, cy: 12 },
];

export function GasTankBar({
  fillPct,
  tone,
  oneLiner,
  className,
}: GasTankBarProps) {
  const prefersReduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, fillPct));
  const pct100 = Math.round(clamped * 100);
  const tones = TONE_CLASSES[tone];

  // Tremor effect on low fuel: 4-frame micro-rotation every 6s.
  const tremorEnabled = clamped < 0.25 && !prefersReduced;
  const [tremorTick, setTremorTick] = useState(0);
  useEffect(() => {
    if (!tremorEnabled) return;
    const id = window.setInterval(() => {
      setTremorTick((n) => n + 1);
    }, 6000);
    return () => window.clearInterval(id);
  }, [tremorEnabled]);

  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct100}
        className="relative h-4 w-full overflow-hidden rounded-2xl border border-border/50 bg-muted/30"
      >
        {/* Inner gradient fill — animates width from 0 to clamped on mount. */}
        <motion.div
          initial={prefersReduced ? false : { width: 0 }}
          animate={{ width: `${clamped * 100}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute inset-y-0 left-0 ${tones.fill}`}
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0) 60%)",
          }}
        />

        {/* Lace overlay — stitched border outline + 8 eyelets. */}
        <svg
          aria-hidden
          viewBox="0 0 100 16"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {/* Subtle stitched border traced inside the rounded rect. */}
          <rect
            x="0.6"
            y="0.6"
            width="98.8"
            height="14.8"
            rx="6"
            ry="6"
            fill="none"
            strokeWidth="0.4"
            strokeDasharray="1.2 1"
            className={tones.stroke}
            vectorEffect="non-scaling-stroke"
          />
          {/* 8 lace eyelets — animated tremor on low fuel. */}
          {EYELET_POSITIONS.map((p, i) => (
            <motion.circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r="0.9"
              className={tones.dot}
              animate={
                tremorEnabled
                  ? { rotate: [0, 1, -1, 0] }
                  : { rotate: 0 }
              }
              transition={{
                duration: 0.6,
                ease: "easeInOut",
                // re-runs each tremorTick because key changes the animate target.
              }}
              style={{ originX: `${p.cx}%`, originY: `${p.cy}%` }}
              // tremorTick forces re-render so animate keyframes restart.
              data-tick={tremorTick}
            />
          ))}
        </svg>
      </div>

      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        {oneLiner}
      </p>
    </div>
  );
}
