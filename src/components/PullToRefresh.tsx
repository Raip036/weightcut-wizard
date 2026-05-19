import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { getPullRefreshHandler } from "@/lib/pullRefreshRegistry";

const THRESHOLD = 110;
const DAMPEN = 0.4;
// If the finger moves upward at all before pulling down past this guard,
// treat the gesture as a scroll-to-top — not a pull-to-refresh.
const UPWARD_CANCEL_PX = 8;
// Raw finger pixels of downward intent before we engage the gesture.
// Below this, we let native scroll handle the touch (no preventDefault, no
// pull distance), so small drifts at scrollTop=0 don't feel "sticky".
const INTENT_PX = 30;
// Once past the threshold, the user must hold this long before refresh fires.
// Prevents accidental triggers from quick flicks that happen to cross threshold.
const HOLD_DURATION_MS = 500;

export function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);
  const armed = useRef(false);
  const holdStart = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const getMain = useCallback(() => document.querySelector("main"), []);

  // Walk from the touch target up to <main>, checking every scrollable ancestor.
  // Pages that put content inside an inner scroll container would otherwise leave
  // <main>.scrollTop = 0 even when visually scrolled down — and pull-to-refresh
  // would fire incorrectly. Returns true if any ancestor scroller is past top.
  const anyAncestorScrolled = useCallback((target: EventTarget | null, mainEl: Element): boolean => {
    let node: Element | null = target instanceof Element ? target : null;
    while (node && node !== mainEl.parentElement) {
      if (node instanceof HTMLElement && node.scrollTop > 0) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return true;
      }
      node = node.parentElement;
    }
    return false;
  }, []);

  useEffect(() => {
    const main = getMain();
    if (!main) return;

    const clearHold = () => {
      holdStart.current = null;
      if (holdRaf.current !== null) {
        cancelAnimationFrame(holdRaf.current);
        holdRaf.current = null;
      }
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      setHoldProgress(0);
    };

    const tickHold = () => {
      if (holdStart.current === null) return;
      const elapsed = Date.now() - holdStart.current;
      setHoldProgress(Math.min(elapsed / HOLD_DURATION_MS, 1));
      if (elapsed < HOLD_DURATION_MS) {
        holdRaf.current = requestAnimationFrame(tickHold);
      }
    };

    const triggerRefresh = () => {
      pulling.current = false;
      armed.current = false;
      clearHold();
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.7);
      triggerHaptic(ImpactStyle.Medium);
      const handler = getPullRefreshHandler();
      if (handler) {
        Promise.resolve()
          .then(() => handler())
          .catch(() => window.location.reload())
          .finally(() => {
            setTimeout(() => {
              setRefreshing(false);
              setPullDistance(0);
            }, 250);
          });
      } else {
        setTimeout(() => window.location.reload(), 300);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (main.scrollTop > 0) return;
      // Inner scroll containers must also be at top — otherwise this is a scroll
      // gesture inside an inner panel, not a page-level pull.
      if (anyAncestorScrolled(e.target, main)) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
      armed.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshing) return;
      if (main.scrollTop > 0 || anyAncestorScrolled(e.target, main)) {
        pulling.current = false;
        armed.current = false;
        clearHold();
        setPullDistance(0);
        return;
      }
      const dy = e.touches[0].clientY - startY.current;
      // Cancel if the user drags upward — they're scrolling to the top, not pulling.
      if (dy < -UPWARD_CANCEL_PX) {
        pulling.current = false;
        armed.current = false;
        clearHold();
        setPullDistance(0);
        return;
      }
      if (dy > 0) {
        // Intent gate: don't take over the gesture until the user has
        // committed to a real pull. Below INTENT_PX we let native scroll
        // handle the touch (a no-op/tiny bounce at scrollTop=0), which
        // avoids the "sticky" feel from preventDefault-ing every drift.
        if (dy < INTENT_PX) return;
        // Suppress native scroll while we're owning the gesture so the indicator
        // stays attached to the finger instead of fighting iOS rubber-band.
        if (e.cancelable) e.preventDefault();
        // Subtract INTENT_PX so pull distance starts at 0 the moment we
        // engage, instead of jumping by ~12px (INTENT_PX * DAMPEN).
        const dampened = Math.min((dy - INTENT_PX) * DAMPEN, THRESHOLD * 1.6);
        setPullDistance(dampened);
        // Once past threshold, start (or maintain) the hold timer. Releasing
        // before HOLD_DURATION_MS elapses cancels — the user must commit.
        if (dampened >= THRESHOLD) {
          if (!armed.current) {
            armed.current = true;
            triggerHaptic(ImpactStyle.Light);
          }
          if (holdStart.current === null) {
            holdStart.current = Date.now();
            holdRaf.current = requestAnimationFrame(tickHold);
            holdTimer.current = window.setTimeout(triggerRefresh, HOLD_DURATION_MS);
          }
        } else {
          // Dropped below threshold — abort any pending hold.
          if (armed.current) armed.current = false;
          if (holdStart.current !== null) clearHold();
        }
      }
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      armed.current = false;
      // Released before the hold completed — cancel pending refresh and collapse.
      clearHold();
      if (!refreshing) setPullDistance(0);
    };

    main.addEventListener("touchstart", onTouchStart, { passive: true });
    main.addEventListener("touchmove", onTouchMove, { passive: false });
    main.addEventListener("touchend", onTouchEnd, { passive: true });
    main.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      main.removeEventListener("touchstart", onTouchStart);
      main.removeEventListener("touchmove", onTouchMove);
      main.removeEventListener("touchend", onTouchEnd);
      main.removeEventListener("touchcancel", onTouchEnd);
      clearHold();
    };
  }, [refreshing, getMain, anyAncestorScrolled]);

  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const atThreshold = progress >= 1;

  return (
    <div
      className="flex flex-col items-center justify-center w-full pointer-events-none md:hidden"
      style={{
        height: `${pullDistance}px`,
        transition: pulling.current ? "none" : "height 0.3s ease-out",
        overflow: "hidden",
      }}
    >
      <div
        className="relative h-8 w-8 rounded-full bg-muted/80 border border-border/50 flex items-center justify-center"
        style={{
          opacity: Math.max(0.3, progress),
          transform: `scale(${0.6 + progress * 0.4})`,
          transition: pulling.current ? "none" : "all 0.3s ease-out",
        }}
      >
        {/* Hold-progress ring fills clockwise as the user keeps holding past threshold */}
        {atThreshold && !refreshing && (
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-foreground"
              strokeDasharray={`${holdProgress * 88} 88`}
              strokeLinecap="round"
            />
          </svg>
        )}
        <RefreshCw
          className={`h-4 w-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        />
      </div>
      {atThreshold && !refreshing && (
        <span className="text-[10px] text-muted-foreground/70 mt-1 tabular-nums">
          {holdProgress >= 1 ? "Refreshing…" : "Hold to refresh"}
        </span>
      )}
    </div>
  );
}
