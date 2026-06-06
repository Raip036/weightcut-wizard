/**
 * RestTimerPill — the auto-rest countdown shown during an active workout.
 *
 * Registers a `start(seconds)` with the rest-timer bus on mount, so completing
 * a set (anywhere in the tree) slides this pill up with a draining bar. The
 * user can adjust live (−15 / +15), Skip, or tap the time to change the
 * default duration via presets (persisted). At zero it fires a success haptic
 * and auto-dismisses. Non-blocking — the user can keep logging while it runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Timer, X } from "lucide-react";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
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

export function RestTimerPill() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState(0);
  const [left, setLeft] = useState(0);
  const intRef = useRef<number | null>(null);

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

  const pct = total > 0 ? Math.max(0, (left / total) * 100) : 0;
  const nearDone = left <= 3;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="rest-pill"
          initial={{ y: 140, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 140, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="fixed inset-x-3 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]"
          role="timer"
        >
          {editing ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            <div className="flex items-center gap-3">
              <Timer className={`h-5 w-5 shrink-0 ${nearDone ? "text-success" : "text-primary"}`} />
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex-1 min-w-0 text-left"
                aria-label="Change rest duration"
              >
                <span className="display-number text-[19px] font-bold tabular-nums leading-none">
                  {fmt(Math.max(0, left))}
                </span>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted-foreground/15">
                  <div
                    className={`h-full rounded-full ${nearDone ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${pct}%`, transition: "width 1s linear" }}
                  />
                </div>
              </button>
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
