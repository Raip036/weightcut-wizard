// WP-T18 — ProtocolRegenerateButton
// Inline "Regenerate protocol" control with a confirm flow. Used at the
// bottom of the Weight Protocol screen so a fighter can ask the AI for a
// fresh plan without leaving the page.
//
// Regeneration is UNLIMITED — there is no daily cap.
//
// Behaviour:
//   - Tap opens an inline confirmation popover ("Are you sure? ...").
//     Confirming triggers haptic + onRegenerate.
//   - While `isLoading` is true the button shows a spinning sync icon and
//     "Regenerating..." copy and is disabled.
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
  isLoading: boolean;
  className?: string;
}

export function ProtocolRegenerateButton({
  onRegenerate,
  isLoading,
  className = "",
}: ProtocolRegenerateButtonProps) {
  const [open, setOpen] = useState(false);
  const disabled = isLoading;

  const buttonLabel = isLoading ? "Regenerating..." : "Regenerate protocol";
  const ariaLabel = isLoading
    ? "Regenerating protocol"
    : "Regenerate protocol";

  const handleConfirm = async () => {
    setOpen(false);
    // Selection-style haptic mirrors other inline confirm flows in the app.
    void triggerHapticSelection();
    await onRegenerate();
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
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
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[15px] font-medium transition-transform active:scale-[0.98] ${
              disabled
                ? "border-border/40 bg-muted/30 text-muted-foreground cursor-not-allowed"
                : "border-border/60 bg-card text-foreground"
            }`}
          >
            <Icon
              name={isLoading ? "syncOutline" : "refreshOutline"}
              size={16}
              className={isLoading ? "animate-spin" : ""}
            />
            <span>{buttonLabel}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
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

      {!isLoading && (
        <p className="text-center text-[11px] text-muted-foreground/80">
          Tip: most fighters generate this in the final week before weigh-in.
        </p>
      )}
    </div>
  );
}
