/**
 * MadeWeightShareSheet: bottom sheet that previews the auto-generated
 * "Made Weight" polaroid card and offers Share / Save-to-photos / Cancel.
 *
 * The card is rendered once (per input) to a JPEG blob and shown via an
 * <img> + object URL. We re-render only when `input` or `open` changes,
 * and revoke object URLs on unmount/regen to keep memory bounded.
 *
 * This component does NOT couple to the WeightTracker. It just accepts
 * a fully-resolved `MadeWeightInput`. The decision to open the sheet
 * lives upstream (e.g. when a logged weight meets/beats target).
 */
import { useEffect, useState } from "react";
import { Download, Loader2, Share2, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMadeWeightShare } from "@/hooks/useMadeWeightShare";
import {
  generateMadeWeightCard,
  type MadeWeightInput,
} from "@/lib/madeWeightCard";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { isIOS, isAndroid } from "@/lib/platform";
import { logger } from "@/lib/logger";

interface MadeWeightShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: MadeWeightInput | null;
}

async function saveBlobToPhotos(blob: Blob): Promise<"native" | "download"> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const r = reader.result;
          if (typeof r !== "string") return reject(new Error("read failed"));
          const idx = r.indexOf(",");
          resolve(idx >= 0 ? r.slice(idx + 1) : r);
        };
        reader.onerror = () => reject(reader.error ?? new Error("read error"));
        reader.readAsDataURL(blob);
      });
      const fileName = `made-weight-${Date.now()}.jpg`;
      await Filesystem.writeFile({
        path: fileName,
        data: base64,
        // Documents is the closest analog to "user-visible" via the Files
        // app; full Photos library write requires a paid plugin, so we
        // fall back to documents for v1.
        directory: Directory.Documents,
      });
      return "native";
    } catch (err) {
      logger.warn("Native save failed, falling back to download", { error: err });
    }
  }
  // Web / fallback path: trigger a regular download anchor.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `made-weight-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return "download";
}

export function MadeWeightShareSheet({
  open,
  onOpenChange,
  input,
}: MadeWeightShareSheetProps) {
  const { shareCard, generating: sharing } = useMadeWeightShare();
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Generate the preview when the sheet opens with valid input. We
  // intentionally regenerate on every (re)open so reactive profile
  // changes (e.g. avatar updated) flow into the next share.
  useEffect(() => {
    let cancelled = false;
    let urlToRevoke: string | null = null;

    async function build() {
      if (!open || !input) return;
      setPreviewing(true);
      setPreviewBlob(null);
      try {
        const blob = await generateMadeWeightCard(input);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlToRevoke = url;
        setPreviewBlob(blob);
        setPreviewUrl(url);
      } catch (err) {
        logger.error("Preview render failed", { error: err });
        if (!cancelled) {
          toast({
            title: "Couldn't render your card",
            description: "Close and try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }
    build();

    return () => {
      cancelled = true;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
      setPreviewUrl(null);
    };
  }, [open, input, toast]);

  const handleShare = async () => {
    if (!input) return;
    await shareCard(input);
  };

  const handleSave = async () => {
    if (!previewBlob) return;
    setSaving(true);
    try {
      const result = await saveBlobToPhotos(previewBlob);
      if (result === "native") {
        // The save target (Directory.Documents) is cross-platform, but the
        // user-facing location differs per store, so the copy is too.
        if (isAndroid()) {
          toast({
            title: "Saved",
            description: "Saved to your Files. Check your Downloads or Files app.",
          });
        } else if (isIOS()) {
          toast({
            title: "Saved to Files",
            description: "Find it under On My iPhone › WeightCut.",
          });
        } else {
          toast({
            title: "Saved to Files",
            description: "Find it in your Files app.",
          });
        }
      } else {
        toast({
          title: "Downloaded",
          description: "Check your downloads folder.",
        });
      }
    } catch (err) {
      logger.error("Save failed", { error: err });
      toast({
        title: "Couldn't save your card",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-border/40 p-0 max-h-[92vh] overflow-y-auto"
      >
        <SheetHeader className="px-5 pt-5 pb-2 text-left">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-[17px] font-semibold">
                Made Weight
              </SheetTitle>
              <p className="text-[12px] text-muted-foreground/80 mt-0.5">
                Share your card to your gym and socials.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-full inline-flex items-center justify-center text-muted-foreground/70 hover:bg-muted/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SheetHeader>

        <div className="px-5 pb-6 pt-2 space-y-4">
          <div className="aspect-square w-full rounded-xs bg-[#EDECE6] dark:bg-[#1a1a1a] overflow-hidden flex items-center justify-center border border-border/40">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Made Weight card preview"
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : previewing ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[12px]">Rendering your card…</span>
              </div>
            ) : (
              <span className="text-[12px] text-muted-foreground">
                No card to preview.
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={handleShare}
              disabled={!previewBlob || sharing}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              {sharing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              Share
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!previewBlob || saving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground text-[13px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Save to photos
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-10 items-center justify-center rounded-xs text-muted-foreground/80 text-[12px] font-medium hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          <p className="text-center text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
            Powered by WeightCut Wizard
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
