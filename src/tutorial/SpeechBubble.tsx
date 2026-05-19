import { useEffect } from "react";
import { motion, useAnimation, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { TypewriterText } from "./TypewriterText";
import { endsAtSentence } from "./typewriter";
import type { VoicePace } from "./types";

interface SpeechBubbleProps {
  headline: string;
  body: string;
  revealKey: string;
  pace?: VoicePace;
  forceComplete: boolean;
  onTypingComplete: () => void;
  /**
   * Optional dismiss handler. When provided, a small X button is rendered
   * in the top-right corner of the bubble so the user can hide the speech
   * if it overlaps an input or CTA on the page underneath. Tap is stopped
   * from bubbling to a parent button wrapper so the bubble's own tap
   * (skip-typewriter / next-step) isn't triggered at the same time.
   */
  onClose?: () => void;
  /**
   * Tail side. Determines which corner the tail points from.
   *   - "bottom-left"  (default): tail at bottom-left → mascot below-and-right
   *   - "bottom-right":            tail at bottom-right → mascot below-and-left
   *   - "left":                    tail on left side → mascot to the left
   * Matches the tutorial's bottom-left convention by default.
   */
  tailSide?: "bottom-left" | "bottom-right" | "left";
}

const bubbleSpring = { type: "spring" as const, stiffness: 520, damping: 28, mass: 0.8 };
const tailSpring = { type: "spring" as const, stiffness: 700, damping: 18, delay: 0.06 };

export function SpeechBubble({
  headline,
  body,
  revealKey,
  pace,
  forceComplete,
  onTypingComplete,
  onClose,
  tailSide = "bottom-left",
}: SpeechBubbleProps) {
  const prefersReduced = useReducedMotion();
  const pulseControls = useAnimation();

  useEffect(() => {
    pulseControls.set({ scale: 1 });
  }, [revealKey, pulseControls]);

  // Tail geometry. Origin point doubles as the transform-origin of the
  // bubble's scale-in animation so the bubble "grows out of" the mascot.
  const tail = (() => {
    switch (tailSide) {
      case "bottom-right":
        return {
          className: "-bottom-3 right-6",
          path: "M0 0 L20 0 L12 14 Z",
          transformOrigin: "10px 0px",
          bubbleOrigin: "90% 100%",
        };
      case "left":
        return {
          className: "left-[-12px] top-6",
          path: "M14 0 L14 20 L0 8 Z",
          transformOrigin: "14px 8px",
          bubbleOrigin: "0% 30%",
        };
      case "bottom-left":
      default:
        return {
          className: "-bottom-3 left-6",
          path: "M0 0 L20 0 L8 14 Z",
          transformOrigin: "10px 0px",
          bubbleOrigin: "10% 100%",
        };
    }
  })();

  return (
    <motion.div
      key={revealKey}
      // Width: a proper speech-bubble shape — wider than tall.
      // `min-w-[240px]` stops short single-sentence headlines from
      // rendering as a thin column when the bubble is constrained by a
      // narrow parent wrapper (which was the source of the "long skinny"
      // look). `max-w-[min(86vw,360px)]` keeps it readable on phones
      // without spanning the whole screen.
      className="relative w-fit max-w-[min(86vw,360px)] rounded-[22px] px-5 py-4 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
      style={{
        background: "rgba(28, 28, 30, 0.72)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.08)",
        transformOrigin: tail.bubbleOrigin,
        willChange: "transform, opacity",
      }}
      initial={prefersReduced ? { opacity: 0 } : { scale: 0.6, opacity: 0, y: 8, rotate: -2 }}
      animate={
        prefersReduced
          ? { opacity: 1 }
          : { scale: 1, opacity: 1, y: 0, rotate: 0 }
      }
      exit={prefersReduced ? { opacity: 0 } : { scale: 0.6, opacity: 0, y: 8 }}
      transition={prefersReduced ? { duration: 0.12 } : bubbleSpring}
    >
      {onClose ? (
        <button
          type="button"
          onClick={(e) => {
            // Stop the click from reaching a parent <button> wrapper that
            // also handles tap-to-skip-typing on the bubble itself.
            e.stopPropagation();
            onClose();
          }}
          aria-label="Hide wizard message"
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/75 hover:bg-white/15 hover:text-white"
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          <X className="h-3 w-3" strokeWidth={2.6} />
        </button>
      ) : null}

      <motion.div
        animate={pulseControls}
        // Reserve room for the X so the headline never collides with it.
        style={onClose ? { paddingRight: 18 } : undefined}
      >
        <h3 className="text-base font-semibold leading-tight text-white">{headline}</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-white/85">
          <TypewriterText
            text={body}
            pace={pace}
            forceComplete={forceComplete}
            onComplete={onTypingComplete}
            onTick={(revealedSoFar) => {
              if (!prefersReduced && endsAtSentence(revealedSoFar)) {
                pulseControls.start({ scale: [1, 1.02, 1], transition: { duration: 0.12 } });
              }
            }}
          />
        </p>
      </motion.div>

      <motion.svg
        className={`absolute ${tail.className}`}
        width={tailSide === "left" ? 14 : 20}
        height={tailSide === "left" ? 20 : 14}
        viewBox={tailSide === "left" ? "0 0 14 20" : "0 0 20 14"}
        aria-hidden
        initial={prefersReduced ? { opacity: 0 } : { scale: 0, opacity: 0 }}
        animate={prefersReduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={prefersReduced ? { duration: 0.12 } : tailSpring}
        style={{ transformOrigin: tail.transformOrigin }}
      >
        <path
          d={tail.path}
          fill="rgba(28, 28, 30, 0.72)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      </motion.svg>
    </motion.div>
  );
}
