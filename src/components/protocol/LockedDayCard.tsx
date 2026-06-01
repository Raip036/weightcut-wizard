// WP-T12 — LockedDayCard
// Frosted preview that collapses N future-plan days (typically 5-6 for a
// week-long cut) into a single locked card with an upgrade CTA. Shown to
// free users for everything past T-(N-1) so the day list still telegraphs
// what's coming without giving away the plan.
//
// Visual / motion notes:
//   - Amber-tinted chrome — matches the wider "Pro-gated" cue used in
//     CampCompassCard's locked state (`border-amber-400/30 bg-amber-400/[0.03]`).
//   - Day list is rendered for real then CSS-blurred to 3px and marked
//     `aria-hidden` so screen readers don't dictate scrambled copy. The
//     blur ramps from 0 → 3px over 600ms on mount — feels like the card
//     is *locking*, not blurred-on-first-paint.
//   - Bottom CTA fires haptic selection feedback on tap and routes to
//     `useSubscription().openPaywall` unless the caller provides their
//     own `onUpgrade`.
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import type { FightPlan } from "@/../convex/_shared/aiSchemas";

type DayProjection = FightPlan["days"][number];

export interface LockedDayCardProps {
  /** The days being collapsed under the lock — typically 5-6. */
  days: DayProjection[];
  /** Optional override; defaults to `useSubscription().openPaywall`. */
  onUpgrade?: () => void;
  className?: string;
}

// Cap the keyAction preview length so each row stays single-line under
// the blur. The blur swallows fine detail anyway — clipping at 30 chars
// keeps the layout tight and avoids wrap-induced height jitter.
const ACTION_PREVIEW_LEN = 30;

export function LockedDayCard({
  days,
  onUpgrade,
  className = "",
}: LockedDayCardProps) {
  const prefersReduced = useReducedMotion();
  const { openPaywall } = useSubscription();

  const handleUpgrade = () => {
    triggerHapticSelection();
    (onUpgrade ?? openPaywall)();
  };

  const lockedCount = days.length;

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`relative card-surface rounded-2xl border border-amber-400/30 bg-amber-400/[0.03] overflow-hidden ${className}`}
    >
      {/* Lock affordance, top-right corner — same icon CampCompassCard
          uses for its locked state. */}
      <div className="absolute top-3 right-3 text-amber-400/80">
        <Icon
          name="lockClosedOutline"
          size={14}
          aria-label="Pro feature"
        />
      </div>

      <div className="p-4 pt-4 space-y-3">
        {/* Section tracker — same 10px uppercase pattern as the rest of
            the protocol page. */}
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400/80">
          {lockedCount} days · Pro
        </div>

        {/* Day-line list — real content, blurred. We animate the blur in
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
          {days.map((day, i) => (
            <div
              key={`${day.dayIso}-${i}`}
              className="text-[12px] text-muted-foreground/85 leading-snug tabular-nums"
            >
              <span className="font-bold uppercase tracking-[0.1em] text-foreground/70 mr-1">
                {day.dayLabel}
              </span>
              <span>· {day.keyAction.slice(0, ACTION_PREVIEW_LEN)}</span>
            </div>
          ))}
        </motion.div>

        {/* Upgrade CTA — full-width pill, primary surface to draw the
            tap. 44px min-height matches Apple's hit-target guidance and
            the convention used by CampCompassCard's "Unlock" button. */}
        <button
          type="button"
          onClick={handleUpgrade}
          className="mt-2 w-full min-h-[44px] rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Icon name="lockClosedOutline" size={14} />
          <span>
            Upgrade to Pro to unlock {lockedCount}{" "}
            {lockedCount === 1 ? "day" : "days"}
          </span>
        </button>
      </div>
    </motion.div>
  );
}
