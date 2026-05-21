import { ReactNode, useRef, useEffect, useCallback, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Share2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { useShareCard } from "@/hooks/useShareCard";
import type { AspectRatio } from "./templates/CardShell";

interface ShareCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  shareTitle?: string;
  shareText?: string;
  transparent?: boolean;
  /** When true, render a small "Swipe to switch style" hint with an animated chevron pulse. */
  showSwipeHint?: boolean;
  children: (props: {
    cardRef: React.RefObject<HTMLDivElement>;
    aspect: AspectRatio;
    transparent?: boolean;
  }) => ReactNode;
}

// Card source dimensions
const CARD_W = 1080;
const CARD_H: Record<AspectRatio, number> = { square: 1080, story: 1920 };

// Max preview height (px) — keeps buttons always visible
const MAX_PREVIEW_H = 340;

export function ShareCardDialog({
  open,
  onOpenChange,
  title = "Share Card",
  shareTitle,
  shareText,
  transparent,
  showSwipeHint,
  children,
}: ShareCardDialogProps) {
  // Story 9:16 is the only supported aspect — the 1:1 square variant was
  // dropped because users never picked it. Kept as a constant (rather than
  // state) so the dialog's render-prop API still hands cards an `aspect`
  // value and individual card components don't need to change.
  const aspect: AspectRatio = "story";
  const { cardRef, isCapturing, captureAndShare } = useShareCard();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 300, h: MAX_PREVIEW_H, scale: 0.28 });

  const recalc = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const cardH = CARD_H[aspect];

    // Scale to fit width
    const scaleByW = containerW / CARD_W;
    // Scale to fit max height
    const scaleByH = MAX_PREVIEW_H / cardH;
    // Use whichever is smaller so both axes fit
    const scale = Math.min(scaleByW, scaleByH);

    setDims({
      w: Math.round(CARD_W * scale),
      h: Math.round(cardH * scale),
      scale,
    });
  }, [aspect]);

  useEffect(() => {
    if (!open) return;
    // Small delay to let dialog render and get layout width
    const t = setTimeout(recalc, 20);
    return () => clearTimeout(t);
  }, [open, recalc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm w-[calc(100vw-32px)] rounded-xs flex flex-col gap-3 p-4 max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
        </DialogHeader>

        {/* Preview — fixed max height, no gaps. Aspect toggle removed:
            story 9:16 is now the only output format. */}
        <div ref={wrapperRef} className="w-full shrink-0 flex justify-center">
          <div
            className="overflow-hidden rounded-xs border border-border/50"
            style={{
              width: dims.w,
              height: dims.h,
              ...(transparent
                ? {
                    backgroundImage:
                      "linear-gradient(45deg, #1a1a1a 25%, transparent 25%), " +
                      "linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), " +
                      "linear-gradient(45deg, transparent 75%, #1a1a1a 75%), " +
                      "linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                    backgroundColor: "#111111",
                  }
                : { backgroundColor: "#000000" }),
            }}
          >
            <div
              style={{
                transform: `scale(${dims.scale})`,
                transformOrigin: "top left",
                width: CARD_W,
                height: CARD_H[aspect],
              }}
            >
              {children({ cardRef, aspect, transparent })}
            </div>
          </div>
        </div>

        {/* Swipe hint — animated chevrons + helper text. Only shown when the
         * caller has wired up swipe handling (e.g. dark ↔ transparent). */}
        {showSwipeHint && (
          <div
            className="flex items-center justify-center gap-2 shrink-0 text-[11px] text-muted-foreground/80 select-none"
            aria-hidden
          >
            <ChevronLeft className="h-3.5 w-3.5 swipe-hint-pulse" />
            <span className="font-medium tracking-wide">Swipe to switch style</span>
            <ChevronRight className="h-3.5 w-3.5 swipe-hint-pulse" />
          </div>
        )}

        {/* Single slim Share pill — Download removed per design request */}
        <div className="flex justify-center shrink-0">
          <button
            onClick={() => captureAndShare(shareTitle, shareText, transparent)}
            disabled={isCapturing}
            className="inline-flex items-center justify-center gap-2 h-9 px-6 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold transition-opacity active:opacity-80 disabled:opacity-60"
          >
            {isCapturing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            Share
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
