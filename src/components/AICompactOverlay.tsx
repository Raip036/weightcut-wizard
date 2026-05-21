import { memo, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { celebrateSuccess } from "@/lib/haptics";

export interface AIStep {
  icon: LucideIcon;
  label: string;
  color?: string;
}

interface AICompactOverlayProps {
  isOpen: boolean;
  isGenerating: boolean;
  steps: AIStep[];
  title?: string;
  subtitle?: string;
  startedAt?: number;
  onCompletion?: () => void;
  onCancel?: () => void;
  onMinimize?: () => void;
}

export const AICompactOverlay = memo(function AICompactOverlay({
  isOpen,
  isGenerating,
  steps,
  title = "Processing",
  startedAt,
  onCompletion,
  onCancel,
  onMinimize,
}: AICompactOverlayProps) {
  const STEP_INTERVAL = 1200;
  const [currentStep, setCurrentStep] = useState(() => {
    // Calculate initial step from elapsed time so returning to page continues smoothly
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

  // Advance steps every 1.2s while generating
  useEffect(() => {
    if (!isGenerating || steps.length === 0) return;

    // Resume from elapsed time instead of resetting to 0
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

  // Detect generating true -> false transition
  useEffect(() => {
    if (prevGenerating.current && !isGenerating) {
      celebrateSuccess();
      onCompletion?.();
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, onCompletion]);

  const ActiveIcon = steps[currentStep]?.icon;
  const activeColor = steps[currentStep]?.color;
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
          <div className="bg-background/95 border border-border rounded-xs shadow-2xl p-4">
            {/* Header row: icon + title + buttons */}
            <div className="flex items-center gap-3">
              {/* Animated icon */}
              <div
                className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0"
                style={activeColor ? { backgroundColor: `${activeColor}20` } : undefined}
              >
                {ActiveIcon && (
                  <motion.div
                    key={currentStep}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springs.snappy}
                  >
                    <ActiveIcon
                      className={cn("w-5 h-5 animate-pulse", activeColor ? "" : "text-primary")}
                      style={activeColor ? { color: activeColor } : undefined}
                    />
                  </motion.div>
                )}
              </div>

              {/* Title */}
              <span className="text-sm font-semibold text-foreground truncate flex-1">
                {title}
              </span>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {onMinimize && (
                  <button
                    onClick={onMinimize}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-xs"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Minimize</span>
                  </button>
                )}
                <AnimatePresence>
                  {showCancel && onCancel && (
                    <motion.button
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={springs.snappy}
                      onClick={onCancel}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-red-500/20 hover:text-red-400 border border-border/50 rounded-xs transition-colors touch-manipulation"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mt-3 ml-[52px]">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors duration-300",
                    i < currentStep
                      ? "bg-primary"
                      : i === currentStep
                        ? "bg-primary animate-pulse"
                        : "bg-muted-foreground/20"
                  )}
                />
              ))}
            </div>

            {/* Current step label */}
            {activeLabel && (
              <motion.p
                key={currentStep}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={springs.snappy}
                className="text-xs text-muted-foreground mt-2 ml-[52px] truncate"
              >
                {activeLabel}
              </motion.p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
