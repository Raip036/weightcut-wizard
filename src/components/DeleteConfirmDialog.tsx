import { useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { triggerHapticWarning, confirmDelete } from "@/lib/haptics";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  itemName?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "Delete Entry",
  description,
  itemName,
}: DeleteConfirmDialogProps) {
  const defaultDescription = itemName
    ? `Are you sure you want to delete "${itemName}"?`
    : "Are you sure you want to delete this entry?";

  useEffect(() => {
    if (open) triggerHapticWarning();
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[240px] rounded-xs p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0 shadow-2xl">
        <VisuallyHidden><AlertDialogPrimitive.Title>Delete</AlertDialogPrimitive.Title></VisuallyHidden>
        <AlertDialogPrimitive.Description asChild>
          <div className="pt-4 pb-3 px-4 text-center">
            <p className="text-[15px] font-semibold text-foreground">{title}</p>
            <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">
              {description || defaultDescription}
            </p>
          </div>
        </AlertDialogPrimitive.Description>

        <div className="border-t border-border/40">
          <button
            onClick={() => { confirmDelete(); onConfirm(); }}
            className="w-full py-2.5 text-[14px] font-semibold text-destructive active:bg-muted/50 transition-colors"
          >
            Delete
          </button>
          <div className="border-t border-border/40" />
          <button
            onClick={() => onOpenChange(false)}
            className="w-full py-2.5 text-[14px] font-normal text-primary active:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
