// ReviewPromptCard — custom aurora pre-prompt for the win-moment review ask
// (Variant A). Shown on the Dashboard after the user wraps up a fight camp.
// "Rate" calls Apple's native StoreKit dialog (the only real review surface);
// "Maybe later" starts a cooldown. See src/lib/appReview.ts for eligibility.
import { AnimatePresence, motion } from "motion/react";
import { Star } from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { requestReviewNow, snoozeReview } from "@/lib/appReview";
import wizard from "@/assets/wizard_3D.png";

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;
const CTA_SOLID = "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(217_91%_58%/0.5)]";

export function ReviewPromptCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const handleRate = async () => {
    await requestReviewNow();
    onClose();
  };
  const handleLater = () => {
    snoozeReview();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-5"
          style={{ pointerEvents: "auto", background: "rgba(0,0,0,0.66)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleLater}
          role="dialog"
          aria-modal="true"
          aria-label="Rate WeightCut Wizard"
        >
          <motion.div
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-primary/20 card-surface px-5 py-6 text-center"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <WizardAuroraBackground intensity="full" radialGlow />
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="relative grid h-[84px] w-[84px] place-items-center">
                <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.14)} 45%, transparent 70%)` }} />
                <motion.img
                  src={wizard}
                  alt=""
                  draggable={false}
                  className="relative h-[68px] w-[68px] object-contain"
                  style={{ filter: `drop-shadow(0 0 12px ${hsl(0.5)})` }}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>

              <div className="flex items-center justify-center gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 320, damping: 18 }}
                  >
                    <Star size={22} className="text-white" fill="white" style={{ filter: `drop-shadow(0 0 6px ${hsl(0.9)})` }} />
                  </motion.span>
                ))}
              </div>

              <div>
                <h3 className="text-[17px] font-bold text-white">Enjoying WeightCut Wizard?</h3>
                <p className="mt-1 text-[13px] text-white/60">You just wrapped up your camp. A quick rating helps other fighters find us.</p>
              </div>

              <div className="mt-1 flex w-full flex-col gap-2">
                <button type="button" onClick={handleRate} className={`w-full rounded-full px-4 py-2.5 text-[14px] font-bold ${CTA_SOLID}`}>
                  Rate on the App Store
                </button>
                <button type="button" onClick={handleLater} className="w-full rounded-full px-4 py-2 text-[13px] font-semibold text-white/45">
                  Maybe later
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ReviewPromptCard;
