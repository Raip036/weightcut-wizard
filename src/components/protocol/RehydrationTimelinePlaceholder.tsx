// WP-T16 — RehydrationTimelinePlaceholder
// Pre-weigh-in card explaining the hour-by-hour timeline is locked until
// the user actually weighs in. The protocol is pre-computed — we just
// need the real scale number to anchor H+0 — so the messaging leans on
// "unlocks the moment you log it" rather than "still calculating".
//
// Visual conventions mirror the rest of the protocol/ family:
//   - card-surface rounded-2xl border border-border/50 p-5
//   - centered layout (this is a "nothing-here-yet" state, not a card
//     packed with data)
//   - 10px uppercase tracker, 13px muted body
//   - Optional "Preview a sample hour →" secondary button when the
//     parent wires up `onPreview`
//
// Mount animation: fade + slide-up 16px (matches TodaysActionHero entry).
// Guarded by `prefers-reduced-motion`.
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";

export interface RehydrationTimelinePlaceholderProps {
  /** Weigh-in clock time, formatted by the parent (e.g. "11:00"). */
  weighInTime: string;
  /** Optional — when supplied, the "Preview a sample hour →" CTA renders. */
  onPreview?: () => void;
  className?: string;
}

export function RehydrationTimelinePlaceholder({
  weighInTime,
  onPreview,
  className = "",
}: RehydrationTimelinePlaceholderProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.section
      role="region"
      aria-label="Rehydration timeline placeholder"
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={`card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      <div className="flex flex-col items-center text-center">
        {/* Clock icon — subtle, muted, sits above the copy block. */}
        <span
          aria-hidden
          className="mb-3 inline-flex items-center justify-center h-10 w-10 rounded-full border border-border/50 bg-background/30 text-muted-foreground"
        >
          <Icon name="timeOutline" size={20} aria-hidden />
        </span>

        {/* Headline tracker */}
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
          HOUR-BY-HOUR · available after weigh-in
        </p>

        {/* Body copy */}
        <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-prose">
          The full timeline unlocks the moment you log your weigh-in weight at
          {" "}
          <span className="tabular-nums text-foreground/90">{weighInTime}</span>.
          Your protocol is pre-computed — we just need the actual scale number
          to anchor H+0.
        </p>

        {/* Optional sample-hour preview CTA */}
        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="mt-4 inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/30 px-3 py-1.5 text-[12px] font-semibold text-foreground/90 active:scale-[0.97] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Preview a sample hour →
          </button>
        )}
      </div>
    </motion.section>
  );
}
