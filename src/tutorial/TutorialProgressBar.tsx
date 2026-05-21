import { motion } from "motion/react";
import type { TutorialStep } from "./types";

interface TutorialProgressBarProps {
  activeSteps: TutorialStep[];
  currentStepIndex: number;
}

/**
 * Tutorial progress bar — single continuous crystal-glass bar that fills
 * left-to-right as the user advances through steps. Replaces the older
 * segmented design where each step had its own micro-bar.
 *
 * Visual recipe matches the shadcn Progress component:
 *   • Track : bg-neutral-900 (dark blue-black), 3px tall, fully rounded.
 *   • Fill  : Aurora gradient (Spirit Blue → Protein Blue → Dream Cyan)
 *             with a translucent shimmer sweeping inside on a 2.6s loop.
 *   • Width : (currentStepIndex + 1) / totalSteps, animated with a
 *             gentle spring so each "Next" tap pushes the bar forward
 *             visibly without snapping.
 */
export function TutorialProgressBar({ activeSteps, currentStepIndex }: TutorialProgressBarProps) {
  const total = Math.max(1, activeSteps.length);
  const progressPct =
    Math.min(1, Math.max(0, (currentStepIndex + 1) / total)) * 100;

  return (
    <div
      className="flex w-full"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)", paddingLeft: 16, paddingRight: 16 }}
      aria-label="Tutorial progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progressPct)}
      role="progressbar"
    >
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-neutral-900">
        <motion.div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-gradient-aurora"
          initial={false}
          animate={{ width: `${progressPct}%` }}
          transition={{ type: "spring", stiffness: 180, damping: 26 }}
        >
          {/* Shimmer — only renders once the bar has any width, so it
              doesn't flicker at progressPct = 0. */}
          {progressPct > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -inset-x-1/2 block animate-[progress-shimmer_2.6s_linear_infinite]"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 50%, transparent 100%)",
                width: "60%",
              }}
            />
          )}
        </motion.div>
      </div>
    </div>
  );
}
