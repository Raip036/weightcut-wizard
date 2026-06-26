// AppUpdatePrompt — presentational aurora modal telling the user a newer app
// version is available and offering to open the App Store. PRESENTATIONAL ONLY:
// it owns no version logic and no data fetching. All behavior comes via props.
// Visual language mirrors ReviewPromptCard (blue wizard aurora pre-prompt).
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpCircle, ArrowRight } from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { triggerHapticSelection } from "@/lib/haptics";
import wizard from "@/assets/wizard_3D.png";

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;
const CTA_SOLID = "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(217_91%_58%/0.5)]";

export interface AppUpdatePromptProps {
  open: boolean;
  currentVersion: string;
  latestVersion: string | null;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function AppUpdatePrompt({
  open,
  currentVersion,
  latestVersion,
  onUpdate,
  onDismiss,
}: AppUpdatePromptProps): JSX.Element {
  const prefersReduced = useReducedMotion();

  const handleUpdate = () => {
    triggerHapticSelection();
    onUpdate();
  };
  const handleDismiss = () => {
    triggerHapticSelection();
    onDismiss();
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
          onClick={handleDismiss}
          role="dialog"
          aria-modal="true"
          aria-label="App update available"
        >
          <motion.div
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-primary/20 card-surface px-5 py-6 text-center"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={
              prefersReduced
                ? { duration: 0.15 }
                : { type: "spring", damping: 22, stiffness: 280 }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <WizardAuroraBackground intensity="full" radialGlow />
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="relative grid h-[84px] w-[84px] place-items-center">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.14)} 45%, transparent 70%)` }}
                />
                <motion.img
                  src={wizard}
                  alt=""
                  draggable={false}
                  className="relative h-[68px] w-[68px] object-contain"
                  style={{ filter: `drop-shadow(0 0 12px ${hsl(0.5)})` }}
                  animate={prefersReduced ? undefined : { y: [0, -4, 0] }}
                  transition={prefersReduced ? undefined : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>

              <div>
                <h3 className="text-[18px] font-bold text-white">Update available</h3>
                <p className="mt-1 text-[13px] text-white/60">
                  A newer version of FightCamp Wizard is ready. Update for the latest features and fixes.
                </p>
              </div>

              {latestVersion && (
                <div className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-white/45">
                  <span>Version {currentVersion}</span>
                  <ArrowRight size={13} className="text-white/45" aria-hidden />
                  <span className="text-white/70">{latestVersion}</span>
                </div>
              )}

              <div className="mt-1 flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={handleUpdate}
                  className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-bold ${CTA_SOLID}`}
                >
                  <ArrowUpCircle size={17} aria-hidden />
                  Update now
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="w-full rounded-full px-4 py-2 text-[13px] font-semibold text-white/45"
                >
                  Not now
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default AppUpdatePrompt;
