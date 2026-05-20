import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Capacitor } from "@capacitor/core";
import { ImpactStyle } from "@capacitor/haptics";
import { triggerHaptic, triggerHapticSelection, triggerHapticSuccess, triggerHapticWarning } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { WizardCharacter } from "./WizardCharacter";
import { SpeechBubble } from "./SpeechBubble";
import { TutorialProgressBar } from "./TutorialProgressBar";
import { TutorialNav } from "./TutorialNav";
import { ONBOARDING_SECTIONS } from "./sections";
import type { TutorialStep } from "./types";

interface TutorialStageProps {
  isActive: boolean;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  totalSteps: number;
  activeSteps: TutorialStep[];
  flowId: string | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

class StageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    logger.warn("TutorialStage render error", { error, componentStack: info.componentStack });
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function sectionIdForStep(stepId: string): string | null {
  const match = ONBOARDING_SECTIONS.find((s) => s.stepIds.includes(stepId));
  return match?.id ?? null;
}

function StageInner({
  isActive,
  currentStep,
  currentStepIndex,
  totalSteps,
  activeSteps,
  flowId,
  onNext,
  onPrev,
  onSkip,
}: TutorialStageProps) {
  const [bubbleComplete, setBubbleComplete] = useState(false);
  const [forceComplete, setForceComplete] = useState(false);
  const prevSectionRef = useRef<string | null>(null);
  const successFiredRef = useRef(false);

  const isLastStep = currentStepIndex === totalSteps - 1;

  useEffect(() => {
    successFiredRef.current = false;
  }, [currentStep?.id]);

  useEffect(() => {
    if (isLastStep && bubbleComplete && !successFiredRef.current) {
      successFiredRef.current = true;
      triggerHapticSuccess();
    }
  }, [isLastStep, bubbleComplete]);

  useEffect(() => {
    if (!isActive) return;
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    return () => {
      StatusBar.setStyle({ style: Style.Default }).catch(() => {});
    };
  }, [isActive]);

  useEffect(() => {
    setBubbleComplete(false);
    setForceComplete(false);
    if (!currentStep || flowId !== "onboarding") return;
    const sectionId = sectionIdForStep(currentStep.id);
    if (sectionId && prevSectionRef.current && sectionId !== prevSectionRef.current) {
      triggerHaptic(ImpactStyle.Medium);
    } else if (prevSectionRef.current !== null) {
      triggerHaptic(ImpactStyle.Light);
    }
    prevSectionRef.current = sectionId;
  }, [currentStep?.id, flowId]);

  const handleBackdropTap = useCallback(() => {
    if (!bubbleComplete) {
      setForceComplete(true);
    } else {
      onNext();
    }
  }, [bubbleComplete, onNext]);

  const handleNext = useCallback(() => {
    triggerHapticSelection();
    onNext();
  }, [onNext]);

  const handleSkip = useCallback(() => {
    triggerHapticWarning();
    onSkip();
  }, [onSkip]);

  if (!isActive || !currentStep) return null;

  const isFirstStep = currentStepIndex === 0;

  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: 10003, width: "100vw", height: "100dvh" }}
      aria-live="polite"
      aria-label="Tutorial"
    >
      <motion.div
        className="absolute inset-0"
        style={{ background: "transparent" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={handleBackdropTap}
      />

      {/* Skip pill, top-right, screen-relative. Brand-tinted Void surface
          + glass blur (Design System v1) so it sits visibly on any page
          background without screaming for attention. */}
      <button
        type="button"
        onClick={handleSkip}
        aria-label="Skip tutorial"
        className="absolute z-10 flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-neutral-200"
        style={{
          top: "calc(env(safe-area-inset-top) + 14px)",
          right: "calc(env(safe-area-inset-right) + 14px)",
          background: "rgba(8, 12, 20, 0.62)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        Skip
      </button>

      {flowId === "onboarding" && (
        <div className="absolute inset-x-0 top-0">
          <TutorialProgressBar activeSteps={activeSteps} currentStepIndex={currentStepIndex} />
        </div>
      )}

      <div
        className="absolute left-4 flex flex-col items-start gap-3"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)", pointerEvents: "auto" }}
      >
        <AnimatePresence mode="wait">
          <SpeechBubble
            key={currentStep.id}
            revealKey={currentStep.id}
            headline={currentStep.title}
            body={currentStep.description}
            pace={currentStep.voicePace}
            forceComplete={forceComplete}
            onTypingComplete={() => setBubbleComplete(true)}
          />
        </AnimatePresence>

        <motion.div
          key={`hop-${currentStep.id}`}
          animate={{ y: [0, -10, 0], scaleY: [1, 0.94, 1] }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <WizardCharacter pose={currentStep.wizardPose ?? "idle"} />
        </motion.div>

        <TutorialNav
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          onBack={onPrev}
          onNext={handleNext}
        />
      </div>
    </div>,
    document.body,
  );
}

export function TutorialStage(props: TutorialStageProps) {
  return (
    <StageErrorBoundary>
      <StageInner {...props} />
    </StageErrorBoundary>
  );
}
