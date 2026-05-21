/**
 * SwipeDial — horizontal scroll-snap picker that replaces multi-row chip
 * grids with a single-line "wheel" selector. The active option sits in
 * a fixed center frame; the user swipes horizontally to bring a different
 * option into the frame, or taps any option to scroll it to center.
 *
 * Why this shape:
 *  - Eats one line of vertical space regardless of option count.
 *  - Reads as a familiar iOS-style picker (haptic feedback on settle).
 *
 * Implementation notes:
 *  - Uses native CSS `scroll-snap-x mandatory` with snap-center on each
 *    option button so iOS Safari momentum settles cleanly.
 *  - The scroller pads itself with `padding-inline: calc(50% - cellWidth/2)`
 *    instead of manual padder divs — manual padders rounded to integer
 *    pixels and broke the last option's snap target on devices with
 *    fractional widths (e.g. 375px / 430px iPhones). With CSS padding the
 *    browser handles sub-pixel layout internally so the last option's
 *    snap point exactly equals max scrollLeft.
 *  - The active option is determined by which BUTTON is closest to the
 *    scroller's visual center (DOM-measured), not by `Math.round(scrollLeft
 *    / cellWidth)`. Math-based indexing assumed leftPad was exactly
 *    `(clientWidth - cellWidth) / 2`; when browsers rounded that, the
 *    indexer drifted half a cell and the bubble visually straddled two
 *    labels while the last option became unreachable (math target exceeded
 *    max scrollLeft, scrollTo clamped short, settle re-fired forever).
 *  - The center frame is an absolute overlay (pointer-events-none) so
 *    taps still hit the underlying option button.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { triggerHapticSelection } from "@/lib/haptics";

export interface SwipeDialOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SwipeDialOption[];
  onChange: (value: string) => void;
  /** Visual width of each option cell, in px. 110 reads well at default
   *  font-size; tweak if labels truncate. */
  cellWidth?: number;
  className?: string;
  ariaLabel?: string;
}

// 160ms is long enough to outlast iOS momentum-scroll snap settle while
// still feeling responsive after a deliberate flick.
const SETTLE_MS = 160;
// iOS smooth scrolls run ~300-500ms. Suppress the settle handler for the
// full duration so the smooth scroll's own scroll events don't restart
// the settle loop while we're still mid-correction.
const SMOOTH_SCROLL_MS = 500;
// Anything within this many pixels of the snap target is considered
// already snapped — avoids fighting sub-pixel rounding noise.
const SNAP_TOLERANCE_PX = 1.5;

export function SwipeDial({
  value,
  options,
  onChange,
  cellWidth = 110,
  className = "",
  ariaLabel,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<string>(value);
  // True while WE'RE driving the scroll (programmatic correction or
  // external value sync). Suppresses the settle handler so our own
  // scroll events don't trip another correction → onChange → re-render
  // loop.
  const programmaticRef = useRef(false);

  const activeIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value],
  );

  // scrollLeft needed to put a button's center at the scroller's visual
  // center. Uses the button's measured offsetLeft, so it's immune to
  // sub-pixel padder rounding.
  const centerOffsetFor = useCallback((idx: number): number | null => {
    const el = scrollerRef.current;
    const btn = buttonsRef.current[idx];
    if (!el || !btn) return null;
    return btn.offsetLeft + btn.offsetWidth / 2 - el.clientWidth / 2;
  }, []);

  const indexClosestToCenter = useCallback((): number => {
    const el = scrollerRef.current;
    if (!el) return 0;
    const target = el.scrollLeft + el.clientWidth / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < options.length; i++) {
      const btn = buttonsRef.current[i];
      if (!btn) continue;
      const c = btn.offsetLeft + btn.offsetWidth / 2;
      const d = Math.abs(c - target);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [options.length]);

  const markProgrammatic = useCallback((ms: number) => {
    programmaticRef.current = true;
    if (programmaticClearTimer.current) clearTimeout(programmaticClearTimer.current);
    programmaticClearTimer.current = setTimeout(() => {
      programmaticRef.current = false;
    }, ms);
  }, []);

  const emit = useCallback(
    (idx: number) => {
      const v = options[idx]?.value;
      if (v && v !== lastEmittedRef.current) {
        lastEmittedRef.current = v;
        triggerHapticSelection();
        onChange(v);
      }
    },
    [options, onChange],
  );

  // Sync external value -> scroll position when value changes from outside.
  useEffect(() => {
    if (lastEmittedRef.current === value) return;
    const el = scrollerRef.current;
    if (!el) return;
    const target = centerOffsetFor(activeIndex);
    if (target === null) return;
    if (Math.abs(el.scrollLeft - target) > SNAP_TOLERANCE_PX) {
      markProgrammatic(80);
      el.scrollTo({ left: target, behavior: "auto" });
    }
    lastEmittedRef.current = value;
  }, [activeIndex, value, centerOffsetFor, markProgrammatic]);

  const handleScroll = useCallback(() => {
    if (programmaticRef.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const idx = indexClosestToCenter();
      const target = centerOffsetFor(idx);

      // Magnetic settle — uses smooth so it reads as a soft snap. The
      // programmatic flag is held for the full smooth-scroll duration
      // so the resulting scroll events don't kick the settle loop again.
      if (target !== null && Math.abs(el.scrollLeft - target) > SNAP_TOLERANCE_PX) {
        markProgrammatic(SMOOTH_SCROLL_MS);
        el.scrollTo({ left: target, behavior: "smooth" });
      }

      emit(idx);
    }, SETTLE_MS);
  }, [centerOffsetFor, emit, indexClosestToCenter, markProgrammatic]);

  const scrollToIndex = useCallback(
    (idx: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const target = centerOffsetFor(idx);
      if (target === null) return;
      markProgrammatic(SMOOTH_SCROLL_MS);
      el.scrollTo({ left: target, behavior: "smooth" });
      emit(idx);
    },
    [centerOffsetFor, emit, markProgrammatic],
  );

  // Re-anchor the active item on mount and after resize (orientation
  // change, dynamic viewport on iOS).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const sync = () => {
      const target = centerOffsetFor(activeIndex);
      if (target === null) return;
      markProgrammatic(80);
      el.scrollTo({ left: target, behavior: "auto" });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeIndex, cellWidth, centerOffsetFor, markProgrammatic]);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (programmaticClearTimer.current) clearTimeout(programmaticClearTimer.current);
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      {/* Center "selection" frame. Pointer-events-none so taps fall through. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xs bg-primary/10 ring-1 ring-primary/40"
        style={{ width: cellWidth - 8, height: 40 }}
      />

      <div
        ref={scrollerRef}
        role="listbox"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className="flex items-center overflow-x-auto overflow-y-hidden scrollbar-hide snap-x snap-mandatory h-12 rounded-xs bg-muted/20"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
          paddingInline: `calc(50% - ${cellWidth / 2}px)`,
        }}
      >
        {options.map((opt, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                buttonsRef.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => scrollToIndex(i)}
              className="snap-center shrink-0 h-12 flex items-center justify-center"
              style={{ width: cellWidth }}
            >
              <span
                className={`text-[14px] truncate px-2 transition-all ${
                  active
                    ? "font-semibold text-foreground scale-100"
                    : "font-medium text-muted-foreground/60 scale-95"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
