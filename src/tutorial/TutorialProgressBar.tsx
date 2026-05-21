import { motion } from "motion/react";
import { computeSegmentFills } from "./sections";
import type { TutorialStep } from "./types";

interface TutorialProgressBarProps {
  activeSteps: TutorialStep[];
  currentStepIndex: number;
}

export function TutorialProgressBar({ activeSteps, currentStepIndex }: TutorialProgressBarProps) {
  const fills = computeSegmentFills(activeSteps, currentStepIndex);

  return (
    <div
      className="flex w-full gap-1.5"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)", paddingLeft: 16, paddingRight: 16 }}
      aria-label="Tutorial progress"
    >
      {/* Crystal-glass tutorial bar — same recipe as the shadcn Progress
          component, segmented for the per-step layout. Track is the dark
          neutral-900 used app-wide; each fill is the Aurora gradient
          with a translucent shimmer sweeping inside it on a 2.6s loop. */}
      {fills.map((fill, i) => (
        <div key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-neutral-900">
          <motion.div
            className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-gradient-aurora"
            initial={false}
            animate={{ width: `${Math.round(fill * 100)}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 26 }}
          >
            {/* Shimmer — only renders inside filled segments. Hidden when
                width = 0 thanks to the parent's overflow-hidden. */}
            {fill > 0 && (
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
      ))}
    </div>
  );
}
