import { useState } from "react";
import { useSubscriptionContext } from "@/contexts/SubscriptionContext";
import { WelcomeProDialog } from "./WelcomeProDialog";

export function WelcomeProOverlay() {
  const { showWelcomePro, dismissWelcomePro } = useSubscriptionContext();
  // DEV-only visual-QA trigger: load any page with `?welcomePro=1` to play the
  // cutscene without a real purchase. Stripped in production builds.
  const [devOpen, setDevOpen] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has("welcomePro"),
  );
  const onClose = () => {
    setDevOpen(false);
    dismissWelcomePro();
  };
  return <WelcomeProDialog open={showWelcomePro || devOpen} onClose={onClose} />;
}
