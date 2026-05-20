/**
 * ConnectHealthStep — onboarding wizard step that wraps the shared
 * ConnectAppleHealthSheet explainer.
 *
 * Inserted between "training frequency" and the next step inside
 * `src/pages/Onboarding.tsx`. Keeps the parent's step-layout / mascot
 * conventions intact — the page owns the StepLayout chrome and just
 * renders this body inside.
 *
 * Behaviour:
 *   - Tapping Connect → triggers the permission sheet via Agent A's
 *     `healthKit.requestPermissions` (handled inside the shared sheet
 *     component) and advances onboarding via `onAdvance` on success.
 *   - Tapping Skip → records the prompt-shown timestamp on the profile
 *     (`api.health.recordPromptShown`) so we don't re-nag during the
 *     same onboarding session, then advances.
 *   - Web build / non-iOS → shared sheet renders an "Only available in
 *     the iOS app" panel; Skip becomes the only meaningful action.
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";

import { logger } from "@/lib/logger";
import { api } from "@/../convex/_generated/api";

import { ConnectAppleHealthSheet } from "@/components/health/ConnectAppleHealthSheet";

interface ConnectHealthStepProps {
  /** Called after a successful connect OR after the user skips. */
  onAdvance: () => void;
  className?: string;
}

export function ConnectHealthStep({
  onAdvance,
  className,
}: ConnectHealthStepProps): JSX.Element {
  const recordPromptShown = useMutation(api.health.recordPromptShown);

  const handleConnected = useCallback(() => {
    onAdvance();
  }, [onAdvance]);

  const handleSkip = useCallback(async () => {
    try {
      if (recordPromptShown) {
        await recordPromptShown({});
      }
    } catch (err) {
      // Non-fatal — UX still advances. Re-nag logic is server-driven so
      // a missed write at most means we'll show this screen again on
      // the next sign-in.
      logger.warn("recordPromptShown failed", err);
    }
    onAdvance();
  }, [recordPromptShown, onAdvance]);

  return (
    <ConnectAppleHealthSheet
      context="onboarding"
      onConnected={handleConnected}
      onSkip={handleSkip}
      className={className}
    />
  );
}
