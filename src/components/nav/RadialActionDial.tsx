/**
 * RadialActionDial — iOS-style radial long-press dial.
 *
 * `children` render as the trigger (e.g. a camera FAB). A press-and-hold of
 * `longPressMs` opens a fan of `options` arranged on a quarter-arc above
 * the trigger; the user drags a finger to the desired option and releases
 * to fire it. A simple tap (no long-press) fires `onTap`.
 *
 * State machine:
 *   IDLE → pointerdown → PRESSED
 *     PRESSED → pointerup (over trigger, pre-timer) → onTap() → IDLE
 *     PRESSED → timer fires → DIAL_OPEN
 *       DIAL_OPEN → pointermove → highlight closest option within SNAP_PX
 *       DIAL_OPEN → pointerup over highlighted bubble → onSelect(id) → IDLE
 *       DIAL_OPEN → pointerup w/no highlight | backdrop tap → close → IDLE
 *
 * Implementation notes:
 *  • Pointer Events only — Capacitor's WKWebView surfaces touch as pointer
 *    events. `setPointerCapture` keeps move/up routed to the trigger even
 *    when the finger drifts over a bubble or the backdrop.
 *  • `touch-action: none` on the trigger prevents iOS scroll-cancel from
 *    eating the long-press.
 *  • `useReducedMotion`: bubbles snap to final arc position, no springs.
 *  • Single-pointer only — secondary pointers are ignored.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImpactStyle } from "@capacitor/haptics";

import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";

// ─── Public API ─────────────────────────────────────────────────────────

export interface RadialActionOption {
  id: string;
  label: string;
  iconName: IonIconName;
  tone?: "primary" | "amber" | "green";
}

interface RadialActionDialProps {
  /** 2–4 options that fan above the trigger. */
  options: RadialActionOption[];
  /** Fires on a simple tap (no long-press), finger released over the trigger. */
  onTap: () => void;
  /** Fires when the user releases over a highlighted dial option. */
  onSelect: (optionId: string) => void;
  /** ms to hold before the dial opens. Default 320ms. */
  longPressMs?: number;
  /** Optional className for the trigger wrapper. */
  className?: string;
  /** The trigger visual (camera FAB etc.). Rendered inside the gesture target. */
  children: ReactNode;
}

// ─── Layout constants ──────────────────────────────────────────────────

const DIAL_RADIUS = 92; // px from trigger centre to bubble centre
const SNAP_PX = 80;     // highlight tolerance
const BUBBLE_SIZE = 52; // px (square)

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Per-option arc offsets relative to the trigger centre. Angles are degrees
 * counter-clockwise from +x (so 90° = straight up); the dial fans in the
 * upper hemisphere. Browser +y is DOWN, so we invert dy.
 */
function arcOffsets(count: number): Array<{ dx: number; dy: number }> {
  let angles: number[];
  switch (count) {
    case 2: angles = [150, 30]; break;
    case 3: angles = [150, 90, 30]; break;
    case 4: angles = [155, 105, 75, 25]; break;
    default:
      angles = Array.from({ length: count }, (_, i) => {
        const t = count === 1 ? 0.5 : i / (count - 1);
        return 155 - t * (155 - 25);
      });
  }
  return angles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { dx: Math.cos(rad) * DIAL_RADIUS, dy: -Math.sin(rad) * DIAL_RADIUS };
  });
}

function toneClasses(tone: RadialActionOption["tone"], highlighted: boolean): string {
  // Frosted-glass bubble surface — a translucent light fill on top of the
  // darkened scrim so the bubbles pop against the near-black app chrome
  // below. `bg-card` was nearly invisible against the dark backdrop.
  const base = "bg-white/[0.10] backdrop-blur-xl border-[1.5px]";
  if (!highlighted)
    return `${base} border-white/35 shadow-[0_8px_24px_rgba(0,0,0,0.55)]`;
  switch (tone) {
    case "amber":
      return `${base} border-amber-300 shadow-[0_0_22px_rgba(251,191,36,0.65)]`;
    case "green":
      return `${base} border-emerald-300 shadow-[0_0_22px_rgba(52,211,153,0.65)]`;
    case "primary":
    default:
      return `${base} border-primary shadow-[0_0_22px_rgba(139,126,234,0.7)]`;
  }
}

function toneIconColor(tone: RadialActionOption["tone"]): string {
  if (tone === "amber") return "text-amber-400";
  if (tone === "green") return "text-emerald-400";
  return "text-primary";
}

// ─── Component ─────────────────────────────────────────────────────────

export function RadialActionDial({
  options,
  onTap,
  onSelect,
  longPressMs = 320,
  className,
  children,
}: RadialActionDialProps): JSX.Element {
  const prefersReducedMotion = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // UI state — mirrored to refs where pointer callbacks need the latest
  // synchronous value.
  const [dialOpen, setDialOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [triggerCentre, setTriggerCentre] = useState({ x: 0, y: 0 });

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const dialOpenRef = useRef(false);
  const highlightedIdRef = useRef<string | null>(null);
  const moveRafRef = useRef<number | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const offsets = useMemo(() => arcOffsets(options.length), [options.length]);

  // Latest-callback refs — parent re-renders shouldn't tear down handlers.
  const onTapRef = useRef(onTap);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const clearTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const cancelRaf = useCallback(() => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
  }, []);

  const measureTriggerCentre = useCallback((): { x: number; y: number } => {
    const el = triggerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const closeDial = useCallback(() => {
    setDialOpen(false);
    dialOpenRef.current = false;
    setHighlightedId(null);
    highlightedIdRef.current = null;
    lastPointerRef.current = null;
    cancelRaf();
  }, [cancelRaf]);

  const resetAll = useCallback(() => {
    clearTimer();
    cancelRaf();
    activePointerIdRef.current = null;
    longPressFiredRef.current = false;
    lastPointerRef.current = null;
    setDialOpen(false);
    dialOpenRef.current = false;
    setHighlightedId(null);
    highlightedIdRef.current = null;
  }, [cancelRaf, clearTimer]);

  // Defensive cleanup on unmount.
  useEffect(() => () => { clearTimer(); cancelRaf(); }, [cancelRaf, clearTimer]);

  // ─── Hit detection (rAF-throttled) ──────────────────────────────────
  const computeHighlight = useCallback(() => {
    moveRafRef.current = null;
    if (!dialOpenRef.current) return;
    const pointer = lastPointerRef.current;
    if (!pointer) return;

    let best: { id: string; dist: number } | null = null;
    for (let i = 0; i < options.length; i++) {
      const off = offsets[i];
      const bx = triggerCentre.x + off.dx;
      const by = triggerCentre.y + off.dy;
      const dist = Math.hypot(pointer.x - bx, pointer.y - by);
      if (dist <= SNAP_PX && (best === null || dist < best.dist)) {
        best = { id: options[i].id, dist };
      }
    }
    const nextId = best?.id ?? null;
    if (nextId !== highlightedIdRef.current) {
      highlightedIdRef.current = nextId;
      setHighlightedId(nextId);
      // Selection haptic on every highlight crossing (including → null).
      void triggerHapticSelection();
    }
  }, [offsets, options, triggerCentre]);

  // ─── Pointer handlers on the trigger ────────────────────────────────
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== null) return; // first pointer wins
      if (e.button !== undefined && e.button !== 0) return; // primary only

      activePointerIdRef.current = e.pointerId;
      longPressFiredRef.current = false;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      // Capture so moves outside the trigger keep firing on this element.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }

      clearTimer();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressFiredRef.current = true;
        setTriggerCentre(measureTriggerCentre());
        dialOpenRef.current = true;
        setDialOpen(true);
        void triggerHaptic(ImpactStyle.Medium);
        if (moveRafRef.current === null) {
          moveRafRef.current = requestAnimationFrame(computeHighlight);
        }
      }, longPressMs);
    },
    [clearTimer, computeHighlight, longPressMs, measureTriggerCentre],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!dialOpenRef.current) return; // pre-open: no highlight work
      if (moveRafRef.current === null) {
        moveRafRef.current = requestAnimationFrame(computeHighlight);
      }
    },
    [computeHighlight],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      activePointerIdRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      clearTimer();
      cancelRaf();

      const wasLongPress = longPressFiredRef.current;
      const highlighted = highlightedIdRef.current;

      if (wasLongPress) {
        // Releasing back near the trigger (no highlight) is a cancellation.
        if (highlighted) {
          void triggerHaptic(ImpactStyle.Medium);
          onSelectRef.current(highlighted);
        }
        closeDial();
        longPressFiredRef.current = false;
        return;
      }

      // Pre-long-press release — tap only if released over the trigger.
      const rect = triggerRef.current?.getBoundingClientRect();
      const insideTrigger =
        rect !== undefined &&
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom;
      lastPointerRef.current = null;
      if (insideTrigger) {
        void triggerHaptic(ImpactStyle.Light);
        onTapRef.current();
      }
    },
    [cancelRaf, clearTimer, closeDial],
  );

  const handlePointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      resetAll();
    },
    [resetAll],
  );

  // Window blur (system gesture / app backgrounded mid-press) — tear down
  // even if no pointercancel arrives.
  useEffect(() => {
    const onWindowBlur = () => {
      if (activePointerIdRef.current !== null) resetAll();
    };
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, [resetAll]);

  // Suppress the synthetic click iOS dispatches after pointerup so the tap
  // path doesn't double-fire (mirrors useFabGesture in useRoundCardCapture).
  const handleClick = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);
  const handleContextMenu = useCallback((e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  // Backdrop tap — close without firing anything. Stops here so the
  // pointerdown doesn't reach the trigger underneath.
  const handleBackdropPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      resetAll();
    },
    [resetAll],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`relative select-none touch-none ${className ?? ""}`.trim()}
        aria-label="Open action dial (long-press) or trigger primary action (tap)"
      >
        {children}
      </button>

      <AnimatePresence>
        {dialOpen && (
          <motion.div
            key="radial-dial-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
            // z-[10000] sits above bottom-nav (z-9999). The backdrop
            // captures backdrop-only pointerdown for tap-to-dismiss; the
            // active pointer-captured gesture routes events to the trigger
            // directly so this overlay doesn't intercept the drag.
            className="fixed inset-0 z-[10000] bg-black/65 backdrop-blur-md pointer-events-auto"
            onPointerDown={handleBackdropPointerDown}
            aria-hidden
          >
            {options.map((opt, i) => (
              <DialBubble
                key={opt.id}
                option={opt}
                centre={triggerCentre}
                offset={offsets[i]}
                highlighted={highlightedId === opt.id}
                stagger={i}
                prefersReducedMotion={!!prefersReducedMotion}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── DialBubble ────────────────────────────────────────────────────────

interface DialBubbleProps {
  option: RadialActionOption;
  centre: { x: number; y: number };
  offset: { dx: number; dy: number };
  highlighted: boolean;
  stagger: number;
  prefersReducedMotion: boolean;
}

// Half-width of the visual footprint per bubble (bubble OR its label,
// whichever is wider). Labels like "Nutrition" or "Training" are roughly
// 70-90px wide centred on the bubble — using 48px on each side covers them
// with a small extra cushion before clipping kicks in.
const BUBBLE_HALF_FOOTPRINT = 48;
const VIEWPORT_MARGIN = 12;

function DialBubble({
  option,
  centre,
  offset,
  highlighted,
  stagger,
  prefersReducedMotion,
}: DialBubbleProps): JSX.Element {
  // Clamp the horizontal offset so the bubble + its label stay within the
  // viewport. The camera FAB sits near the centre of the bottom-nav but is
  // not always at exact viewport centre (other nav items shift it), so the
  // right- or left-most arc position can clip off-screen without this guard.
  let clampedDx = offset.dx;
  const vw =
    typeof window !== "undefined" ? window.innerWidth : Number.POSITIVE_INFINITY;
  const cx = centre.x + clampedDx;
  if (cx + BUBBLE_HALF_FOOTPRINT > vw - VIEWPORT_MARGIN) {
    clampedDx = vw - VIEWPORT_MARGIN - BUBBLE_HALF_FOOTPRINT - centre.x;
  } else if (cx - BUBBLE_HALF_FOOTPRINT < VIEWPORT_MARGIN) {
    clampedDx = VIEWPORT_MARGIN + BUBBLE_HALF_FOOTPRINT - centre.x;
  }

  const targetX = centre.x + clampedDx - BUBBLE_SIZE / 2;
  const targetY = centre.y + offset.dy - BUBBLE_SIZE / 2;
  const triggerX = centre.x - BUBBLE_SIZE / 2;
  const triggerY = centre.y - BUBBLE_SIZE / 2;

  // Reduced motion: snap to final pos, no spring on highlight.
  const initial = prefersReducedMotion
    ? { x: targetX, y: targetY, opacity: 1, scale: 1 }
    : { x: triggerX, y: triggerY, opacity: 0, scale: 0.6 };

  const animate = {
    x: targetX,
    y: targetY,
    opacity: 1,
    scale: highlighted && !prefersReducedMotion ? 1.15 : 1,
  };

  const exit = prefersReducedMotion
    ? { opacity: 0 }
    : { x: triggerX, y: triggerY, opacity: 0, scale: 0.6 };

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, damping: 22, stiffness: 380, delay: stagger * 0.04 };

  return (
    <motion.div
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition}
      // pointer-events-none — backdrop owns dismiss-on-tap, and selection
      // is driven by the captured pointer on the trigger (not bubble hits).
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: BUBBLE_SIZE,
        height: BUBBLE_SIZE,
        pointerEvents: "none",
      }}
    >
      <div
        className={`flex h-full w-full items-center justify-center rounded-full ${toneClasses(option.tone, highlighted)}`}
      >
        <Icon
          name={option.iconName}
          size={22}
          className={toneIconColor(option.tone)}
          aria-label={option.label}
        />
      </div>
      <div
        className={`absolute left-1/2 -translate-x-1/2 top-full mt-1.5 text-[11px] tabular-nums font-semibold whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] ${
          highlighted ? "text-white" : "text-white/85"
        }`}
      >
        {option.label}
      </div>
    </motion.div>
  );
}
