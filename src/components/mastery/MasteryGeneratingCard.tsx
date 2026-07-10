// MasteryGeneratingCard: inline (NOT full-screen) slim "status row" loader shown
// while drills or sparring are being generated. One 56px line: a small haloed
// wizard sigil, an eyebrow, a rotating status line, and an indeterminate shimmer
// riding the bottom edge. Blue primary throughout, matching the app's aurora
// convention. Reduced motion freezes motion but keeps the row legible.
// Self-contained, index-based motion only (no Math.random).
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import wizard from "@/assets/wizard_3D.png";

export interface MasteryGeneratingCardProps {
  kind: "drills" | "sparring";
  /**
   * Retained for callers that pass a discipline token. The row deliberately
   * renders in the blue primary (see the aurora convention), so this is unused.
   */
  accentToken?: string;
  className?: string;
}

const STATUS_INTERVAL_MS = 2200;

const STATUS_LINES: Record<MasteryGeneratingCardProps["kind"], readonly string[]> = {
  drills: [
    "Reading your session notes",
    "Spotting what to fix",
    "Building your drills",
  ],
  sparring: [
    "Your drills are graduating",
    "Building live sparring",
    "Setting your targets",
  ],
};

const EYEBROW: Record<MasteryGeneratingCardProps["kind"], string> = {
  drills: "Generating drills",
  sparring: "Generating sparring",
};

const tint = (a: number) => `hsl(var(--primary) / ${a})`;

const WIZARD_PX = 26;

export function MasteryGeneratingCard({
  kind,
  accentToken,
  className,
}: MasteryGeneratingCardProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  void accentToken;

  const steps = STATUS_LINES[kind];

  // Rotating status line on a fixed cadence (no real progress signal).
  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStatusIdx((i) => (i + 1) % steps.length),
      STATUS_INTERVAL_MS,
    );
    return () => clearInterval(t);
  }, [steps]);

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280 }}
      className={cn(
        "relative w-full overflow-hidden rounded-[14px] border px-3 py-2.5",
        className,
      )}
      style={{ borderColor: tint(0.25), background: tint(0.07) }}
      aria-live="polite"
      aria-busy="true"
      aria-label={EYEBROW[kind]}
    >
      <div className="flex items-center gap-3">
        {/* Haloed, bobbing wizard sigil. */}
        <div
          className="relative flex flex-shrink-0 items-center justify-center"
          style={{ width: WIZARD_PX, height: WIZARD_PX }}
        >
          {!prefersReduced && (
            <motion.div
              aria-hidden
              className="absolute rounded-full"
              style={{
                width: WIZARD_PX * 1.5,
                height: WIZARD_PX * 1.5,
                background: `radial-gradient(circle, ${tint(0.4)} 0%, ${tint(0.1)} 45%, transparent 70%)`,
              }}
              animate={{ opacity: [0.45, 0.8, 0.45], scale: [0.95, 1.06, 0.95] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <motion.img
            src={wizard}
            alt=""
            draggable={false}
            className="relative"
            style={{ width: WIZARD_PX, height: WIZARD_PX, objectFit: "contain" }}
            animate={prefersReduced ? { y: 0 } : { y: [0, -3, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: tint(1) }}
          >
            {EYEBROW[kind]}
          </p>

          {/* Rotating status line. */}
          <div className="mt-0.5 h-[16px] overflow-hidden">
            <motion.p
              key={statusIdx}
              initial={prefersReduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="truncate text-[12px] text-muted-foreground"
            >
              {steps[statusIdx]}
            </motion.p>
          </div>
        </div>
      </div>

      {/* Indeterminate shimmer on the bottom edge — a seamless, constant-speed
          sweep. A double-band gradient twice the track width, translated by
          exactly one band period (-50%) on a LINEAR loop: a bright band is
          always crossing, with no easing dwell and no seam. */}
      <div
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ height: 1.5, background: tint(0.1) }}
        aria-hidden
      >
        {!prefersReduced && (
          <motion.div
            className="absolute inset-y-0 left-0"
            style={{
              width: "200%",
              background: `linear-gradient(90deg, transparent, ${tint(1)}, transparent, ${tint(1)}, transparent)`,
            }}
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>
    </motion.section>
  );
}
