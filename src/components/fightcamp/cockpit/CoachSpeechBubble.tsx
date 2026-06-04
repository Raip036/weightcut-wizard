import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

/**
 * Proactive coach speech bubble that pops out of the floating FightCamp Coach
 * orb when the chat is closed. It "speaks" the coach's current read (priority
 * action / red flag / greeting) with an animated typewriter reveal and a gentle
 * attention bob — like a tutorial coach nudging the user to tap the orb.
 *
 * Presentational only: positioning + visibility + data are owned by
 * FloatingWizardChat (it knows the orb's snapped edge + position). The `side`
 * prop points the tail toward the orb (orb on the right edge → tail bottom-right).
 */
export function CoachSpeechBubble({
  text,
  side,
  onTap,
  onDismiss,
}: {
  text: string;
  side: "left" | "right";
  onTap: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const prefersReduced = useReducedMotion();
  const [shown, setShown] = useState(prefersReduced ? text.length : 0);

  // Typewriter reveal — re-runs whenever the text changes.
  useEffect(() => {
    if (prefersReduced) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) window.clearInterval(id);
    }, 24);
    return () => window.clearInterval(id);
  }, [text, prefersReduced]);

  const visible = text.slice(0, shown);
  const typing = shown < text.length;

  return (
    <motion.div
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
      animate={
        prefersReduced
          ? { opacity: 1 }
          : { opacity: 1, scale: 1, y: [0, -3, 0] }
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
      style={{ transformOrigin: side === "right" ? "bottom right" : "bottom left" }}
      className="relative max-w-[230px] pointer-events-auto"
    >
      <button
        type="button"
        onClick={onTap}
        className="block w-full text-left rounded-2xl border border-primary/30 bg-card/90 backdrop-blur-xl px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)] active:scale-[0.97] transition-transform"
        aria-label="Open FightCamp Coach"
      >
        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-primary mb-0.5">
          Coach
        </span>
        <p className="text-[13px] leading-snug text-foreground">
          {visible}
          {typing && (
            <span className="inline-block w-[2px] h-[1em] align-middle bg-primary/80 ml-0.5 animate-pulse" />
          )}
        </p>
        <span className="mt-1 block text-[10px] font-medium text-primary/80">Tap to chat &rarr;</span>
      </button>

      {/* Dismiss */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-muted/90 border border-border/60 flex items-center justify-center text-muted-foreground active:scale-90 transition-transform"
        aria-label="Dismiss coach message"
      >
        <X className="h-3 w-3" />
      </button>

      {/* Tail pointing down toward the orb */}
      <div
        className={`absolute -bottom-1.5 h-3 w-3 rotate-45 bg-card/90 border-primary/30 ${
          side === "right" ? "right-5 border-r border-b" : "left-5 border-l border-b"
        }`}
      />
    </motion.div>
  );
}
