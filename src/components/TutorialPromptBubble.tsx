import { motion, useReducedMotion } from "motion/react";
import { X, Compass } from "lucide-react";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * Onboarding speech bubble that pops out of the floating AI coach orb to ask a
 * brand-new user whether they want a quick guided tour of the app.
 *
 * Visually mirrors {@link CoachSpeechBubble}: same card shell, animated spring
 * entry with a gentle attention bob, a tail that points toward the orb (driven
 * by `side` + `placement`), and reduced-motion fallback to a simple opacity
 * fade. The dot + "COACH" eyebrow was removed (the orb already signals it's the
 * coach).
 *
 * Presentational only: positioning + visibility are owned by the caller.
 * `side` points the tail horizontally toward the orb; `placement` flips the
 * bubble above vs below the orb so it stays on-screen.
 */

interface TutorialPromptBubbleProps {
  /** Which screen edge the orb is on (tail points toward the orb). */
  side: "left" | "right";
  /** Bubble position relative to the orb. */
  placement: "above" | "below";
  /** User tapped "Start tour". */
  onAccept: () => void;
  /** User tapped "Later" OR the dismiss X. */
  onDecline: () => void;
}

export function TutorialPromptBubble({
  side,
  placement,
  onAccept,
  onDecline,
}: TutorialPromptBubbleProps): JSX.Element {
  const prefersReduced = useReducedMotion();

  const originY = placement === "below" ? "top" : "bottom";
  const originX = side === "right" ? "right" : "left";

  // Greeting tier — quiet accent, matching CoachSpeechBubble's "greeting" look.
  const ring = "border-border/60";

  const handleAccept = () => {
    triggerHapticSelection();
    onAccept();
  };

  const handleDecline = () => {
    triggerHapticSelection();
    onDecline();
  };

  return (
    <motion.div
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
      animate={
        prefersReduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: [0, -3, 0] }
      }
      exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
      transition={
        prefersReduced
          ? { duration: 0.15 }
          : {
              opacity: { duration: 0.2 },
              scale: { type: "spring", stiffness: 420, damping: 24 },
              y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" },
            }
      }
      style={{ transformOrigin: `${originX} ${originY}` }}
      className="relative max-w-[244px] pointer-events-auto"
    >
      <div
        className={`rounded-2xl border ${ring} bg-card/90 backdrop-blur-xl px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}
      >
        <p className="text-[13px] leading-snug text-foreground">
          New here? Want a quick tour?
        </p>

        {/* Action row — primary "Start tour" + ghost "Later". */}
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleAccept}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95 transition-transform"
          >
            <Compass className="h-3 w-3" /> Start tour
          </button>
          <button
            type="button"
            onClick={handleDecline}
            className="flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground active:scale-95 transition-transform"
          >
            Later
          </button>
        </div>
      </div>

      {/* Dismiss — enlarged touch target (28px) so it's easy to close on phones. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDecline();
        }}
        className="absolute -top-2.5 -right-2.5 h-7 w-7 rounded-full bg-muted/95 border border-border/60 flex items-center justify-center text-muted-foreground active:scale-90 transition-transform shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
        aria-label="Dismiss tutorial prompt"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Tail — points toward the orb. Bottom edge when the bubble sits above
          the orb, top edge when it sits below (orb dragged near the top). */}
      <div
        className={`absolute h-3 w-3 rotate-45 bg-card/90 ${ring} ${
          side === "right" ? "right-5" : "left-5"
        } ${
          placement === "below"
            ? `-top-1.5 ${side === "right" ? "border-r border-t" : "border-l border-t"}`
            : `-bottom-1.5 ${side === "right" ? "border-r border-b" : "border-l border-b"}`
        }`}
      />
    </motion.div>
  );
}
