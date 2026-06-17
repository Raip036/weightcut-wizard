import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  X,
  MessageCircle,
  AlertTriangle,
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
 * action / red flag / greeting) with an animated typewriter reveal and a gentle
 * attention bob.
 *
 * Refined card layout: a coloured tier dot + "COACH" label, the message, and a
 * CONTEXT-AWARE primary action (the CTA + route match what the coach is nudging
 * about — weigh-in → Log weigh-in, nutrition → Log a meal, etc.) plus a Chat
 * fallback. A greeting (no action) collapses to a single "Chat with coach".
 *
 * Presentational only: positioning + visibility + data + navigation are owned by
 * FloatingWizardChat. `side` points the tail horizontally toward the orb;
 * `placement` flips the bubble above vs below the orb so it stays on-screen.
 */

type Tier = "redFlag" | "priority" | "greeting";

export type BubbleAction = { kind: string; label: string; route: string };

const ACTION_ICONS: Record<string, LucideIcon> = {
  weighIn: Scale,
  nutrition: Utensils,
  training: Dumbbell,
  hydration: Droplet,
  recovery: HeartPulse,
};

/** Bold any number / figure (digits, optional decimal, optional unit). */
function renderWithBoldNumbers(text: string) {
  const parts = text.split(
    /(\d[\d.,]*\s?(?:kg|lbs?|%|ml|L|g|hrs?|h|min|days?|wk|d)?)/gi,
  );
  return parts.map((part, i) =>
    part && /^\d/.test(part) ? (
      <strong key={i} className="font-bold text-foreground">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function CoachSpeechBubble({
  text,
  tier = "priority",
  action,
  side,
  placement = "above",
  onAct,
  onChat,
  onDismiss,
}: {
  text: string;
  tier?: Tier;
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

  // Tier accents — red flags read urgent, greetings read quiet.
  const isRed = tier === "redFlag";
  const ring = isRed
    ? "border-func-danger-red/40"
    : tier === "greeting"
      ? "border-border/60"
      : "border-primary/35";
  const dot = isRed
    ? "bg-func-danger-red"
    : tier === "greeting"
      ? "bg-muted-foreground"
      : "bg-primary";
  const labelColor = isRed
    ? "text-func-danger-red"
    : tier === "greeting"
      ? "text-muted-foreground"
      : "text-primary";

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
      className="relative max-w-[244px] pointer-events-auto"
    >
      <div
        className={`rounded-2xl border ${ring} bg-card/90 backdrop-blur-xl px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}
      >
        {/* Header + message — tapping anywhere here opens the chat. */}
        <button
          type="button"
          onClick={onChat}
          className="block w-full text-left"
          aria-label="Open FightCamp Coach"
        >
          <span className="flex items-center gap-1.5 mb-1">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.12em] ${labelColor}`}
            >
              Coach
            </span>
            {isRed && (
              <AlertTriangle className="h-3 w-3 text-func-danger-red ml-auto" />
            )}
          </span>
          <p className="text-[13px] leading-snug text-foreground">
            {renderWithBoldNumbers(visible)}
            {typing && (
              <span className="inline-block w-[2px] h-[1em] align-middle bg-primary/80 ml-0.5 animate-pulse" />
            )}
          </p>
        </button>

        {/* Action row — context-aware primary + Chat fallback. */}
        <div className="mt-2.5 flex items-center gap-2">
          {action && ActionIcon ? (
            <>
              <button
                type="button"
                onClick={onAct}
                className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95 transition-transform"
              >
                <ActionIcon className="h-3 w-3" /> {action.label}
              </button>
              <button
                type="button"
                onClick={onChat}
                className="flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground active:scale-95 transition-transform"
              >
                <MessageCircle className="h-3 w-3" /> Chat
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onChat}
              className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95 transition-transform"
            >
              <MessageCircle className="h-3 w-3" /> Chat with coach
            </button>
          )}
        </div>
      </div>

      {/* Dismiss — enlarged touch target (28px) so it's easy to close on phones. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute -top-2.5 -right-2.5 h-7 w-7 rounded-full bg-muted/95 border border-border/60 flex items-center justify-center text-muted-foreground active:scale-90 transition-transform shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
        aria-label="Dismiss coach message"
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
