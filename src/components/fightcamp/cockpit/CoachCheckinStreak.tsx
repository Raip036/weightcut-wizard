import { useReducedMotion } from "motion/react";

import { Icon } from "@/components/ui/Icon";

/**
 * Daily check-in streak surface for the coach cockpit (Phase 2, local-only).
 *
 * Two states:
 *   - checkedInToday → compact streak badge ("🔥-style" flame + "N-day streak").
 *   - not checked in → one-tap "Daily check-in" card that calls onCheckIn(),
 *     with the current streak (or a "start your streak" nudge) as secondary text.
 *
 * Styling reuses the cockpit pill vocabulary (primary/blue accent, tinted
 * surface) and app tokens. 44px touch target on the CTA; honors
 * prefers-reduced-motion.
 */
export function CoachCheckinStreak({
  streak,
  checkedInToday,
  onCheckIn,
  className,
}: {
  streak: number;
  checkedInToday: boolean;
  onCheckIn: () => void;
  className?: string;
}): JSX.Element | null {
  const prefersReduced = useReducedMotion();

  const join = (...parts: (string | false | null | undefined)[]) =>
    parts.filter(Boolean).join(" ");

  // Checked in today → compact badge.
  if (checkedInToday) {
    return (
      <span
        className={join(
          "inline-flex items-center gap-1 rounded-xs border px-2 py-0.5",
          "text-[11px] font-bold uppercase tracking-[0.12em] tabular-nums leading-none",
          "text-primary bg-primary/15 border-primary/35",
          className,
        )}
        aria-label={`${streak}-day check-in streak`}
      >
        <Icon
          name="flame"
          size={11}
          className={join("text-primary", !prefersReduced && "animate-pulse")}
        />
        {streak}-DAY STREAK
      </span>
    );
  }

  // Not checked in → one-tap CTA card.
  const secondary =
    streak > 0
      ? `${streak}-day streak — keep it alive`
      : "Start your check-in streak";

  return (
    <button
      type="button"
      onClick={onCheckIn}
      className={join(
        "flex w-full min-h-[44px] items-center gap-3 rounded-xl border px-3 py-2 text-left",
        "border-primary/30 bg-primary/10",
        "transition-colors active:bg-primary/15",
        !prefersReduced && "transition-transform active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
      aria-label="Daily check-in"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
        <Icon name="flame" size={16} className="text-primary" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">Daily check-in</span>
        <span className="truncate text-xs text-muted-foreground">{secondary}</span>
      </span>
    </button>
  );
}
