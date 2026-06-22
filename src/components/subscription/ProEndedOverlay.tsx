import { useState } from "react";
import { useSubscriptionContext } from "@/contexts/SubscriptionContext";
import { ProEndedDialog } from "./ProEndedDialog";

export function ProEndedOverlay() {
  const { showProEnded, dismissProEnded, openPaywall } = useSubscriptionContext();
  // DEV-only visual-QA trigger: load any page with `?proEnded=1` to play the
  // cutscene without a real lapse. Stripped in production builds.
  const [devOpen, setDevOpen] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has("proEnded"),
  );
  const onClose = () => {
    setDevOpen(false);
    dismissProEnded();
  };
  const onReactivate = () => {
    setDevOpen(false);
    dismissProEnded();
    openPaywall();
  };
  return (
    <ProEndedDialog
      open={showProEnded || devOpen}
      onClose={onClose}
      onReactivate={onReactivate}
    />
  );
}
