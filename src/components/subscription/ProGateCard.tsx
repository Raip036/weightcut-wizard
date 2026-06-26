import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { ShimmerCrownBadge } from "./ShimmerCrownBadge";

interface ProGateCardProps {
  /** Feature name shown as the card headline. */
  title: string;
  /** One-line value sentence under the title. */
  subtitle: string;
  /** Tap handler — open the explainer / paywall. */
  onUnlock: () => void;
  /** Label inside the gradient pill (default "Unlock"). */
  unlockLabel?: string;
  /** Extra classes for grid placement (e.g. column span). */
  className?: string;
  /** Crown crest size (default 42, matching the meal-plan card). */
  badgeSize?: number;
}

/**
 * Shared Pro-gate card — the single "premium upsell" tile look used across the
 * app (meal-plan ideas, Training Missions, Recovery). One tappable card with a
 * blue gradient wash, a blue inset hairline + glow, a periodic gloss shimmer,
 * the shimmering crown crest, title + Pro pill + subtitle, and a gradient
 * "Unlock" pill. Keep every gate on this so they read identically.
 */
export function ProGateCard({
  title,
  subtitle,
  onUnlock,
  unlockLabel = "Unlock",
  className,
  badgeSize = 42,
}: ProGateCardProps) {
  const prefersReduced = useReducedMotion();
  return (
    <button
      type="button"
      onClick={onUnlock}
      aria-label={`${title} - a Pro feature, tap to unlock`}
      className={cn(
        "relative w-full overflow-hidden rounded-2xl p-4 text-left active:scale-[0.99] transition-transform",
        className,
      )}
      style={{
        background:
          "linear-gradient(135deg, hsl(217 91% 58% / 0.12) 0%, hsl(221 83% 46% / 0.06) 60%, transparent 100%)",
        boxShadow:
          "inset 0 0 0 1px hsl(217 91% 58% / 0.35), 0 0 22px hsl(217 91% 58% / 0.10)",
      }}
    >
      {/* periodic gloss shimmer sweeping across the card */}
      {!prefersReduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/10"
          style={{ transform: "skewX(-20deg)" }}
          initial={{ x: "-160%" }}
          animate={{ x: "460%" }}
          transition={{ duration: 1.3, ease: "easeOut", repeat: Infinity, repeatDelay: 3.2, delay: 1 }}
        />
      )}

      <div className="relative flex items-center gap-3.5">
        <ShimmerCrownBadge size={badgeSize} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold">{title}</h3>
            <span className="text-[9px] font-bold uppercase tracking-wide text-primary">
              Pro
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>
        </div>
        <span className="shrink-0 rounded-xl bg-gradient-to-r from-primary to-secondary px-3 py-2 text-[12px] font-bold text-primary-foreground">
          {unlockLabel}
        </span>
      </div>
    </button>
  );
}
