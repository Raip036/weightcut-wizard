import { motion } from "motion/react";

interface TutorialNavProps {
  isFirstStep: boolean;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
}

/* Design System v1 — Tutorial nav buttons.
 *
 * Back  = Outline/Tertiary look (Void surface, 0.5px translucent border).
 *         Sits quietly so it doesn't compete with Next for attention.
 * Next  = Gradient CTA (the 4-stop brand gradient — same one the new
 *         <Button variant="cta"> uses). Soft lilac shadow gives it
 *         tutorial-moment lift without the old heavy black drop. */
const NEXT_GLOW =
  "0 8px 28px -2px rgba(139, 126, 234, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35)";

export function TutorialNav({ isFirstStep, isLastStep, onBack, onNext }: TutorialNavProps) {
  return (
    <motion.div
      className="relative flex w-full max-w-[78vw] gap-2"
      style={{ zIndex: 50 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: 0.08 }}
    >
      {!isFirstStep && (
        <button
          type="button"
          onClick={onBack}
          className="h-12 flex-1 rounded-xs text-[15px] font-light text-neutral-200 bg-brand-void border-[0.5px] border-[rgba(226,229,242,0.5)] hover:border-neutral-100 active:scale-[0.98] transition-transform"
          style={{ WebkitTapHighlightColor: "transparent" }}
        >
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        className="h-12 flex-1 rounded-xs bg-gradient-cta text-[15px] font-semibold text-neutral-200 active:scale-[0.98] transition-transform"
        style={{
          boxShadow: NEXT_GLOW,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {isLastStep ? "Got it" : "Next"}
      </button>
    </motion.div>
  );
}
