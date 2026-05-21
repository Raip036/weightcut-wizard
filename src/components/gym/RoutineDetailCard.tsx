import { useState, useRef, useEffect, useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown, Play, Trash2, Pencil, Check, X, ChevronRight,
} from "lucide-react";
import type { SavedRoutine, RoutineExercise } from "@/pages/gym/types";

interface RoutineDetailCardProps {
  routine: SavedRoutine;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onStartWorkout: (routine: SavedRoutine, dayFilter?: string) => void;
}

const GOAL_BADGE: Record<string, string> = {
  hypertrophy: "bg-blue-500/15 text-blue-400",
  strength: "bg-func-danger-red/15 text-func-danger-red",
  explosiveness: "bg-func-warning-yellow/15 text-func-warning-yellow",
  conditioning: "bg-func-recovery-green/15 text-func-recovery-green",
};

const MUSCLE_COLORS: Record<string, string> = {
  chest: "bg-blue-500/15 text-blue-400",
  back: "bg-func-fats-purple/15 text-func-fats-purple",
  shoulders: "bg-func-carbs-orange/15 text-func-carbs-orange",
  biceps: "bg-func-hydration-cyan/15 text-func-hydration-cyan",
  triceps: "bg-pink-500/15 text-pink-400",
  quads: "bg-func-recovery-green/15 text-func-recovery-green",
  hamstrings: "bg-func-recovery-green/15 text-func-recovery-green",
  glutes: "bg-func-danger-red/15 text-func-danger-red",
  calves: "bg-teal-500/15 text-teal-400",
  abs: "bg-func-warning-yellow/15 text-func-warning-yellow",
  core: "bg-func-warning-yellow/15 text-func-warning-yellow",
  full_body: "bg-indigo-500/15 text-indigo-400",
  cardio: "bg-func-danger-red/15 text-func-danger-red",
};

const DAY_COLORS = [
  "border-l-blue-500",
  "border-l-func-fats-purple",
  "border-l-func-recovery-green",
  "border-l-func-warning-yellow",
  "border-l-func-danger-red",
  "border-l-func-hydration-cyan",
];

interface GroupedExerciseListProps {
  exercises: RoutineExercise[];
  onStartDay?: (day: string) => void;
}

function ExerciseRow({ ex, idx }: { ex: RoutineExercise; idx: number }) {
  // Explicit grid columns guarantee alignment and prevent the muscle pill from
  // colliding with sets×reps even when names or values get long. min-w-0 on
  // every cell lets each column truncate independently instead of pushing
  // siblings around. Each cell uses overflow-hidden so a long pill can't bleed
  // into the next column visually.
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_3.5rem_5.75rem] items-center gap-2 px-3 py-2">
      <span className="text-[10px] text-muted-foreground/50 text-right tabular-nums">{idx + 1}</span>
      <span className="text-xs font-medium truncate min-w-0">{ex.name}</span>
      <span className="text-[11px] text-muted-foreground tabular-nums text-right min-w-0 truncate">
        {ex.sets}&times;{ex.reps}
      </span>
      <div className="min-w-0 flex justify-end overflow-hidden">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full max-w-full truncate ${MUSCLE_COLORS[ex.muscle_group] || "bg-muted/50 text-muted-foreground"}`}>
          {ex.muscle_group.replace("_", " ")}
        </span>
      </div>
    </div>
  );
}

function GroupedExerciseList({ exercises, onStartDay }: GroupedExerciseListProps) {
  const hasDays = exercises.some(e => e.day);

  const groups = useMemo(() => {
    if (!hasDays) return [{ day: "", exercises }];
    const result: { day: string; exercises: RoutineExercise[] }[] = [];
    for (const ex of exercises) {
      const label = ex.day || "Exercises";
      const existing = result.find(g => g.day === label);
      if (existing) existing.exercises.push(ex);
      else result.push({ day: label, exercises: [ex] });
    }
    return result;
  }, [exercises, hasDays]);

  if (!hasDays) {
    // Flat list for old routines
    return (
      <div className="px-4 pb-2 space-y-1">
        {exercises.map((ex, i) => (
          <div key={i} className="border-t border-border/20 first:border-t-0">
            <ExerciseRow ex={ex} idx={i} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-3 pb-2 space-y-2.5 pt-1">
      {groups.map((group, gi) => (
        <div key={group.day || gi} className={`rounded-xs border border-border/30 overflow-hidden border-l-[3px] ${DAY_COLORS[gi % DAY_COLORS.length]}`}>
          {/* Day header — tappable to start that day's workout */}
          <button
            type="button"
            onClick={() => onStartDay?.(group.day)}
            disabled={!onStartDay}
            className="w-full px-3 py-2.5 bg-muted/15 flex items-center justify-between gap-2 active:bg-muted/30 transition-colors disabled:active:bg-muted/15 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Play className="h-3 w-3 text-primary shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-foreground truncate">{group.day}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-muted-foreground">{group.exercises.length} exercises</span>
              {onStartDay && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
            </div>
          </button>
          <div className="divide-y divide-border/15">
            {group.exercises.map((ex, i) => (
              <ExerciseRow key={i} ex={ex} idx={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RoutineDetailCard({ routine, onDelete, onRename, onStartWorkout }: RoutineDetailCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(routine.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== routine.name) {
      onRename(routine.id, trimmed);
    } else {
      setEditName(routine.name);
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditName(routine.name);
    setEditing(false);
  };

  const formattedDate = new Date(routine.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="card-surface rounded-xs border border-border/50 overflow-hidden relative">
        {/* Subtle gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.02] to-transparent pointer-events-none" />

        <div className="relative">
          {/* Header — name + always-visible Start button + chevron */}
          <div className="flex items-start gap-2 p-4">
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    ref={inputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                    className="h-7 text-sm font-semibold bg-muted/30 border-border/30 rounded-xs px-2"
                  />
                  <button onClick={handleRename} className="p-1 rounded hover:bg-muted/40">
                    <Check className="h-3.5 w-3.5 text-func-recovery-green" />
                  </button>
                  <button onClick={handleCancelEdit} className="p-1 rounded hover:bg-muted/40">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold truncate">{routine.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                    className="p-1 rounded hover:bg-muted/40 shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                    aria-label="Rename routine"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${GOAL_BADGE[routine.goal] || "bg-muted/50 text-muted-foreground"}`}>
                  {routine.goal}
                </span>
                {routine.is_ai_generated && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-func-fats-purple/15 text-func-fats-purple font-bold uppercase tracking-wider">
                    AI
                  </span>
                )}
                {routine.sport && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border border-border/20 capitalize">
                    {routine.sport.replace("_", " ")}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {routine.exercises.length} exer · {formattedDate}
                </span>
              </div>
            </div>

            {/* Always-visible Start button + expand chevron */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStartWorkout(routine); }}
                aria-label="Start routine"
                className="h-9 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-bold inline-flex items-center gap-1.5 active:scale-[0.96] transition-transform shadow-md shadow-primary/30"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={2.6} />
                Start
              </button>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-label={expanded ? "Collapse routine" : "Expand routine"}
                  className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
            </div>
          </div>

          {/* Exercises list — grouped by day if available. Tap a day header to
              start just that day; for single-day / flat routines the footer
              "Start Workout" button starts the whole thing. */}
          <CollapsibleContent>
            <GroupedExerciseList
              exercises={routine.exercises}
              onStartDay={(day) => onStartWorkout(routine, day)}
            />

            {/* Footer actions */}
            <div className="px-4 pb-4 pt-2 border-t border-border/20">
              {(() => {
                const hasDays = routine.exercises.some(e => e.day);
                return (
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => onStartWorkout(routine)}
                      className="flex-1 h-10 rounded-xs text-xs font-semibold bg-gradient-to-r from-primary to-primary/80"
                      size="sm"
                    >
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      {hasDays ? "Start Full Routine" : "Start Workout"}
                    </Button>
                    <button
                      onClick={() => onDelete(routine.id)}
                      className="h-10 w-10 rounded-xs flex items-center justify-center border border-border/50 hover:bg-destructive/10 hover:border-destructive/30 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                    </button>
                  </div>
                );
              })()}
            </div>
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  );
}
