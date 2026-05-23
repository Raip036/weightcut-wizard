import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { celebrateSuccess } from "@/lib/haptics";
import { Icon } from "@/components/ui/Icon";
import { selectLabeledItems } from "@/lib/aiLineItemLabels";
import type { AIStep } from "@/contexts/AITaskContext";
import type { AiLineItem } from "@/pages/nutrition/types";

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
  /**
   * AI-detected line items. When provided and `isGenerating` is false
   * (scan complete) the overlay renders numbered pins on the image at
   * each item's bounding-box centroid. Items without a bbox are skipped.
   */
  lineItems?: AiLineItem[];
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
  lineItems,
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
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
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

  // Labeled items: same ordering as the caller's list mirrors the numbers.
  // Pins anchor at bbox centroid; items without bbox are skipped.
  const labeled = useMemo(
    () => (lineItems && lineItems.length > 0 ? selectLabeledItems(lineItems) : []),
    [lineItems],
  );
  const pins = useMemo(
    () =>
      labeled
        .map((item, idx) => {
          if (!item.bbox) return null;
          const cx = item.bbox.x + item.bbox.w / 2;
          const cy = item.bbox.y + item.bbox.h / 2;
          return { number: idx + 1, x: cx, y: cy, name: item.name };
        })
        .filter((p): p is { number: number; x: number; y: number; name: string } => p !== null),
    [labeled],
  );

  const showPins = !isGenerating && pins.length > 0;
  // Aspect ratio: once the image is loaded use its natural ratio so the
  // whole photo is visible. Fall back to 4/3 pre-load to avoid layout jump.
  const aspectStyle = imgDims
    ? { aspectRatio: `${imgDims.w} / ${imgDims.h}` }
    : { aspectRatio: "4 / 3" };

  const shouldRender = isOpen && steps.length > 0 && (isGenerating || showPins);

  return (
    <AnimatePresence>
      {shouldRender && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={springs.gentle}
          className="w-full"
        >
          <div className="bg-background/95 border border-border rounded-xs p-3 space-y-3">
            {/* Viewfinder frame — aspect matches the image so nothing is cropped. */}
            <div
              className="relative w-full rounded-xs overflow-hidden bg-black"
              style={aspectStyle}
            >
              <img
                src={`data:image/jpeg;base64,${photoBase64}`}
                alt="Meal"
                onLoad={(e) => {
                  const t = e.currentTarget;
                  if (t.naturalWidth > 0 && t.naturalHeight > 0) {
                    setImgDims({ w: t.naturalWidth, h: t.naturalHeight });
                  }
                }}
                className="absolute inset-0 w-full h-full object-contain"
              />

              {/* Vignette — stronger at the bottom so the title stays legible
                  against busy photos. */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/65" />

              {/* Corner brackets */}
              <div className="absolute -top-px -left-px w-7 h-7 border-t-[3px] border-l-[3px] border-primary rounded-tl-xl" />
              <div className="absolute -top-px -right-px w-7 h-7 border-t-[3px] border-r-[3px] border-primary rounded-tr-xl" />
              <div className="absolute -bottom-px -left-px w-7 h-7 border-b-[3px] border-l-[3px] border-primary rounded-bl-xl" />
              <div className="absolute -bottom-px -right-px w-7 h-7 border-b-[3px] border-r-[3px] border-primary rounded-br-xl" />

              {/* Sweeping scan line (only while generating) */}
              {isGenerating && (
                <div
                  className="animate-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent pointer-events-none"
                  style={{ boxShadow: "0 0 16px hsl(var(--primary)), 0 0 8px hsl(var(--primary))" }}
                />
              )}

              {/* Numbered pins, post-scan */}
              {showPins && (
                <div className="absolute inset-0 pointer-events-none">
                  {pins.map((pin, i) => (
                    <motion.div
                      key={`${pin.number}-${pin.name}`}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ ...springs.snappy, delay: i * 0.04 }}
                      className="absolute flex items-center justify-center w-[22px] h-[22px] rounded-full bg-primary text-primary-foreground text-[11px] font-semibold ring-1 ring-white/70 shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
                      style={{
                        left: `${pin.x * 100}%`,
                        top: `${pin.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      aria-label={`Item ${pin.number}: ${pin.name}`}
                    >
                      {pin.number}
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Title overlaid — bigger, more breathing room */}
              <div className="absolute inset-x-0 bottom-0 px-3 py-3">
                <p className="text-[15px] font-semibold leading-snug text-white">{title}</p>
                {subtitle && (
                  <p className="text-[12px] text-white/90 mt-0.5">{subtitle}</p>
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
                    aria-label="Cancel analysis"
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 min-w-[36px] min-h-[36px] px-3 text-[12px] font-medium text-muted-foreground bg-muted/60 hover:bg-func-danger-red/20 hover:text-func-danger-red border border-border/50 rounded-xs transition-colors touch-manipulation"
                  >
                    <Icon name="closeOutline" size={14} />
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
