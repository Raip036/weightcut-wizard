import { useState } from "react";
import { triggerHapticSelection } from "@/lib/haptics";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { MissionsProDialog } from "./MissionsProDialog";

/**
 * Pro paywall fallback for the Training Missions feature.
 *
 * Tapping the CTA opens the animated {@link MissionsProDialog} explainer
 * (Welcome-to-Pro theme) so the user understands the value before reaching
 * the RevenueCat paywall, instead of jumping there cold.
 *
 * Visual rhythm matches the rest of `/camp` (rounded card-surface p-4), with
 * a premium shimmering-crown crest in place of the old flat icon.
 */
export function LockedMissionCard() {
  const [explainerOpen, setExplainerOpen] = useState(false);

  const handlePress = () => {
    triggerHapticSelection();
    setExplainerOpen(true);
  };

  return (
    <>
      <div className="relative w-full rounded-2xl border border-primary/20 bg-primary/10 p-4 flex flex-col items-start gap-3 overflow-hidden">
        <div className="flex items-center gap-3">
          {/* Shimmering crown crest: shared premium marker. */}
          <ShimmerCrownBadge size={40} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-body-sm font-semibold text-foreground leading-tight">
                Training Missions
              </p>
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                Pro
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePress}
          className="w-full min-h-[44px] rounded-xs bg-gradient-to-r from-primary to-secondary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold card-press"
        >
          Unlock Training Missions
        </button>
      </div>

      <MissionsProDialog open={explainerOpen} onOpenChange={setExplainerOpen} />
    </>
  );
}
