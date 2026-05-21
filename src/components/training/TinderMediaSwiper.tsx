/**
 * TinderMediaSwiper — fullscreen, throw-card-style media swiper.
 *
 * Used when the user wants a "Tinder" feel for flipping through their
 * session media — a single tilted card on screen, drag horizontal to
 * commit, fling-out exit, next card peeking behind. Distinct from
 * `MediaLightbox` (the scroll-snap pager): this one feels physical
 * and is the recommended viewer when the user explicitly chooses
 * "swipe mode" from a session.
 *
 * Performance budget:
 *  - Only ever mount 3 DOM cards (current + 2 stacked behind). Beyond
 *    that the cards live in JS state only — keeps photo decode + video
 *    metadata pulls bounded regardless of library size.
 *  - Drag uses `useMotionValue` so React never re-renders on each
 *    pointermove tick; transforms stay on the compositor.
 *  - Off-screen videos are paused. We never autoplay.
 *  - `will-change: transform` is set on the active card only; removed
 *    after settle so iOS Safari doesn't keep the GPU layer pinned.
 *
 * Spec values are picked from the brainstorm — see `SPEC` block below.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "motion/react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { LightboxItem } from "@/components/training/MediaLightbox";

interface Props {
  items: LightboxItem[];
  startIndex?: number;
  open: boolean;
  onClose: () => void;
}

// Pinned spec — copy/paste verbatim if any value gets tweaked later.
const SPEC = {
  /** Drag distance (fraction of card width) required to commit a throw. */
  commitThreshold: 0.32,
  /** Velocity (px/s) above which a flick commits regardless of distance. */
  velocityThreshold: 600,
  /** Max rotation at full-card-width drag. Smaller feels stiffer. */
  maxRotateDeg: 14,
  /** Spring back when the user releases below threshold. */
  springStiffness: 320,
  springDamping: 28,
  /** Throw-out exit distance multiplier (off-screen). */
  exitDistanceFactor: 1.6,
  /** Throw-out exit duration in ms. */
  exitMs: 280,
  /** Card behind the active one. */
  peekScale: 0.93,
  peekOpacity: 0.55,
  peekY: 14,
  /** How many cards to mount in the DOM at once (current + behind). */
  visibleStackCount: 3,
};

export function TinderMediaSwiper({
  items,
  startIndex = 0,
  open,
  onClose,
}: Props) {
  const [index, setIndex] = useState(startIndex);

  // Reset on (re)open. Index is owned here, not derived from props,
  // so a parent re-render mid-swipe doesn't snap us back.
  useEffect(() => {
    if (open) setIndex(startIndex);
  }, [open, startIndex]);

  // Lock body scroll while the swiper is open. Prevents the underlying
  // dialog from rubber-banding when the user drags vertically near the
  // edges of the card.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc to dismiss on web (Capacitor traps the OS back button).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const advance = useCallback(() => {
    setIndex((i) => Math.min(items.length - 1, i + 1));
  }, [items.length]);
  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const next = useCallback(() => {
    if (index < items.length - 1) {
      triggerHaptic(ImpactStyle.Light);
      advance();
    } else {
      // No next card — give a soft tap so the user knows they're at the end.
      triggerHaptic(ImpactStyle.Light);
    }
  }, [index, items.length, advance]);

  const prev = useCallback(() => {
    if (index > 0) {
      triggerHaptic(ImpactStyle.Light);
      back();
    }
  }, [index, back]);

  // Build the visible stack: current card at the top, plus the next 2
  // behind for the peek effect. Reversed so the topmost card paints last.
  const stack = useMemo(() => {
    const out: { item: LightboxItem; offset: number }[] = [];
    for (let off = SPEC.visibleStackCount - 1; off >= 0; off--) {
      const i = index + off;
      if (i < items.length) out.push({ item: items[i], offset: off });
    }
    return out;
  }, [index, items]);

  if (!open || items.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[10002] bg-black flex flex-col"
      onClick={(e) => {
        // Tap outside the card area also dismisses.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4"
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
        <div className="flex items-center gap-1.5">
          {/* Compact pager dots — caps at 12 to avoid edge-to-edge clutter. */}
          {items.length <= 12 ? (
            items.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/35"
                }`}
              />
            ))
          ) : (
            <span className="text-[12px] font-medium text-white/85 tabular-nums">
              {index + 1} / {items.length}
            </span>
          )}
        </div>
        <div className="h-9 w-9" />
      </div>

      {/* Card stack */}
      <div className="flex-1 flex items-center justify-center px-4 relative">
        <AnimatePresence initial={false}>
          {stack.map(({ item, offset }) => {
            const isActive = offset === 0;
            return (
              <SwipeCard
                key={item.id}
                item={item}
                isActive={isActive}
                offsetIndex={offset}
                onCommit={(direction) => {
                  triggerHaptic(ImpactStyle.Medium);
                  if (direction === "right") advance();
                  else if (direction === "left") {
                    // Throw-left also advances (unlike Tinder's like/nope —
                    // here every commit just moves to the next clip).
                    advance();
                  }
                }}
              />
            );
          })}
        </AnimatePresence>
      </div>

      {/* Bottom caption + arrows */}
      <div
        className="absolute bottom-0 inset-x-0 z-20 px-5 pb-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
      >
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-white/80 mb-1">
              {items[index]?.sessionType && (
                <span className="text-[10px] uppercase tracking-wider font-semibold bg-white/15 backdrop-blur-md px-2 py-0.5 rounded-full">
                  {items[index].sessionType}
                </span>
              )}
              {items[index]?.capturedAt && (
                <span className="text-[12px] tabular-nums">
                  {safeDate(items[index].capturedAt!)}
                </span>
              )}
            </div>
            {items[index]?.caption && (
              <p className="text-[14px] text-white leading-snug line-clamp-2">
                {items[index].caption}
              </p>
            )}
          </div>

          {/* Arrow shortcuts — ergonomics for one-handed use without
              relying on a perfect throw. Disabled at the edges. */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              aria-label="Previous"
              className="h-10 w-10 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={next}
              disabled={index >= items.length - 1}
              aria-label="Next"
              className="h-10 w-10 rounded-full bg-white/15 backdrop-blur-md text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SwipeCard — a single draggable card. The active card listens to drag,
// non-active cards render statically at peek positions behind it.
// ─────────────────────────────────────────────────────────────────────

function SwipeCard({
  item,
  isActive,
  offsetIndex,
  onCommit,
}: {
  item: LightboxItem;
  isActive: boolean;
  offsetIndex: number;
  onCommit: (direction: "left" | "right") => void;
}) {
  const x = useMotionValue(0);
  // Rotation scales linearly with x — simple, fast, no per-frame React
  // updates needed because `useTransform` lives in motion's reactive layer.
  const rotate = useTransform(
    x,
    [-window.innerWidth, 0, window.innerWidth],
    [-SPEC.maxRotateDeg, 0, SPEC.maxRotateDeg],
  );
  const opacity = useTransform(x, [-300, 0, 300], [0.6, 1, 0.6]);
  const [exiting, setExiting] = useState<"left" | "right" | null>(null);
  const [didLightHaptic, setDidLightHaptic] = useState(false);

  const handleDrag = (_e: unknown, info: PanInfo) => {
    // One soft haptic when the user crosses the commit threshold so they
    // *feel* the throw will commit on release. Reset when they drag back.
    const w = (typeof window !== "undefined" ? window.innerWidth : 360);
    const ratio = Math.abs(info.offset.x) / w;
    if (ratio > SPEC.commitThreshold && !didLightHaptic) {
      triggerHapticSelection();
      setDidLightHaptic(true);
    } else if (ratio < SPEC.commitThreshold * 0.6 && didLightHaptic) {
      setDidLightHaptic(false);
    }
  };

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const w = window.innerWidth || 360;
    const ratio = info.offset.x / w;
    const flicked = Math.abs(info.velocity.x) > SPEC.velocityThreshold;
    const committed = Math.abs(ratio) > SPEC.commitThreshold || flicked;
    if (committed) {
      const direction: "left" | "right" = ratio > 0 ? "right" : "left";
      setExiting(direction);
      // Let the exit animation play before bumping the index — the
      // committed card is removed from the stack via AnimatePresence.
      setTimeout(() => onCommit(direction), SPEC.exitMs);
    }
    setDidLightHaptic(false);
  };

  // Position non-active cards behind with a peek treatment. They don't
  // listen to drag and never receive pointer events.
  const baseStyle = isActive
    ? {
        x,
        rotate,
        opacity,
        zIndex: 10,
        willChange: "transform" as const,
      }
    : {
        x: 0,
        scale: SPEC.peekScale - offsetIndex * 0.04,
        y: SPEC.peekY * offsetIndex,
        opacity: SPEC.peekOpacity - offsetIndex * 0.15,
        zIndex: 10 - offsetIndex,
        willChange: "auto" as const,
      };

  return (
    <motion.div
      key={item.id}
      drag={isActive && !exiting ? "x" : false}
      dragElastic={0.7}
      dragMomentum={false}
      onDrag={isActive ? handleDrag : undefined}
      onDragEnd={isActive ? handleDragEnd : undefined}
      style={baseStyle}
      animate={
        exiting
          ? {
              x: (exiting === "right" ? 1 : -1) * window.innerWidth * SPEC.exitDistanceFactor,
              rotate: (exiting === "right" ? 1 : -1) * SPEC.maxRotateDeg * 1.6,
              opacity: 0,
              transition: { duration: SPEC.exitMs / 1000, ease: [0.32, 0.72, 0, 1] },
            }
          : isActive
          ? { x: 0 }
          : undefined
      }
      transition={{
        type: "spring",
        stiffness: SPEC.springStiffness,
        damping: SPEC.springDamping,
      }}
      exit={{ opacity: 0 }}
      className="absolute inset-x-4 top-[calc(env(safe-area-inset-top,0px)+72px)] bottom-[calc(env(safe-area-inset-bottom,0px)+120px)] rounded-xs overflow-hidden bg-zinc-900 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] touch-none"
    >
      {!item.url ? (
        <div className="h-full w-full flex items-center justify-center text-white/50 text-sm">
          Media unavailable
        </div>
      ) : item.kind === "video" ? (
        <video
          src={item.url}
          className="w-full h-full object-cover"
          // Only the active card autoplays controls; behind cards stay
          // visually frozen on their poster frame.
          controls={isActive}
          playsInline
          muted={!isActive}
          preload={isActive ? "auto" : "metadata"}
        />
      ) : (
        <img
          src={item.url}
          alt={item.caption ?? "Training media"}
          className="w-full h-full object-cover"
          // Eager-load the active card; everything behind can wait.
          loading={isActive ? "eager" : "lazy"}
          draggable={false}
        />
      )}
    </motion.div>
  );
}

function safeDate(iso: string): string {
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return iso;
  }
}
