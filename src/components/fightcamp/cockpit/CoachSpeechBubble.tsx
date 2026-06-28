import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  X,
  MessageCircle,
  Scale,
  Utensils,
  Dumbbell,
  Droplet,
  HeartPulse,
  type LucideIcon,
} from "lucide-react";

/**
 * Proactive coach speech bubble that pops out of the floating FightCamp Coach
 * orb when the chat is closed. It "speaks" the coach's current read (priority
 * action / safety nudge / greeting) with an animated typewriter reveal.
 *
 * Calm message bubble with a small tail pointing back to the orb — the orb
 * itself is the coach's avatar, so the bubble carries no avatar of its own.
 * One calm style for EVERY state, no red / urgency accents. A single primary
 * action: the context CTA when the coach is nudging about something specific
 * (weigh-in, meals, hydration...), otherwise a quiet "Tap to chat". Tapping the
 * message always opens the full chat.
 *
 * Presentational only: positioning + visibility + data + navigation are owned by
 * FloatingWizardChat. `side` points the tail horizontally toward the orb;
 * `placement` flips the bubble above vs below the orb so it stays on-screen.
 */

export type BubbleAction = { kind: string; label: string; route: string };

const ACTION_ICONS: Record<string, LucideIcon> = {
  weighIn: Scale,
  nutrition: Utensils,
  training: Dumbbell,
  hydration: Droplet,
  recovery: HeartPulse,
};

// A number (optional ~ prefix, decimals, simple range) plus an optional trailing
// unit word, captured as ONE token so it never wraps mid-figure.
const NUM_RE =
  /(~?\d[\d.,]*(?:\s?[-–]\s?\d[\d.,]*)?\s?(?:kg|lbs?|%\s?\/\s?wk|%|ml|L|g|hrs?|h|mins?|min|days?|day|weeks?|wk|d)?)/gi;

/** Render numbers / percentages as restrained, non-breaking semibold tokens. */
function renderWithNumbers(text: string) {
  const parts = text.split(NUM_RE);
  return parts.map((part, i) =>
    part && /^[~\d]/.test(part) ? (
      <span
        key={i}
        className="whitespace-nowrap font-semibold tabular-nums text-foreground"
      >
        {part.trim()}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function CoachSpeechBubble({
  text,
  action,
  side,
  placement = "above",
  onAct,
  onChat,
  onDismiss,
}: {
  text: string;
  action?: BubbleAction | null;
  side: "left" | "right";
  placement?: "above" | "below";
  onAct: () => void;
  onChat: () => void;
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

  const originY = placement === "below" ? "top" : "bottom";
  const originX = side === "right" ? "right" : "left";

  const ActionIcon = action ? ACTION_ICONS[action.kind] ?? MessageCircle : null;

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
      className="relative max-w-[260px] pointer-events-auto"
    >
      <div className="rounded-2xl border border-border/45 bg-card/90 backdrop-blur-xl px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
        {/* Tapping the message opens the full chat. */}
        <button
          type="button"
          onClick={onChat}
          className="block w-full text-left"
          aria-label="Open FightCamp Coach"
        >
          <p className="text-[13px] leading-relaxed text-foreground/90">
            {renderWithNumbers(visible)}
            {typing && (
              <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse align-middle bg-primary/70" />
            )}
          </p>
        </button>

        {/* Single action: context CTA, or a quiet tap-to-chat fallback. */}
        <div className="mt-2">
          {action && ActionIcon ? (
            <button
              type="button"
              onClick={onAct}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground active:scale-95 transition-transform"
            >
              <ActionIcon className="h-3.5 w-3.5" /> {action.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={onChat}
              className="flex items-center gap-1 text-[11.5px] font-medium text-primary active:scale-95 transition-transform"
            >
              Tap to chat <MessageCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Dismiss — enlarged touch target so it's easy to close on phones. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute -top-2.5 -right-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-muted/95 text-muted-foreground shadow-[0_2px_8px_rgba(0,0,0,0.4)] active:scale-90 transition-transform"
        aria-label="Dismiss coach message"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Tail — points toward the orb. Bottom edge when the bubble sits above
          the orb, top edge when it sits below (orb dragged near the top). */}
      <div
        className={`absolute h-3 w-3 rotate-45 border-border/45 bg-card/90 ${
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
