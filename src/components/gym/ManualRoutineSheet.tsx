import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Search, ChevronLeft, Check, Minus } from "lucide-react";
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

const GOALS: { value: TrainingGoal; label: string }[] = [
  { value: "strength", label: "Strength" },
  { value: "hypertrophy", label: "Hypertrophy" },
  { value: "explosiveness", label: "Explosiveness" },
  { value: "conditioning", label: "Conditioning" },
];

const REP_PRESETS = ["5", "8-12", "12-15"];
const REST_PRESETS = [60, 90, 120];

// Solid muscle dot colours, matching the routine card markers.
const MUSCLE_DOT: Record<string, string> = {
  chest: "bg-blue-400",
  back: "bg-func-fats-purple",
  shoulders: "bg-func-carbs-orange",
  biceps: "bg-func-hydration-cyan",
  triceps: "bg-pink-400",
  quads: "bg-func-recovery-green",
  hamstrings: "bg-func-recovery-green",
  glutes: "bg-func-danger-red",
  calves: "bg-teal-400",
  abs: "bg-primary",
  forearms: "bg-func-warning-yellow",
  traps: "bg-func-fats-purple",
  full_body: "bg-indigo-400",
  cardio: "bg-func-danger-red",
};

interface Entry {
  exercise: Exercise;
  sets: number;
  reps: string;
  restSeconds: number;
  day: number; // 1-based
}

const pill = (active: boolean) =>
  `px-3.5 py-2 rounded-full text-xs font-semibold transition-all active:scale-[0.97] ${
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted/30 text-muted-foreground border border-border/30 hover:text-foreground"
  }`;

export function ManualRoutineSheet({ open, onOpenChange, exercises, onSave }: ManualRoutineSheetProps) {
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [routineName, setRoutineName] = useState("");
  const [goal, setGoal] = useState<TrainingGoal>("strength");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dayCount, setDayCount] = useState(1);
  const [currentDay, setCurrentDay] = useState(1);
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
    setGoal("strength");
    setEntries([]);
    setDayCount(1);
    setCurrentDay(1);
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
    setEntries((prev) => [...prev, { exercise, sets: 3, reps: "8-12", restSeconds: 90, day: currentDay }]);
    setShowPicker(false);
    setSearchQuery("");
  };

  const removeAt = (index: number) => {
    triggerHaptic(ImpactStyle.Light);
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAt = (index: number, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const addDay = () => {
    triggerHaptic(ImpactStyle.Light);
    setDayCount((c) => c + 1);
    setCurrentDay(dayCount + 1); // jump to the freshly added day
  };

  const handleSave = async () => {
    if (entries.length === 0 || !routineName.trim()) return;
    setSaving(true);
    try {
      const ordered = [...entries].sort((a, b) => a.day - b.day);
      const routineExercises: RoutineExercise[] = ordered.map((entry) => ({
        exercise_id: entry.exercise.id,
        name: entry.exercise.name,
        muscle_group: entry.exercise.muscle_group as MuscleGroup,
        sets: entry.sets,
        reps: entry.reps,
        rpe: null,
        rest_seconds: entry.restSeconds,
        notes: null,
        ...(dayCount > 1 ? { day: `Day ${entry.day}` } : {}),
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

  // Indices grouped per day so we can render day headers + reassign.
  const visibleDays = Array.from({ length: dayCount }, (_, i) => i + 1);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="h-[86vh] flex flex-col rounded-t-3xl border-border/50 p-0 [&>button:last-of-type]:hidden" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}>
        <SheetHeader className="px-5 pb-3 pt-5 shrink-0">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button onClick={() => { setStep(1); setShowPicker(false); }} className="h-9 w-9 rounded-full bg-muted/30 flex items-center justify-center">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-left">{step === 1 ? "New routine" : "Build your days"}</SheetTitle>
              <p className="text-xs text-muted-foreground text-left mt-0.5">
                {step === 1 ? "Name it and pick a focus" : "Add exercises to each training day"}
              </p>
            </div>
            <button onClick={() => onOpenChange(false)} className="h-9 w-9 rounded-full bg-muted/30 flex items-center justify-center shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Step progress */}
          <div className="flex items-center gap-1.5 pt-1">
            <span className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-primary" : "bg-muted/40"}`} />
            <span className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-primary" : "bg-muted/40"}`} />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── Step 1: Setup ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Routine name</label>
                <Input
                  placeholder="e.g. Fighter Strength Block"
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  className="h-12 bg-muted/20 border-border/40 rounded-xs text-[15px]"
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Training goal</label>
                <div className="grid grid-cols-4 gap-1.5 p-1 rounded-2xl bg-muted/20 border border-border/30">
                  {GOALS.map((g) => {
                    const active = goal === g.value;
                    return (
                      <button
                        key={g.value}
                        onClick={() => { setGoal(g.value); triggerHaptic(ImpactStyle.Light); }}
                        className={`flex items-center justify-center text-center h-11 px-1 rounded-xl text-[11px] font-semibold leading-tight transition-all active:scale-[0.96] ${
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button onClick={() => setStep(2)} disabled={!routineName.trim()} className="w-full rounded-xs h-12 text-[15px] font-semibold">
                Next
              </Button>
            </div>
          )}

          {/* ── Step 2: Days + exercises ── */}
          {step === 2 && (
            showPicker ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Adding to <span className="font-semibold text-foreground">Day {currentDay}</span></p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search exercises…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-11 bg-muted/20 border-border/40 rounded-xs"
                    autoFocus
                  />
                </div>
                <div className="max-h-[55vh] overflow-y-auto space-y-1 rounded-xs border border-border/40 bg-muted/10 p-2">
                  {filteredExercises.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No exercises found</p>
                  )}
                  {filteredExercises.map((ex) => {
                    const already = entries.some((a) => a.exercise.id === ex.id && a.day === currentDay);
                    return (
                      <button
                        key={ex.id}
                        onClick={() => !already && handleAddExercise(ex)}
                        disabled={already}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xs text-left transition-colors ${already ? "opacity-40" : "hover:bg-muted/30 active:scale-[0.99]"}`}
                      >
                        <span className={`h-2 w-2 rounded-full shrink-0 ${MUSCLE_DOT[ex.muscle_group] || "bg-muted-foreground/50"}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate text-foreground">{ex.name}</span>
                          <span className="block text-[11px] text-muted-foreground capitalize">{ex.muscle_group.replace(/_/g, " ")}</span>
                        </span>
                        {already && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                <Button variant="ghost" onClick={() => { setShowPicker(false); setSearchQuery(""); }} className="w-full rounded-full text-muted-foreground">
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Day selector */}
                <div className="flex flex-wrap items-center gap-2">
                  {visibleDays.map((d) => (
                    <button key={d} onClick={() => setCurrentDay(d)} className={pill(currentDay === d)}>
                      Day {d}
                    </button>
                  ))}
                  <button onClick={addDay} className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold text-primary border border-primary/30 bg-primary/10 active:scale-[0.97] transition-transform">
                    <Plus className="h-3.5 w-3.5" /> Day
                  </button>
                  {dayCount > 1 && (
                    <button
                      onClick={() => {
                        // Remove the last day and its exercises.
                        setEntries((prev) => prev.filter((e) => e.day !== dayCount));
                        setDayCount((c) => Math.max(1, c - 1));
                        setCurrentDay((c) => Math.min(c, dayCount - 1) || 1);
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground border border-border/30 bg-muted/30 active:scale-[0.95] transition-transform"
                      aria-label="Remove last day"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <Button variant="outline" onClick={() => setShowPicker(true)} className="w-full rounded-xs border-dashed border-border/50 bg-muted/10 h-11">
                  <Plus className="h-4 w-4 mr-2" />
                  Add exercise to Day {currentDay}
                </Button>

                {entries.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No exercises yet. Pick a day and add some.</p>
                )}

                {/* Exercises grouped by day */}
                {visibleDays.map((d) => {
                  const dayEntries = entries
                    .map((e, idx) => ({ e, idx }))
                    .filter(({ e }) => e.day === d);
                  if (dayEntries.length === 0) return null;
                  return (
                    <div key={d} className="space-y-2">
                      {dayCount > 1 && (
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary/80 pt-1">Day {d}</p>
                      )}
                      {dayEntries.map(({ e: entry, idx }) => (
                        <div key={`${entry.exercise.id}-${idx}`} className="card-surface rounded-xs border border-border/40 p-3.5 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full shrink-0 ${MUSCLE_DOT[entry.exercise.muscle_group] || "bg-muted-foreground/50"}`} />
                              <span className="min-w-0">
                                <span className="block text-[14px] font-semibold truncate text-foreground">{entry.exercise.name}</span>
                                <span className="block text-[11px] text-muted-foreground capitalize">{entry.exercise.muscle_group.replace(/_/g, " ")}</span>
                              </span>
                            </span>
                            <button onClick={() => removeAt(idx)} className="h-7 w-7 rounded-full bg-muted/30 flex items-center justify-center shrink-0 active:bg-destructive/20 transition-colors">
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </div>

                          {/* Sets / Reps / Rest with presets */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Sets</label>
                              <Input
                                type="number"
                                min={1}
                                value={entry.sets}
                                onChange={(ev) => updateAt(idx, { sets: parseInt(ev.target.value, 10) || 1 })}
                                className="h-10 bg-muted/20 border-border/40 rounded-xs text-center text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Reps</label>
                              <Input
                                value={entry.reps}
                                onChange={(ev) => updateAt(idx, { reps: ev.target.value })}
                                className="h-10 bg-muted/20 border-border/40 rounded-xs text-center text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rest (s)</label>
                              <Input
                                type="number"
                                min={0}
                                value={entry.restSeconds}
                                onChange={(ev) => updateAt(idx, { restSeconds: parseInt(ev.target.value, 10) || 0 })}
                                className="h-10 bg-muted/20 border-border/40 rounded-xs text-center text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {REP_PRESETS.map((r) => (
                              <button key={r} onClick={() => updateAt(idx, { reps: r })} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${entry.reps === r ? "bg-primary/15 text-primary border border-primary/30" : "bg-muted/30 text-muted-foreground border border-border/20"}`}>
                                {r}
                              </button>
                            ))}
                            <span className="w-px self-stretch bg-border/40 mx-0.5" />
                            {REST_PRESETS.map((s) => (
                              <button key={s} onClick={() => updateAt(idx, { restSeconds: s })} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${entry.restSeconds === s ? "bg-primary/15 text-primary border border-primary/30" : "bg-muted/30 text-muted-foreground border border-border/20"}`}>
                                {s}s
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {entries.length > 0 && (
                  <Button onClick={handleSave} disabled={saving} className="w-full rounded-xs h-12 mt-2 text-[15px] font-semibold">
                    {saving ? "Saving…" : "Save routine"}
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
