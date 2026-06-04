import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import { ProUpsellScreen } from "./ProUpsellScreen";

interface ProExplainerOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  blurb: string;
  /** Value bullets that sell the feature before the paywall. */
  perks: string[];
  upgradeLabel?: string;
  dismissLabel?: string;
}

/**
 * Generic full-screen "Pro feature explainer" overlay.
 *
 * Tapping a locked entry point opens this (instead of jumping straight to the
 * paywall) so free users see the value first. Wraps the shared
 * {@link ProUpsellScreen}; "Upgrade to Pro" hands off to the RevenueCat
 * paywall, "Maybe later" / Escape closes it.
 *
 * Used for Training Missions, Weekly Recap, and any future locked feature —
 * pass feature-specific `title` / `blurb` / `perks`.
 */
export function ProExplainerOverlay({
  open,
  onOpenChange,
  title,
  blurb,
  perks,
  upgradeLabel,
  dismissLabel,
}: ProExplainerOverlayProps) {
  const { openPaywall } = useSubscription();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[10000] h-screen-safe overflow-y-auto overscroll-contain bg-background"
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <ProUpsellScreen
            title={title}
            blurb={blurb}
            perks={perks}
            upgradeLabel={upgradeLabel}
            dismissLabel={dismissLabel}
            onUpgrade={() => {
              onOpenChange(false);
              triggerHapticSelection();
              openPaywall();
            }}
            onDismiss={() => onOpenChange(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
