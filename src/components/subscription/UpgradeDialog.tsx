import { Crown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/useSubscription";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional name of the feature the user tried to use (e.g. "AI Meal Analysis"). */
  featureName?: string;
}

/**
 * Shown when a free user attempts to use a Pro-only feature.
 *
 * Replaces the legacy `NoGemsDialog`. Single CTA upgrades to Pro via the
 * existing `openPaywall()` flow on `useSubscription`. There is intentionally
 * no "Watch Ad" path — ads were removed alongside the gems system.
 */
export function UpgradeDialog({ open, onOpenChange, featureName }: UpgradeDialogProps) {
  const { openPaywall } = useSubscription();

  const handleUpgrade = () => {
    onOpenChange(false);
    openPaywall();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[320px] rounded-xs p-0 border border-border/50 glass-card overflow-hidden gap-0 shadow-2xl [&>button:last-of-type]:hidden">
        <VisuallyHidden>
          <DialogTitle>Pro feature</DialogTitle>
          <DialogDescription>Upgrade to Pro to unlock this feature.</DialogDescription>
        </VisuallyHidden>

        <div className="flex flex-col items-center text-center px-6 pt-7 pb-5">
          {/* Crown icon — mirrors the activation flow visual */}
          <div className="h-14 w-14 rounded-xs bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30 flex items-center justify-center mb-4">
            <Crown className="h-7 w-7 text-primary" />
          </div>

          <h2 className="text-[17px] font-bold tracking-tight text-foreground">Pro Feature</h2>
          <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
            {featureName ? (
              <><span className="font-medium text-foreground/90">{featureName}</span> is available for Pro members. Upgrade to unlock unlimited AI access across the app.</>
            ) : (
              <>This feature is available for Pro members. Upgrade to unlock unlimited AI access across the app.</>
            )}
          </p>
        </div>

        <div className="px-4 pb-4 space-y-2">
          <Button
            onClick={handleUpgrade}
            className="w-full h-11 rounded-xs text-[14px] font-bold bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-lg shadow-primary/20 active:scale-[0.97] transition-transform"
          >
            Upgrade to Pro
          </Button>
          <button
            onClick={() => onOpenChange(false)}
            className="w-full py-2 text-[13px] font-medium text-muted-foreground active:text-foreground transition-colors"
          >
            Not Now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
