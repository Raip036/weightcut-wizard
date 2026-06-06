import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Check } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, springs } from "@/lib/motion";
import { AnimatedNumber } from "@/components/motion";
import { ExerciseBlock } from "./ExerciseBlock";
import { RestTimerPill } from "./RestTimerPill";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { formatVolume } from "@/lib/gymCalculations";
import { resolveTrackingType, effectiveVolumeWeight } from "@/lib/exerciseTypes";
import type { ActiveWorkout, Exercise, ExercisePR, GymSet } from "@/pages/gym/types";

interface ActiveSessionViewProps {
  workout: ActiveWorkout;
  exercises: Exercise[];
  prs: Map<string, ExercisePR>;
  newPRSetIds: Set<string>;
  previousSetsMap?: Map<string, GymSet[]>;
  onOpenExercisePicker: () => void;
  onAddSet: (exerciseOrder: number, data: { weight_kg?: number | null; reps: number; rpe?: number | null; is_warmup?: boolean; is_bodyweight?: boolean }) => void;
  onUpdateSet: (setId: string, exerciseOrder: number, updates: Partial<{ weight_kg: number | null; reps: number; rpe: number | null; is_warmup: boolean; completed: boolean }>) => void;
  onDeleteSet: (setId: string, exerciseOrder: number) => void;
  onDuplicateLastSet: (exerciseOrder: number) => void;
  onRemoveExercise: (exerciseOrder: number) => void;
  onFinish: (opts: { durationMinutes?: number; notes?: string; perceivedFatigue?: number }) => void;
  onDiscard: () => void;
  onExerciseTap?: (exerciseId: string) => void;
  /** Latest bodyweight (kg) — counts added-load-only volume for weighted exercises. */
  bodyweightKg?: number | null;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const hrs = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  return (
    <div className="display-number text-4xl tracking-tight">
      {hrs > 0 && <>{hrs}:</>}
      {hrs > 0 ? mins.toString().padStart(2, "0") : mins}:{secs.toString().padStart(2, "0")}
    </div>
  );
}

export function ActiveSessionView({
  workout, exercises, prs, newPRSetIds, previousSetsMap,
  onOpenExercisePicker, onAddSet, onUpdateSet, onDeleteSet,
  onDuplicateLastSet, onRemoveExercise, onFinish, onDiscard, onExerciseTap, bodyweightKg,
}: ActiveSessionViewProps) {
  const [finishSheetOpen, setFinishSheetOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  // Only one exercise expanded at a time. Defaults to the LAST added exercise
  // (assumed to be the one the user is currently working on). Re-keys when
  // a new exercise is added.
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(() =>
    workout.exerciseGroups[workout.exerciseGroups.length - 1]?.exercise.id ?? null,
  );
  useEffect(() => {
    const last = workout.exerciseGroups[workout.exerciseGroups.length - 1];
    if (last && expandedExerciseId == null) setExpandedExerciseId(last.exercise.id);
    // If the last exercise was just appended (not already in the list before),
    // bring it into focus.
    if (last && !workout.exerciseGroups.some((g) => g.exercise.id === expandedExerciseId)) {
      setExpandedExerciseId(last.exercise.id);
    }
  }, [workout.exerciseGroups, expandedExerciseId]);
  const [notes, setNotes] = useState("");
  const [fatigue, setFatigue] = useState([5]);

  const totalSets = workout.exerciseGroups.reduce((sum, g) => sum + g.sets.filter(s => !s.is_warmup).length, 0);
  const completedSets = workout.exerciseGroups.reduce((sum, g) => sum + g.sets.filter(s => !s.is_warmup && s.completed).length, 0);

  const totalVolume = useMemo(() => {
    let vol = 0;
    for (const group of workout.exerciseGroups) {
      const trackingType = resolveTrackingType(group.exercise.tracking_type, group.exercise.is_bodyweight);
      for (const set of group.sets) {
        if (!set.is_warmup && set.weight_kg && set.reps) {
          vol += effectiveVolumeWeight(set.weight_kg, trackingType, bodyweightKg) * set.reps;
        }
      }
    }
    return vol;
  }, [workout.exerciseGroups, bodyweightKg]);

  const handleFinish = useCallback(() => {
    onFinish({
      notes: notes || undefined,
      perceivedFatigue: fatigue[0],
    });
    setFinishSheetOpen(false);
  }, [notes, fatigue, onFinish]);

  return (
    <div className="space-y-4">
      {/* Live session header card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springs.responsive}
        className="card-surface rounded-xs p-5 relative overflow-hidden"
      >
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

        <div className="relative space-y-4">
          {/* Top row: live badge + Finish (green) / discard */}
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-bold uppercase tracking-wide">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-func-recovery-green opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-func-recovery-green" />
              </span>
              {workout.sessionType}
            </span>
            <div className="flex items-center gap-1.5">
              {totalSets > 0 && (
                <button
                  onClick={() => setFinishSheetOpen(true)}
                  className="rounded-full bg-success px-4 py-1.5 text-[13px] font-extrabold text-white active:scale-95 transition-transform shadow-[0_8px_22px_-8px_hsl(var(--success))]"
                >
                  Finish
                </button>
              )}
              <button
                onClick={() => setDiscardDialogOpen(true)}
                className="p-2 rounded-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                aria-label="Discard workout"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Hero timer */}
          <div className="text-center py-1">
            <ElapsedTimer startedAt={workout.startedAt} />
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mt-1.5">Elapsed</p>
          </div>

          {/* Live counters — Sets done + Volume pop/count-up on completion */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-muted/30 border border-border/40 p-3 text-center">
              <div className="display-number text-2xl font-extrabold tabular-nums">
                <AnimatedNumber value={completedSets} format={(n) => `${Math.round(n)}`} />
                <span className="text-muted-foreground/60 text-base font-bold">/{totalSets}</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mt-1">Sets done</div>
            </div>
            <div className="rounded-xl bg-muted/30 border border-border/40 p-3 text-center">
              <div className="display-number text-2xl font-extrabold tabular-nums">
                <AnimatedNumber value={totalVolume} format={(n) => formatVolume(n)} />
                <span className="text-muted-foreground/60 text-base font-bold"> kg</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mt-1">Volume</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Exercise blocks */}
      <motion.div
        variants={staggerContainer(60)}
        initial="hidden"
        animate="visible"
        className="space-y-3"
      >
        {workout.exerciseGroups.map(group => (
          <ExerciseBlock
            key={`${group.exerciseOrder}-${group.exercise.id}`}
            group={group}
            pr={prs.get(group.exercise.id)}
            newPRSetIds={newPRSetIds}
            previousSets={previousSetsMap?.get(group.exercise.id)}
            collapsed={expandedExerciseId !== group.exercise.id}
            onToggleCollapse={() =>
              setExpandedExerciseId((prev) =>
                prev === group.exercise.id ? null : group.exercise.id,
              )
            }
            onAddSet={onAddSet}
            onUpdateSet={onUpdateSet}
            onDeleteSet={onDeleteSet}
            onDuplicateLastSet={onDuplicateLastSet}
            onRemoveExercise={onRemoveExercise}
            onExerciseTap={onExerciseTap}
            bodyweightKg={bodyweightKg}
          />
        ))}
      </motion.div>

      {/* Add exercise button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={springs.gentle}
      >
        <button
          onClick={onOpenExercisePicker}
          className="w-full h-14 rounded-xs border-2 border-dashed border-border/60 flex items-center justify-center gap-2.5 text-sm font-medium text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 active:scale-[0.98] transition-all"
        >
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Plus className="h-4 w-4 text-primary" />
          </div>
          Add Exercise
        </button>
      </motion.div>

      {/* Finish lives in the header HUD now (green pill, top-right). */}

      {/* Auto rest timer (floating), fixed-positioned and self-managed via
          its module bus. */}
      <RestTimerPill />

      {/* Bottom spacer for nav bar + rest pill clearance */}
      <div className="h-4" />

      {/* Finish workout dialog */}
      <Dialog open={finishSheetOpen} onOpenChange={setFinishSheetOpen}>
        <DialogContent className="sm:max-w-[320px] rounded-xs p-0 border-0 bg-card/95 backdrop-blur-xl gap-0 max-h-[calc(100vh-var(--keyboard-inset,0px)-6rem)] overflow-y-auto">
          <div className="px-4 pt-4 pb-3">
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold text-center">Finish Workout</DialogTitle>
            </DialogHeader>
          </div>
          <div className="px-4 space-y-2.5">
            <div className="rounded-xs bg-muted/20 p-3 space-y-1.5">
              <label className="text-[13px] font-medium block">
                Fatigue: <span className="text-primary">{fatigue[0]}/10</span>
              </label>
              <Slider
                value={fatigue}
                onValueChange={setFatigue}
                min={1}
                max={10}
                step={1}
                className="py-1.5"
              />
              <div className="flex justify-between text-[13px] text-muted-foreground">
                <span>Fresh</span>
                <span>Destroyed</span>
              </div>
            </div>

            <div className="rounded-xs bg-muted/20 p-3 space-y-1.5">
              <label className="text-[13px] font-medium block">Notes</label>
              <Textarea
                placeholder="How did the workout feel?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[60px] resize-none text-[13px] rounded-xs border-border/30 bg-muted/20"
              />
            </div>
          </div>

          <div className="border-t border-border/40 mt-3">
            <button
              onClick={handleFinish}
              className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors flex items-center justify-center gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Complete Workout
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discard confirmation */}
      <DeleteConfirmDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        onConfirm={onDiscard}
        title="Discard Workout"
        description="This will permanently delete this workout session and all logged sets."
      />
    </div>
  );
}
