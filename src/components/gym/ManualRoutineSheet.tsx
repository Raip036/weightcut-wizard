import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Search, Dumbbell, ChevronLeft, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { Exercise, RoutineExercise, TrainingGoal, MuscleGroup } from "@/pages/gym/types";

interface ManualRoutineSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercises: Exercise[];
  onSave: (
    name: string,
    goal: TrainingGoal,
    exercises: RoutineExercise[],
    sport?: undefined,
    trainingDays?: number,
    isAiGenerated?: boolean,
  ) => Promise<void>;
}

const GOALS: { value: TrainingGoal; label: string; icon: typeof Dumbbell }[] = [
  { value: "hypertrophy", label: "Hypertrophy", icon: Dumbbell },
  { value: "strength", label: "Strength", icon: Dumbbell },
  { value: "explosiveness", label: "Explosiveness", icon: Dumbbell },
  { value: "conditioning", label: "Conditioning", icon: Dumbbell },
];

const MUSCLE_COLORS: Record<string, string> = {
  chest: "bg-blue-500/15 text-blue-400",
  back: "bg-purple-500/15 text-purple-400",
  shoulders: "bg-orange-500/15 text-orange-400",
  biceps: "bg-cyan-500/15 text-cyan-400",
  triceps: "bg-pink-500/15 text-pink-400",
  quads: "bg-green-500/15 text-green-400",
  hamstrings: "bg-emerald-500/15 text-emerald-400",
  glutes: "bg-rose-500/15 text-rose-400",
  calves: "bg-teal-500/15 text-teal-400",
  abs: "bg-primary/15 text-primary",
  forearms: "bg-amber-500/15 text-amber-400",
  traps: "bg-violet-500/15 text-violet-400",
  full_body: "bg-indigo-500/15 text-indigo-400",
  cardio: "bg-red-500/15 text-red-400",
};

interface RoutineExerciseEntry {
  exercise: Exercise;
  sets: number;
  reps: string;
  restSeconds: number;
}

export function ManualRoutineSheet({
  open,
  onOpenChange,
  exercises,
  onSave,
}: ManualRoutineSheetProps) {
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [routineName, setRoutineName] = useState("");
  const [goal, setGoal] = useState<TrainingGoal>("hypertrophy");
  const [addedExercises, setAddedExercises] = useState<RoutineExerciseEntry[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const filteredExercises = useMemo(() => {
    if (!searchQuery.trim()) return exercises;
    const q = searchQuery.toLowerCase();
    return exercises.filter((e) => e.name.toLowerCase().includes(q));
  }, [exercises, searchQuery]);

  const resetState = () => {
    setStep(1);
    setRoutineName("");
    setGoal("hypertrophy");
    setAddedExercises([]);
    setShowPicker(false);
    setSearchQuery("");
    setSaving(false);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) resetState();
    onOpenChange(value);
  };

  const handleAddExercise = (exercise: Exercise) => {
    triggerHaptic(ImpactStyle.Light);
    setAddedExercises((prev) => [
      ...prev,
      { exercise, sets: 3, reps: "8-12", restSeconds: 90 },
    ]);
    setShowPicker(false);
    setSearchQuery("");
  };

  const handleRemoveExercise = (index: number) => {
    triggerHaptic(ImpactStyle.Light);
    setAddedExercises((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExerciseField = (
    index: number,
    field: "sets" | "reps" | "restSeconds",
    value: string,
  ) => {
    setAddedExercises((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        if (field === "sets") return { ...entry, sets: parseInt(value, 10) || 1 };
        if (field === "restSeconds") return { ...entry, restSeconds: parseInt(value, 10) || 0 };
        return { ...entry, reps: value };
      }),
    );
  };

  const handleSave = async () => {
    if (addedExercises.length === 0 || !routineName.trim()) return;
    setSaving(true);
    try {
      const routineExercises: RoutineExercise[] = addedExercises.map((entry) => ({
        exercise_id: entry.exercise.id,
        name: entry.exercise.name,
        muscle_group: entry.exercise.muscle_group as MuscleGroup,
        sets: entry.sets,
        reps: entry.reps,
        rpe: null,
        rest_seconds: entry.restSeconds,
        notes: null,
      }));
      await onSave(routineName.trim(), goal, routineExercises, undefined, undefined, false);
      triggerHaptic(ImpactStyle.Medium);
      toast({ title: "Routine saved", description: `"${routineName.trim()}" has been created.` });
      resetState();
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "Failed to save routine. Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="h-[80vh] flex flex-col rounded-t-3xl border-border/50 p-0 [&>button:last-of-type]:hidden" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}>
        <SheetHeader className="px-5 pb-3 pt-5 shrink-0">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => { setStep(1); setShowPicker(false); }}
                className="h-8 w-8 rounded-xs bg-muted/30 flex items-center justify-center"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <SheetTitle className="flex-1">{step === 1 ? "New Routine" : "Add Exercises"}</SheetTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-xs bg-muted/30 flex items-center justify-center shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── Step 1: Setup ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Routine Name</label>
                <Input
                  placeholder="My Routine"
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  className="bg-muted/30 border-border/50 rounded-xs"
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm text-muted-foreground">Training Goal</label>
                <div className="grid grid-cols-2 gap-3">
                  {GOALS.map((g) => {
                    const selected = goal === g.value;
                    return (
                      <button
                        key={g.value}
                        onClick={() => { setGoal(g.value); triggerHaptic(ImpactStyle.Light); }}
                        className={`card-surface rounded-xs border p-4 text-left transition-all active:scale-[0.97] ${
                          selected
                            ? "border-primary/50 ring-1 ring-primary/30 bg-primary/5"
                            : "border-border/50 hover:border-border"
                        }`}
                      >
                        <div className={`h-9 w-9 rounded-xs flex items-center justify-center mb-2 ${
                          selected ? "bg-primary/20" : "bg-muted/40"
                        }`}>
                          <g.icon className={`h-4 w-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <span className={`text-sm font-medium ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                          {g.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={() => setStep(2)}
                disabled={!routineName.trim()}
                className="w-full rounded-xs h-12"
              >
                Next
              </Button>
            </div>
          )}

          {/* ── Step 2: Add Exercises ── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Inline exercise picker */}
              {showPicker ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search exercises..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-muted/30 border-border/50 rounded-xs"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-[45vh] overflow-y-auto space-y-1 rounded-xs border border-border/50 bg-muted/10 p-2">
                    {filteredExercises.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">No exercises found</p>
                    )}
                    {filteredExercises.map((ex) => {
                      const alreadyAdded = addedExercises.some((a) => a.exercise.id === ex.id);
                      return (
                        <button
                          key={ex.id}
                          onClick={() => !alreadyAdded && handleAddExercise(ex)}
                          disabled={alreadyAdded}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xs text-left transition-colors ${
                            alreadyAdded
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:bg-muted/30 active:scale-[0.99]"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{ex.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                              MUSCLE_COLORS[ex.muscle_group] || "bg-muted/30 text-muted-foreground"
                            }`}>
                              {ex.muscle_group.replace("_", " ")}
                            </span>
                          </div>
                          {alreadyAdded && <Check className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => { setShowPicker(false); setSearchQuery(""); }}
                    className="w-full rounded-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowPicker(true)}
                    className="w-full rounded-xs border-dashed border-border/50 bg-muted/10 h-11"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Exercise
                  </Button>

                  {addedExercises.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No exercises yet. Tap above to add some.
                    </p>
                  )}

                  <div className="space-y-3">
                    {addedExercises.map((entry, idx) => (
                      <div
                        key={`${entry.exercise.id}-${idx}`}
                        className="card-surface rounded-xs border border-border/50 p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{entry.exercise.name}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                              MUSCLE_COLORS[entry.exercise.muscle_group] || "bg-muted/30 text-muted-foreground"
                            }`}>
                              {entry.exercise.muscle_group.replace("_", " ")}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveExercise(idx)}
                            className="h-7 w-7 rounded-xs bg-muted/30 flex items-center justify-center shrink-0 hover:bg-destructive/20 transition-colors"
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Sets</label>
                            <Input
                              type="number"
                              min={1}
                              value={entry.sets}
                              onChange={(e) => updateExerciseField(idx, "sets", e.target.value)}
                              className="h-9 bg-muted/20 border-border/50 rounded-xs text-center text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Reps</label>
                            <Input
                              value={entry.reps}
                              onChange={(e) => updateExerciseField(idx, "reps", e.target.value)}
                              className="h-9 bg-muted/20 border-border/50 rounded-xs text-center text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rest (s)</label>
                            <Input
                              type="number"
                              min={0}
                              value={entry.restSeconds}
                              onChange={(e) => updateExerciseField(idx, "restSeconds", e.target.value)}
                              className="h-9 bg-muted/20 border-border/50 rounded-xs text-center text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {addedExercises.length > 0 && (
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      className="w-full rounded-xs h-12 mt-2"
                    >
                      {saving ? "Saving..." : "Save Routine"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
