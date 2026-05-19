import { motion } from "motion/react";

interface TutorialNavProps {
  isFirstStep: boolean;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
}

// Opaque, high-contrast backgrounds plus a ringed shadow so both buttons
// sit clearly on top of whatever page content the tutorial overlays. The
// Back button gets a near-solid dark fill and a brighter border so its
// box reads at a glance; the primary button gets an extra primary-tinted
// glow so it pops without competing with the back box's outline.
const BACK_BG = "rgba(0,0,0,0.88)";
const BACK_BORDER = "1.5px solid rgba(255,255,255,0.32)";
const BACK_SHADOW =
  "0 14px 36px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)";
const NEXT_SHADOW =
  "0 14px 36px rgba(0,0,0,0.55), 0 0 0 1px hsl(var(--primary) / 0.55), 0 0 28px hsl(var(--primary) / 0.45)";

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
          className="h-12 flex-1 rounded-xl text-[15px] font-semibold text-white active:scale-[0.98] transition-transform"
          style={{
            background: BACK_BG,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            border: BACK_BORDER,
            boxShadow: BACK_SHADOW,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        className="h-12 flex-1 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
        style={{
          border: "1.5px solid rgba(255,255,255,0.28)",
          boxShadow: NEXT_SHADOW,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {isLastStep ? "Got it" : "Next"}
      </button>
    </motion.div>
  );
}
