// WP-T19 — NoFightCampEmptyState
// Empty state shown on the Weight Protocol page when the user has no
// active fight camp. CTA links to /fight-camps where they can create
// one. Mirrors the Recovery.tsx empty-state pattern: wizard mascot
// (wave pose, scaled down) + headline + body + primary action.
//
// Visual conventions:
//   - No card border / chrome — empty states feel emptier this way
//   - Wizard mascot at ~72px effective size via scale(0.5)
//   - 19px bold headline, 13px muted body, primary pill button
//   - Mount: fade + slide-up 16px (320ms spring), guarded by
//     useReducedMotion so the page still appears instantly when the
//     user has motion preferences set
//   - Haptic selection on tap
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export interface NoFightCampEmptyStateProps {
  /** Override the default navigation to `/fight-camps`. */
  onSetFightDate?: () => void;
  className?: string;
}

export function NoFightCampEmptyState({
  onSetFightDate,
  className,
}: NoFightCampEmptyStateProps) {
  const prefersReduced = useReducedMotion();
  const navigate = useNavigate();

  const handleTap = () => {
    triggerHapticSelection();
    if (onSetFightDate) {
      onSetFightDate();
      return;
    }
    navigate("/fight-camps");
  };

  return (
    <motion.section
      role="region"
      aria-label="No active fight camp"
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 260 }}
      className={cn(
        "relative w-full px-5 py-8 sm:py-10 flex flex-col items-center text-center",
        className,
      )}
    >
      {/* Wizard mascot — wave pose, scaled to ~70px effective height */}
      <div
        className="relative shrink-0 mb-3"
        style={{ width: 80, height: 80 }}
        aria-hidden="true"
      >
        <div
          style={{
            width: 160,
            height: 160,
            transform: "scale(0.5)",
            transformOrigin: "top left",
          }}
        >
          <WizardCharacter pose="wave" />
        </div>
      </div>

      {/* Headline */}
      <h2 className="text-[19px] font-bold leading-tight text-foreground">
        Set your weigh-in date
      </h2>

      {/* Body */}
      <p className="mt-2 max-w-sm text-[13px] text-muted-foreground leading-snug">
        Get a personalised cut + rehydration plan for your fight week. Tuned to
        your weight, training load, and prior cuts.
      </p>

      {/* Primary CTA */}
      <button
        type="button"
        onClick={handleTap}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-[13px] font-bold text-primary-foreground active:scale-[0.97] transition"
      >
        Set fight date →
      </button>
    </motion.section>
  );
}
