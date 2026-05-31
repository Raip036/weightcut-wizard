import { useCallback, useMemo } from "react";
import { Plus, Copy, X, ChevronRight, ChevronDown, Trophy } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerItem } from "@/lib/motion";
import { SetRow } from "./SetRow";
import { formatWeight, formatVolume } from "@/lib/gymCalculations";
import { resolveTrackingType, effectiveVolumeWeight } from "@/lib/exerciseTypes";
import type { ExerciseGroup, PRType, GymSet } from "@/pages/gym/types";
import type { ExercisePR } from "@/pages/gym/types";

interface ExerciseBlockProps {
  group: ExerciseGroup;
  pr?: ExercisePR | null;
  newPRSetIds?: Set<string>;
  previousSets?: GymSet[];
  /** When true, the block renders header-only (collapsed). Default false (expanded). */
  collapsed?: boolean;
  /** Toggle expand/collapse. When provided, a chevron appears in the header
   *  and tapping the row toggles the block. */
  onToggleCollapse?: () => void;
  onAddSet: (exerciseOrder: number, data: { weight_kg?: number | null; reps: number; rpe?: number | null; is_warmup?: boolean; is_bodyweight?: boolean }) => void;
  onUpdateSet: (setId: string, exerciseOrder: number, updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean }>) => void;
  onDeleteSet: (setId: string, exerciseOrder: number) => void;
  onDuplicateLastSet: (exerciseOrder: number) => void;
  onRemoveExercise: (exerciseOrder: number) => void;
  onExerciseTap?: (exerciseId: string) => void;
  /** Latest bodyweight (kg) — used to count added-load-only volume for weighted exercises. */
  bodyweightKg?: number | null;
}

const MUSCLE_BORDER_COLORS: Record<string, string> = {
  chest: "border-l-func-danger-red",
  back: "border-l-blue-400",
  shoulders: "border-l-func-fats-purple",
  biceps: "border-l-pink-400",
  triceps: "border-l-func-carbs-orange",
  quads: "border-l-func-recovery-green",
  hamstrings: "border-l-func-recovery-green",
  glutes: "border-l-lime-400",
  calves: "border-l-teal-400",
  abs: "border-l-func-warning-yellow",
  forearms: "border-l-func-hydration-cyan",
  traps: "border-l-indigo-400",
  full_body: "border-l-func-fats-purple",
  cardio: "border-l-func-danger-red",
};

const MUSCLE_COLORS: Record<string, string> = {
  chest: "bg-func-danger-red/10 text-func-danger-red",
  back: "bg-blue-500/10 text-blue-400",
  shoulders: "bg-func-fats-purple/10 text-func-fats-purple",
  biceps: "bg-pink-500/10 text-pink-400",
  triceps: "bg-func-carbs-orange/10 text-func-carbs-orange",
  quads: "bg-func-recovery-green/10 text-func-recovery-green",
  hamstrings: "bg-func-recovery-green/10 text-func-recovery-green",
  glutes: "bg-lime-500/10 text-lime-400",
  calves: "bg-teal-500/10 text-teal-400",
  abs: "bg-func-warning-yellow/10 text-func-warning-yellow",
  forearms: "bg-func-hydration-cyan/10 text-func-hydration-cyan",
  traps: "bg-indigo-500/10 text-indigo-400",
  full_body: "bg-func-fats-purple/10 text-func-fats-purple",
  cardio: "bg-func-danger-red/10 text-func-danger-red",
};

export function ExerciseBlock({
  group, pr, newPRSetIds, previousSets, collapsed = false, onToggleCollapse,
  onAddSet, onUpdateSet, onDeleteSet,
  onDuplicateLastSet, onRemoveExercise, onExerciseTap, bodyweightKg,
}: ExerciseBlockProps) {
  const trackingType = resolveTrackingType(group.exercise.tracking_type, group.exercise.is_bodyweight);
  // Volume of all working sets — surfaced in the collapsed header so the
  // user can see this exercise's contribution at a glance. Weighted exercises
  // count the added load only (total − bodyweight).
  const blockVolume = useMemo(
    () => group.sets.reduce(
      (sum, s) => sum + (s.is_warmup
        ? 0
        : effectiveVolumeWeight(s.weight_kg ?? 0, trackingType, bodyweightKg) * (s.reps ?? 0)),
      0,
    ),
    [group.sets, trackingType, bodyweightKg],
  );
  const workingSets = useMemo(
    () => group.sets.filter(s => !s.is_warmup),
    [group.sets]
  );

  const handleAddSet = useCallback(() => {
    const lastSet = group.sets[group.sets.length - 1];
    // Seed from previous workout's top set when the current group is empty —
    // gives user an explicit number to beat (progressive overload).
    const seedSet = lastSet ?? previousSets?.[0] ?? null;
    onAddSet(group.exerciseOrder, {
      weight_kg: seedSet?.weight_kg ?? null,
      reps: seedSet?.reps ?? 10,
      is_bodyweight: group.exercise.is_bodyweight,
    });
  }, [group, previousSets, onAddSet]);

  const handleUpdate = useCallback((setId: string, updates: any) => {
    onUpdateSet(setId, group.exerciseOrder, updates);
  }, [group.exerciseOrder, onUpdateSet]);

  const handleDelete = useCallback((setId: string) => {
    onDeleteSet(setId, group.exerciseOrder);
  }, [group.exerciseOrder, onDeleteSet]);

  const muscleColor = MUSCLE_COLORS[group.exercise.muscle_group] || "bg-muted text-muted-foreground";
  const borderColor = MUSCLE_BORDER_COLORS[group.exercise.muscle_group] || "border-l-muted-foreground";

  return (
    <motion.div
      variants={staggerItem}
      className={`card-surface rounded-xs border-l-[3px] ${borderColor} overflow-hidden`}
    >
      {/* Header — tappable to toggle collapse when onToggleCollapse is wired.
          The exercise name + chevron-right is the existing tap into stats
          (onExerciseTap); we expose a separate area on the right for collapse
          to avoid swallowing the user's intent. */}
      <div className="flex items-center justify-between p-3 pb-2">
        <button
          onClick={() => onExerciseTap?.(group.exercise.id)}
          className="flex items-center gap-2 min-w-0 group flex-1 text-left"
        >
          <h3 className="font-bold text-[15px] tracking-tight truncate">{group.exercise.name}</h3>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${muscleColor}`}>
            {group.exercise.muscle_group.replace("_", " ")}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 group-hover:text-muted-foreground transition-colors" />
        </button>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="shrink-0 p-1.5 rounded-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label={collapsed ? "Expand exercise" : "Collapse exercise"}
            aria-expanded={!collapsed}
          >
            <motion.span
              animate={{ rotate: collapsed ? 0 : 180 }}
              transition={{ duration: 0.18 }}
              className="inline-block"
            >
              <ChevronDown className="h-4 w-4" />
            </motion.span>
          </button>
        )}
        <button
          onClick={() => onRemoveExercise(group.exerciseOrder)}
          className="shrink-0 p-1.5 rounded-xs text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label="Remove exercise"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Compact summary visible in BOTH states so the user can see
          set count + volume at a glance when collapsed. */}
      {collapsed && (
        <div className="px-3 pb-3 -mt-1 flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
          <span>
            <span className="font-bold text-foreground">{workingSets.length}</span> {workingSets.length === 1 ? "set" : "sets"}
          </span>
          {blockVolume > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>
                <span className="font-bold text-foreground">{formatVolume(blockVolume)}</span> kg vol
              </span>
            </>
          )}
        </div>
      )}

      {/* Expanded body — wrapped in AnimatePresence so collapse animates */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >

      {/* Last workout hint — beat this */}
      {previousSets && previousSets.length > 0 && (
        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
          <Trophy className="h-3 w-3 text-func-warning-yellow/70 shrink-0" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 shrink-0">Last time</span>
          <div className="flex items-center gap-1 flex-wrap">
            {previousSets.map((s, i) => (
              <span key={s.id} className="text-[11px] tabular-nums text-muted-foreground/90">
                {s.is_bodyweight ? "BW" : `${formatWeight(s.weight_kg)}kg`}
                <span className="text-muted-foreground/40"> × </span>
                {s.reps}
                {i < previousSets.length - 1 && <span className="text-muted-foreground/30 ml-1">·</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Column headers — mirror SetRow flex/gap/widths so labels sit centered above inputs */}
      {group.sets.length > 0 && (
        <div className="flex items-center gap-2 px-3 pb-1.5 mb-1 text-[11px] text-muted-foreground/70 uppercase tracking-wider border-b border-border/20">
          <div className="w-8 shrink-0 text-center">Set</div>
          <div className="w-[84px] text-center">Weight</div>
          <div className="w-[84px] text-center">Reps</div>
          <div className="w-7 shrink-0" />
          <div className="w-7 shrink-0" />
        </div>
      )}

      {/* Sets */}
      <div className="divide-y divide-border/10">
        {group.sets.map((set, i) => {
          const setIndex = set.is_warmup ? i : workingSets.indexOf(set);
          const prTypesForSet: PRType[] = [];
          if (newPRSetIds?.has(set.id)) {
            if (pr && set.weight_kg && set.weight_kg >= (pr.max_weight_kg ?? 0)) prTypesForSet.push("weight");
            if (pr && set.reps >= (pr.max_reps ?? 0)) prTypesForSet.push("reps");
          }

          return (
            <SetRow
              key={set.id}
              set={set}
              index={setIndex}
              prTypes={prTypesForSet}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-3 pt-2">
        <button
          onClick={handleAddSet}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 active:scale-95 transition-all"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Set
        </button>
        {group.sets.length > 0 && (
          <button
            onClick={() => onDuplicateLastSet(group.exerciseOrder)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border/30 hover:bg-muted active:scale-95 transition-all"
          >
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </button>
        )}
      </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
