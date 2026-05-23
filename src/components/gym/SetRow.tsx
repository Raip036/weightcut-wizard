import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Trash2, Flame, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { springs } from "@/lib/motion";
import type { GymSet, PRType } from "@/pages/gym/types";

interface SetRowProps {
  set: GymSet;
  index: number;
  prTypes?: PRType[];
  onUpdate: (setId: string, updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean }>) => void;
  onDelete: (setId: string) => void;
}

export function SetRow({ set, index, prTypes, onUpdate, onDelete }: SetRowProps) {
  const [weightStr, setWeightStr] = useState(set.weight_kg?.toString() ?? "");
  const [repsStr, setRepsStr] = useState(set.reps.toString());
  const handleWeightBlur = useCallback(() => {
    const val = weightStr === "" ? null : parseFloat(weightStr);
    if (val !== set.weight_kg) {
      onUpdate(set.id, { weight_kg: val && !isNaN(val) ? val : null });
    }
  }, [weightStr, set.id, set.weight_kg, onUpdate]);

  const handleRepsBlur = useCallback(() => {
    const val = parseInt(repsStr, 10);
    if (!isNaN(val) && val > 0 && val !== set.reps) {
      onUpdate(set.id, { reps: val });
    }
  }, [repsStr, set.id, set.reps, onUpdate]);

  const hasPR = prTypes && prTypes.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.snappy}
      className={`group relative flex items-center gap-2 px-3 py-2.5 transition-colors ${
        set.is_warmup ? "opacity-60" : ""
      } ${hasPR ? "bg-gradient-to-r from-func-warning-yellow/[0.06] via-transparent to-transparent" : ""}`}
    >
      {/* PR shimmer rail — subtle gold edge on the left when this set is a PR */}
      {hasPR && (
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-func-warning-yellow via-func-warning-yellow to-func-warning-yellow rounded-l-2xl" />
      )}

      {/* Set number badge */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        set.is_warmup
          ? "bg-muted text-muted-foreground"
          : hasPR
            ? "bg-gradient-to-br from-func-warning-yellow to-func-warning-yellow text-black"
            : "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
      }`}>
        {set.is_warmup ? "W" : index + 1}
      </div>

      {/* Weight input — wider so 3-digit values aren't clipped, native
          spinners stripped so the visible characters use the full width. */}
      <Input
        type="number"
        inputMode="decimal"
        placeholder={set.is_bodyweight ? "BW" : "kg"}
        value={weightStr}
        onChange={(e) => setWeightStr(e.target.value)}
        onBlur={handleWeightBlur}
        className="h-10 w-[84px] text-center text-[15px] font-bold tabular-nums bg-background/50 border-border/40 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        disabled={set.is_bodyweight}
      />

      {/* Reps input — same width treatment */}
      <Input
        type="number"
        inputMode="numeric"
        placeholder="reps"
        value={repsStr}
        onChange={(e) => setRepsStr(e.target.value)}
        onBlur={handleRepsBlur}
        className="h-10 w-[84px] text-center text-[15px] font-bold tabular-nums bg-background/50 border-border/40 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />

      {/* Warmup toggle */}
      <button
        onClick={() => onUpdate(set.id, { is_warmup: !set.is_warmup })}
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
          set.is_warmup
            ? "text-func-carbs-orange bg-func-carbs-orange/15"
            : "text-muted-foreground/40 active:text-func-carbs-orange active:bg-func-carbs-orange/10"
        }`}
        aria-label="Toggle warmup"
      >
        <Flame className="h-3 w-3" />
      </button>

      {/* Delete button */}
      <button
        onClick={() => onDelete(set.id)}
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground/30 active:text-destructive active:bg-destructive/10 transition-all"
        aria-label="Delete set"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* PR badge — floats out of the flex flow so the Set/Weight/Reps/
          Warmup/Trash column geometry stays identical across PR and
          non-PR rows. Anchored to the row's top-right corner above the
          (vertically-centered) trash button, so it doesn't intercept its
          tap target. `pointer-events-none` makes that explicit. */}
      {hasPR && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.bouncy}
          className="pointer-events-none absolute top-1 right-1 inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-func-warning-yellow/95 to-func-warning-yellow/95 text-black px-1.5 py-[1px] z-10"
          title={prTypes.includes("weight") ? "New heaviest set" : "New rep max"}
        >
          <Trophy className="h-2.5 w-2.5" strokeWidth={2.6} fill="currentColor" />
          <span className="text-[9px] font-black tracking-wider leading-none">PR</span>
        </motion.span>
      )}
    </motion.div>
  );
}
