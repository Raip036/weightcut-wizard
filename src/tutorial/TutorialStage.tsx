import React, { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { isNativePlatform } from "@/hooks/useIsNative";
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
  const lastSpotGeomRef = useRef<{ cx: number; cy: number; r: number; w?: number; h?: number } | null>(null);

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

    let observed = false;
    let rafId = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Commit a new rect only when it has moved meaningfully. Scroll fires
    // the handler up to once per frame and the target's viewport rect
    // shifts as the page scrolls, but identical/sub-pixel rects would
    // still force a full overlay re-render (SVG mask + Framer re-eval) for
    // no visible change — so we bail out when nothing moved.
    const commit = (rect: DOMRect) => {
      setSpotlightRect((prev) => {
        if (
          prev &&
          Math.abs(prev.left - rect.left) < 0.5 &&
          Math.abs(prev.top - rect.top) < 0.5 &&
          Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) {
          return prev;
        }
        return rect;
      });
    };

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tutorial="${selector}"]`);
      if (el) {
        commit(el.getBoundingClientRect());
        // Attach the ResizeObserver lazily — the target may not have
        // existed at effect-mount time (e.g. it lives inside a sheet
        // that opens via `actionEventName`). Once we find the element
        // we observe it so subsequent layout shifts re-measure.
        if (!observed) {
          ro.observe(el);
          observed = true;
        }
      }
    };

    // Coalesce high-frequency events (scroll / resize / ResizeObserver)
    // into a single measurement per animation frame. Without this, a
    // single scroll swipe fires getBoundingClientRect + setState dozens of
    // times per frame (layout thrashing) — the main source of scroll jank.
    const scheduleMeasure = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    };

    // Declared after `measure`/`scheduleMeasure` (which it closes over);
    // `measure` only runs via the timers/listeners below, after init.
    const ro = new ResizeObserver(scheduleMeasure);

    // Retry the lookup a few times at 100 ms intervals so steps whose
    // target appears asynchronously (sheet slide-up, lazy-loaded page,
    // etc.) still resolve. Initial 80 ms delay matches the prior
    // post-navigation paint allowance.
    const RETRY_DELAYS_MS = [80, 180, 280, 380, 480];
    RETRY_DELAYS_MS.forEach((delay) => {
      timers.push(setTimeout(measure, delay));
    });

    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });

    return () => {
      timers.forEach(clearTimeout);
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
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

  // Stable so the memoized SpeechBubble doesn't re-render every time the
  // overlay re-renders (e.g. on each scroll frame while the spotlight tracks).
  const handleTypingComplete = useCallback(() => setBubbleComplete(true), []);

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

      {/* Single persistent scrim + spotlight — never unmounts so there is
          no flash when moving between spotlight-on and spotlight-off steps.
          The circle in the mask scales from 0→1 (iris open) when active
          and the scrim rect crossfades its opacity between 0.55 and 0.88. */}
      {(() => {
        const hasSpotlight = !!currentStep?.spotlight;
        const isRect = currentStep?.spotlightShape === "rect";
        const spotPad = currentStep?.spotlightPadding ?? SPOTLIGHT_PADDING;
        const cutoutOpen = hasSpotlight && !!spotlightRect;
        const cx = spotlightRect
          ? spotlightRect.left + spotlightRect.width / 2 + (currentStep?.spotlightOffset?.x ?? 0)
          : (lastSpotGeomRef.current?.cx ?? 0);
        const cy = spotlightRect
          ? spotlightRect.top + spotlightRect.height / 2 + (currentStep?.spotlightOffset?.y ?? 0)
          : (lastSpotGeomRef.current?.cy ?? 0);
        const r = spotlightRect
          ? Math.max(spotlightRect.width, spotlightRect.height) / 2 + spotPad
          : (lastSpotGeomRef.current?.r ?? 100);
        const rectW = spotlightRect
          ? spotlightRect.width + 2 * spotPad
          : (lastSpotGeomRef.current?.w ?? 200);
        const rectH = spotlightRect
          ? spotlightRect.height + 2 * spotPad
          : (lastSpotGeomRef.current?.h ?? 80);
        if (spotlightRect) lastSpotGeomRef.current = { cx, cy, r, w: rectW, h: rectH };
        return (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <svg
              className="absolute inset-0"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
            >
              <defs>
                <mask id="wcw-spotlight-mask">
                  <rect x="-9999" y="-9999" width="19999" height="19999" fill="white" />
                  <motion.g
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                    animate={{ scale: cutoutOpen ? 1 : 0 }}
                    transition={cutoutOpen
                      ? { delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }
                      : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {isRect ? (
                      <rect
                        x={cx - rectW / 2}
                        y={cy - rectH / 2}
                        width={Math.max(rectW, 1)}
                        height={Math.max(rectH, 1)}
                        rx={14}
                        ry={14}
                        fill="black"
                      />
                    ) : (
                      <circle cx={cx} cy={cy} r={Math.max(r, 1)} fill="black" />
                    )}
                  </motion.g>
                </mask>
              </defs>
              <motion.g
                animate={{ opacity: cutoutOpen ? 0.88 : 0.55 }}
                transition={{ duration: 0.3 }}
              >
                <rect x="-9999" y="-9999" width="19999" height="19999" fill="rgb(5, 8, 20)" mask="url(#wcw-spotlight-mask)" />
              </motion.g>
            </svg>
          </motion.div>
        );
      })()}

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
          // On native iOS, backdrop-filter forces a per-frame GPU
          // re-rasterization of the page behind the pill during any scroll.
          // Swap the blur for a near-opaque solid so the pill still reads on
          // any background without the compositing cost. Web keeps the glass.
          background: isNativePlatform ? "rgba(12, 17, 27, 0.95)" : "rgba(8, 12, 20, 0.62)",
          backdropFilter: isNativePlatform ? undefined : "blur(20px) saturate(160%)",
          WebkitBackdropFilter: isNativePlatform ? undefined : "blur(20px) saturate(160%)",
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

      {/* Wizard + bubble column.
          A single AnimatePresence (mode="popLayout", keyed to step id) fades
          the entire column — wizard AND bubble — in and out on every step
          change. This gives a consistent, direction-agnostic transition that
          works identically when going forward or back:
            • Old content fades out while being removed from layout flow.
            • New content fades in at the new position.
          No layoutId is needed; the position jump between steps is hidden
          by the simultaneous fade. */}
      {(() => {
        const isRight = currentStep.wizardSide === "right";
        const wizardFirst =
          (!!currentStep.spotlight || currentStep.wizardAnchor === "top") &&
          !currentStep.bubbleFirst;
        const tailSide = wizardFirst
          ? isRight ? ("top-right" as const) : ("top-left" as const)
          : isRight ? ("bottom-right" as const) : ("bottom-left" as const);

        // Column anchor position. For wizardAboveSpotlight, fall back to
        // lastSpotGeomRef when spotlightRect hasn't been measured yet so the
        // wizard doesn't snap from a far-off default on step entry.
        const colStyle: React.CSSProperties = (() => {
          if (currentStep.wizardAnchor === "top") {
            return { top: "calc(env(safe-area-inset-top) + 56px)", pointerEvents: "auto" };
          }
          if (currentStep.wizardAboveSpotlight) {
            let approxTop: number | null = null;
            if (spotlightRect) {
              approxTop = spotlightRect.top;
            } else if (lastSpotGeomRef.current) {
              const { cy, h } = lastSpotGeomRef.current;
              approxTop = cy - (h ?? 80) / 2;
            }
            if (approxTop !== null) {
              const fromBottom = Math.min(
                window.innerHeight - approxTop + 20,
                window.innerHeight - 260,
              );
              return { bottom: `${fromBottom}px`, pointerEvents: "auto" };
            }
          }
          return {
            bottom: currentStep.wizardBottomOffset ?? "calc(env(safe-area-inset-bottom) + 100px)",
            pointerEvents: "auto",
          };
        })();

        const colClass = isRight
          ? "absolute right-4 flex flex-col items-end gap-3"
          : "absolute left-4 flex flex-col items-start gap-3";

        return (
          <div className={colClass} style={colStyle}>
            <AnimatePresence mode="popLayout">
              <motion.div
                key={currentStep.id}
                className={`flex flex-col ${isRight ? "items-end" : "items-start"} gap-3`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeInOut" }}
              >
                {wizardFirst ? (
                  <>
                    <motion.div
                      animate={{ y: [0, -10, 0], scaleY: [1, 0.94, 1] }}
                      transition={{ duration: 0.28, ease: "easeOut" }}
                    >
                      <WizardCharacter pose={currentStep.wizardPose ?? "idle"} />
                    </motion.div>
                    <SpeechBubble
                      revealKey={currentStep.id}
                      headline={currentStep.title}
                      body={currentStep.description}
                      pace={currentStep.voicePace}
                      forceComplete={forceComplete}
                      onTypingComplete={handleTypingComplete}
                      tailSide={tailSide}
                    />
                  </>
                ) : (
                  <>
                    <SpeechBubble
                      revealKey={currentStep.id}
                      headline={currentStep.title}
                      body={currentStep.description}
                      pace={currentStep.voicePace}
                      forceComplete={forceComplete}
                      onTypingComplete={handleTypingComplete}
                      tailSide={tailSide}
                    />
                    <motion.div
                      animate={{ y: [0, -10, 0], scaleY: [1, 0.94, 1] }}
                      transition={{ duration: 0.28, ease: "easeOut" }}
                    >
                      <WizardCharacter pose={currentStep.wizardPose ?? "idle"} />
                    </motion.div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        );
      })()}

      {/* Tutorial nav — its OWN absolute container outside the
          left-anchored speech-bubble column. `inset-x-0 flex
          justify-center` centers the Back/Next row on the viewport,
          so its horizontal position no longer depends on the speech
          bubble's width (which previously made the row appear at
          different left positions on different steps). */}
      <div
        className="absolute inset-x-0 flex justify-center px-4"
        style={{ bottom: currentStep.navBottomOffset ?? "calc(env(safe-area-inset-bottom) + 16px)", pointerEvents: "auto" }}
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

// Memoized: the TutorialProvider wraps the whole app and re-renders on
// unrelated context churn. Props here (step data + useCallback handlers) only
// change when the tutorial actually advances, so memo skips those re-renders.
export const TutorialStage = React.memo(function TutorialStage(props: TutorialStageProps) {
  return (
    <StageErrorBoundary>
      <StageInner {...props} />
    </StageErrorBoundary>
  );
});
