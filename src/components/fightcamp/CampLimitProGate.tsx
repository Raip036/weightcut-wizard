import { createPortal } from "react-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";
import { triggerHapticSelection } from "@/lib/haptics";
import { ProUpsellScreen } from "@/components/subscription/ProUpsellScreen";

interface CampLimitProGateProps {
  /** Whether the gate is shown. Callers open this after a failed
   *  `checkFeatureAccess("MULTIPLE_FIGHT_CAMPS")` at a camp-creation entry. */
  open: boolean;
  /** Dismiss ("Maybe later"): close the gate and return to where they were. */
  onClose: () => void;
}

const TITLE = "Run unlimited fight camps";
const BLURB =
  "Free covers your first camp. Go Pro to line up your next fight, keep every camp's history, and get a fresh AI cut plan each time.";
const PERKS = [
  "Start a new fight camp anytime",
  "A fresh AI cut & weight plan for every camp",
  "Keep your full camp history & comparisons",
];

/**
 * Full-screen Pro gate shown when a FREE user tries to create a SECOND fight
 * camp (or any camp beyond their single onboarding one). Reuses the shared
 * animated {@link ProUpsellScreen}, the "Welcome-to-Pro" visual language
 * (blue aurora, drifting motes, floating wizard mascot), with camp-specific
 * copy and value bullets.
 *
 * Portals to <body> so it anchors to the viewport, not a transformed
 * page/sheet ancestor. The server is authoritative; this is the front door so
 * a free user never reaches the new-camp wizard. The "Upgrade to Pro" CTA
 * opens the existing paywall.
 */
export function CampLimitProGate({ open, onClose }: CampLimitProGateProps) {
  const { openPaywall } = useSubscription();
  // Clear any stuck `body { pointer-events: none }` left by a badly-closed
  // Radix/vaul overlay so this full-screen gate's buttons aren't frozen.
  useClearStuckPointerEvents();
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] h-screen-safe overflow-y-auto overscroll-contain bg-background animate-in fade-in duration-300 pointer-events-auto"
      style={{ pointerEvents: "auto" }}
    >
      <ProUpsellScreen
        title={TITLE}
        blurb={BLURB}
        perks={PERKS}
        onUpgrade={() => {
          triggerHapticSelection();
          openPaywall();
        }}
        onDismiss={onClose}
      />
    </div>,
    document.body,
  );
}
