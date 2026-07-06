import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

interface NutritionProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The value story for AI meal tracking, shown before the paywall. */
const PERKS = [
  "Snap a photo and AI reads the plate",
  "Describe it in plain words, no scales",
  "Hands-free voice logging",
  "Accurate calories & macros in seconds",
];

/**
 * Full-screen animated explainer for the AI meal tracking Pro feature.
 *
 * A thin wrapper over the shared {@link ProExplainerOverlay} so the nutrition
 * copy lives in one place.
 */
export function NutritionProDialog({ open, onOpenChange }: NutritionProDialogProps) {
  return (
    <ProExplainerOverlay
      open={open}
      onOpenChange={onOpenChange}
      source="meal_tracking"
      title="AI meal tracking is a Pro feature"
      blurb="Stop weighing and guessing. Snap a photo or just say what you ate, and your AI corner logs the calories and macros for you."
      perks={PERKS}
    />
  );
}
