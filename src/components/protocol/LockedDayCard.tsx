// WP-T12: LockedDayCard
// Soft "preview" that collapses N future-plan days (typically 5-6 for a
// week-long cut) into a single locked card. Shown to free users for
// everything past T-(N-1) so the day list still telegraphs what's coming
// without giving away the plan.
//
// This card used to carry a loud full-width "Upgrade to Pro" CTA. The
// protocol page now hoists a single primary upgrade gate to the top, so
// these lower sections are deliberately quiet teasers: the whole surface
// is tappable, carries a small shimmering Pro chip, and routes the tap to
// the page-level gate via `onUnlock` (falling back to the paywall directly
// for older callers).
//
// Visual / motion notes:
//   - Wizard-blue (primary) chrome, but dialled down vs. the old CTA:
//     a faint tint (`border-primary/20 bg-primary/[0.04]`) so it reads as
//     "premium preview" rather than "buy now".
//   - Day list is rendered for real then CSS-blurred to 3px and marked
//     `aria-hidden` so screen readers don't dictate scrambled copy. The
//     blur ramps from 0 → 3px over 600ms on mount, feels like the card
//     is *locking*, not blurred-on-first-paint.
//   - The whole card is a single tappable surface. It fires haptic
//     selection feedback and routes to `onUnlock` if provided, else the
//     caller-supplied `onUpgrade`, else `useSubscription().openPaywall`.
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import type { FightPlan } from "@/../convex/_shared/aiSchemas";

type DayProjection = FightPlan["days"][number];

export interface LockedDayCardProps {
  /** The days being collapsed under the lock; typically 5-6. */
  days: DayProjection[];
  /**
   * Preferred tap handler. When provided, tapping the card routes here
   * instead of opening the paywall directly; used by the redesigned
   * protocol page to defer to its single top-level upgrade gate.
   */
  onUnlock?: () => void;
  /**
   * Legacy override; used only when `onUnlock` is not supplied. Falls back
   * to `useSubscription().openPaywall` if neither is given.
   */
  onUpgrade?: () => void;
  /**
   * Used when `days` is empty, i.e. the card stands in for a whole locked
   * section (e.g. the rehydration timeline) rather than collapsing real
   * future days. Describes what's behind the lock. Falls back to a generic
   * teaser. Ignored when `days` has entries.
   */
  teaser?: string;
  className?: string;
}

// Cap the keyAction preview length so each row stays single-line under
// the blur. The blur swallows fine detail anyway, so clipping at 30 chars
// keeps the layout tight and avoids wrap-induced height jitter.
const ACTION_PREVIEW_LEN = 30;

// Generic blurred lines shown when the card stands in for a whole section
// (no real days). Keeps the card from looking empty while still teasing
// the content shape.
const SECTION_PREVIEW_LINES = [
  "Hour-by-hour rehydration timeline",
  "DIY ORS recipe for your body",
];

export function LockedDayCard({
  days,
  onUnlock,
  onUpgrade,
  teaser,
  className = "",
}: LockedDayCardProps) {
  const prefersReduced = useReducedMotion();
  const { openPaywall } = useSubscription();

  const handleUnlock = () => {
    triggerHapticSelection();
    (onUnlock ?? onUpgrade ?? openPaywall)();
  };

  const lockedCount = days.length;
  const hasDays = lockedCount > 0;
  // Footer copy adapts: real days → "unlock N more days"; section stand-in
  // → the supplied teaser (or a generic fallback).
  const footerText = hasDays
    ? `Unlock ${lockedCount} more ${lockedCount === 1 ? "day" : "days"}`
    : `Unlock ${teaser ?? "the full plan"}`;

  return (
    <motion.button
      type="button"
      onClick={handleUnlock}
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      aria-label={
        hasDays
          ? `Preview: unlock ${lockedCount} more ${
              lockedCount === 1 ? "day" : "days"
            } with Pro`
          : `Preview: unlock ${teaser ?? "this section"} with Pro`
      }
      className={`relative w-full text-left card-surface rounded-2xl border border-primary/20 bg-primary/[0.04] overflow-hidden active:scale-[0.99] transition-transform ${className}`}
    >
      {/* Pro chip, top-right corner: shimmering crown over a quiet "PRO"
          label. Replaces the old lock icon; signals premium without the
          hard-sell button. */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <ShimmerCrownBadge size={18} />
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/80">
          Pro
        </span>
      </div>

      <div className="p-4 pt-4 space-y-3">
        {/* Gentle teaser line: same 10px uppercase pattern as the rest of
            the protocol page, but phrased as an invitation, not a sell. */}
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
          Preview · unlock with Pro
        </div>

        {/* Day-line list: real content, blurred. We animate the blur in
            (0 → 3px over 600ms) so the locking feels mechanical rather
            than the card appearing already-blurred. Under reduced-motion
            we snap straight to 3px to honour the user preference. */}
        <motion.div
          aria-hidden
          initial={
            prefersReduced
              ? { filter: "blur(3px)" }
              : { filter: "blur(0px)" }
          }
          animate={{ filter: "blur(3px)" }}
          transition={{ duration: prefersReduced ? 0 : 0.6, ease: "easeOut" }}
          className="space-y-1.5"
          style={{ userSelect: "none" }}
        >
          {hasDays
            ? days.map((day, i) => (
                <div
                  key={`${day.dayIso}-${i}`}
                  className="text-[12px] text-muted-foreground/85 leading-snug tabular-nums"
                >
                  <span className="font-bold uppercase tracking-[0.1em] text-foreground/70 mr-1">
                    {day.dayLabel}
                  </span>
                  <span>· {day.keyAction.slice(0, ACTION_PREVIEW_LEN)}</span>
                </div>
              ))
            : SECTION_PREVIEW_LINES.map((line) => (
                <div
                  key={line}
                  className="text-[12px] text-muted-foreground/85 leading-snug"
                >
                  <span>· {line}</span>
                </div>
              ))}
        </motion.div>

        {/* Quiet footer teaser: muted, no button. The whole card is the
            tap target; this just tells the user what they'd gain. */}
        <div className="pt-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/80">
          <Icon name="lockClosedOutline" size={12} className="text-primary/70" />
          <span>{footerText}</span>
        </div>
      </div>
    </motion.button>
  );
}
