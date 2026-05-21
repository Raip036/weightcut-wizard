import { Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

export function LockedState() {
  const { openPaywall } = useSubscription();
  return (
    <div className="rounded-2xl border border-border/50 card-surface p-5 flex flex-col items-center text-center gap-3">
      <Sparkles className="h-6 w-6 text-primary" aria-hidden />
      <p className="text-[14px] font-semibold">Training Coach</p>
      <p className="text-[12px] text-muted-foreground">
        Upgrade for personalized training paths that adapt as you train.
      </p>
      <button
        type="button"
        onClick={openPaywall}
        className="rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-[13px] font-semibold"
      >
        Upgrade to Pro
      </button>
    </div>
  );
}
