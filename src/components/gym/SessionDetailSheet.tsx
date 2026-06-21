import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Dumbbell, TrendingUp, Brain, Trash2, Pencil, Check, Share2, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { formatWeight, formatVolume } from "@/lib/gymCalculations";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { GymSet, SessionWithSets } from "@/pages/gym/types";

interface SessionDetailSheetProps {
  session: SessionWithSets | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (sessionId: string) => void;
  onUpdateSet?: (setId: string, updates: Partial<{ weight_kg: number | null; reps: number; is_warmup: boolean }>) => Promise<void>;
  onDeleteSet?: (setId: string) => Promise<void>;
  /** Fires when the user taps the share icon in the sheet header. The page
   *  is expected to own the ShareCardDialog and pass back through the
   *  currently-viewed session. */
  onShare?: (session: SessionWithSets) => void;
}

interface EditableSetRowProps {
  set: GymSet;
  label: string;
  onUpdateSet: (setId: string, updates: Partial<{ weight_kg: number | null; reps: number }>) => Promise<void>;
  onDeleteSet: (setId: string) => Promise<void>;
}

function EditableSetRow({ set, label, onUpdateSet, onDeleteSet }: EditableSetRowProps) {
  const [weightStr, setWeightStr] = useState(set.weight_kg?.toString() ?? "");
  const [repsStr, setRepsStr] = useState(set.reps.toString());

  const handleWeightBlur = useCallback(() => {
    const val = weightStr === "" ? null : parseFloat(weightStr);
    if (val !== set.weight_kg) {
      onUpdateSet(set.id, { weight_kg: val !== null && !isNaN(val) ? val : null });
    }
  }, [weightStr, set.id, set.weight_kg, onUpdateSet]);

  const handleRepsBlur = useCallback(() => {
    const val = parseInt(repsStr, 10);
    if (!isNaN(val) && val > 0 && val !== set.reps) {
      onUpdateSet(set.id, { reps: val });
    }
  }, [repsStr, set.id, set.reps, onUpdateSet]);

  return (
    <div className={`flex items-center gap-2 px-3 py-2 ${set.is_warmup ? "opacity-60" : ""}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
        set.is_warmup ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary"
      }`}>
        {label}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        placeholder={set.is_bodyweight ? "BW" : "kg"}
        value={weightStr}
        onChange={(e) => setWeightStr(e.target.value)}
        onBlur={handleWeightBlur}
        disabled={set.is_bodyweight}
        className="h-9 w-[72px] text-center text-sm font-medium tabular-nums bg-background/50 border-border/40"
      />
      <span className="text-muted-foreground text-xs">×</span>
      <Input
        type="number"
        inputMode="numeric"
        placeholder="reps"
        value={repsStr}
        onChange={(e) => setRepsStr(e.target.value)}
        onBlur={handleRepsBlur}
        className="h-9 w-[72px] text-center text-sm font-medium tabular-nums bg-background/50 border-border/40"
      />
      <button
        onClick={() => onDeleteSet(set.id)}
        className="ml-auto shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground/40 active:text-destructive active:bg-destructive/10 transition-all"
        aria-label="Delete set"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SessionDetailSheet({ session, open, onOpenChange, onDelete, onUpdateSet, onDeleteSet, onShare }: SessionDetailSheetProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const canEdit = Boolean(onUpdateSet && onDeleteSet);

  if (!session) return null;

  // Auto-expand all in edit mode; collapse all otherwise (one expanded at a
  // time after the user manually opens one).
  const isExerciseOpen = (key: string) => editMode || expandedExercises.has(key);
  const toggleExercise = (key: string) => {
    setExpandedExercises((prev) => {
      const next = new Set<string>();
      if (!prev.has(key)) next.add(key);
      return next;
    });
  };

  // Discipline-colored edge for the hero card.
  const edgeColor = (() => {
    switch ((session.session_type ?? "").toLowerCase()) {
      case "strength":      return "bg-blue-400";
      case "hypertrophy":   return "bg-func-fats-purple";
      case "powerlifting":  return "bg-func-warning-yellow";
      case "explosiveness": return "bg-func-warning-yellow";
      case "conditioning":  return "bg-func-carbs-orange";
      case "circuit":       return "bg-func-danger-red";
      case "endurance":     return "bg-func-recovery-green";
      case "mobility":      return "bg-func-hydration-cyan";
      default:              return "bg-primary";
    }
  })();

  // Reset edit mode when sheet closes
  const handleOpenChange = (next: boolean) => {
    if (!next) setEditMode(false);
    onOpenChange(next);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
          {/* Share lives in the top-LEFT (absolute) and the sheet's own
              close X stays in the top-right. The title sits centered between
              them so neither button collides with it. Mirrors the
              ExerciseStatsSheet pattern. */}
          <SheetHeader className="relative flex flex-col items-center justify-center min-h-9 space-y-0 pb-1 px-9">
            <SheetTitle className="text-[15px] font-bold tracking-tight text-center">
              Workout
            </SheetTitle>
            {onShare && (
              <div className="absolute left-0 top-0">
                <button
                  type="button"
                  onClick={() => onShare(session)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground active:text-foreground active:bg-muted/40 transition-colors"
                  aria-label="Share session"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </SheetHeader>

          <motion.div
            variants={staggerContainer(50)}
            initial="hidden"
            animate="visible"
          >
            {/* Premium hero card: discipline edge + 3-stat row */}
            <motion.div
              variants={staggerItem}
              className="relative mt-3 rounded-xs card-surface pl-4 pr-3 py-3 overflow-hidden"
            >
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${edgeColor}`} />
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground truncate">
                    {session.session_type}
                  </span>
                  {session.session_tag && (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                      {session.session_tag}
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  {new Date(session.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </div>
              {/* 3-up stats */}
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="display-number text-[20px] font-black tabular-nums leading-none text-foreground">
                    {session.duration_minutes ?? "-"}
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">min</p>
                </div>
                <div className="text-center border-x border-border/30">
                  <p className="display-number text-[20px] font-black tabular-nums leading-none text-foreground">
                    {session.exerciseCount}
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">exer</p>
                </div>
                <div className="text-center">
                  <p className="display-number text-[20px] font-black tabular-nums leading-none text-foreground">
                    {session.totalVolume > 0 ? formatVolume(session.totalVolume) : "-"}
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">kg vol</p>
                </div>
              </div>
              {/* Fatigue + notes inline */}
              {(session.perceived_fatigue != null && session.perceived_fatigue > 0) && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Brain className="h-3 w-3 text-primary" />
                  Fatigue {session.perceived_fatigue}/10
                </div>
              )}
            </motion.div>

            {/* Notes */}
            {session.notes && (
              <motion.div variants={staggerItem} className="mt-3 card-surface rounded-xs p-3.5 text-[13px] text-muted-foreground leading-snug">
                {session.notes}
              </motion.div>
            )}

            {/* Collapsible exercise cards, one expanded at a time. Edit
                mode auto-expands everything so the user can edit any set. */}
            <div className="mt-4 space-y-2">
              {session.exerciseGroups.map((group) => {
                const key = `${group.exerciseOrder}-${group.exercise.id}`;
                const open = isExerciseOpen(key);
                const workingSets = group.sets.filter((s) => !s.is_warmup);
                const groupVolume = group.sets.reduce(
                  (sum, s) => sum + (s.is_warmup ? 0 : (s.weight_kg ?? 0) * (s.reps ?? 0)),
                  0,
                );
                return (
                  <motion.div
                    key={key}
                    variants={staggerItem}
                    className="rounded-xs card-surface overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => !editMode && toggleExercise(key)}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-muted/20 transition-colors"
                      aria-expanded={open}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-foreground truncate">{group.exercise.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {workingSets.length} {workingSets.length === 1 ? "set" : "sets"}
                          {groupVolume > 0 ? <> · {formatVolume(groupVolume)} kg</> : null}
                          {group.exercise.muscle_group ? <> · {group.exercise.muscle_group.replace(/_/g, " ")}</> : null}
                        </p>
                      </div>
                      <motion.span
                        className="shrink-0 text-muted-foreground/40"
                        animate={{ rotate: open ? 180 : 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden border-t border-border/30"
                        >
                          <div className="divide-y divide-border/15">
                            {group.sets.map((set, i) => {
                              const label = set.is_warmup
                                ? "W"
                                : String(group.sets.filter((s, j) => j <= i && !s.is_warmup).length);

                              if (editMode && onUpdateSet && onDeleteSet) {
                                return (
                                  <EditableSetRow
                                    key={set.id}
                                    set={set}
                                    label={label}
                                    onUpdateSet={onUpdateSet}
                                    onDeleteSet={onDeleteSet}
                                  />
                                );
                              }

                              return (
                                <div key={set.id} className="flex items-center gap-3 text-xs px-3 py-2.5">
                                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                    set.is_warmup ? "bg-muted/60 text-muted-foreground" : "bg-primary/15 text-primary"
                                  }`}>
                                    {label}
                                  </span>
                                  <span className="tabular-nums font-semibold text-[13px] text-foreground">
                                    {set.is_bodyweight ? "BW" : `${formatWeight(set.weight_kg)} kg`}
                                  </span>
                                  <span className="text-muted-foreground/60">×</span>
                                  <span className="tabular-nums font-semibold text-[13px] text-foreground">{set.reps}</span>
                                  {set.is_warmup && (
                                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">warmup</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <SheetFooter className="mt-6 pb-4 flex-row gap-2 sm:flex-row sm:space-x-0">
            {canEdit && (
              <Button
                variant="outline"
                onClick={() => setEditMode(v => !v)}
                className="flex-1 gap-2"
              >
                {editMode ? (
                  <>
                    <Check className="h-4 w-4" />
                    Done
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </>
                )}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 gap-2 border-destructive/20"
            >
              <Trash2 className="h-4 w-4" />
              Delete Session
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          onDelete(session.id);
          setDeleteOpen(false);
          onOpenChange(false);
        }}
        title="Delete Session"
        description="This will permanently delete this workout session and all its sets."
      />
    </>
  );
}
