import { ReactNode, useRef, useEffect, useCallback, useState } from "react";
import { motion } from "framer-motion";
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
  /** Short, PII-free card identifier for the SHARE_CARD_SHARED analytics event
   *  (e.g. "fightscore", "gym_session", "weight"). */
  shareType?: string;
  /**
   * When true the dialog renders a swipeable Normal ↔ Transparent preview with a
   * hint, and passes the selected `transparent` flag to `children`. The card
   * must accept a `transparent` prop. When false (default) a single dark preview
   * is shown and `transparent` is always false. This is the single source of the
   * variant swipe — callers no longer wire their own touch handlers.
   */
  supportsTransparent?: boolean;
  children: (props: {
    cardRef: React.RefObject<HTMLDivElement>;
    aspect: AspectRatio;
    transparent?: boolean;
  }) => ReactNode;
}

const CARD_W = 1080;
const CARD_H: Record<AspectRatio, number> = { square: 1080, story: 1920 };
const MAX_PREVIEW_H = 340;

// Checkerboard so the transparent variant reads as a real cut-out.
const CHECKER: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
  backgroundColor: "#111111",
};

export function ShareCardDialog({
  open,
  onOpenChange,
  title = "Share Card",
  shareTitle,
  shareText,
  shareType,
  supportsTransparent = false,
  children,
}: ShareCardDialogProps) {
  // Story 9:16 is the only supported aspect.
  const aspect: AspectRatio = "story";
  const { cardRef, isCapturing, captureAndShare } = useShareCard();
  // Ghost ref for the inactive slide so only the SELECTED variant holds the
  // real capture ref.
  const ghostRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 300, h: MAX_PREVIEW_H, scale: 0.28 });
  const [variant, setVariant] = useState<"dark" | "transparent">("dark");
  const transparent = variant === "transparent";

  // Reset to the default (dark) variant each time the dialog opens.
  useEffect(() => {
    if (open) setVariant("dark");
  }, [open]);

  const recalc = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const cardH = CARD_H[aspect];
    const scale = Math.min(containerW / CARD_W, MAX_PREVIEW_H / cardH);
    setDims({ w: Math.round(CARD_W * scale), h: Math.round(cardH * scale), scale });
  }, [aspect]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(recalc, 20);
    return () => clearTimeout(t);
  }, [open, recalc]);

  // One preview slide. The slide whose transparency matches the selected
  // variant gets the real capture ref.
  const slide = (isTransparent: boolean) => (
    <div
      style={{
        width: dims.w,
        height: dims.h,
        flexShrink: 0,
        overflow: "hidden",
        ...(isTransparent ? CHECKER : { backgroundColor: "#000000" }),
      }}
    >
      <div style={{ transform: `scale(${dims.scale})`, transformOrigin: "top left", width: CARD_W, height: CARD_H[aspect] }}>
        {children({ cardRef: isTransparent === transparent ? cardRef : ghostRef, aspect, transparent: isTransparent })}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm w-[calc(100vw-32px)] rounded-xs flex flex-col gap-3 p-4 max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
        </DialogHeader>

        {/* Preview */}
        <div ref={wrapperRef} className="w-full shrink-0 flex justify-center">
          <div className="overflow-hidden rounded-xs border border-border/50" style={{ width: dims.w, height: dims.h }}>
            {supportsTransparent ? (
              <motion.div
                style={{ display: "flex", width: dims.w * 2, height: dims.h, cursor: "grab" }}
                drag="x"
                dragConstraints={{ left: -dims.w, right: 0 }}
                dragElastic={0.12}
                animate={{ x: transparent ? -dims.w : 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -40 || info.velocity.x < -350) setVariant("transparent");
                  else if (info.offset.x > 40 || info.velocity.x > 350) setVariant("dark");
                }}
              >
                {slide(false)}
                {slide(true)}
              </motion.div>
            ) : (
              slide(false)
            )}
          </div>
        </div>

        {/* Swipe hint + variant controls (only when transparency is supported) */}
        {supportsTransparent && (
          <div className="flex flex-col items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 text-muted-foreground/70 select-none" aria-hidden>
              <motion.span animate={{ x: [-3, 3, -3] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </motion.span>
              <span className="text-[11px] font-medium tracking-wide">Swipe to switch style</span>
              <motion.span animate={{ x: [3, -3, 3] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
                <ChevronRight className="h-3.5 w-3.5" />
              </motion.span>
            </div>
            <div className="flex items-center gap-3">
              {(["dark", "transparent"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  className="text-[12px] font-semibold transition-colors"
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: variant === v ? "#ffffff" : "rgba(255,255,255,0.35)" }}
                >
                  {v === "dark" ? "Normal" : "Transparent"}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(["dark", "transparent"] as const).map((v) => (
                <motion.span
                  key={v}
                  animate={{ width: variant === v ? 20 : 6, backgroundColor: variant === v ? "#4AB4ED" : "rgba(255,255,255,0.25)" }}
                  style={{ height: 6, borderRadius: 99, display: "block" }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Big cross-platform Share button (native share sheet on iOS/Android,
            Web Share API in browsers, download fallback — all via useShareCard). */}
        <div className="shrink-0">
          <button
            onClick={() => captureAndShare(shareTitle, shareText, transparent, shareType)}
            disabled={isCapturing}
            style={{
              width: "100%",
              height: 54,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              background: "linear-gradient(180deg, #5BBDF0 0%, #2F8FD8 100%)",
              boxShadow: "0 10px 30px rgba(47,143,216,0.4)",
              color: "#ffffff",
              fontSize: 16,
              fontWeight: 800,
              opacity: isCapturing ? 0.6 : 1,
            }}
          >
            {isCapturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            Share
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
