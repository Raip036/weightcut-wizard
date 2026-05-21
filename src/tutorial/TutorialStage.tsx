import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
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

/** Padding (px) added around the spotlight element on each side. */
const SPOTLIGHT_PADDING = 10;
/** Border-radius (px) of the spotlight cutout. */
const SPOTLIGHT_RADIUS = 24;

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
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
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

  // Measure the spotlight target element and keep it up-to-date.
  useEffect(() => {
    const selector = currentStep?.spotlight;
    if (!selector) {
      setSpotlightRect(null);
      return;
    }

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tutorial="${selector}"]`);
      if (el) setSpotlightRect(el.getBoundingClientRect());
    };

    // Delay first measure so the page has painted after any navigation.
    const t = setTimeout(measure, 80);

    const ro = new ResizeObserver(measure);
    const el = document.querySelector<HTMLElement>(`[data-tutorial="${selector}"]`);
    if (el) ro.observe(el);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });

    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [currentStep?.spotlight, currentStep?.id]);

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
      {/* Backdrop — click-to-advance handler covering the full screen. */}
      <div className="absolute inset-0" onClick={handleBackdropTap} />

      {/* Scrim / spotlight overlay.
          - No spotlight: plain semi-transparent scrim.
          - Spotlight active: SVG mask that renders the scrim everywhere
            except a rounded-rect window over the target element.
            maskUnits default (objectBoundingBox) is fine because we let
            the mask content use userSpaceOnUse (the default for
            maskContentUnits) so pixel coords from getBoundingClientRect
            map directly to SVG user space. */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        {spotlightRect ? (
          <motion.svg
            key={`spot-${currentStep?.id}`}
            className="absolute inset-0"
            style={{ width: "100%", height: "100%", overflow: "visible" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <defs>
              <mask id="wcw-spotlight-mask">
                {/* White = opaque overlay; black = transparent cutout */}
                <rect x="-9999" y="-9999" width="19999" height="19999" fill="white" />
                <circle
                  cx={spotlightRect.left + spotlightRect.width / 2 + (currentStep?.spotlightOffset?.x ?? 0)}
                  cy={spotlightRect.top + spotlightRect.height / 2 + (currentStep?.spotlightOffset?.y ?? 0)}
                  r={Math.max(spotlightRect.width, spotlightRect.height) / 2 + SPOTLIGHT_PADDING}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="-9999" y="-9999"
              width="19999" height="19999"
              fill="rgba(5, 8, 20, 0.88)"
              mask="url(#wcw-spotlight-mask)"
            />
          </motion.svg>
        ) : (
          <div className="absolute inset-0" style={{ background: "rgba(5, 8, 20, 0.55)" }} />
        )}
      </motion.div>

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

      {/* LayoutGroup scopes the wizard's layoutId so it animates smoothly
          between spotlight (above bubble) and default (below bubble) positions
          rather than snapping. The hop animation lives on a nested div to
          compose independently of the layout position tween. */}
      <LayoutGroup id="tutorial-bottom">
        <div
          className="absolute left-4 flex flex-col items-start gap-3"
          /* Bottom offset = safe-area + nav row (~64px) + breathing room (36px)
             so the speech bubble's bottom edge sits well above the Back/Next
             buttons rather than crowding them. */
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 100px)", pointerEvents: "auto" }}
        >
          {currentStep.spotlight ? (
            /* Spotlight: wizard on top so bubble sits lower, clear of ring. */
            <>
              <motion.div
                layoutId="wcw-wizard"
                layout
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <motion.div
                  key={`hop-${currentStep.id}`}
                  animate={{ y: [0, -10, 0], scaleY: [1, 0.94, 1] }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  <WizardCharacter pose={currentStep.wizardPose ?? "idle"} />
                </motion.div>
              </motion.div>

              <AnimatePresence mode="wait">
                <SpeechBubble
                  key={currentStep.id}
                  revealKey={currentStep.id}
                  headline={currentStep.title}
                  body={currentStep.description}
                  pace={currentStep.voicePace}
                  forceComplete={forceComplete}
                  onTypingComplete={() => setBubbleComplete(true)}
                  tailSide="top-left"
                />
              </AnimatePresence>
            </>
          ) : (
            /* Default: bubble on top, wizard below. */
            <>
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
                layoutId="wcw-wizard"
                layout
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <motion.div
                  key={`hop-${currentStep.id}`}
                  animate={{ y: [0, -10, 0], scaleY: [1, 0.94, 1] }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  <WizardCharacter pose={currentStep.wizardPose ?? "idle"} />
                </motion.div>
              </motion.div>
            </>
          )}

        </div>
      </LayoutGroup>

      {/* Tutorial nav — its OWN absolute container outside the
          left-anchored speech-bubble column. `inset-x-0 flex
          justify-center` centers the Back/Next row on the viewport,
          so its horizontal position no longer depends on the speech
          bubble's width (which previously made the row appear at
          different left positions on different steps). */}
      <div
        className="absolute inset-x-0 flex justify-center px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)", pointerEvents: "auto" }}
      >
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
