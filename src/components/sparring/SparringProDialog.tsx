import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

interface SparringProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The value story for the Sparring To-Do List, shown before the paywall. */
const PERKS = [
  "Reads the techniques you log",
  "Builds a per-discipline sparring checklist",
  "Setups and counters for every move",
  "Refreshes as you keep training",
];

/**
 * Full-screen animated explainer for the Sparring To-Do List Pro feature.
 *
 * A thin wrapper over the shared {@link ProExplainerOverlay} so the sparring
 * copy lives in one place — mirrors {@link MissionsProDialog}.
 */
export function SparringProDialog({ open, onOpenChange }: SparringProDialogProps) {
  return (
    <ProExplainerOverlay
      open={open}
      onOpenChange={onOpenChange}
      title="Sparring To-Do List is a Pro feature"
      blurb="Your AI corner turns the techniques you log into a tickable game-plan for your next sparring session."
      perks={PERKS}
    />
  );
}
