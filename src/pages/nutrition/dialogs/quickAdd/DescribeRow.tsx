import { forwardRef } from "react";
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
  placeholder?: string;
}

/**
 * Side-by-side text input + voice mic button. The text input is the
 * primary surface; mic is a 40×40 secondary square on the right.
 *
 * Auto-focus is intentionally NOT applied — we don't want to summon the
 * iOS keyboard the moment the sheet opens. The user explicitly taps the
 * input to start typing.
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
  },
  ref,
) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-2">
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={isListening ? "Listening…" : placeholder}
          className={`flex-1 min-w-0 h-11 rounded-2xl bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[15px] text-foreground placeholder:text-muted-foreground/50 px-4 outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${
            isListening ? "ring-2 ring-func-danger-red/40" : ""
          }`}
          aria-label="Describe your meal"
        />
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
            className={`shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-2xl border border-border/40 transition-all active:scale-[0.96] ${
              isListening
                ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                : "bg-muted/40 text-muted-foreground active:bg-muted/60"
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
