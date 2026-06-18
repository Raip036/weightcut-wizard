import { useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { SparringProDialog } from "./SparringProDialog";

/**
 * Pro paywall fallback for the Sparring To-Do List feature.
 *
 * Matches the Training Missions compact upsell row in `Camp.tsx`: a single
 * tappable row (crown crest + label + "Pro" chip), no blurb, no inline button.
 * Pressing it opens the animated {@link SparringProDialog} explainer, which
 * leads to the RevenueCat paywall — so the paywall only appears on tap.
 */
export function LockedSparringCard() {
  const [explainerOpen, setExplainerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          triggerHaptic(ImpactStyle.Light);
          setExplainerOpen(true);
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-primary/30 bg-primary/10 active:brightness-110 transition-[filter]"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <ShimmerCrownBadge size={26} />
          <span className="text-body-sm font-semibold text-foreground truncate">
            Unlock sparring to-do list
          </span>
        </span>
        <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary shrink-0">
          Pro
        </span>
      </button>

      <SparringProDialog open={explainerOpen} onOpenChange={setExplainerOpen} />
    </>
  );
}
