// WP-T18 — ProtocolRegenerateButton
// Inline "Regenerate protocol" control with a daily-cap counter and confirm
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
//   - The counter reads as REMAINING regenerations ("1 of 1 daily
//     regeneration left") with an info popover explaining when most fighters
//     actually need this.
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
  const [infoOpen, setInfoOpen] = useState(false);
  const atLimit = usedToday >= limit;
  const disabled = isLoading || atLimit;

  const remaining = Math.max(0, limit - usedToday);
  const counterText = `${remaining} of ${limit} daily regeneration${
    limit === 1 ? "" : "s"
  } left`;

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
            title={atLimit ? "Daily limit reached" : undefined}
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

      <div className="flex items-center justify-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums"
          aria-label={counterText}
        >
          <span aria-hidden>✦</span>
          <span>{counterText}</span>
        </span>

        <Popover open={infoOpen} onOpenChange={setInfoOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="About daily regenerations"
              className="inline-flex items-center text-muted-foreground transition-opacity active:opacity-70"
            >
              <Icon name="informationCircleOutline" size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={8}
            className="w-64 p-3 text-[13px] text-muted-foreground"
          >
            You get 1 plan regeneration per day. Most fighters only need this in
            the final week before weigh-in — when your weight and weigh-in
            timing are locked in.
          </PopoverContent>
        </Popover>
      </div>

      {!isLoading && (
        <p className="text-center text-[11px] text-muted-foreground/80">
          Tip: most fighters generate this in the final week before weigh-in.
        </p>
      )}
    </div>
  );
}
