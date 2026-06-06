import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Trash2, Check, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { springs } from "@/lib/motion";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { setInputBus } from "./setInputBus";
import type { GymSet, PRType } from "@/pages/gym/types";

/** Shared 6-column grid template — ExerciseBlock's header uses the same one so
 *  columns line up perfectly: SET · PREVIOUS · KG · REPS · ✓ · (delete). */
export const SET_GRID = "grid grid-cols-[32px_minmax(0,1fr)_58px_50px_44px_22px] items-center gap-1.5";

interface SetRowProps {
  set: GymSet;
  index: number;
  prTypes?: PRType[];
  /** Matched set from the previous session — shown as the ghost target. */
  previous?: { weight_kg: number | null; reps: number } | null;
  onUpdate: (
    setId: string,
    updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean; completed: boolean }>,
  ) => void;
  /** Toggle the completed state (parent persists + starts the rest timer). */
  onToggleComplete: (setId: string, next: boolean) => void;
  onDelete: (setId: string) => void;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function SetRow({ set, index, prTypes, previous, onUpdate, onToggleComplete, onDelete }: SetRowProps) {
  const [weightStr, setWeightStr] = useState(set.weight_kg?.toString() ?? "");
  const [repsStr, setRepsStr] = useState(set.reps ? set.reps.toString() : "");

  const handleWeightBlur = useCallback(() => {
    const val = weightStr === "" ? null : parseFloat(weightStr);
    if (val !== set.weight_kg) onUpdate(set.id, { weight_kg: val != null && !isNaN(val) ? val : null });
  }, [weightStr, set.id, set.weight_kg, onUpdate]);

  const handleRepsBlur = useCallback(() => {
    const val = parseInt(repsStr, 10);
    if (!isNaN(val) && val > 0 && val !== set.reps) onUpdate(set.id, { reps: val });
  }, [repsStr, set.id, set.reps, onUpdate]);

  const hasPR = !!(prTypes && prTypes.length > 0);
  const done = set.completed;

  const prevLabel = previous
    ? `${previous.weight_kg != null ? fmtNum(previous.weight_kg) : "BW"}×${previous.reps}`
    : "—";

  const copyPrevious = () => {
    if (!previous) return;
    triggerHaptic(ImpactStyle.Light);
    const w = previous.weight_kg;
    setWeightStr(w != null ? fmtNum(w) : "");
    setRepsStr(String(previous.reps));
    onUpdate(set.id, { weight_kg: w ?? null, reps: previous.reps });
  };

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

  // Keyboard-accessory wiring — register the focused field so the ± bar can
  // mutate it, and advance focus via [data-setfield] DOM order.
  const focusWeight = (e: React.FocusEvent<HTMLInputElement>) =>
    setInputBus.focus({
      key: `${set.id}:weight`,
      kind: "weight",
      el: e.currentTarget,
      apply: (d) => setWeightStr((s) => fmtNum((parseFloat(s || "0") || 0) + d)),
    });
  const focusReps = (e: React.FocusEvent<HTMLInputElement>) =>
    setInputBus.focus({
      key: `${set.id}:reps`,
      kind: "reps",
      el: e.currentTarget,
      apply: (d) => setRepsStr((s) => String(Math.max(0, (parseInt(s || "0", 10) || 0) + d))),
    });

  const inputCls =
    "h-9 w-full px-1 text-center text-[15px] font-bold tabular-nums rounded-lg bg-background/50 border-border/40 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  const inputDone = done ? " !bg-transparent !border-transparent text-success" : "";

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

      {/* Set badge — tap to toggle warmup. */}
      <button
        type="button"
        onClick={() => onUpdate(set.id, { is_warmup: !set.is_warmup })}
        aria-label={set.is_warmup ? "Mark as working set" : "Mark as warmup"}
        className={`h-8 w-8 rounded-[10px] flex items-center justify-center text-[13px] font-extrabold shrink-0 transition-colors ${
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
      </button>

      {/* Previous — tap to copy into the inputs. */}
      <button
        type="button"
        onClick={copyPrevious}
        disabled={!previous}
        className="min-w-0 truncate text-left text-[13px] font-semibold tabular-nums text-muted-foreground/40 active:text-primary disabled:active:text-muted-foreground/40 pl-0.5"
      >
        {prevLabel}
      </button>

      {/* Weight */}
      <Input
        type="number"
        inputMode="decimal"
        data-setfield="weight"
        placeholder={previous?.weight_kg != null ? fmtNum(previous.weight_kg) : set.is_bodyweight ? "BW" : "kg"}
        value={weightStr}
        onChange={(e) => setWeightStr(e.target.value)}
        onFocus={focusWeight}
        onBlur={(e) => {
          setInputBus.blur(`${set.id}:weight`);
          handleWeightBlur();
          void e;
        }}
        className={inputCls + inputDone}
        disabled={set.is_bodyweight}
      />

      {/* Reps */}
      <Input
        type="number"
        inputMode="numeric"
        data-setfield="reps"
        placeholder={previous?.reps != null ? String(previous.reps) : "reps"}
        value={repsStr}
        onChange={(e) => setRepsStr(e.target.value)}
        onFocus={focusReps}
        onBlur={() => {
          setInputBus.blur(`${set.id}:reps`);
          handleRepsBlur();
        }}
        className={inputCls + inputDone}
      />

      {/* Complete ✓ — the emotional payload. */}
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

      {/* Delete — compact. */}
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
