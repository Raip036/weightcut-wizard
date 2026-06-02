// WP-T21 — ProtocolGeneratingOverlay
//
// Replaces the static skeleton on the WeightProtocol page during the
// 5–15s generation window. The page no longer "looks frozen": the
// WizardCharacter mascot pose-cycles, and a 4-step text list advances
// on a fixed cadence so the user always sees progress, even though
// we don't have real progress signals from the action.
//
// Cadence:
//   • Wizard pose cycle:   wave → point → celebrate → wave (~2.4s)
//   • Step progression:    advance every ~3.4s, the final step pulses
//                          indefinitely once reached (handles slow
//                          generations gracefully past ~15s).
//
// Reduced motion:
//   • Wizard stays on `wave` (no pose cycling, but the WizardCharacter
//     itself already drops its internal animations under prefers-reduced).
//   • Steps still advance (so the user sees forward motion), but the
//     active-dot pulse + ink-fade transitions are disabled.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import type { WizardPose } from "@/tutorial/types";

export interface ProtocolGeneratingOverlayProps {
  /** Tier tone for the soft gradient background. Defaults to "primary". */
  tone?: "green" | "amber" | "red" | "primary";
  className?: string;
}

// Pose cycle — uses the three WizardPose values that read as "working
// on it" / "thinking" / "presenting". `idle` is skipped so the mascot
// never appears static while we wait.
const POSE_CYCLE: ReadonlyArray<WizardPose> = ["wave", "point", "celebrate"];
const POSE_INTERVAL_MS = 2400;

// Step copy — kept in-file (per-feature; no other surface uses these).
const STEPS: ReadonlyArray<string> = [
  "Analyzing your body and training load...",
  "Computing weight loss math...",
  "Drafting your day-by-day plan...",
  "Tuning your rehydration timeline...",
];
const STEP_INTERVAL_MS = 3400;

// Tier → soft gradient classes. Mirrors the TodaysActionHero stripe
// palette but rendered as a low-opacity radial wash behind the wizard.
function toneGradientClass(tone: ProtocolGeneratingOverlayProps["tone"]): string {
  switch (tone) {
    case "green":
      return "from-func-recovery-green/15 via-func-recovery-green/5 to-transparent";
    case "amber":
      return "from-func-warning-yellow/15 via-func-warning-yellow/5 to-transparent";
    case "red":
      return "from-func-danger-red/15 via-func-danger-red/5 to-transparent";
    case "primary":
    default:
      return "from-primary/15 via-primary/5 to-transparent";
  }
}

export function ProtocolGeneratingOverlay({
  tone = "primary",
  className = "",
}: ProtocolGeneratingOverlayProps) {
  const prefersReduced = useReducedMotion();

  // ── Wizard pose cycling ──────────────────────────────────────────
  const [poseIdx, setPoseIdx] = useState(0);
  useEffect(() => {
    if (prefersReduced) return;
    const t = setInterval(() => {
      setPoseIdx((i) => (i + 1) % POSE_CYCLE.length);
    }, POSE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [prefersReduced]);
  const pose = POSE_CYCLE[poseIdx];

  // ── Step progression ─────────────────────────────────────────────
  // `activeStep` is the index of the currently-running step. Indices
  // below it are done (rendered with a ✓). When activeStep reaches
  // STEPS.length - 1, we stop advancing — the final step keeps pulsing
  // until the parent un-mounts us.
  const [activeStep, setActiveStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setActiveStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  const gradient = useMemo(() => toneGradientClass(tone), [tone]);

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={cn(
        "relative overflow-hidden card-surface rounded-2xl border border-border/50 p-6",
        className,
      )}
      aria-live="polite"
      aria-busy="true"
      aria-label="Generating your weight protocol"
    >
      {/* Soft tier-tinted radial wash behind the wizard. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-0 bg-gradient-to-b pointer-events-none",
          gradient,
        )}
      />

      <div className="relative z-10 flex flex-col items-center">
        {/* Wizard — pose crossfade. AnimatePresence keys on `pose` so each
            pose mounts/unmounts with a 400ms opacity transition. */}
        <div className="relative h-[150px] w-[150px] flex items-center justify-center">
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={pose}
              initial={prefersReduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReduced ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <WizardCharacter pose={pose} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Caption — kept compact so the eye is drawn to the step list. */}
        <p className="mt-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
          Cooking up your protocol
        </p>

        {/* Step list — vertical 4-step list. Each row is one of three
            states: done / active / pending. */}
        <ul className="mt-5 w-full max-w-sm space-y-3" role="list">
          {STEPS.map((label, i) => {
            const isDone = i < activeStep;
            const isActive = i === activeStep;
            return (
              <li key={label} className="flex items-start gap-3">
                {/* Status indicator — ✓ when done, pulsing dot when
                    active, empty ring when pending. */}
                <div className="mt-[3px] h-4 w-4 shrink-0 flex items-center justify-center">
                  {isDone ? (
                    <motion.div
                      initial={prefersReduced ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 18, stiffness: 320 }}
                      className="h-4 w-4 rounded-full bg-primary/90 flex items-center justify-center"
                    >
                      <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />
                    </motion.div>
                  ) : isActive ? (
                    <motion.span
                      className="h-2.5 w-2.5 rounded-full bg-primary"
                      animate={
                        prefersReduced
                          ? { opacity: 1 }
                          : { opacity: [1, 0.35, 1], scale: [1, 1.25, 1] }
                      }
                      transition={
                        prefersReduced
                          ? { duration: 0 }
                          : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                      }
                    />
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />
                  )}
                </div>

                {/* Step copy — fades on transition from pending → active. */}
                <motion.span
                  animate={{
                    color: isDone
                      ? "hsl(var(--foreground) / 0.7)"
                      : isActive
                        ? "hsl(var(--foreground))"
                        : "hsl(var(--muted-foreground) / 0.5)",
                    opacity: isDone ? 0.7 : isActive ? 1 : 0.5,
                  }}
                  transition={prefersReduced ? { duration: 0 } : { duration: 0.4 }}
                  className={cn(
                    "text-[14px] leading-snug",
                    isActive && "font-medium",
                  )}
                >
                  {label}
                </motion.span>
              </li>
            );
          })}
        </ul>

        {/* Helper line — muted 12px, sets expectation for the wait. */}
        <p className="mt-5 text-[12px] text-muted-foreground/70 text-center">
          This usually takes 5–15 seconds.
        </p>
      </div>
    </motion.section>
  );
}
