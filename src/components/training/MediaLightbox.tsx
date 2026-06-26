/**
 * MediaLightbox — full-screen swipeable photo/video viewer.
 *
 * Used by:
 *  - SessionDetailDrawer: tap a thumbnail to view that session's media.
 *  - TrainingLibrary: tap a tile to view all media starting from that index.
 *
 * Interactions (mobile-first, all native gestures):
 *  - Swipe left / right → previous / next media (CSS scroll-snap).
 *  - Swipe DOWN > 80px → dismiss (matches iOS Photos behaviour).
 *  - Tap close button (top-right) → dismiss.
 *  - Videos pause when scrolled out of view (IntersectionObserver) so
 *    audio doesn't bleed between adjacent clips.
 *
 * Why scroll-snap rather than a touch-tracking pager:
 *  - iOS momentum + bounce is free.
 *  - Works inside the Capacitor WebView without a JS animation loop.
 *  - The vertical-dismiss listener is a separate touchmove handler on the
 *    container, so it doesn't fight the scroller's horizontal axis.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Capacitor } from "@capacitor/core";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import { preloadAndDecodeImages } from "@/hooks/useImageReady";

export interface LightboxItem {
  id: string;
  url: string | null;
  kind: "photo" | "video";
  caption?: string | null;
  capturedAt?: string;
  /** PRIMARY discipline (martial art / "S&C" / "Rest"). */
  sessionType?: string | null;
  /** OPTIONAL activity descriptor (Sparring, Strength, …); null when absent. */
  sessionTag?: string | null;
}

interface Props {
  items: LightboxItem[];
  startIndex?: number;
  open: boolean;
  onClose: () => void;
  /** Optional delete handler — when provided, a small trash button shows
   *  on the active item. */
  onDelete?: (item: LightboxItem) => void;
}

const DISMISS_THRESHOLD_PX = 80;

export function MediaLightbox({
  items,
  startIndex = 0,
  open,
  onClose,
  onDelete,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  // Track vertical drag for swipe-to-dismiss. We only track touchstart.y
  // and translate the whole container so the dismiss feels physical.
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  // Anchor scroll position to startIndex when the lightbox opens.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(startIndex);
    setDragY(0);
    // Wait one frame so the items have laid out before scrolling.
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      const target = itemRefs.current[startIndex];
      if (!el || !target) return;
      el.scrollTo({ left: target.offsetLeft, behavior: "auto" });
    });
  }, [open, startIndex]);

  // Track which item is centred so the counter + caption can update.
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      const node = itemRefs.current[i];
      if (!node) continue;
      const c = node.offsetLeft + node.offsetWidth / 2;
      const d = Math.abs(c - center);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== activeIndex) setActiveIndex(bestIdx);
  }, [activeIndex, items.length]);

  // Pause videos that are not the active slide so audio doesn't bleed.
  useEffect(() => {
    itemRefs.current.forEach((node, i) => {
      if (!node) return;
      const video = node.querySelector("video");
      if (!video) return;
      if (i === activeIndex) {
        // Don't autoplay — let the user tap. Just keep the controls live.
      } else {
        try {
          video.pause();
        } catch {
          /* ignore */
        }
      }
    });
  }, [activeIndex]);

  // Decode-ahead: fully decode the full-res neighbours (+/- 2) of the active
  // slide so swiping lands on an already-painted image instead of a flash +
  // decode. Reuses the shared decode cache (no duplicate work across opens).
  useEffect(() => {
    if (!open) return;
    const urls: Array<string | null> = [];
    for (let d = -2; d <= 2; d++) {
      const it = items[activeIndex + d];
      if (it && it.kind === "photo") urls.push(it.url);
    }
    preloadAndDecodeImages(urls);
  }, [activeIndex, items, open]);

  // ESC dismisses on web (Capacitor traps the back button at the OS level
  // and routes it through the React Router; this is a desktop courtesy).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Vertical-drag dismiss. We only commit the dismiss on touchend so a
  // shallow swipe can settle back to centre without tearing the scroll.
  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    // Only react to downward drags. Upward stays at 0 so we don't fight
    // any browser native pull-to-refresh.
    setDragY(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    if (dragY > DISMISS_THRESHOLD_PX) {
      triggerHaptic(ImpactStyle.Light);
      onClose();
    } else {
      setDragY(0);
    }
    dragStartY.current = null;
  };

  // Save the active clip to the device. On iOS Capacitor we write to the
  // Cache dir then hand it to the OS share sheet so the user can pick
  // "Save Image" / "Save Video" — that's the only sanctioned route to
  // Photos without the photo-library plugin. On the web we trigger a
  // standard download.
  const handleSave = useCallback(async (item: LightboxItem) => {
    if (!item.url || saving) return;
    setSaving(true);
    triggerHaptic(ImpactStyle.Light);
    try {
      const ext = item.kind === "video" ? "mp4" : "jpg";
      const fileName = `wcw-${item.kind}-${item.id}.${ext}`;

      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const s = reader.result as string;
            resolve(s.split(",")[1] ?? "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const written = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({
          title: item.kind === "video" ? "Save video" : "Save photo",
          url: written.uri,
          dialogTitle: "Save to Photos",
        });
      } else if (typeof navigator !== "undefined" && navigator.share && navigator.canShare) {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: blob.type || (item.kind === "video" ? "video/mp4" : "image/jpeg") });
        const shareData: ShareData = { files: [file] };
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
          } catch (e) {
            if ((e as DOMException).name !== "AbortError") throw e;
          }
        } else {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        }
      } else {
        const a = document.createElement("a");
        a.href = item.url;
        a.download = fileName;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      logger.warn("MediaLightbox save failed", { error: err });
      // User-cancelled share on iOS throws too; only toast on real failures
      if (!(err instanceof Error && /cancel/i.test(err.message))) {
        toast({
          title: "Couldn't save",
          description: "Try again in a moment.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  }, [saving, toast]);

  if (!open || items.length === 0) return null;

  const active = items[activeIndex] ?? items[0];
  const opacity = Math.max(0.4, 1 - dragY / 600);

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] bg-black flex flex-col touch-none"
      style={{
        opacity,
        transform: `translateY(${dragY}px)`,
        transition: dragY === 0 ? "transform 220ms ease, opacity 220ms ease" : "none",
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="h-9 w-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center active:bg-white/25 transition-colors"
        >
          <X className="h-4 w-4 text-white" strokeWidth={2.4} />
        </button>
        <span className="text-[12px] font-medium text-white/80 tabular-nums">
          {activeIndex + 1} / {items.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSave(active)}
            disabled={saving || !active.url}
            aria-label={active.kind === "video" ? "Save video" : "Save photo"}
            className="h-9 w-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center active:bg-white/25 transition-colors text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" strokeWidth={2.2} />}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(active)}
              aria-label="Delete media"
              className="h-9 w-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center active:bg-white/25 transition-colors text-func-danger-red"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* Pager */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hide touch-pan-x"
        style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
      >
        {items.map((m, i) => (
          <div
            key={m.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className="snap-center shrink-0 w-screen h-full flex items-center justify-center"
          >
            {!m.url ? (
              <div className="text-white/60 text-sm">Media unavailable</div>
            ) : Math.abs(i - activeIndex) > 1 ? (
              // Off-screen slides don't mount media — stops the pager from
              // fetching every clip the moment the lightbox opens. Loads as
              // they're swiped within one of the active neighbour.
              <div className="h-10 w-10 rounded-full border-2 border-white/15 border-t-white/50 animate-spin" />
            ) : m.kind === "video" ? (
              <video
                src={m.url}
                className="max-h-full max-w-full"
                controls
                playsInline
                preload={i === activeIndex ? "auto" : "none"}
              />
            ) : (
              <img
                src={m.url}
                alt={m.caption ?? "Training media"}
                className="max-h-full max-w-full object-contain"
                draggable={false}
                decoding="async"
              />
            )}
          </div>
        ))}
      </div>

      {/* Bottom caption strip */}
      <div
        className="absolute bottom-0 inset-x-0 z-10 px-5 pb-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="flex items-center gap-2 text-white/80">
          {active.sessionType && (
            <span className="text-[10px] uppercase tracking-wider font-semibold bg-white/15 backdrop-blur-md px-2 py-0.5 rounded-full">
              {active.sessionType}
            </span>
          )}
          {active.sessionTag && (
            <span className="text-[10px] uppercase tracking-wider font-medium bg-white/10 backdrop-blur-md px-2 py-0.5 rounded-full">
              {active.sessionTag}
            </span>
          )}
          {active.capturedAt && (
            <span className="text-[12px] tabular-nums">
              {safeDate(active.capturedAt)}
            </span>
          )}
        </div>
        {active.caption && (
          <p className="mt-1.5 text-[14px] text-white leading-snug line-clamp-3">
            {active.caption}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function safeDate(iso: string): string {
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return iso;
  }
}
