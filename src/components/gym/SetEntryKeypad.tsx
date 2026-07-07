import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Delete, ChevronDown, Minus, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";
import { useKeyboardAware } from "@/hooks/useKeyboardAware";

/** Weight step (kg) and reps step for the big +/- steppers. */
const WEIGHT_STEP = 2.5;
const REPS_STEP = 1;

type Field = "weight" | "reps";

interface SetEntryKeypadProps {
  open: boolean;
  activeField: Field;
  /** Identity of the set being edited. Resets the internal buffer when it or
   *  the active field changes (so switching sets/fields re-seeds the readout). */
  targetKey: string;
  weightKg: number | null;
  reps: number | null;
  /** Bodyweight sets have no editable load — weight controls are hidden. */
  isBodyweight?: boolean;
  /** Header hint, e.g. the exercise name. */
  label?: string;
  /** Fires on every keystroke/stepper change (commit-on-change). Guarded by parent. */
  onChange: (field: Field, value: number | null) => void;
  onToggleField: () => void;
  onLogSet: () => void;
  onDismiss: () => void;
  /** Disable "Log set" while an advance is settling, to avoid a double add. */
  logDisabled?: boolean;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function SetEntryKeypad({
  open,
  activeField,
  targetKey,
  weightKg,
  reps,
  isBodyweight = false,
  label,
  onChange,
  onToggleField,
  onLogSet,
  onDismiss,
  logDisabled = false,
}: SetEntryKeypadProps) {
  const reduceMotion = useReducedMotion();
  const { keyboardHeight } = useKeyboardAware();
  const isWeight = activeField === "weight";

  // Editing buffer for the active field. Kept as a string so decimal + backspace
  // behave predictably. Re-seeded ONLY when the target set or field changes,
  // never on `weightKg`/`reps` prop churn, so commit-on-change doesn't clobber
  // mid-entry.
  const [buf, setBuf] = useState("");
  useEffect(() => {
    const v = isWeight ? weightKg : reps;
    setBuf(v != null ? fmtNum(v) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, activeField]);

  const commit = useCallback(
    (next: string) => {
      setBuf(next);
      if (isWeight) {
        const val = next === "" ? null : parseFloat(next);
        onChange("weight", val != null && !isNaN(val) ? val : null);
      } else {
        const val = parseInt(next, 10);
        // Only push valid reps (>0); empty/NaN keeps the previous committed value.
        if (!isNaN(val) && val > 0) onChange("reps", val);
        else if (next === "") onChange("reps", null);
      }
    },
    [isWeight, onChange],
  );

  const pressDigit = useCallback(
    (d: string) => {
      triggerHapticSelection();
      // Guard against runaway length + a single decimal point (weight only).
      if (buf.replace(".", "").length >= 5) return;
      if (d === "." && (!isWeight || buf.includes("."))) return;
      if (d === "." && buf === "") {
        commit("0.");
        return;
      }
      commit(buf + d);
    },
    [buf, isWeight, commit],
  );

  const backspace = useCallback(() => {
    triggerHapticSelection();
    commit(buf.slice(0, -1));
  }, [buf, commit]);

  const step = useCallback(
    (dir: 1 | -1) => {
      triggerHapticSelection();
      if (isWeight) {
        const base = weightKg ?? 0;
        const next = Math.max(0, Math.round((base + dir * WEIGHT_STEP) * 100) / 100);
        commit(fmtNum(next));
      } else {
        const base = reps ?? 0;
        const next = Math.max(1, base + dir * REPS_STEP);
        commit(fmtNum(next));
      }
    },
    [isWeight, weightKg, reps, commit],
  );

  // Outside-tap handling for the docked pad's full-screen catcher. The
  // catcher sits above the scrollable set rows (so it can catch genuine taps
  // on empty space), which also means it eats taps meant for a DIFFERENT
  // set's weight/reps cell. Hit-test the point ourselves: if a keypad-target
  // cell (see SetRow's `data-keypad-target`) is underneath, forward the click
  // to it so the pad retargets in one tap instead of just dismissing.
  const handleOutsideTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const stack =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(e.clientX, e.clientY)
          : [];
      for (const el of stack) {
        const cell = el.closest?.("[data-keypad-target]") as HTMLElement | null;
        if (cell) {
          cell.click();
          return;
        }
      }
      onDismiss();
    },
    [onDismiss],
  );

  const displayValue = buf === "" ? "0" : buf;
  const unit = isWeight ? "kg" : "reps";

  const keys: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", isWeight ? "." : "", "0", "back"];

  const enterFrom = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 };
  const enterTo = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Tap-catcher so tapping away dismisses the pad. Transparent, no
              blur. Taps that land on another set's weight/reps cell retarget
              the pad instead of dismissing (see handleOutsideTap). */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            onClick={handleOutsideTap}
            aria-hidden
          />

          <motion.div
            initial={enterFrom}
            animate={enterTo}
            exit={enterFrom}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-x-0 bottom-0 z-50 border-t border-border/50 bg-card/95 [backdrop-filter:none]"
            style={{
              // Sit above the software keyboard should it ever appear; the pad
              // itself suppresses it, so this is normally just the safe-area inset.
              paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardHeight}px)`,
            }}
            role="group"
            aria-label="Set entry keypad"
          >
            <div className="mx-auto w-full max-w-md px-3 pt-2.5 pb-3">
              {/* Header: field toggle + readout + dismiss */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="inline-flex rounded-full bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => !isWeight && onToggleField()}
                    disabled={isBodyweight}
                    className={cn(
                      "px-3 py-1 rounded-full text-[12px] font-bold tracking-wide transition-colors",
                      isWeight ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      isBodyweight && "opacity-40",
                    )}
                  >
                    Weight
                  </button>
                  <button
                    type="button"
                    onClick={() => isWeight && onToggleField()}
                    className={cn(
                      "px-3 py-1 rounded-full text-[12px] font-bold tracking-wide transition-colors",
                      !isWeight ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                  >
                    Reps
                  </button>
                </div>

                <div className="flex-1 min-w-0 text-right">
                  {label && (
                    <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      {label}
                    </div>
                  )}
                  <div className="display-number text-2xl font-extrabold tabular-nums leading-none text-foreground">
                    {displayValue}
                    <span className="text-muted-foreground/60 text-sm font-bold ml-1">{unit}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Close keypad"
                  className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/70 active:bg-muted/60 transition-colors"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              </div>

              {/* Steppers + numeric pad */}
              <div className="flex items-stretch gap-2">
                {/* Left rail: big -/+ steppers */}
                <div className="flex flex-col gap-2 w-14 shrink-0">
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label={isWeight ? "Increase weight" : "Increase reps"}
                    className="flex-1 rounded-xl bg-primary/12 text-primary border border-primary/25 flex items-center justify-center active:bg-primary/20 transition-colors"
                  >
                    <Plus className="h-5 w-5" strokeWidth={2.6} />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label={isWeight ? "Decrease weight" : "Decrease reps"}
                    className="flex-1 rounded-xl bg-muted/40 text-muted-foreground border border-border/40 flex items-center justify-center active:bg-muted/70 transition-colors"
                  >
                    <Minus className="h-5 w-5" strokeWidth={2.6} />
                  </button>
                </div>

                {/* Numeric grid */}
                <div className="flex-1 grid grid-cols-3 gap-1.5">
                  {keys.map((k, i) =>
                    k === "" ? (
                      <span key={`blank-${i}`} aria-hidden />
                    ) : k === "back" ? (
                      <button
                        key="back"
                        type="button"
                        onClick={backspace}
                        aria-label="Backspace"
                        className="h-11 rounded-xl bg-muted/40 text-muted-foreground border border-border/40 flex items-center justify-center active:bg-muted/70 transition-colors"
                      >
                        <Delete className="h-5 w-5" />
                      </button>
                    ) : (
                      <button
                        key={k}
                        type="button"
                        onClick={() => pressDigit(k)}
                        className="h-11 rounded-xl bg-background/60 border border-border/40 text-[18px] font-bold tabular-nums text-foreground active:bg-muted/60 transition-colors"
                      >
                        {k}
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Primary action */}
              <button
                type="button"
                onClick={onLogSet}
                disabled={logDisabled}
                className={cn(
                  "mt-2.5 w-full h-12 rounded-xl bg-primary text-primary-foreground text-[15px] font-extrabold flex items-center justify-center gap-2 active:opacity-90 transition-opacity",
                  logDisabled && "opacity-50",
                )}
              >
                <Check className="h-5 w-5" strokeWidth={3} />
                Log set
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
