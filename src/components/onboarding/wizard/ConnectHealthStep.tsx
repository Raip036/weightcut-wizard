/**
 * ConnectHealthStep: onboarding wizard step that wraps the shared
 * ConnectAppleHealthSheet explainer.
 *
 * Inserted between "training frequency" and the next step inside
 * `src/pages/Onboarding.tsx`. Keeps the parent's step-layout / mascot
 * conventions intact: the page owns the StepLayout chrome and just
 * renders this body inside.
 *
 * Behaviour:
 *   - Tapping Connect → triggers the permission sheet via Agent A's
 *     `healthKit.requestPermissions` (handled inside the shared sheet
 *     component) and advances onboarding via `onAdvance` on success.
 *   - Tapping Skip records the prompt-shown timestamp on the profile
 *     (`api.health.recordPromptShown`) so we don't re-nag during the
 *     same onboarding session, then advances.
 *   - Web build / non-iOS: shared sheet renders an "Only available in
 *     the iOS app" panel; Skip becomes the only meaningful action.
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";

import { logger } from "@/lib/logger";
import { api } from "@/../convex/_generated/api";
import { cn } from "@/lib/utils";
import ErrorBoundary from "@/components/ErrorBoundary";

import { ConnectAppleHealthSheet } from "@/components/health/ConnectAppleHealthSheet";

interface ConnectHealthStepProps {
  /** Called after a successful connect OR after the user skips. */
  onAdvance: () => void;
  className?: string;
}

export function ConnectHealthStep(props: ConnectHealthStepProps): JSX.Element {
  // Wrap the inner step so a Convex / render error here doesn't crash the
  // onboarding flow. Onboarding cannot recover from an unwound page boundary,
  // so we render an inline fallback that still advances the wizard.
  return (
    <ErrorBoundary
      fallback={
        <ConnectHealthStepErrorFallback
          onAdvance={props.onAdvance}
          className={props.className}
        />
      }
    >
      <ConnectHealthStepInner {...props} />
    </ErrorBoundary>
  );
}

function ConnectHealthStepInner({
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
      // Non-fatal: UX still advances. Re-nag logic is server-driven so
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

function ConnectHealthStepErrorFallback({
  onAdvance,
  className,
}: {
  onAdvance: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("space-y-4 p-4 text-center", className)}>
      <p className="text-[13px] font-semibold tracking-tight">
        Couldn't load Apple Health setup
      </p>
      <p className="text-[12px] leading-snug text-muted-foreground">
        You can connect Apple Health later from Settings → Apple Health.
      </p>
      <button
        type="button"
        onClick={onAdvance}
        className="h-10 w-full rounded-xs bg-primary text-primary-foreground active:scale-[0.98] transition"
      >
        Continue
      </button>
    </div>
  );
}
