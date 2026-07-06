import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

interface WeightProtocolProDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The value story for the fight-week protocol, shown before the paywall. */
const PERKS = [
  "Hour-by-hour rehydration timeline",
  "DIY ORS recipe tuned to your body",
  "Day-by-day fight-week cut plan",
  "Weigh-in day spotlight + refuel",
];

/**
 * Full-screen animated explainer for the Weight Protocol Pro feature.
 *
 * A thin wrapper over the shared {@link ProExplainerOverlay} so the fight-week
 * protocol copy lives in one place.
 */
export function WeightProtocolProDialog({ open, onOpenChange }: WeightProtocolProDialogProps) {
  return (
    <ProExplainerOverlay
      open={open}
      onOpenChange={onOpenChange}
      source="weight_protocol_explainer"
      title="Unlock your fight-week plan"
      blurb="Your AI corner builds a science-backed cut and rehydration plan tuned to your exact fight metrics."
      perks={PERKS}
    />
  );
}
