import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { VolumeX, Volume2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { SpeechBubble } from "@/tutorial/SpeechBubble";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { getLine } from "./onboardingDialogue";

interface OnboardingWizardMascotProps {
  step: number;
  branch: "cutting" | "losing";
  fightSubStep?: number;
  hidden?: boolean;
}

const MUTE_STORAGE_KEY = "wcw_wizard_muted";
// Per-step dismiss key prefix. We remember which step the user explicitly
// hid the bubble on (via the X button) so reopening the same step doesn't
// re-show it, but advancing to the next step still gets a fresh greeting.
const DISMISSED_STEP_KEY = "wcw_wizard_dismissed_step";

function readMutedInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

async function lightHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod = await import("@capacitor/haptics");
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch {
    // Plugin not installed or failed — degrade silently.
  }
}

export function OnboardingWizardMascot({
  step,
  branch,
  fightSubStep,
  hidden,
}: OnboardingWizardMascotProps): JSX.Element | null {
  const prefersReduced = useReducedMotion();
  // Always render in corner mode (bottom-left). Step 1 used to use the
  // mid-screen "hero" layout but it competed with the goal-type picker
  // cards; corner keeps the mascot consistent across every step.
  const mode: "hero" | "corner" = "corner";

  const [muted, setMuted] = useState<boolean>(() => readMutedInitial());
  const [bubbleOpen, setBubbleOpen] = useState<boolean>(() => {
    // Step 1 always opens on mount; subsequent steps respect muted flag.
    if (step === 1) return true;
    return !readMutedInitial();
  });
  const [forceComplete, setForceComplete] = useState<boolean>(false);
  const [typingDone, setTypingDone] = useState<boolean>(false);

  const line = useMemo(
    () => getLine({ step, branch, fightSubStep }),
    [step, branch, fightSubStep],
  );

  const revealKey = `${branch}:${step}:${fightSubStep ?? 0}`;

  // Step change: reset typewriter + reopen bubble UNLESS the user
  // explicitly dismissed *this* step via the X. (Dismissals are per-step,
  // so the next step still gets a fresh greeting.) We removed the
  // 3-second auto-collapse — the wizard stays on the page so the user
  // can re-read the line at any time during the step.
  useEffect(() => {
    setForceComplete(false);
    setTypingDone(false);
    if (muted) return;
    let dismissedForThisStep = false;
    try {
      dismissedForThisStep =
        window.sessionStorage.getItem(DISMISSED_STEP_KEY) === revealKey;
    } catch {
      // Storage blocked — treat as not-dismissed.
    }
    if (!dismissedForThisStep) {
      setBubbleOpen(true);
      if (mode === "corner") {
        void lightHaptic();
      }
    }
    // We intentionally omit `muted` & `mode` from deps — toggling mute mid-step
    // should not retrigger an open; only step transitions do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fightSubStep, branch, revealKey]);

  // Note: we intentionally do NOT close the bubble on input focus.
  // The bubble lives at the bottom-left so the iOS keyboard / native date
  // picker naturally covers it while the user types, then reveals it
  // again when they dismiss. Hiding programmatically meant users lost
  // their place mid-typing.

  const handleTypingComplete = useCallback((): void => {
    setTypingDone(true);
    // No auto-collapse. The bubble stays open until the step advances or
    // the user explicitly dismisses it (X button / mascot tap).
  }, []);

  // Tapping the bubble itself skips the typewriter; it does NOT dismiss
  // the bubble. Dismissing is reserved for the explicit X button so the
  // text never disappears just because the user happened to tap near it.
  const handleBubbleTap = useCallback((): void => {
    if (!typingDone) {
      setForceComplete(true);
    }
  }, [typingDone]);

  // Explicit dismiss — wired to the X button on the bubble. Remembers
  // which step was dismissed so a re-render in the same step doesn't
  // re-pop the bubble. Advancing to the next step clears the gate.
  const handleBubbleClose = useCallback((): void => {
    setBubbleOpen(false);
    try {
      window.sessionStorage.setItem(DISMISSED_STEP_KEY, revealKey);
    } catch {
      // Storage blocked — in-memory state still reflects the dismiss.
    }
  }, [revealKey]);

  const handleMascotTap = useCallback((): void => {
    if (mode === "hero") return;
    if (bubbleOpen) {
      // Tapping the mascot while bubble is open hides it (same intent
      // as the X). Record the per-step dismiss so it doesn't re-pop.
      setBubbleOpen(false);
      try {
        window.sessionStorage.setItem(DISMISSED_STEP_KEY, revealKey);
      } catch {
        // Storage blocked — fall through.
      }
      return;
    }
    // Tapping the mascot while bubble is closed re-summons it. Clear the
    // dismiss gate so the user can deliberately bring the line back.
    try {
      window.sessionStorage.removeItem(DISMISSED_STEP_KEY);
    } catch {
      // Storage blocked — fall through.
    }
    setForceComplete(false);
    setTypingDone(false);
    setBubbleOpen(true);
    void lightHaptic();
  }, [mode, bubbleOpen, revealKey]);

  const toggleMute = useCallback((): void => {
    setMuted((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? "true" : "false");
      } catch {
        // Storage blocked — keep in-memory state only.
      }
      if (next) {
        // Muting closes any open bubble immediately.
        setBubbleOpen(false);
      }
      return next;
    });
  }, []);

  if (hidden) return null;

  const pose = line.pose ?? (step === 1 ? "wave" : "idle");
  const variant = line.variant ?? "3d";

  if (mode === "hero") {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-30 flex flex-col items-center"
        style={{ top: "25vh" }}
      >
        <div className="pointer-events-auto">
          <WizardCharacter pose={pose} variant={variant} />
        </div>
        <div className="pointer-events-auto mt-3 w-full flex justify-center px-4">
          <AnimatePresence mode="wait">
            {bubbleOpen && (
              // `div` (not `button`) so the inline X close button inside
              // the bubble is valid HTML. Skip-typewriter is wired via
              // role="button" + onClick + keyboard handler.
              <motion.div
                key={revealKey}
                role="button"
                tabIndex={0}
                onClick={handleBubbleTap}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleBubbleTap();
                  }
                }}
                className="cursor-pointer"
                aria-label="Wizard message"
                initial={prefersReduced ? { opacity: 0 } : undefined}
                animate={prefersReduced ? { opacity: 1 } : undefined}
                exit={prefersReduced ? { opacity: 0 } : undefined}
                transition={prefersReduced ? { duration: 0.12 } : undefined}
              >
                <SpeechBubble
                  headline={line.headline}
                  body={line.body}
                  revealKey={revealKey}
                  forceComplete={forceComplete}
                  onTypingComplete={handleTypingComplete}
                  onClose={handleBubbleClose}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // Corner mode — mascot anchored bottom-LEFT (mirroring the tutorial's
  // layout), bubble peeking out to the RIGHT of the mascot with its tail
  // pointing back at the wizard. Row layout (mascot + bubble side-by-side)
  // gives the bubble room to breathe so it renders as a proper wide
  // speech bubble instead of a thin column squeezed against a screen edge.
  return (
    <div
      className="pointer-events-none fixed z-30 flex flex-row items-end gap-2"
      style={{
        left: "12px",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        // Leave room for the bubble to the right of the mascot. The
        // container is `pointer-events-none` so the page underneath is
        // still tappable; each child opts back in.
        right: "12px",
      }}
    >
      {/* Mascot column: 56×56 (scaled down WizardCharacter) + mute toggle */}
      <div className="pointer-events-auto flex flex-col items-center" style={{ width: 56 }}>
        <div className="relative" style={{ width: 56, height: 56 }}>
          <div
            style={{
              width: 140,
              height: 140,
              transform: "scale(0.4)",
              transformOrigin: "bottom left",
              position: "absolute",
              bottom: 0,
              left: 0,
            }}
          >
            <WizardCharacter pose={pose} variant={variant} onTap={handleMascotTap} />
          </div>
        </div>

        {/* Mute toggle below mascot */}
        <button
          type="button"
          onClick={toggleMute}
          className="mt-1 flex h-5 w-5 items-center justify-center bg-transparent text-muted-foreground/60 hover:text-muted-foreground"
          aria-label={muted ? "Unmute wizard" : "Mute wizard"}
          aria-pressed={muted}
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Bubble: anchored to the RIGHT of the mascot, tail pointing left
          back at the wizard. `div` (not `button`) so the X close button
          inside the bubble is valid HTML. */}
      <div className="pointer-events-auto flex-1 min-w-0">
        <AnimatePresence>
          {bubbleOpen && (
            <motion.div
              key={revealKey}
              role="button"
              tabIndex={0}
              onClick={handleBubbleTap}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleBubbleTap();
                }
              }}
              className="cursor-pointer"
              aria-label="Wizard message"
              initial={prefersReduced ? { opacity: 0 } : undefined}
              animate={prefersReduced ? { opacity: 1 } : undefined}
              exit={prefersReduced ? { opacity: 0 } : undefined}
              transition={prefersReduced ? { duration: 0.12 } : undefined}
            >
              <SpeechBubble
                headline={line.headline}
                body={line.body}
                revealKey={revealKey}
                forceComplete={forceComplete}
                onTypingComplete={handleTypingComplete}
                onClose={handleBubbleClose}
                tailSide="left"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
