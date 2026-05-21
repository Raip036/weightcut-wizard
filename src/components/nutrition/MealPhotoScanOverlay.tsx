import { memo, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { celebrateSuccess } from "@/lib/haptics";
import type { AIStep } from "@/contexts/AITaskContext";

interface MealPhotoScanOverlayProps {
  isOpen: boolean;
  isGenerating: boolean;
  photoBase64: string;
  steps: AIStep[];
  title?: string;
  subtitle?: string;
  startedAt?: number;
  onCompletion?: () => void;
  onCancel?: () => void;
}

const STEP_INTERVAL = 1200;

export const MealPhotoScanOverlay = memo(function MealPhotoScanOverlay({
  isOpen,
  isGenerating,
  photoBase64,
  steps,
  title = "Analyzing your meal",
  subtitle = "This usually takes ~10 seconds",
  startedAt,
  onCompletion,
  onCancel,
}: MealPhotoScanOverlayProps) {
  const [currentStep, setCurrentStep] = useState(() => {
    if (startedAt && isGenerating && steps.length > 0) {
      const elapsed = Date.now() - startedAt;
      return Math.min(Math.floor(elapsed / STEP_INTERVAL), steps.length - 1);
    }
    return 0;
  });
  const [showCancel, setShowCancel] = useState(() => {
    if (startedAt && isGenerating) return Date.now() - startedAt > 3000;
    return false;
  });
  const prevGenerating = useRef(isGenerating);

  useEffect(() => {
    if (!isGenerating || steps.length === 0) return;

    if (startedAt) {
      const elapsed = Date.now() - startedAt;
      setCurrentStep(Math.min(Math.floor(elapsed / STEP_INTERVAL), steps.length - 1));
      if (elapsed > 3000) setShowCancel(true);
    } else {
      setCurrentStep(0);
      setShowCancel(false);
    }

    const stepTimer = setInterval(() => {
      setCurrentStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, STEP_INTERVAL);

    const cancelDelay = startedAt ? Math.max(0, 3000 - (Date.now() - startedAt)) : 3000;
    const cancelTimer = setTimeout(() => setShowCancel(true), cancelDelay);

    return () => {
      clearInterval(stepTimer);
      clearTimeout(cancelTimer);
    };
  }, [isGenerating, steps.length, startedAt]);

  useEffect(() => {
    if (prevGenerating.current && !isGenerating) {
      celebrateSuccess();
      onCompletion?.();
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, onCompletion]);

  const ActiveIcon = steps[currentStep]?.icon;
  const activeLabel = steps[currentStep]?.label;

  return (
    <AnimatePresence>
      {isOpen && isGenerating && steps.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={springs.gentle}
          className="w-full"
        >
          <div className="bg-background/95 border border-border rounded-xs shadow-2xl p-3 space-y-3">
            {/* Viewfinder frame */}
            <div className="relative w-full aspect-[4/3] rounded-xs overflow-hidden bg-black">
              <img
                src={`data:image/jpeg;base64,${photoBase64}`}
                alt="Meal"
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Dark vignette for text legibility */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/50" />

              {/* Corner brackets */}
              <div className="absolute -top-px -left-px w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-xl" />
              <div className="absolute -top-px -right-px w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-xl" />
              <div className="absolute -bottom-px -left-px w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-xl" />
              <div className="absolute -bottom-px -right-px w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-xl" />

              {/* Sweeping scan line */}
              <div
                className="animate-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent pointer-events-none"
                style={{ boxShadow: "0 0 16px hsl(var(--primary)), 0 0 8px hsl(var(--primary))" }}
              />

              {/* Title overlaid */}
              <div className="absolute inset-x-0 bottom-0 px-3 py-2">
                <p className="text-[13px] font-semibold text-white drop-shadow">{title}</p>
                {subtitle && (
                  <p className="text-[11px] text-white/80 drop-shadow">{subtitle}</p>
                )}
              </div>
            </div>

            {/* Step row + cancel */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                {ActiveIcon && (
                  <motion.div
                    key={currentStep}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springs.snappy}
                  >
                    <ActiveIcon className="w-4 h-4 text-primary animate-pulse" />
                  </motion.div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  {steps.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors duration-300",
                        i < currentStep
                          ? "bg-primary"
                          : i === currentStep
                            ? "bg-primary animate-pulse"
                            : "bg-muted-foreground/20"
                      )}
                    />
                  ))}
                </div>
                {activeLabel && (
                  <motion.p
                    key={currentStep}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={springs.snappy}
                    className="text-[11px] text-muted-foreground mt-1 truncate"
                  >
                    {activeLabel}
                  </motion.p>
                )}
              </div>

              <AnimatePresence>
                {showCancel && onCancel && (
                  <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={springs.snappy}
                    onClick={onCancel}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground bg-muted/60 hover:bg-func-danger-red/20 hover:text-func-danger-red border border-border/50 rounded-xs transition-colors touch-manipulation"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
