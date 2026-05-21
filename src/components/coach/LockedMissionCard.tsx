import { Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * Pro paywall fallback for the Training Missions feature. Mirrors the
 * integration pattern in `src/components/dashboard/training-coach/
 * LockedState.tsx` — it pulls `openPaywall` from the existing
 * `useSubscription` hook (backed by `SubscriptionContext`) so the user
 * lands in the same RevenueCat-powered upgrade flow used everywhere else.
 *
 * Visual rhythm matches the rest of `/camp` (rounded-xs card-surface p-4)
 * so this slot doesn't look orthogonal to the page when it's the only
 * thing the user can see.
 */
export function LockedMissionCard() {
  const { openPaywall } = useSubscription();

  const handlePress = () => {
    triggerHapticSelection();
    openPaywall();
  };

  return (
    <div className="w-full rounded-xs card-surface p-4 flex flex-col items-start gap-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-body-sm font-semibold text-foreground leading-tight">
              Training Missions
            </p>
            <span className="text-[10px] uppercase tracking-wide text-primary font-bold">
              Pro
            </span>
          </div>
          <p className="text-note text-muted-foreground leading-snug mt-0.5">
            Turn your session notes into a linear checklist that adapts as
            you train.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handlePress}
        className="w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold active:scale-[0.99] transition-transform"
      >
        Upgrade to Pro
      </button>
    </div>
  );
}
