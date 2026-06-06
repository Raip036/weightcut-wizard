import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

interface RoutineGenProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The value story for the AI routine builder, shown before the paywall. */
const PERKS = [
  "Full multi-day routines built from your goal",
  "Smart splits — upper/lower, push/pull/legs",
  "Matched to your sport & experience level",
  "Regenerate or tweak any routine anytime",
];

/**
 * Animated Pro explainer for the AI Routine Builder. Tapping the locked
 * "AI Routines" button opens this so free users see the value before the
 * paywall. A thin wrapper over the shared {@link ProExplainerOverlay}.
 */
export function RoutineGenProDialog({ open, onOpenChange }: RoutineGenProDialogProps) {
  return (
    <ProExplainerOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="AI Routine Builder is a Pro feature"
      blurb="Tell the coach your goal and it writes you a complete, structured training plan."
      perks={PERKS}
    />
  );
}
