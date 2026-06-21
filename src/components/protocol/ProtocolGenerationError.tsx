// WP-T19: ProtocolGenerationError
// Error card shown when AI generation of the weight protocol fails.
// Always offers a retry; optionally offers "use last good plan" when
// the caller has a cached fallback available (typically read from
// AIPersistence).
//
// Visual conventions:
//   - Red-tinted card chrome (matches SafetyWarningBanner "red" level)
//   - 16px semibold heading, 13px muted body
//   - Body has max-height + overflow so a long stack/trace doesn't
//     blow out the layout
//   - aria-role "alert" + aria-live "assertive"; screen readers should
//     announce immediately
//   - Mount: fade in only (no slide). Errors should appear instantly
//     rather than animating in
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export interface ProtocolGenerationErrorProps {
  /** Human-readable error message to display. */
  error: string;
  /** Required: primary action retries the generation. */
  onRetry: () => void;
  /** Optional fallback: only shown when a cached last-good plan exists. */
  onUseLastGood?: () => void;
  className?: string;
}

export function ProtocolGenerationError({
  error,
  onRetry,
  onUseLastGood,
  className,
}: ProtocolGenerationErrorProps) {
  const prefersReduced = useReducedMotion();

  const handleRetry = () => {
    triggerHapticSelection();
    onRetry();
  };

  const handleUseLastGood = () => {
    triggerHapticSelection();
    onUseLastGood?.();
  };

  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "card-surface rounded-2xl border border-func-danger-red/40 bg-func-danger-red/[0.04] p-5",
        className,
      )}
    >
      {/* Header: warning icon + title */}
      <div className="flex items-start gap-2.5">
        <span className="mt-px text-func-danger-red shrink-0">
          <Icon name="alertCircleOutline" size={18} aria-label="Error" />
        </span>
        <h3 className="text-[16px] font-semibold leading-tight text-foreground">
          Couldn&apos;t build your protocol
        </h3>
      </div>

      {/* Body (long errors scroll within the card) */}
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
        {error}
      </p>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1.5 rounded-full bg-func-danger-red px-4 py-2 text-[13px] font-bold text-white active:scale-[0.97] transition"
        >
          Try again
        </button>
        {onUseLastGood && (
          <button
            type="button"
            onClick={handleUseLastGood}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-4 py-2 text-[13px] font-semibold text-foreground active:scale-[0.97] transition"
          >
            Use last good plan
          </button>
        )}
      </div>
    </motion.div>
  );
}
