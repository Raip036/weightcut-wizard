import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Utensils,
  PieChart,
  Search,
  CheckCircle,
  Check,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import wizardImg from "@/assets/thoughtful_wizard.png";
import { cn } from "@/lib/utils";

interface WizardDietScrollOverlayProps {
  /** Ordered analysis phases. Defaults to the diet-analysis pipeline. */
  steps?: Array<{ icon: LucideIcon; label: string }>;
  /** Ghost "Cancel" affordance — rendered after a short delay. */
  onCancel?: () => void;
}

const DEFAULT_STEPS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Utensils, label: "Reviewing your meals" },
  { icon: PieChart, label: "Reading the micronutrients" },
  { icon: Search, label: "Hunting for gaps" },
  { icon: CheckCircle, label: "Conjuring recommendations" },
];

// How long the quill lingers on each line before advancing. The real
// analysis usually outlasts the full sweep, so we hold on the final line
// until the result arrives and this overlay unmounts.
const STEP_MS = 1500;

// Sparkles that twinkle around the wizard's hat — `z-20` keeps them in
// front of the scroll below.
const SPARKLES: Array<{ className: string; delay: number; size: number }> = [
  { className: "absolute -top-1 left-3", delay: 0, size: 13 },
  { className: "absolute -top-2 right-4", delay: 0.7, size: 16 },
  { className: "absolute top-2 -right-1", delay: 1.2, size: 11 },
  { className: "absolute top-0 -left-2", delay: 0.4, size: 12 },
];

/**
 * Inline loading animation for the "Analyse Diet" action — a whimsical
 * wizard poring over a glowing recipe scroll that lists your day's meals.
 * The quill ticks down the scroll phase by phase (Reviewing → Gaps →
 * Recommendations) while the wizard bobs and sparkles twinkle. Drops into
 * the diet-analysis card slot and is replaced by the result when ready.
 *
 * Respects `useReducedMotion`: the wizard sits still, the aura/twinkle
 * loops freeze, but the phase list still advances so progress reads.
 */
export function WizardDietScrollOverlay({
  steps = DEFAULT_STEPS,
  onCancel,
}: WizardDietScrollOverlayProps) {
  const prefersReduced = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);
  const [showCancel, setShowCancel] = useState(false);

  // Advance the quill down the scroll, holding on the last line.
  useEffect(() => {
    const id = setInterval(
      () => setActiveStep((s) => Math.min(s + 1, steps.length - 1)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [steps.length]);

  // Cancel only appears after a beat so it doesn't undercut the moment.
  useEffect(() => {
    const id = setTimeout(() => setShowCancel(true), 2500);
    return () => clearTimeout(id);
  }, []);

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className="card-surface rounded-2xl p-5 flex flex-col items-center text-center overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Analysing your diet"
    >
      {/* Wizard mascot + twinkling sparkles. */}
      <div className="relative">
        {SPARKLES.map((s, i) => (
          <motion.div
            key={i}
            aria-hidden
            className={cn(
              s.className,
              "z-20 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.55)]",
            )}
            animate={
              prefersReduced
                ? { opacity: 0.7 }
                : { opacity: [0.2, 1, 0.2], scale: [0.8, 1.1, 0.8] }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : {
                    duration: 1.8,
                    ease: "easeInOut",
                    repeat: Infinity,
                    delay: s.delay,
                  }
            }
          >
            <Sparkles size={s.size} strokeWidth={2.25} />
          </motion.div>
        ))}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="h-[104px] w-[104px] object-contain select-none pointer-events-none"
          animate={
            prefersReduced ? undefined : { rotate: [-3, 3, -3], y: [0, -3, 0] }
          }
          transition={
            prefersReduced
              ? undefined
              : {
                  rotate: { duration: 3.2, ease: "easeInOut", repeat: Infinity },
                  y: { duration: 2.6, ease: "easeInOut", repeat: Infinity },
                }
          }
          style={{ transformOrigin: "50% 85%" }}
        />
      </div>

      <p className="mt-2 text-[13px] font-semibold text-foreground">
        The wizard is studying your day…
      </p>

      {/* The glowing recipe scroll. */}
      <div className="relative mt-3.5 w-full max-w-[300px]">
        {/* Warm aura pulsing behind the parchment. */}
        <motion.div
          aria-hidden
          className="absolute -inset-3 rounded-[28px]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, rgb(251 191 36 / 0.22) 0%, hsl(var(--primary) / 0.12) 45%, transparent 72%)",
          }}
          animate={
            prefersReduced ? { opacity: 0.6 } : { opacity: [0.45, 0.9, 0.45] }
          }
          transition={
            prefersReduced
              ? { duration: 0 }
              : { duration: 2.4, ease: "easeInOut", repeat: Infinity }
          }
        />

        <motion.div
          className="relative rounded-2xl ring-1 ring-amber-400/20 bg-gradient-to-b from-card to-background/70 px-4 py-3.5 space-y-2"
          animate={prefersReduced ? undefined : { y: [0, -2.5, 0] }}
          transition={
            prefersReduced
              ? undefined
              : { duration: 3.4, ease: "easeInOut", repeat: Infinity }
          }
        >
          {steps.map((step, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
            const Icon = step.icon;
            return (
              <div
                key={step.label}
                className="relative flex items-center gap-2.5 py-0.5 text-left"
              >
                {/* Status glyph. */}
                <span
                  className={cn(
                    "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors",
                    done && "bg-emerald-500/15",
                    active && "bg-amber-400/15",
                    !done && !active && "bg-muted/20",
                  )}
                >
                  {/* Pulsing ring on the active line. */}
                  {active && !prefersReduced && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-lg ring-2 ring-amber-400/40"
                      animate={{ opacity: [0.7, 0, 0.7], scale: [1, 1.35, 1] }}
                      transition={{ duration: 1.6, ease: "easeOut", repeat: Infinity }}
                    />
                  )}
                  {done ? (
                    <motion.span
                      initial={prefersReduced ? false : { scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.25, ease: "backOut" }}
                    >
                      <Check size={13} className="text-emerald-400" strokeWidth={3} />
                    </motion.span>
                  ) : (
                    <Icon
                      size={13}
                      className={cn(
                        active ? "text-amber-300" : "text-muted-foreground/40",
                      )}
                      strokeWidth={2.25}
                    />
                  )}
                </span>

                <span
                  className={cn(
                    "text-[12.5px] leading-tight transition-colors",
                    done && "text-muted-foreground/70",
                    active && "text-foreground font-semibold",
                    !done && !active && "text-muted-foreground/40",
                  )}
                >
                  {step.label}
                </span>

                {/* Quill on the active line, gently writing. */}
                {active && (
                  <motion.span
                    aria-hidden
                    className="ml-auto text-amber-300/90"
                    animate={
                      prefersReduced
                        ? undefined
                        : { rotate: [-8, 8, -8], y: [0, -1.5, 0] }
                    }
                    transition={
                      prefersReduced
                        ? undefined
                        : { duration: 1.1, ease: "easeInOut", repeat: Infinity }
                    }
                  >
                    🪶
                  </motion.span>
                )}
              </div>
            );
          })}
        </motion.div>
      </div>

      {/* Ghost cancel. */}
      {onCancel && showCancel && (
        <motion.button
          type="button"
          onClick={onCancel}
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </motion.button>
      )}
    </motion.div>
  );
}

export default WizardDietScrollOverlay;
