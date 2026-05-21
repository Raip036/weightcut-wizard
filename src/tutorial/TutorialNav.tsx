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
 * Next  = Solid Spirit Blue (#4068EF) — the v1 primary color. Matches
 *         the standard <Button variant="default"> look so tutorial CTAs
 *         feel consistent with non-tutorial CTAs in the rest of the app
 *         rather than promoting tutorial steps with the rare gradient CTA.
 *
 * Layout: `self-center` puts the button row in the center of the parent
 * flex-col (TutorialStage uses items-start so the speech bubble and
 * wizard character hug the left; the nav row breaks out of that and
 * centers itself). */
const NEXT_GLOW =
  "0 6px 20px -4px rgba(64, 104, 239, 0.45), 0 2px 8px rgba(0, 0, 0, 0.30)";

export function TutorialNav({ isFirstStep, isLastStep, onBack, onNext }: TutorialNavProps) {
  return (
    <motion.div
      className="relative flex w-full max-w-[78vw] gap-2 self-center"
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
        className="h-12 flex-1 rounded-xs bg-brand-spirit-blue text-[15px] font-semibold text-white hover:bg-[#5078F5] active:bg-[#2A4ACC] active:scale-[0.98] transition-all"
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
