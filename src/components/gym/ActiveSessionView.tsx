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
import { SetEntryKeypad } from "./SetEntryKeypad";
import { startRest, getRestForExercise } from "./restTimer";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { formatVolume } from "@/lib/gymCalculations";
import { resolveTrackingType, effectiveVolumeWeight } from "@/lib/exerciseTypes";
import type { WorkoutRecapStats } from "./WorkoutRecapCutscene";
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
  onFinish: (opts: { durationMinutes?: number; notes?: string; perceivedFatigue?: number }, recap: WorkoutRecapStats) => void;
  onDiscard: () => void;
  onExerciseTap?: (exerciseId: string) => void;
  /** Latest bodyweight (kg), counts added-load-only volume for weighted exercises. */
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

  // ─── Docked set-entry keypad ───
  // ONE keypad instance serves whichever set is being edited. We track the
  // target set + exercise + active field here; SetRow only reports taps.
  const [keypadTarget, setKeypadTarget] = useState<
    { setId: string; exerciseOrder: number; field: "weight" | "reps" } | null
  >(null);
  // After "Log set" adds the next set we don't yet know its id (onAddSet is
  // async + optimistic). This flag lets an effect retarget the keypad to the
  // freshly appended set once it lands, and blocks a second add in the meantime.
  const [pendingAdvance, setPendingAdvance] = useState<
    { exerciseOrder: number; prevLastSetId: string | null } | null
  >(null);

  const activeGroup = useMemo(
    () =>
      keypadTarget
        ? workout.exerciseGroups.find((g) => g.exerciseOrder === keypadTarget.exerciseOrder) ?? null
        : null,
    [keypadTarget, workout.exerciseGroups],
  );
  const activeSet = useMemo(
    () => (keypadTarget && activeGroup ? activeGroup.sets.find((s) => s.id === keypadTarget.setId) ?? null : null),
    [keypadTarget, activeGroup],
  );

  // Close the keypad if its target set vanished (deleted, exercise removed).
  useEffect(() => {
    if (keypadTarget && !activeSet) setKeypadTarget(null);
  }, [keypadTarget, activeSet]);

  // Retarget the keypad onto the auto-advanced set once it appears.
  useEffect(() => {
    if (!pendingAdvance) return;
    const group = workout.exerciseGroups.find((g) => g.exerciseOrder === pendingAdvance.exerciseOrder);
    if (!group) {
      setPendingAdvance(null);
      return;
    }
    const last = group.sets[group.sets.length - 1];
    if (last && last.id !== pendingAdvance.prevLastSetId) {
      setKeypadTarget({
        setId: last.id,
        exerciseOrder: pendingAdvance.exerciseOrder,
        field: last.is_bodyweight ? "reps" : "weight",
      });
      setPendingAdvance(null);
    }
  }, [workout.exerciseGroups, pendingAdvance]);

  const handleActivateSetField = useCallback(
    (setId: string, exerciseOrder: number, field: "weight" | "reps") => {
      setKeypadTarget({ setId, exerciseOrder, field });
    },
    [],
  );

  // Commit-on-change: guard exactly like the old blur handlers so invalid /
  // empty entries never overwrite good data.
  const handleKeypadChange = useCallback(
    (field: "weight" | "reps", value: number | null) => {
      if (!keypadTarget) return;
      if (field === "weight") {
        onUpdateSet(keypadTarget.setId, keypadTarget.exerciseOrder, {
          weight_kg: value != null && !isNaN(value) ? value : null,
        });
      } else if (value != null && !isNaN(value) && value > 0) {
        onUpdateSet(keypadTarget.setId, keypadTarget.exerciseOrder, { reps: value });
      }
    },
    [keypadTarget, onUpdateSet],
  );

  const handleToggleField = useCallback(() => {
    setKeypadTarget((prev) => (prev ? { ...prev, field: prev.field === "weight" ? "reps" : "weight" } : prev));
  }, []);

  const handleLogSet = useCallback(() => {
    if (pendingAdvance) return; // an advance is still settling — ignore repeat taps
    if (!keypadTarget || !activeGroup || !activeSet) {
      setKeypadTarget(null);
      return;
    }
    const group = activeGroup;
    const set = activeSet;
    const prevLastSetId = group.sets[group.sets.length - 1]?.id ?? null;

    // 1. Complete via the SAME mechanism the ✓ uses: persist completed + start
    //    the rest timer (restTimer module bus, see restTimer.ts). Skip if the
    //    set is already complete so Log set never double-fires the timer.
    if (!set.completed) {
      onUpdateSet(set.id, group.exerciseOrder, { completed: true });
      startRest(getRestForExercise(group.exercise.id));
      if (newPRSetIds?.has(set.id)) triggerHapticSuccess();
      else triggerHaptic(ImpactStyle.Medium);
    }

    // 2. Auto-advance: seed a pre-filled next set from the just-logged set
    //    (same progressive-overload seed as ExerciseBlock's Add Set), then let
    //    the effect above move the keypad onto it.
    onAddSet(group.exerciseOrder, {
      weight_kg: set.weight_kg ?? null,
      reps: set.reps ?? 10,
      is_bodyweight: set.is_bodyweight,
    });
    setPendingAdvance({ exerciseOrder: group.exerciseOrder, prevLastSetId });
  }, [pendingAdvance, keypadTarget, activeGroup, activeSet, onUpdateSet, onAddSet, newPRSetIds]);

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
    // Snapshot the finished-session stats BEFORE onFinish → finishSession clears
    // `activeSession` (and unmounts this view). finishSession returns only
    // { ok, calendarEntryId }, so the recap's enriched stats must be captured
    // here off the live workout + counters.
    const elapsedMs = Date.now() - workout.startedAt;
    const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));

    const muscleGroups = Array.from(
      new Set(
        workout.exerciseGroups.map((g) =>
          (g.exercise.muscle_group ?? "other").replace(/_/g, " "),
        ),
      ),
    );

    // PR count = this session's sets that flagged a new PR (newPRSetIds can
    // carry ids from earlier sessions in the same mount, so intersect).
    const workoutSetIds = new Set<string>();
    for (const g of workout.exerciseGroups) {
      for (const s of g.sets) workoutSetIds.add(s.id);
    }
    let prCount = 0;
    for (const id of newPRSetIds) {
      if (workoutSetIds.has(id)) prCount++;
    }

    const recap: WorkoutRecapStats = {
      sessionType: workout.sessionType,
      date: new Date().toISOString().split("T")[0],
      durationMinutes,
      // Effort number = total working-set VOLUME (kg), already computed live.
      totalVolume,
      completedSets,
      exerciseCount: workout.exerciseGroups.length,
      muscleGroups,
      prCount,
      exerciseGroups: workout.exerciseGroups,
    };

    onFinish(
      {
        notes: notes || undefined,
        perceivedFatigue: fatigue[0],
      },
      recap,
    );
    setFinishSheetOpen(false);
  }, [workout, totalVolume, completedSets, newPRSetIds, notes, fatigue, onFinish]);

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

          {/* Live counters: Sets done + Volume pop/count-up on completion */}
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
            activeSetId={keypadTarget?.setId ?? null}
            activeField={keypadTarget?.field ?? null}
            onActivateSetField={handleActivateSetField}
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
          its module bus. Lifted above the docked keypad (and given higher
          z-index) whenever the keypad is open, so it isn't covered and its
          controls stay reachable — see RestTimerPill's keypadOpen prop. */}
      <RestTimerPill keypadOpen={!!keypadTarget && !!activeSet} />

      {/* Docked set-entry keypad — replaces the OS keyboard for fast logging. */}
      <SetEntryKeypad
        open={!!keypadTarget && !!activeSet}
        activeField={keypadTarget?.field ?? "weight"}
        targetKey={keypadTarget ? `${keypadTarget.setId}:${keypadTarget.field}` : ""}
        weightKg={activeSet?.weight_kg ?? null}
        reps={activeSet?.reps ?? null}
        isBodyweight={activeSet?.is_bodyweight ?? false}
        label={activeGroup?.exercise.name}
        onChange={handleKeypadChange}
        onToggleField={handleToggleField}
        onLogSet={handleLogSet}
        onDismiss={() => setKeypadTarget(null)}
        logDisabled={!!pendingAdvance}
      />

      {/* Bottom spacer for nav bar + rest pill clearance. Grows while the
          keypad is docked so the active row stays visible above it. */}
      <div className={keypadTarget ? "h-80" : "h-4"} />

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
