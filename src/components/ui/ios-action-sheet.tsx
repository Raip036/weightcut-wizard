import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * A faithful native-iOS action sheet (the grouped, bottom-anchored chooser
 * iOS shows for "Take Photo / Choose from Library", share targets, etc.).
 *
 * Why a dedicated primitive instead of the generic Drawer: a real iOS action
 * sheet is TWO separate rounded cards — the action group (rows split by
 * hairline dividers, optional title/message header) and a distinct, bolded
 * "Cancel" card below it — not the single attached panel `DrawerContent`
 * renders. We reuse vaul's primitives for the backdrop, focus trap, swipe-to
 * dismiss and body-scroll-lock, but render our own grouped cards on top.
 *
 * Surface uses `bg-card` (dark ≈ #1f1f1f, matching iOS secondarySystemBackground)
 * rather than a blur material on purpose: blur/backdrop-filter is stripped on
 * native iOS for perf (see the `.native-app` gating), so a near-opaque card
 * reads correctly with or without it.
 */
export interface IOSActionSheetAction {
  label: string;
  onClick: () => void;
  /** iOS renders destructive actions in red. */
  destructive?: boolean;
  disabled?: boolean;
}

interface IOSActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional grey header title (e.g. "Add Media"). */
  title?: string;
  /** Optional grey header sub-message under the title. */
  message?: string;
  actions: IOSActionSheetAction[];
  cancelLabel?: string;
  /** Fires when the Cancel card is tapped (after the sheet closes). */
  onCancel?: () => void;
}

export function IOSActionSheet({
  open,
  onOpenChange,
  title,
  message,
  actions,
  cancelLabel = "Cancel",
  onCancel,
}: IOSActionSheetProps) {
  const hasHeader = Boolean(title || message);

  const handleAction = (action: IOSActionSheetAction) => {
    if (action.disabled) return;
    triggerHapticSelection();
    onOpenChange(false);
    // Defer the work so the dismiss animation isn't janked by a heavy handler
    // (e.g. opening the native camera) firing on the same frame.
    requestAnimationFrame(() => action.onClick());
  };

  const handleCancel = () => {
    triggerHapticSelection();
    onOpenChange(false);
    onCancel?.();
  };

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-[10001] bg-black/40" />
        <DrawerPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-[10001] flex flex-col gap-2 px-2 outline-none",
            "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          )}
        >
          {/* Visually-hidden title keeps the dialog accessible (vaul requires one). */}
          <DrawerPrimitive.Title className="sr-only">
            {title ?? "Choose an option"}
          </DrawerPrimitive.Title>

          {/* Action group card */}
          <div className="overflow-hidden rounded-[14px] bg-card">
            {hasHeader && (
              <div className="border-b border-border/60 px-4 py-3 text-center">
                {title && (
                  <p className="text-[13px] font-semibold text-muted-foreground">
                    {title}
                  </p>
                )}
                {message && (
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground/80">
                    {message}
                  </p>
                )}
              </div>
            )}
            {actions.map((action, i) => (
              <button
                key={`${action.label}-${i}`}
                type="button"
                disabled={action.disabled}
                onClick={() => handleAction(action)}
                className={cn(
                  "w-full py-[15px] text-[17px] leading-none transition-colors active:bg-foreground/10",
                  (i > 0 || hasHeader) && "border-t border-border/60",
                  action.disabled
                    ? "text-muted-foreground/50"
                    : action.destructive
                      ? "text-destructive"
                      : "text-primary",
                )}
              >
                {action.label}
              </button>
            ))}
          </div>

          {/* Cancel card (separate, bolded — iOS convention) */}
          <button
            type="button"
            onClick={handleCancel}
            className="w-full rounded-[14px] bg-card py-[15px] text-[17px] font-semibold leading-none text-primary transition-colors active:bg-foreground/10"
          >
            {cancelLabel}
          </button>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
