import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Trash2, Check, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { springs } from "@/lib/motion";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { GymSet, PRType } from "@/pages/gym/types";

/** Shared 6-column grid template. ExerciseBlock's header uses the same one so
 *  columns line up perfectly: SET · PREVIOUS · KG · REPS · ✓ · (delete). */
export const SET_GRID = "grid grid-cols-[32px_minmax(0,1fr)_58px_50px_44px_22px] items-center gap-1.5";

interface SetRowProps {
  set: GymSet;
  index: number;
  prTypes?: PRType[];
  /** Matched set from the previous session, shown as the ghost target. */
  previous?: { weight_kg: number | null; reps: number } | null;
  onUpdate: (
    setId: string,
    updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean; completed: boolean }>,
  ) => void;
  /** Toggle the completed state (parent persists + starts the rest timer). */
  onToggleComplete: (setId: string, next: boolean) => void;
  onDelete: (setId: string) => void;
  /** Which field on THIS row the docked keypad is currently editing (null = none). */
  activeField?: "weight" | "reps" | null;
  /** Tapping a value cell opens the docked keypad targeting that field. */
  onActivateField?: (setId: string, field: "weight" | "reps") => void;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function SetRow({ set, index, prTypes, previous, onUpdate, onToggleComplete, onDelete, activeField, onActivateField }: SetRowProps) {
  const [weightStr, setWeightStr] = useState(set.weight_kg?.toString() ?? "");
  const [repsStr, setRepsStr] = useState(set.reps ? set.reps.toString() : "");

  // Editing now happens through the docked keypad, which commits on change.
  // Mirror the committed set values into the display buffers so keypad edits
  // (and reactive Convex reconciliation) show immediately. The inputs are
  // readOnly, so this never fights a user keystroke.
  useEffect(() => {
    setWeightStr(set.weight_kg?.toString() ?? "");
  }, [set.weight_kg]);
  useEffect(() => {
    setRepsStr(set.reps ? set.reps.toString() : "");
  }, [set.reps]);

  const hasPR = !!(prTypes && prTypes.length > 0);
  const done = set.completed;

  const prevLabel = previous
    ? `${previous.weight_kg != null ? fmtNum(previous.weight_kg) : "BW"}×${previous.reps}`
    : "-";

  const toggleComplete = () => {
    const next = !done;
    if (next) {
      // Flush whatever's typed so the completed values persist.
      const w = weightStr === "" ? null : parseFloat(weightStr);
      const r = parseInt(repsStr, 10);
      const updates: Partial<{ weight_kg: number | null; reps: number }> = {};
      if ((w ?? null) !== set.weight_kg) updates.weight_kg = w != null && !isNaN(w) ? w : null;
      if (!isNaN(r) && r > 0 && r !== set.reps) updates.reps = r;
      if (Object.keys(updates).length) onUpdate(set.id, updates);
      if (hasPR) triggerHapticSuccess();
      else triggerHaptic(ImpactStyle.Medium);
    } else {
      triggerHaptic(ImpactStyle.Light);
    }
    onToggleComplete(set.id, next);
  };

  const inputCls =
    "h-9 w-full px-1 text-center text-[15px] font-bold tabular-nums rounded-lg bg-background/50 border-border/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-pointer";
  const inputDone = done ? " !bg-transparent !border-transparent text-success" : "";
  const activeCls = " ring-2 ring-primary/60 border-primary/60 bg-primary/10";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.snappy}
      className={`relative ${SET_GRID} px-3 py-2 transition-colors duration-200 ${
        set.is_warmup ? "opacity-70" : ""
      } ${done ? "bg-success/[0.10] shadow-[inset_3px_0_0_hsl(var(--success))]" : hasPR ? "bg-gradient-to-r from-func-warning-yellow/[0.06] to-transparent" : ""}`}
    >
      {/* PR gold rail (only when not completed-green) */}
      {hasPR && !done && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-func-warning-yellow rounded-l-2xl" />
      )}

      {/* Set number: plain, non-interactive label. Warmup is toggled only via
          the discrete "W" chip below it, never by tapping the number. */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <span
          className={`h-8 w-8 rounded-[10px] flex items-center justify-center text-[13px] font-extrabold transition-colors ${
            done
              ? "bg-success text-white"
              : set.is_warmup
                ? "bg-func-carbs-orange/18 text-func-carbs-orange"
                : hasPR
                  ? "bg-func-warning-yellow text-black"
                  : "bg-gradient-to-br from-primary/22 to-primary/8 text-primary"
          }`}
        >
          {set.is_warmup ? "W" : index + 1}
        </span>
        <button
          type="button"
          onClick={() => onUpdate(set.id, { is_warmup: !set.is_warmup })}
          aria-label={set.is_warmup ? "Mark as working set" : "Mark as warmup"}
          aria-pressed={set.is_warmup}
          className={`h-4 min-w-[20px] px-1 rounded-full flex items-center justify-center text-[8px] font-black tracking-wider leading-none transition-colors ${
            set.is_warmup
              ? "bg-primary/15 text-primary"
              : "bg-muted/40 text-muted-foreground/40 active:bg-muted/70"
          }`}
        >
          W
        </button>
      </div>

      {/* Previous: display-only reference, never mutates the current set. */}
      <span className="min-w-0 truncate text-left text-[13px] font-semibold tabular-nums text-muted-foreground/40 pl-0.5">
        {prevLabel}
      </span>

      {/* Weight — tapping opens the docked keypad instead of the OS keyboard.
          `readOnly` + `inputMode="none"` guarantees iOS never raises the
          software keyboard for this cell. */}
      <Input
        type="text"
        inputMode="none"
        readOnly
        placeholder={previous?.weight_kg != null ? fmtNum(previous.weight_kg) : set.is_bodyweight ? "BW" : "kg"}
        value={weightStr}
        onClick={() => !set.is_bodyweight && onActivateField?.(set.id, "weight")}
        className={inputCls + inputDone + (activeField === "weight" ? activeCls : "")}
        disabled={set.is_bodyweight}
        aria-label="Edit weight"
        // Marks this cell as a keypad-activation target so the keypad's
        // full-screen dismiss catcher (which sits above the set list) can
        // hit-test taps and retarget onto this cell instead of only dismissing.
        data-keypad-target="true"
      />

      {/* Reps — same docked-keypad activation. */}
      <Input
        type="text"
        inputMode="none"
        readOnly
        placeholder={previous?.reps != null ? String(previous.reps) : "reps"}
        value={repsStr}
        onClick={() => onActivateField?.(set.id, "reps")}
        className={inputCls + inputDone + (activeField === "reps" ? activeCls : "")}
        aria-label="Edit reps"
        data-keypad-target="true"
      />

      {/* Complete ✓: the emotional payload. */}
      <motion.button
        type="button"
        onClick={toggleComplete}
        whileTap={{ scale: 0.88 }}
        aria-label={done ? "Mark set incomplete" : "Complete set"}
        aria-pressed={done}
        className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-all ${
          done
            ? "bg-success text-white shadow-[0_0_16px_-2px_hsl(var(--success)/0.55)]"
            : "bg-muted/40 text-muted-foreground/50 border border-border/40 active:bg-muted/70"
        }`}
      >
        {done ? (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springs.bouncy}>
            <Check className="h-5 w-5" strokeWidth={3} />
          </motion.span>
        ) : (
          <Check className="h-5 w-5" strokeWidth={2.4} />
        )}
      </motion.button>

      {/* Delete: compact. */}
      <button
        type="button"
        onClick={() => onDelete(set.id)}
        className="h-7 w-[22px] flex items-center justify-center text-muted-foreground/30 active:text-destructive transition-colors"
        aria-label="Delete set"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* PR badge */}
      {hasPR && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.bouncy}
          className="pointer-events-none absolute -top-0.5 right-7 inline-flex items-center gap-0.5 rounded-full bg-func-warning-yellow text-black px-1.5 py-[1px] z-10"
          title={prTypes!.includes("weight") ? "New heaviest set" : "New rep max"}
        >
          <Trophy className="h-2.5 w-2.5" strokeWidth={2.6} fill="currentColor" />
          <span className="text-[9px] font-black tracking-wider leading-none">PR</span>
        </motion.span>
      )}
    </motion.div>
  );
}
