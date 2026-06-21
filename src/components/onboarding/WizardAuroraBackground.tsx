/**
 * WizardAuroraBackground - the premium "animated wizard blue glow" ambient
 * backdrop extracted from ProUpsellScreen. Drop it inside any `relative`
 * container as a `pointer-events-none absolute inset-0` layer.
 *
 * Perf rationale (iOS Capacitor - every frame counts):
 * - ONLY `transform` (scale/translate) + `opacity` are animated, so the
 *   compositor handles them on the GPU with no layout/paint per frame.
 * - Mote positions live in a module-level const (MOTES), never Math.random in
 *   render - stable across re-renders, no reflow churn, no hydration drift.
 * - `willChange` is set on animating layers so the browser promotes them to
 *   their own layer up front instead of mid-animation.
 * - All loops are gated behind useReducedMotion(): when reduced, we render a
 *   single static low-opacity gradient and bail - no motes, no rAF loops.
 */
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Fixed mote field - stable positions so React never re-lays-out them.
// left: horizontal start, size: px diameter, dur: rise seconds, delay: stagger.
const MOTES = [
  { left: "8%", size: 3, dur: 13, delay: 0 },
  { left: "18%", size: 2, dur: 16, delay: 2.4 },
  { left: "27%", size: 4, dur: 11, delay: 5.1 },
  { left: "38%", size: 2, dur: 15, delay: 1.2 },
  { left: "47%", size: 3, dur: 12, delay: 6.3 },
  { left: "56%", size: 2, dur: 17, delay: 3.7 },
  { left: "64%", size: 4, dur: 10, delay: 0.8 },
  { left: "73%", size: 3, dur: 14, delay: 4.5 },
  { left: "82%", size: 2, dur: 16, delay: 2.0 },
  { left: "91%", size: 3, dur: 12, delay: 5.8 },
  { left: "13%", size: 2, dur: 18, delay: 7.2 },
  { left: "69%", size: 3, dur: 13, delay: 8.0 },
] as const;

export interface WizardAuroraBackgroundProps {
  className?: string;
  /** "full" (default) or "subtle" - subtle thins motes to ~5 and dims it. */
  intensity?: "subtle" | "full";
  /** Render the rising motes (default true). */
  motes?: boolean;
  /** Render a centered pulsing radial glow blob, e.g. behind a hero (default false). */
  radialGlow?: boolean;
}

export function WizardAuroraBackground({
  className,
  intensity = "full",
  motes = true,
  radialGlow = false,
}: WizardAuroraBackgroundProps) {
  const prefersReduced = useReducedMotion();
  const isSubtle = intensity === "subtle";

  // ~40% dimmer in subtle mode (multiply applied to the aurora/mote opacity).
  const dim = isSubtle ? 0.6 : 1;
  const moteList = isSubtle ? MOTES.slice(0, 5) : MOTES;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {/* Aurora wash - slow "breathing" scale. transform-only = GPU cheap. */}
      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
          opacity: dim,
          willChange: prefersReduced ? undefined : "transform",
        }}
        animate={prefersReduced ? undefined : { scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? undefined
            : { duration: 8, ease: "easeInOut", repeat: Infinity }
        }
      />

      {/* Centered pulsing radial glow - opacity + scale only. */}
      {radialGlow && (
        <motion.div
          className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(var(--primary) / 0.14) 42%, transparent 70%)",
            opacity: prefersReduced ? 0.6 * dim : undefined,
            willChange: prefersReduced ? undefined : "transform, opacity",
          }}
          animate={
            prefersReduced
              ? undefined
              : { opacity: [0.4 * dim, 0.72 * dim, 0.4 * dim], scale: [0.95, 1.06, 0.95] }
          }
          transition={
            prefersReduced
              ? undefined
              : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
          }
        />
      )}

      {/* Drifting motes - translate + opacity only. Skipped when reduced. */}
      {motes && !prefersReduced && (
        <div className="absolute inset-0">
          {moteList.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                opacity: 0,
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
                willChange: "transform, opacity",
              }}
              animate={{ opacity: [0, 0.7 * dim, 0], y: [-12, -900] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default WizardAuroraBackground;
