import { useState } from "react";
import { triggerHapticSelection } from "@/lib/haptics";
import { ProGateCard } from "@/components/subscription/ProGateCard";
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
      <ProGateCard
        title="Training Missions"
        subtitle="Guided drills and sparring focus tuned to your camp"
        onUnlock={handlePress}
      />

      <MissionsProDialog open={explainerOpen} onOpenChange={setExplainerOpen} />
    </>
  );
}
