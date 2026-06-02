// WP-T18 — ProtocolRegenerateButton
// Inline "Regenerate protocol" control with a daily-cap chip and confirm
// flow. Used at the bottom of the Weight Protocol screen so a fighter can
// ask the AI for a fresh plan without leaving the page.
//
// Behaviour:
//   - Tap opens an inline confirmation popover ("Are you sure? ...").
//     Confirming triggers haptic + onRegenerate.
//   - While `isLoading` is true the button shows a spinning sync icon and
//     "Regenerating..." copy and is disabled.
//   - When `usedToday >= limit` the button is disabled with an
//     accessible "Daily limit reached" label so the user still understands
//     why the action is unavailable.
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

export interface ProtocolRegenerateButtonProps {
  onRegenerate: () => Promise<void> | void;
  usedToday: number;
  limit: number;
  isLoading: boolean;
  className?: string;
}

export function ProtocolRegenerateButton({
  onRegenerate,
  usedToday,
  limit,
  isLoading,
  className = "",
}: ProtocolRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const atLimit = usedToday >= limit;
  const disabled = isLoading || atLimit;

  const buttonLabel = isLoading ? "Regenerating..." : "Regenerate protocol";
  const ariaLabel = atLimit
    ? "Daily limit reached"
    : isLoading
      ? "Regenerating protocol"
      : "Regenerate protocol";

  const handleConfirm = async () => {
    setOpen(false);
    // Selection-style haptic mirrors other inline confirm flows in the app.
    void triggerHapticSelection();
    await onRegenerate();
  };

  return (
    <div
      className={`flex items-center justify-between gap-3 ${className}`.trim()}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) {
            setOpen(false);
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-disabled={disabled}
            title={atLimit ? "Daily limit reached" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1.5 text-[13px] text-foreground transition-opacity active:opacity-70 ${
              disabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <Icon
              name={isLoading ? "syncOutline" : "refreshOutline"}
              size={14}
              className={isLoading ? "animate-spin" : ""}
            />
            <span>{buttonLabel}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-64 p-3 text-[13px]"
        >
          <p className="text-foreground">
            Are you sure? This will replace your current plan.
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-border/40 px-3 py-1 text-[12px] text-muted-foreground active:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-full bg-foreground px-3 py-1 text-[12px] font-medium text-background active:opacity-80"
            >
              Yes
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <span
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums"
        aria-label={`${usedToday} of ${limit} daily AI calls used`}
      >
        <span aria-hidden>✦</span>
        <span>
          {usedToday} of {limit} daily AI calls used
        </span>
      </span>
    </div>
  );
}
