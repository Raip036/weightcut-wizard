// ProtocolGeneratingOverlay — "Aurora Wizard"
//
// Premium, blue + wizard-themed loading state shown on the Weight Protocol page
// during the 5-15s generation window. The 3D wizard floats inside a breathing
// blue halo over a rising aurora, with drifting blue motes, a rotating status
// line and an indeterminate shimmer bar. Replaces the older 2D pose-cycling
// overlay. Reduced-motion collapses to a calm static state.
//
// This is the app's reference "premium loading" pattern — see the memory note
// reference_aurora_wizard_loader for reuse across other features.
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import wizard from "@/assets/wizard_3D.png";

export interface ProtocolGeneratingOverlayProps {
  /** Accepted for call-site compatibility; the overlay is always blue-themed. */
  tone?: "green" | "amber" | "red" | "primary";
  className?: string;
  /** Uppercase headline shown below the wizard. Defaults to "Conjuring your protocol". */
  label?: string;
  /** Rotating status lines. Defaults to the weight-protocol steps. */
  steps?: ReadonlyArray<string>;
  /** Small footnote at the bottom. Defaults to "This usually takes 5-15 seconds." */
  footnote?: string;
}

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

const DEFAULT_STEPS: ReadonlyArray<string> = [
  "Reading your body and training load",
  "Computing the weight-loss math",
  "Drafting your day-by-day taper",
  "Tuning your rehydration timeline",
];
const STATUS_INTERVAL_MS = 2600;

export function ProtocolGeneratingOverlay({
  className = "",
  label = "Conjuring your protocol",
  steps = DEFAULT_STEPS,
  footnote = "This usually takes 5-15 seconds.",
}: ProtocolGeneratingOverlayProps) {
  const prefersReduced = useReducedMotion();

  // Rotating status line — advances on a fixed cadence (no real progress signal).
  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % steps.length), STATUS_INTERVAL_MS);
    return () => clearInterval(t);
  }, [steps]);

  // Deterministic drifting motes (index-based so no Math.random in render).
  const motes = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        id: i,
        x: ((i * 47) % 160) - 80,
        delay: (i % 5) * 0.6,
        dur: 6 + (i % 4),
        size: 4 + (i % 3) * 2,
      })),
    [],
  );

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280 }}
      className={cn(
        "relative overflow-hidden card-surface rounded-2xl border border-primary/20 px-6 py-9 flex flex-col items-center",
        className,
      )}
      aria-live="polite"
      aria-busy="true"
      aria-label="Generating your weight protocol"
    >
      {/* Aurora wash rising from the base. */}
      {!prefersReduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(120% 70% at 50% 100%, ${hsl(0.28)}, transparent 70%)` }}
          animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Rising blue motes. */}
      {!prefersReduced &&
        motes.map((m) => (
          <motion.span
            key={m.id}
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: `calc(50% + ${m.x}px)`,
              bottom: 0,
              width: m.size,
              height: m.size,
              background: hsl(0.7),
              filter: "blur(0.5px)",
              boxShadow: `0 0 8px ${hsl(0.9)}`,
            }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -240, opacity: [0, 1, 0] }}
            transition={{ duration: m.dur, repeat: Infinity, ease: "easeOut", delay: m.delay }}
          />
        ))}

      {/* Haloed, bobbing wizard. */}
      <div className="relative z-10 flex items-center justify-center" style={{ height: 132 }}>
        {!prefersReduced && (
          <motion.div
            aria-hidden
            className="absolute"
            style={{
              width: 150,
              height: 150,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.15)} 40%, transparent 70%)`,
              filter: "blur(8px)",
            }}
            animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          style={{
            width: 104,
            height: 104,
            objectFit: "contain",
            position: "relative",
            zIndex: 2,
            filter: `drop-shadow(0 0 18px ${hsl(0.45)})`,
          }}
          animate={prefersReduced ? { y: 0 } : { y: [0, -8, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <p className="relative z-10 mt-3 text-[10px] uppercase tracking-[0.22em] font-bold" style={{ color: hsl() }}>
        {label}
      </p>

      {/* Rotating status line. */}
      <div className="relative z-10 mt-1 h-5 overflow-hidden text-center">
        <motion.p
          key={statusIdx}
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-[13px] text-muted-foreground"
        >
          {steps[statusIdx]}
        </motion.p>
      </div>

      {/* Indeterminate shimmer bar. */}
      <div className="relative z-10 mt-4 h-1 w-40 rounded-full overflow-hidden" style={{ background: hsl(0.12) }}>
        {!prefersReduced && (
          <motion.div
            className="h-full w-1/2 rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${hsl(1)}, transparent)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <p className="relative z-10 mt-5 text-[11px] text-muted-foreground/60">
        {footnote}
      </p>
    </motion.section>
  );
}
