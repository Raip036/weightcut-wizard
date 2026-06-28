import { forwardRef, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

interface DescribeRowProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  voiceSupported: boolean;
  isListening: boolean;
  interimText?: string;
  onMicTap: () => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Static placeholder fallback (e.g. the photo "add details" case). */
  placeholder?: string;
  /**
   * Rotating example meals. When provided (and the field is empty), these
   * cycle through the placeholder overlay to teach the natural-language
   * affordance without adding any visible UI chrome.
   */
  examples?: string[];
}

const ROTATE_MS = 2600;

/**
 * Text input with the voice mic tucked INSIDE the field (right edge), matching
 * the app's other capture sheets. When empty and idle, the placeholder gently
 * rotates through example meals so users discover they can just describe what
 * they ate in natural language and get macros back.
 *
 * Auto-focus is intentionally NOT applied — we don't want to summon the iOS
 * keyboard the moment the sheet opens. The user explicitly taps to type.
 */
export const DescribeRow = forwardRef<HTMLInputElement, DescribeRowProps>(function DescribeRow(
  {
    value,
    onChange,
    onSubmit,
    disabled,
    voiceSupported,
    isListening,
    interimText,
    onMicTap,
    onFocus,
    placeholder = "What did you eat?",
    examples,
  },
  ref,
) {
  const prefersReduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [focused, setFocused] = useState(false);

  const showOverlay = !value && !isListening;
  const rotating =
    !!examples &&
    examples.length > 1 &&
    showOverlay &&
    !focused &&
    !prefersReduced;

  // Cycle examples while the field is empty and unfocused.
  useEffect(() => {
    if (!rotating) return;
    const id = setInterval(
      () => setIdx((s) => (s + 1) % examples!.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [rotating, examples]);

  // Resolve the current placeholder text.
  const overlayText = isListening
    ? "Listening…"
    : examples && examples.length
      ? examples[idx % examples.length]
      : placeholder;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled) {
              e.preventDefault();
              onSubmit();
            }
          }}
          // Native placeholder kept blank — the animated overlay below renders
          // the visible hint. aria-label carries the accessible name.
          placeholder=""
          className={`w-full h-12 rounded-2xl bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[15px] text-foreground pl-4 ${
            voiceSupported ? "pr-12" : "pr-4"
          } outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${
            isListening ? "ring-2 ring-func-danger-red/40" : ""
          }`}
          aria-label="Describe your meal"
        />

        {/* Animated placeholder overlay — only visible when the field is empty. */}
        {showOverlay && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-4 flex items-center ${
              voiceSupported ? "right-12" : "right-4"
            } overflow-hidden`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={overlayText}
                initial={prefersReduced ? false : { opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className={`block truncate text-[15px] ${
                  isListening
                    ? "text-func-danger-red/70 font-medium"
                    : "text-muted-foreground/50"
                }`}
              >
                {overlayText}
              </motion.span>
            </AnimatePresence>
          </div>
        )}

        {voiceSupported && (
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onMicTap();
            }}
            disabled={disabled}
            aria-label={isListening ? "Stop voice input" : "Voice input"}
            aria-pressed={isListening}
            className={`absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-9 w-9 rounded-full transition-all active:scale-[0.92] ${
              isListening
                ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                : "text-muted-foreground/80 active:bg-muted/60"
            }`}
          >
            <Icon name={isListening ? "micOffOutline" : "micOutline"} size={18} />
          </button>
        )}
      </div>
      {isListening && interimText && (
        <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
      )}
    </div>
  );
});
