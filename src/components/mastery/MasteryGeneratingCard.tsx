// MasteryGeneratingCard: inline (NOT full-screen) compact "Aurora Wizard"
// loader card shown while drills or sparring are being generated. Reuses the
// app's reference loading aesthetic (see ProtocolGeneratingOverlay): a soft
// radial blue wash, a small haloed bobbing 3D wizard, an indeterminate shimmer
// bar and a rotating status line. Reduced-motion freezes motion but keeps the
// card legible. Self-contained, index-based motion only (no Math.random).
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import wizard from "@/assets/wizard_3D.png";

export interface MasteryGeneratingCardProps {
  kind: "drills" | "sparring";
  /** Optional discipline CSS custom-property token; defaults to blue primary. */
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

export function MasteryGeneratingCard({
  kind,
  accentToken,
  className,
}: MasteryGeneratingCardProps): JSX.Element {
  const prefersReduced = useReducedMotion();

  const tint = accentToken
    ? (a: number) => `hsl(var(${accentToken}) / ${a})`
    : (a: number) => `hsl(var(--primary) / ${a})`;

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

  // Deterministic drifting motes (index-based so no Math.random in render).
  const motes = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        id: i,
        x: ((i * 41) % 120) - 60,
        delay: (i % 4) * 0.6,
        dur: 5 + (i % 3),
        size: 3 + (i % 3) * 2,
      })),
    [],
  );

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280 }}
      className={cn(
        "relative w-full overflow-hidden card-surface rounded-2xl border border-primary/20 px-4 py-5 flex flex-col items-center",
        className,
      )}
      aria-live="polite"
      aria-busy="true"
      aria-label={EYEBROW[kind]}
    >
      {/* Soft radial blue wash rising from the base. */}
      {!prefersReduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(120% 80% at 50% 100%, ${tint(0.22)}, transparent 70%)`,
          }}
          animate={{ opacity: [0.5, 0.9, 0.5], scale: [1, 1.05, 1] }}
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
              background: tint(0.7),
              filter: "blur(0.5px)",
              boxShadow: `0 0 6px ${tint(0.9)}`,
            }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -120, opacity: [0, 1, 0] }}
            transition={{
              duration: m.dur,
              repeat: Infinity,
              ease: "easeOut",
              delay: m.delay,
            }}
          />
        ))}

      {/* Haloed, bobbing wizard (~64px). */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{ height: 80 }}
      >
        {!prefersReduced && (
          <motion.div
            aria-hidden
            className="absolute"
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${tint(0.45)} 0%, ${tint(0.12)} 40%, transparent 70%)`,
              filter: "blur(6px)",
            }}
            animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          style={{
            width: 64,
            height: 64,
            objectFit: "contain",
            position: "relative",
            zIndex: 2,
            filter: `drop-shadow(0 0 12px ${tint(0.45)})`,
          }}
          animate={prefersReduced ? { y: 0 } : { y: [0, -6, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Eyebrow label. */}
      <p
        className="relative z-10 mt-2 text-[10px] uppercase tracking-[0.22em] font-bold"
        style={{ color: tint(1) }}
      >
        {EYEBROW[kind]}
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

      {/* Indeterminate shimmer bar — a seamless, constant-speed sweep. The old
          single band used `easeInOut` over x:-100%→200%, so it slowed to a near
          stop at both off-screen extremes and read as "stuck halfway". This is a
          double-band gradient twice the track width, translated by exactly one
          band period (-50%) on a LINEAR loop: a bright band is always crossing
          the track, with no easing dwell and no seam, so it animates the whole
          time the card is up. */}
      <div
        className="relative z-10 mt-3 h-1 w-36 rounded-full overflow-hidden"
        style={{ background: tint(0.12) }}
      >
        {!prefersReduced && (
          <motion.div
            className="absolute inset-y-0 left-0 h-full"
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
