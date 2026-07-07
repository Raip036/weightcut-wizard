/**
 * RestTimerPill: the auto-rest countdown shown during an active workout.
 *
 * Registers a `start(seconds)` with the rest-timer bus on mount, so completing
 * a set (anywhere in the tree) slides this pill up with a draining ring. The
 * user can adjust live (−15 / +15), Skip, or tap the ring to change the
 * default duration via presets (persisted). At zero it fires a success haptic
 * and auto-dismisses. Non-blocking, the user can keep logging while it runs.
 *
 * Visual: premium blue wizard-aurora treatment (subtle aurora wash behind a
 * depleting SVG countdown ring). Timing/haptics/bus logic below is untouched
 * from the previous linear-bar version - only the JSX changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import {
  registerRestStarter,
  REST_PRESETS,
  getDefaultRest,
  setDefaultRest,
} from "./restTimer";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

// Countdown ring geometry (SVG stroke-dashoffset technique, same math as
// MacroDonut.tsx elsewhere in the app).
const RING_SIZE = 60;
const RING_STROKE = 5;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

interface RestTimerPillProps {
  /** True while the docked SetEntryKeypad panel is open. The keypad is an
   *  opaque bottom-docked panel that otherwise covers this pill (and its tap
   *  catcher swallows taps meant for its ±15/Skip buttons). When true, the
   *  pill lifts above the keypad panel and raises its stacking order so it
   *  stays visible and tappable. Purely presentational — no timing changes. */
  keypadOpen?: boolean;
}

export function RestTimerPill({ keypadOpen = false }: RestTimerPillProps = {}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState(0);
  const [left, setLeft] = useState(0);
  const intRef = useRef<number | null>(null);
  const prefersReduced = useReducedMotion();

  const stop = useCallback(() => {
    if (intRef.current != null) {
      clearInterval(intRef.current);
      intRef.current = null;
    }
  }, []);

  const start = useCallback(
    (seconds: number) => {
      stop();
      setTotal(seconds);
      setLeft(seconds);
      setEditing(false);
      setOpen(true);
      intRef.current = window.setInterval(() => {
        setLeft((l) => {
          if (l <= 1) {
            stop();
            triggerHapticSuccess();
            window.setTimeout(() => setOpen(false), 650);
            return 0;
          }
          return l - 1;
        });
      }, 1000);
    },
    [stop],
  );

  useEffect(() => {
    registerRestStarter(start);
    return () => {
      registerRestStarter(null);
      stop();
    };
  }, [start, stop]);

  const adjust = (delta: number) => {
    triggerHaptic(ImpactStyle.Light);
    setLeft((l) => Math.max(0, l + delta));
    setTotal((t) => Math.max(t, left + delta));
  };

  const skip = () => {
    triggerHaptic(ImpactStyle.Light);
    stop();
    setOpen(false);
  };

  const pickPreset = (sec: number) => {
    triggerHaptic(ImpactStyle.Light);
    setDefaultRest(sec);
    start(sec);
  };

  // Ring depletes as rest counts down: fraction 1 -> 0 maps to
  // strokeDashoffset 0 -> RING_CIRC (empty ring at zero).
  const fraction = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const ringOffset = RING_CIRC * (1 - fraction);
  const nearDone = left <= 3;
  const ringColor = nearDone ? "hsl(var(--success))" : "hsl(var(--primary))";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="rest-pill"
          initial={{ y: 140, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 140, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className={cn(
            "fixed inset-x-3 overflow-hidden rounded-2xl border border-primary/25 bg-card/95 backdrop-blur-xl p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]",
            // The docked keypad panel is z-50 with its own z-40 full-screen tap
            // catcher underneath it. When the keypad is open, lift this pill
            // clear of the panel's height and above both layers (z-[60]) so its
            // ±15/Skip buttons stay reachable instead of being covered/eaten by
            // the tap catcher. Closed state is unchanged from before.
            keypadOpen
              ? "bottom-[350px] z-[60]"
              : "bottom-[calc(88px+env(safe-area-inset-bottom))] z-40",
          )}
          role="timer"
        >
          {/* Subtle blue aurora wash - opacity/scale only, no blur/box-shadow,
              internally respects prefers-reduced-motion. */}
          <WizardAuroraBackground intensity="subtle" motes={false} />

          {editing ? (
            <div className="relative">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                  Rest duration
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-muted-foreground active:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REST_PRESETS.map((p) => {
                  const isCur = p === total || p === getDefaultRest();
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => pickPreset(p)}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-semibold tabular-nums transition-colors ${
                        isCur
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 text-muted-foreground border border-border/40"
                      }`}
                    >
                      {fmt(p)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="relative flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="relative shrink-0"
                style={{ width: RING_SIZE, height: RING_SIZE }}
                aria-label="Change rest duration"
              >
                <svg
                  viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                  className="h-full w-full -rotate-90"
                >
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_R}
                    fill="none"
                    stroke="hsl(var(--primary) / 0.15)"
                    strokeWidth={RING_STROKE}
                  />
                  <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_R}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRC}
                    strokeDashoffset={ringOffset}
                    style={{
                      transition: prefersReduced ? "none" : "stroke-dashoffset 1s linear",
                    }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="display-number text-[15px] font-bold tabular-nums leading-none">
                    {fmt(Math.max(0, left))}
                  </span>
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-primary/80">
                  <Timer className="h-3 w-3 shrink-0" />
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wider">
                    Rest
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => adjust(-15)}
                className="shrink-0 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13px] font-bold tabular-nums text-foreground active:scale-95"
              >
                −15
              </button>
              <button
                type="button"
                onClick={() => adjust(15)}
                className="shrink-0 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13px] font-bold tabular-nums text-foreground active:scale-95"
              >
                +15
              </button>
              <button
                type="button"
                onClick={skip}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted-foreground active:text-foreground"
              >
                Skip
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
