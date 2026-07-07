import { useCallback, useMemo } from "react";
import { Plus, Copy, X, BarChart3, ChevronDown, Trophy } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerItem } from "@/lib/motion";
import { SetRow, SET_GRID } from "./SetRow";
import { startRest, getRestForExercise } from "./restTimer";
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
  onUpdateSet: (setId: string, exerciseOrder: number, updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean; completed: boolean }>) => void;
  onDeleteSet: (setId: string, exerciseOrder: number) => void;
  onDuplicateLastSet: (exerciseOrder: number) => void;
  onRemoveExercise: (exerciseOrder: number) => void;
  onExerciseTap?: (exerciseId: string) => void;
  /** Latest bodyweight (kg), used to count added-load-only volume for weighted exercises. */
  bodyweightKg?: number | null;
  /** Docked keypad wiring (owned by ActiveSessionView, threaded to SetRow). */
  activeSetId?: string | null;
  activeField?: "weight" | "reps" | null;
  onActivateSetField?: (setId: string, exerciseOrder: number, field: "weight" | "reps") => void;
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
  activeSetId, activeField, onActivateSetField,
}: ExerciseBlockProps) {
  const trackingType = resolveTrackingType(group.exercise.tracking_type, group.exercise.is_bodyweight);
  // Volume of all working sets, surfaced in the collapsed header so the
  // user can see this exercise's contribution at a glance. Weighted exercises
  // count the added load only (total minus bodyweight).
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
    // Seed from previous workout's top set when the current group is empty.
    // Gives user an explicit number to beat (progressive overload).
    const seedSet = lastSet ?? previousSets?.[0] ?? null;
    onAddSet(group.exerciseOrder, {
      weight_kg: seedSet?.weight_kg ?? null,
      reps: seedSet?.reps ?? 10,
      is_bodyweight: group.exercise.is_bodyweight,
    });
  }, [group, previousSets, onAddSet]);

  const handleUpdate = useCallback((setId: string, updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean; completed: boolean }>) => {
    onUpdateSet(setId, group.exerciseOrder, updates);
  }, [group.exerciseOrder, onUpdateSet]);

  const handleDelete = useCallback((setId: string) => {
    onDeleteSet(setId, group.exerciseOrder);
  }, [group.exerciseOrder, onDeleteSet]);

  // Completing a set persists the flag and auto-starts the rest timer using
  // this exercise's configured rest (override → default).
  const handleToggleComplete = useCallback((setId: string, next: boolean) => {
    onUpdateSet(setId, group.exerciseOrder, { completed: next });
    if (next) startRest(getRestForExercise(group.exercise.id));
  }, [group.exerciseOrder, group.exercise.id, onUpdateSet]);

  const muscleColor = MUSCLE_COLORS[group.exercise.muscle_group] || "bg-muted text-muted-foreground";
  const borderColor = MUSCLE_BORDER_COLORS[group.exercise.muscle_group] || "border-l-muted-foreground";

  return (
    <motion.div
      variants={staggerItem}
      className={`card-surface rounded-xs border-l-[3px] ${borderColor} overflow-hidden`}
    >
      {/* Header: tapping the name/badge area toggles expand/collapse (same
          handler as the chevron). Viewing stats is now an explicit, separate
          icon button so it can never be triggered by accident. */}
      <div className="flex items-center justify-between p-3 pb-2">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
          aria-label={collapsed ? "Expand exercise" : "Collapse exercise"}
          aria-expanded={!collapsed}
        >
          <h3 className="font-bold text-[15px] tracking-tight truncate">{group.exercise.name}</h3>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${muscleColor}`}>
            {group.exercise.muscle_group.replace("_", " ")}
          </span>
        </button>
        {onExerciseTap && (
          <button
            onClick={() => onExerciseTap(group.exercise.id)}
            className="shrink-0 p-1.5 rounded-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="View exercise stats"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
        )}
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

      {/* Expanded body, wrapped in AnimatePresence so collapse animates */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >

      {/* Last workout hint: beat this */}
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

      {/* Column headers, share the SetRow grid template so labels sit
          centered above each column (Set · Previous · Kg · Reps · ✓). */}
      {group.sets.length > 0 && (
        <div className={`${SET_GRID} px-3 pb-1.5 mb-1 text-[10px] text-muted-foreground/70 uppercase tracking-wider border-b border-border/20`}>
          <div className="text-center">Set</div>
          <div className="text-left pl-0.5">Prev</div>
          <div className="text-center">Kg</div>
          <div className="text-center">Reps</div>
          <div className="text-center">✓</div>
          <div />
        </div>
      )}

      {/* Sets */}
      <div className="divide-y divide-border/10">
        {group.sets.map((set, i) => {
          const setIndex = set.is_warmup ? i : workingSets.indexOf(set);
          const prTypesForSet: PRType[] = [];
          if (newPRSetIds?.has(set.id)) {
            // Weight-only PRs: a set is flagged solely for a new heaviest weight.
            if (pr && set.weight_kg && set.weight_kg >= (pr.max_weight_kg ?? 0)) prTypesForSet.push("weight");
          }
          // Previous session's matching set (by working-set position) as the
          // inline ghost target. Data already comes from usePreviousSets.
          const prevSet = !set.is_warmup ? previousSets?.[setIndex] : undefined;
          const previous = prevSet ? { weight_kg: prevSet.weight_kg, reps: prevSet.reps } : null;

          return (
            <SetRow
              key={set.id}
              set={set}
              index={setIndex}
              prTypes={prTypesForSet}
              previous={previous}
              onUpdate={handleUpdate}
              onToggleComplete={handleToggleComplete}
              onDelete={handleDelete}
              activeField={activeSetId === set.id ? activeField ?? null : null}
              onActivateField={
                onActivateSetField
                  ? (setId, field) => onActivateSetField(setId, group.exerciseOrder, field)
                  : undefined
              }
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
