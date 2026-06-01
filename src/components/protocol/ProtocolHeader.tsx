// WP-T10 — ProtocolHeader
// Page header for the Weight Protocol screen. Renders the page label,
// a help button, and a second row with two pills: the cut-depth tier
// pill and a countdown chip to weigh-in. Respects iOS safe-area inset.
//
// Visual conventions match RecoveryDashboard's header pattern:
//   - 10px uppercase tracker label
//   - `helpCircleOutline` icon button on the right
//   - rounded-full bordered pills, tier-colored
//   - motion fade-in on mount (guarded by useReducedMotion)
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";

type CutCategory = "light" | "moderate" | "heavy" | "extreme";

export interface ProtocolHeaderProps {
  cutDepthPct: number;
  cutCategory: CutCategory;
  daysToWeighIn: number;
  /** Optional date for human-readable display (e.g. "Sat 7 Jun"). */
  weighInDate?: Date | null;
  onOpenInfo?: () => void;
  className?: string;
}

// Tier → pill styling. Light is neutral; moderate blue; heavy amber;
// extreme red. Matches the rest of the app's functional palette.
function tierPillClasses(tier: CutCategory): string {
  switch (tier) {
    case "light":
      return "border-border/40 text-muted-foreground";
    case "moderate":
      return "border-blue-300/40 text-blue-300";
    case "heavy":
      return "border-func-warning-yellow/40 text-func-warning-yellow";
    case "extreme":
      return "border-func-danger-red/40 text-func-danger-red";
  }
}

// Short day name + day + month (e.g. "Sat 7 Jun"). Falls back to ""
// when no date is supplied so the countdown chip still renders cleanly.
function formatWeighInDate(date: Date | null | undefined): string {
  if (!date) return "";
  try {
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

export function ProtocolHeader({
  cutDepthPct,
  cutCategory,
  daysToWeighIn,
  weighInDate,
  onOpenInfo,
  className = "",
}: ProtocolHeaderProps) {
  const prefersReduced = useReducedMotion();
  const pillClasses = tierPillClasses(cutCategory);
  const dateLabel = formatWeighInDate(weighInDate);

  // Countdown copy — "today" / "tomorrow" / "N days" — kept compact so
  // the chip never wraps on a 320px viewport.
  const countdownLabel =
    daysToWeighIn <= 0
      ? "Weigh-in today"
      : daysToWeighIn === 1
        ? "1 day to weigh-in"
        : `${daysToWeighIn} days to weigh-in`;

  return (
    <motion.header
      initial={prefersReduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`pt-[env(safe-area-inset-top)] ${className}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
          Weight Protocol
        </p>
        {onOpenInfo && (
          <button
            type="button"
            onClick={onOpenInfo}
            aria-label="How to read this page"
            className="h-8 w-8 -mr-1 rounded-full flex items-center justify-center text-muted-foreground/70 active:text-foreground transition-colors"
          >
            <Icon name="helpCircleOutline" size={18} />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums ${pillClasses}`}
        >
          <span>{cutDepthPct.toFixed(1)}% cut</span>
          <span aria-hidden className="opacity-60">·</span>
          <span className="uppercase tracking-[0.1em]">{cutCategory}</span>
        </span>

        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground tabular-nums"
          aria-label={`${countdownLabel}${dateLabel ? `, ${dateLabel}` : ""}`}
        >
          <Icon name="calendarOutline" size={12} />
          <span>{countdownLabel}</span>
          {dateLabel && (
            <>
              <span aria-hidden className="opacity-60">·</span>
              <span>{dateLabel}</span>
            </>
          )}
        </span>
      </div>
    </motion.header>
  );
}
