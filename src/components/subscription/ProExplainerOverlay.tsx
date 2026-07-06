import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useSubscription } from "@/hooks/useSubscription";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";
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
  /** Short, PII-free, snake_case key for where this explainer was opened
   *  (e.g. "training_missions", "weekly_recap"). Required; recorded on
   *  PAYWALL_VIEWED and PAYWALL_DISMISSED. */
  source: string;
}

/**
 * Generic full-screen "Pro feature explainer" overlay.
 *
 * Tapping a locked entry point opens this (instead of jumping straight to the
 * paywall) so free users see the value first. Wraps the shared
 * {@link ProUpsellScreen}; "Upgrade to Pro" hands off to the RevenueCat
 * paywall, "Maybe later" / Escape closes it.
 *
 * Used for Training Missions, Weekly Recap, and any future locked feature:
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
  source,
}: ProExplainerOverlayProps) {
  const { openPaywall } = useSubscription();
  // Clear any stuck `body { pointer-events: none }` left by a badly-closed
  // Radix/vaul overlay so this full-screen overlay's buttons aren't frozen.
  useClearStuckPointerEvents();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Portal to <body> so `fixed` resolves against the viewport. Rendered inside
  // a route page, this overlay would otherwise be trapped by the transformed
  // `.page-transition-page` ancestor (containing block for fixed descendants),
  // leaving it cut off and scrollable-away.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[10000] h-screen-safe overflow-y-auto overscroll-contain bg-background pointer-events-auto"
          style={{ pointerEvents: "auto" }}
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
            source={source}
            onUpgrade={() => {
              onOpenChange(false);
              triggerHapticSelection();
              openPaywall(source);
            }}
            onDismiss={() => onOpenChange(false)}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
