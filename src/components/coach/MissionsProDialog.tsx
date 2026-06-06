import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

interface MissionsProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The value story for Training Missions, shown before the paywall. */
const PERKS = [
  "Reads your training notes",
  "Turns them into missions to improve",
  "Suggests new paths so you never plateau",
  "Tracks XP & levels per discipline",
];

/**
 * Full-screen animated explainer for the Training Missions Pro feature.
 *
 * A thin wrapper over the shared {@link ProExplainerOverlay} so the missions
 * copy lives in one place. Reused by both the Camp upsell row and the
 * `LockedMissionCard`.
 */
export function MissionsProDialog({ open, onOpenChange }: MissionsProDialogProps) {
  return (
    <ProExplainerOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="Training Missions is a Pro feature"
      blurb="Your AI corner turns every session note into a plan that keeps you improving."
      perks={PERKS}
    />
  );
}
