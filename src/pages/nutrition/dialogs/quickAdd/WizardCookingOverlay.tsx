import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import wizardImg from "@/assets/thoughtful_wizard.png";
import { isNativePlatform } from "@/hooks/useIsNative";

interface WizardCookingOverlayProps {
  /** User's typed meal description, shown below the rings for context. */
  description: string;
  /** Optional cancel handler — renders a small "Cancel" affordance below. */
  onCancel?: () => void;
}

const CAPTIONS = [
  "Reading your meal…",
  "Resolving ingredients…",
  "Assembling macros…",
  "Almost ready…",
] as const;
const CAPTION_INTERVAL_MS = 1600;

/** Live "calculating" kcal ticker config. */
const KCAL_TICK_MS = 130;
const INITIAL_KCAL = 188;

/**
 * Three concentric macro rings, mirroring the dashboard's Protein / Carbs / Fat
 * rings. Outer → inner so the colour order matches the cards above the sheet.
 * Each ring sits in its own `<motion.g>` that rotates at its own speed/direction
 * while its arc breathes (pathLength fill → drain), so the stack reads as the
 * meal's data being drafted live rather than a generic spinner.
 */
const RINGS: Array<{
  color: string;
  radius: number;
  rotateDur: number;
  dir: 1 | -1;
  pulseDur: number;
  pulseDelay: number;
}> = [
  { color: "#2A5BDD", radius: 66, rotateDur: 7.0, dir: 1, pulseDur: 2.0, pulseDelay: 0 }, // protein-blue
  { color: "#F08439", radius: 52, rotateDur: 5.6, dir: -1, pulseDur: 2.2, pulseDelay: 0.12 }, // carbs-orange
  { color: "#7B31EA", radius: 38, rotateDur: 4.4, dir: 1, pulseDur: 2.4, pulseDelay: 0.24 }, // fats-purple
];

const SVG_SIZE = 150;
const CENTER = SVG_SIZE / 2;
const STROKE_W = 7;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * "Macro Assembly" loading overlay for the text-only "Add a meal" path.
 *
 * Layout (top → bottom):
 *   - Wizard mascot (3D render) with a slow breathing tilt + a conic god-ray
 *     sheen rotating behind it (masked to a thin band).
 *   - Tri-ring stack (protein-blue / carbs-orange / fats-purple) that draws +
 *     rotates, with a kcal figure ticking in the centre and a diagonal gloss
 *     sweep crossing the stack on a loop.
 *   - Caption rotator (cross-fade between 4 strings).
 *   - User's description, italicized + 2-line clamp.
 *   - Optional ghost Cancel button.
 *
 * Respects `useReducedMotion`: rings hold a static partial fill, the kcal figure
 * holds one value, rotation / gloss / god-ray are dropped, and caption
 * transitions become instant fades.
 */
export function WizardCookingOverlay({ description, onCancel }: WizardCookingOverlayProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  const [captionIdx, setCaptionIdx] = useState(0);
  const kcalSpanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const id = setInterval(
      () => setCaptionIdx((s) => (s + 1) % CAPTIONS.length),
      CAPTION_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  // Slot-machine "calculating" kcal ticker — a gentle random walk so it never
  // settles, reinforcing that the AI is still crunching numbers. Writes the
  // number directly to the span via a ref instead of React state: at ~7.7Hz a
  // setState would reconcile the entire tri-ring SVG (3 rotators + 3 pathLength
  // pulses + glow) every tick, stacking render churn on top of the motion loops
  // — brutal on iOS. textContent writes skip React entirely.
  useEffect(() => {
    if (prefersReduced) return;
    let current = INITIAL_KCAL;
    const id = setInterval(() => {
      current = clamp(current + Math.round((Math.random() - 0.42) * 70), 20, 980);
      if (kcalSpanRef.current) kcalSpanRef.current.textContent = String(current);
    }, KCAL_TICK_MS);
    return () => clearInterval(id);
  }, [prefersReduced]);

  const fadeDuration = prefersReduced ? 0 : 0.35;

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6 px-4">
      {/* Wizard mascot — breathing tilt over a slow conic god-ray sheen. */}
      <div className="relative">
        {!prefersReduced && (
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, hsl(217 91% 64% / 0.22) 12deg, transparent 30deg, transparent 168deg, hsl(217 91% 64% / 0.22) 180deg, transparent 198deg, transparent 360deg)",
              maskImage: "radial-gradient(circle, transparent 38%, black 58%, transparent 78%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 38%, black 58%, transparent 78%)",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 14, ease: "linear", repeat: Infinity }}
          />
        )}
        <motion.img
          src={wizardImg}
          alt="Wizard reading your meal"
          className="relative w-[96px] h-[96px] object-contain select-none pointer-events-none"
          draggable={false}
          animate={prefersReduced ? undefined : { rotate: [-2.5, 2.5, -2.5], y: [0, -2, 0] }}
          transition={
            prefersReduced
              ? undefined
              : { duration: 3, ease: "easeInOut", repeat: Infinity }
          }
          style={{ transformOrigin: "50% 85%" }}
        />
      </div>

      {/* Tri-ring stack with the live kcal figure at the centre. */}
      <div className="relative" style={{ width: SVG_SIZE, height: SVG_SIZE }}>
        {/* Soft core glow behind the number. */}
        <motion.div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, hsl(217 91% 60% / 0.30) 0%, hsl(var(--primary) / 0.14) 45%, transparent 72%)",
          }}
          animate={prefersReduced ? { opacity: 0.5 } : { opacity: [0.4, 0.8, 0.4], scale: [0.94, 1.06, 0.94] }}
          transition={prefersReduced ? { duration: 0 } : { duration: 2.4, ease: "easeInOut", repeat: Infinity }}
        />

        <svg
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="absolute inset-0 h-full w-full"
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden
        >
          {RINGS.map((ring) => (
            <g key={ring.color}>
              {/* Faint track. */}
              <circle
                cx={CENTER}
                cy={CENTER}
                r={ring.radius}
                fill="none"
                stroke={ring.color}
                strokeWidth={STROKE_W}
                opacity={0.14}
              />
              {/* Rotating, breathing arc. */}
              <motion.g
                style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
                animate={prefersReduced ? undefined : { rotate: ring.dir * 360 }}
                transition={
                  prefersReduced
                    ? undefined
                    : { duration: ring.rotateDur, ease: "linear", repeat: Infinity }
                }
              >
                <motion.circle
                  cx={CENTER}
                  cy={CENTER}
                  r={ring.radius}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={STROKE_W}
                  strokeLinecap="round"
                  initial={false}
                  animate={prefersReduced ? { pathLength: 0.55 } : { pathLength: [0.12, 0.9, 0.12] }}
                  transition={
                    prefersReduced
                      ? { duration: 0 }
                      : {
                          duration: ring.pulseDur,
                          ease: "easeInOut",
                          repeat: Infinity,
                          delay: ring.pulseDelay,
                        }
                  }
                  // drop-shadow re-rasterizes the arc each frame as it rotates +
                  // pulses; 3 of them on iOS is wasteful. Web keeps the glow.
                  style={isNativePlatform ? undefined : { filter: `drop-shadow(0 0 4px ${ring.color}88)` }}
                />
              </motion.g>
            </g>
          ))}
        </svg>

        {/* Diagonal gloss sweep across the whole stack. */}
        {!prefersReduced && (
          <div className="absolute inset-0 overflow-hidden rounded-full" aria-hidden>
            <motion.div
              className="absolute top-0 -left-1/3 h-full w-1/3 bg-gradient-to-r from-transparent via-white/12 to-transparent"
              style={{ transform: "skewX(-18deg)" }}
              initial={{ x: "-60%" }}
              animate={{ x: "360%" }}
              transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.9 }}
            />
          </div>
        )}

        {/* Live kcal figure. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            ref={kcalSpanRef}
            className="display-number text-[28px] font-bold leading-none text-foreground tabular-nums"
          >
            {prefersReduced ? 412 : INITIAL_KCAL}
          </span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            kcal
          </span>
        </div>
      </div>

      {/* Caption rotator. */}
      <div className="h-5 flex items-center justify-center" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={captionIdx}
            className="text-[14px] font-medium text-foreground text-center"
            initial={{ opacity: 0, y: prefersReduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: prefersReduced ? 0 : -4 }}
            transition={{ duration: fadeDuration, ease: "easeOut" }}
          >
            {CAPTIONS[captionIdx]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* User's typed description, quoted + truncated. */}
      {description.trim().length > 0 && (
        <p className="text-[12px] italic text-muted-foreground text-center max-w-[260px] line-clamp-2">
          “{description}”
        </p>
      )}

      {/* Optional cancel affordance. */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
