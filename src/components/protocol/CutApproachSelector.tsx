// WP-T10 — CutApproachSelector
// 3-way segmented control for the cut approach: gradual / standard /
// aggressive. The active pill slides between segments via motion's
// shared layoutId so the transition stays smooth. Haptic selection
// fires on change (no-op on web). Becomes disabled inside the
// 48-hour window before weigh-in — at that point the protocol is
// locked and switching approach would invalidate the day plan.
//
// Tooltip-on-tap: when disabled, tapping the control opens a small
// popover with the disabledReason. This keeps the affordance discoverable
// without requiring hover (which doesn't exist on mobile).
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { triggerHapticSelection } from "@/lib/haptics";

export type CutApproach = "gradual" | "standard" | "aggressive";

export interface CutApproachSelectorProps {
  value: CutApproach;
  onChange: (v: CutApproach) => void;
  disabled?: boolean;
  /** Shown in a popover when the disabled control is tapped. */
  disabledReason?: string;
  className?: string;
}

const OPTIONS: ReadonlyArray<{ key: CutApproach; label: string }> = [
  { key: "gradual", label: "Gradual" },
  { key: "standard", label: "Standard" },
  { key: "aggressive", label: "Aggressive" },
];

export function CutApproachSelector({
  value,
  onChange,
  disabled = false,
  disabledReason,
  className = "",
}: CutApproachSelectorProps) {
  const prefersReduced = useReducedMotion();
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const handleSelect = (next: CutApproach) => {
    if (disabled) return;
    if (next === value) return;
    triggerHapticSelection();
    onChange(next);
  };

  const segmented = (
    <div
      role="radiogroup"
      aria-label="Cut approach"
      aria-disabled={disabled || undefined}
      className={`relative grid grid-cols-3 gap-1 rounded-2xl border border-border/40 bg-muted/20 p-1 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Cut approach: ${opt.label}`}
            disabled={disabled}
            onClick={() => handleSelect(opt.key)}
            className={`relative z-[1] py-2 rounded-xl text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              active ? "text-foreground" : "text-muted-foreground"
            } ${disabled ? "" : "active:scale-[0.98]"}`}
          >
            {active && (
              <motion.span
                layoutId="cut-approach-pill"
                aria-hidden
                className="absolute inset-0 rounded-xl bg-primary/20 border border-primary/40"
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { type: "spring", damping: 26, stiffness: 320 }
                }
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section className={className} aria-label="Choose cut approach">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold mb-2">
        Cut approach
      </p>
      {disabled && disabledReason ? (
        <Popover open={tooltipOpen} onOpenChange={setTooltipOpen}>
          <PopoverTrigger asChild>
            {/* Wrapping div catches the tap on a disabled control,
                since disabled <button>s don't fire onClick. */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Cut approach locked"
              onClick={() => setTooltipOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTooltipOpen(true);
                }
              }}
              className="cursor-not-allowed"
            >
              {segmented}
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-auto max-w-[260px] p-3 text-[12px] leading-snug text-muted-foreground">
            {disabledReason}
          </PopoverContent>
        </Popover>
      ) : (
        segmented
      )}
    </section>
  );
}
