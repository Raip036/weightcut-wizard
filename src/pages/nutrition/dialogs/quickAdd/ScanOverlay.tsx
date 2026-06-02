import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

interface ScanOverlayProps {
  /** Optional photo to render behind the scan effect; if absent, the
   *  overlay paints on a neutral dark background. */
  photoBase64?: string | null;
}

const STEP_COPY = [
  "Analyzing your plate…",
  "Identifying ingredients…",
  "Computing macros…",
] as const;
const STEP_INTERVAL_MS = 1400;

/**
 * Apple-style scan overlay.
 *
 * Layout:
 *   - Photo (or dark backdrop) as the base layer
 *   - Subtle dark vignette so the brackets read
 *   - 4 corner brackets in primary, pulsing opacity
 *   - One horizontal scan line sweeping vertically top → bottom → top
 *   - 3-step text loader rotating beneath the frame
 *
 * Respects `useReducedMotion`: brackets stay static, no scan line, status
 * text shows the first phrase only.
 */
export function ScanOverlay({ photoBase64 }: ScanOverlayProps) {
  const prefersReduced = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (prefersReduced) return;
    const id = setInterval(
      () => setStep((s) => (s + 1) % STEP_COPY.length),
      STEP_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [prefersReduced]);

  return (
    <div className="space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: "4 / 3" }}
      >
        {photoBase64 ? (
          <img
            src={`data:image/jpeg;base64,${photoBase64}`}
            alt="Meal being analyzed"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-background to-primary/[0.03]" />
        )}

        {/* Vignette so the corner brackets and scan line read against busy photos. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/35"
        />

        {/* Corner brackets — pulse 0.6 → 1 → 0.6 every 1.4s (unless reduced). */}
        <CornerBracket position="top-left" reduced={prefersReduced} />
        <CornerBracket position="top-right" reduced={prefersReduced} />
        <CornerBracket position="bottom-left" reduced={prefersReduced} />
        <CornerBracket position="bottom-right" reduced={prefersReduced} />

        {/* Scan line — sweeps top → bottom → top in a 2s loop. */}
        {!prefersReduced && (
          <motion.div
            aria-hidden
            initial={{ top: "0%" }}
            animate={{ top: ["0%", "100%", "0%"] }}
            transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
            className="absolute left-3 right-3 h-[2px] pointer-events-none"
            style={{
              background:
                "linear-gradient(to right, transparent 0%, hsl(var(--primary) / 0.6) 50%, transparent 100%)",
              boxShadow:
                "0 0 12px hsl(var(--primary) / 0.6), 0 0 6px hsl(var(--primary) / 0.5)",
            }}
          />
        )}
      </div>

      {/* Status text — rotates through 3 phrases (or stays on the first
          phrase under reduced motion). */}
      <p
        className="text-center text-[13px] font-medium text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {STEP_COPY[step]}
      </p>
    </div>
  );
}

type CornerPos = "top-left" | "top-right" | "bottom-left" | "bottom-right";

function CornerBracket({ position, reduced }: { position: CornerPos; reduced: boolean | null }) {
  const base = "absolute w-7 h-7 border-primary";
  const pos: Record<CornerPos, string> = {
    "top-left": "top-3 left-3 border-t-[3px] border-l-[3px] rounded-tl-lg",
    "top-right": "top-3 right-3 border-t-[3px] border-r-[3px] rounded-tr-lg",
    "bottom-left": "bottom-3 left-3 border-b-[3px] border-l-[3px] rounded-bl-lg",
    "bottom-right": "bottom-3 right-3 border-b-[3px] border-r-[3px] rounded-br-lg",
  };
  if (reduced) {
    return <div aria-hidden className={`${base} ${pos[position]}`} />;
  }
  return (
    <motion.div
      aria-hidden
      className={`${base} ${pos[position]}`}
      animate={{ opacity: [0.6, 1, 0.6] }}
      transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
    />
  );
}
