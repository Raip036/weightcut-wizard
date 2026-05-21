import { useState, useCallback, useMemo, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { motion, AnimatePresence } from "motion/react";
import {
  Dumbbell, Zap, Flame, Target,
  ChevronRight, ChevronLeft, Save, Loader2, Clock, Calendar,
  Layout, Layers, Rows3, Grid3X3, Brain,
} from "lucide-react";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import type {
  RoutineGenerationParams, RoutineExercise, TrainingGoal,
  CombatSport, Equipment, WorkoutSplit, FocusArea,
} from "@/pages/gym/types";

interface CompletedRoutineResult {
  exercises: RoutineExercise[];
  name: string;
  notes: string;
  recommendedGymDays: number | null;
  splitUsed: string | null;
}

interface RoutineGeneratorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (params: RoutineGenerationParams) => Promise<any>;
  onSave: (name: string, goal: TrainingGoal, exercises: RoutineExercise[], sport: CombatSport, trainingDays: number, isAiGenerated: boolean) => Promise<void>;
  generating: boolean;
  completedResult?: CompletedRoutineResult | null;
}

const GOALS: { value: TrainingGoal; label: string; icon: typeof Dumbbell; description: string }[] = [
  { value: "hypertrophy", label: "Hypertrophy", icon: Dumbbell, description: "Build muscle size & volume" },
  { value: "strength", label: "Strength", icon: Target, description: "Maximize force output" },
  { value: "explosiveness", label: "Explosiveness", icon: Zap, description: "Power & athleticism" },
  { value: "conditioning", label: "Conditioning", icon: Flame, description: "Endurance & fight cardio" },
];

const SPORTS: { value: CombatSport; label: string }[] = [
  { value: "mma", label: "MMA" },
  { value: "bjj", label: "BJJ" },
  { value: "boxing", label: "Boxing" },
  { value: "muay_thai", label: "Muay Thai" },
  { value: "wrestling", label: "Wrestling" },
  { value: "general", label: "General" },
];

const SPLITS: { value: WorkoutSplit; label: string; icon: typeof Layout }[] = [
  { value: "ai_recommended", label: "Let AI Decide", icon: Brain },
  { value: "upper_lower", label: "Upper / Lower", icon: Rows3 },
  { value: "push_pull_legs", label: "Push / Pull / Legs", icon: Layers },
  { value: "full_body", label: "Full Body", icon: Grid3X3 },
  { value: "bro_split", label: "Bro Split", icon: Layout },
];

const FOCUS_AREAS: { value: FocusArea; label: string }[] = [
  { value: "chest", label: "Chest" },
  { value: "back", label: "Back" },
  { value: "shoulders", label: "Shoulders" },
  { value: "arms", label: "Arms" },
  { value: "legs", label: "Legs" },
  { value: "core", label: "Core" },
  { value: "explosiveness", label: "Explosiveness" },
  { value: "grip", label: "Grip" },
];

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
  abs: "bg-primary/15 text-primary",
  core: "bg-primary/15 text-primary",
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

function groupByDay(exercises: RoutineExercise[]): { day: string; exercises: RoutineExercise[] }[] {
  const groups: { day: string; exercises: RoutineExercise[] }[] = [];
  for (const ex of exercises) {
    const dayLabel = ex.day || "Exercises";
    const existing = groups.find(g => g.day === dayLabel);
    if (existing) {
      existing.exercises.push(ex);
    } else {
      groups.push({ day: dayLabel, exercises: [ex] });
    }
  }
  return groups;
}

export function ExerciseListGrouped({ exercises }: { exercises: RoutineExercise[] }) {
  const groups = useMemo(() => groupByDay(exercises), [exercises]);
  const hasDays = exercises.some(e => e.day);

  if (!hasDays) {
    // Flat list fallback for old routines without day field
    return (
      <div className="space-y-2">
        {exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} index={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => (
        <div key={group.day} className={`rounded-xs border border-border/30 overflow-hidden border-l-[3px] ${DAY_COLORS[gi % DAY_COLORS.length]}`}>
          <div className="px-3.5 py-2.5 bg-muted/20">
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground/80">{group.day}</h4>
            <span className="text-[10px] text-muted-foreground">{group.exercises.length} exercises</span>
          </div>
          <div className="divide-y divide-border/15">
            {group.exercises.map((ex, i) => (
              <ExerciseRow key={i} ex={ex} index={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExerciseRow({ ex, index }: { ex: RoutineExercise; index: number }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="h-7 w-7 rounded-xs bg-primary/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-primary/70">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{ex.name}</div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground tabular-nums">{ex.sets}&times;{ex.reps}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${MUSCLE_COLORS[ex.muscle_group] || "bg-muted/50 text-muted-foreground"}`}>
            {ex.muscle_group.replace("_", " ")}
          </span>
          {ex.rest_seconds > 0 && (
            <span className="text-[10px] text-muted-foreground/60">{ex.rest_seconds}s rest</span>
          )}
        </div>
        {ex.notes && (
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">{ex.notes}</p>
        )}
      </div>
    </div>
  );
}

type Step = "goals" | "sport" | "preferences" | "generate" | "result";
const STEPS: Step[] = ["goals", "sport", "preferences", "generate", "result"];

export function RoutineGeneratorSheet({ open, onOpenChange, onGenerate, onSave, generating, completedResult }: RoutineGeneratorSheetProps) {
  const { tasks: aiTasks, dismissTask: aiDismissTask } = useAITask();
  const gymAiTask = aiTasks.find(t => t.status === "running" && t.type === "gym-routine");

  // Hide bottom nav while sheet is open
  useEffect(() => {
    document.body.classList.toggle("hide-bottom-nav", open);
    return () => { document.body.classList.remove("hide-bottom-nav"); };
  }, [open]);

  const [step, setStep] = useState<Step>("goals");
  const [selectedGoals, setSelectedGoals] = useState<TrainingGoal[]>([]);
  const [sport, setSport] = useState<CombatSport | null>(null);
  const [sportTrainingDays, setSportTrainingDays] = useState(5);
  const [sessionDuration, setSessionDuration] = useState(60);
  const [preferredSplit, setPreferredSplit] = useState<WorkoutSplit>("ai_recommended");
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [generatedExercises, setGeneratedExercises] = useState<RoutineExercise[]>([]);
  const [routineName, setRoutineName] = useState("");
  const [recommendedGymDays, setRecommendedGymDays] = useState<number | null>(null);
  const [splitUsed, setSplitUsed] = useState<string | null>(null);
  const [routineNotes, setRoutineNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  const reset = useCallback(() => {
    setStep("goals");
    setSelectedGoals([]);
    setSport(null);
    setSportTrainingDays(5);
    setSessionDuration(60);
    setPreferredSplit("ai_recommended");
    setFocusAreas([]);
    setGeneratedExercises([]);
    setRoutineName("");
    setRecommendedGymDays(null);
    setSplitUsed(null);
    setRoutineNotes("");
    setSaving(false);
  }, []);

  // Restore state from a completed background generation
  useEffect(() => {
    if (completedResult && completedResult.exercises.length > 0) {
      setGeneratedExercises(completedResult.exercises);
      setRoutineName(completedResult.name || "Generated Routine");
      setRoutineNotes(completedResult.notes || "");
      setRecommendedGymDays(completedResult.recommendedGymDays);
      setSplitUsed(completedResult.splitUsed);
      // Set defaults so handleSave works (goal/sport aren't in the result)
      if (selectedGoals.length === 0) setSelectedGoals(["strength"]);
      if (!sport) setSport("general");
      setStep("result");
    }
  }, [completedResult]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  }, [onOpenChange, reset]);

  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const toggleGoal = (g: TrainingGoal) => {
    setSelectedGoals(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  };

  const toggleFocus = (f: FocusArea) => {
    setFocusAreas(prev =>
      prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
    );
  };

  const canProceed = (): boolean => {
    switch (step) {
      case "goals": return selectedGoals.length > 0;
      case "sport": return sport !== null;
      case "preferences": return true;
      case "generate": return !generating;
      case "result": return routineName.trim().length > 0 && generatedExercises.length > 0;
      default: return false;
    }
  };

  const handleGenerate = async () => {
    if (selectedGoals.length === 0 || !sport) return;
    const params: RoutineGenerationParams = {
      goals: selectedGoals,
      sport,
      sportTrainingDays,
      availableEquipment: ["barbell", "dumbbell", "cable", "machine", "bodyweight"] as Equipment[],
      sessionDurationMinutes: sessionDuration,
      focusAreas,
      preferredSplit,
    };
    try {
      const result = await onGenerate(params);
      if (result?.exercises) {
        setGeneratedExercises(result.exercises);
        setRoutineName(result.name || `${selectedGoals.map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(" + ")} Routine`);
        setRecommendedGymDays(result.recommendedGymDays || null);
        setSplitUsed(result.splitUsed || null);
        setRoutineNotes(result.notes || "");
      }
      setStep("result");
    } catch {
      // Error handled upstream
    }
  };

  const handleSave = async () => {
    if (selectedGoals.length === 0 || !sport || !routineName.trim()) return;
    setSaving(true);
    try {
      await onSave(routineName.trim(), selectedGoals[0], generatedExercises, sport, sportTrainingDays, true);
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const stepTitle = (): string => {
    switch (step) {
      case "goals": return "Training Goals";
      case "sport": return "Your Sport";
      case "preferences": return "Preferences";
      case "generate": return "Generate";
      case "result": return "Your Routine";
      default: return "";
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl flex flex-col" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}>
        <SheetHeader className="pb-2">
          <div className="flex items-center justify-between">
            {stepIndex > 0 && step !== "result" ? (
              <button onClick={goBack} className="w-12 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <div className="w-12" />
            )}
            <SheetTitle className="text-lg font-bold tracking-tight text-center">{stepTitle()}</SheetTitle>
            <div className="w-12" />
          </div>
          <div className="flex gap-1.5 justify-center pt-2">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i <= stepIndex ? "bg-primary w-6" : "bg-muted/40 w-4"
                }`}
              />
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto pt-4 pb-4 px-1">
          <AnimatePresence mode="wait">
            {/* STEP 1: GOALS (multi-select) */}
            {step === "goals" && (
              <motion.div key="goals" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">
                <p className="text-xs text-muted-foreground text-center">Select one or more goals</p>
                <div className="grid grid-cols-2 gap-3">
                  {GOALS.map(g => {
                    const Icon = g.icon;
                    const selected = selectedGoals.includes(g.value);
                    return (
                      <button
                        key={g.value}
                        onClick={() => toggleGoal(g.value)}
                        className={`card-surface rounded-xs border p-4 text-center transition-all active:scale-[0.97] ${
                          selected
                            ? "border-primary/50 ring-1 ring-primary/30 bg-primary/5"
                            : "border-border/50 hover:border-border"
                        }`}
                      >
                        <div className={`h-10 w-10 rounded-xs flex items-center justify-center mb-3 mx-auto ${
                          selected ? "bg-primary/20" : "bg-muted/40"
                        }`}>
                          <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                        </div>
                        <div className="text-sm font-semibold">{g.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{g.description}</div>
                      </button>
                    );
                  })}
                </div>
                <Button onClick={goNext} disabled={selectedGoals.length === 0} className="w-full h-12 rounded-xs text-[15px] font-semibold">
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* STEP 2: SPORT + SPORT TRAINING DAYS */}
            {step === "sport" && (
              <motion.div key="sport" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-6">
                <div>
                  <p className="text-xs text-muted-foreground mb-3">What combat sport do you train?</p>
                  <div className="flex flex-wrap gap-2">
                    {SPORTS.map(s => {
                      const selected = sport === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => setSport(s.value)}
                          className={`px-5 py-3 rounded-xs text-sm font-semibold transition-all active:scale-[0.97] ${
                            selected
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "card-surface border border-border/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary/70" />
                      <span className="text-sm font-medium">Sport Training Days</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-primary">{sportTrainingDays} days/week</span>
                  </div>
                  <Slider
                    value={[sportTrainingDays]}
                    onValueChange={([v]) => setSportTrainingDays(v)}
                    min={2}
                    max={7}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-2 text-center">
                    How many days you train {sport ? SPORTS.find(s => s.value === sport)?.label : "your sport"} per week (not gym)
                  </p>
                </div>

                <Button onClick={goNext} disabled={!sport} className="w-full h-12 rounded-xs text-[15px] font-semibold">
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* STEP 3: PREFERENCES (split, focus, duration) */}
            {step === "preferences" && (
              <motion.div key="preferences" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-6">
                {/* Preferred Split */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Preferred Split</p>
                  <div className="space-y-2">
                    {SPLITS.map(s => {
                      const Icon = s.icon;
                      const selected = preferredSplit === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => setPreferredSplit(s.value)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xs text-left transition-all active:scale-[0.98] ${
                            selected
                              ? "bg-primary/10 border border-primary/30"
                              : "card-surface border border-border/30 hover:border-border/50"
                          }`}
                        >
                          <Icon className={`h-4 w-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                          <span className={`text-sm font-medium ${selected ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Focus Areas */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Focus Areas <span className="font-normal">(optional)</span></p>
                  <div className="flex flex-wrap gap-2">
                    {FOCUS_AREAS.map(f => {
                      const selected = focusAreas.includes(f.value);
                      return (
                        <button
                          key={f.value}
                          onClick={() => toggleFocus(f.value)}
                          className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all active:scale-[0.97] ${
                            selected
                              ? "bg-primary/15 text-primary border border-primary/30"
                              : "bg-muted/30 text-muted-foreground border border-border/30 hover:text-foreground"
                          }`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Session Duration */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary/70" />
                      <span className="text-sm font-medium">Session Duration</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-primary">{sessionDuration} min</span>
                  </div>
                  <Slider
                    value={[sessionDuration]}
                    onValueChange={([v]) => setSessionDuration(v)}
                    min={30}
                    max={90}
                    step={15}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1.5 px-0.5">
                    <span>30m</span><span>45m</span><span>60m</span><span>75m</span><span>90m</span>
                  </div>
                </div>

                <Button onClick={goNext} className="w-full h-12 rounded-xs text-[15px] font-semibold">
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* STEP 4: GENERATE (summary + button) */}
            {step === "generate" && (
              <motion.div key="generate" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="flex flex-col items-center justify-center py-4">
                <div className="card-surface rounded-xs border border-border/50 p-5 w-full mb-8">
                  <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-3">Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Goals</span>
                      <span className="font-medium capitalize text-right">{selectedGoals.join(", ")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sport</span>
                      <span className="font-medium capitalize">{sport?.replace("_", " ")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sport Days</span>
                      <span className="font-medium">{sportTrainingDays}/week</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Split</span>
                      <span className="font-medium">{SPLITS.find(s => s.value === preferredSplit)?.label}</span>
                    </div>
                    {focusAreas.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Focus</span>
                        <span className="font-medium capitalize text-right">{focusAreas.join(", ")}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{sessionDuration} min</span>
                    </div>
                  </div>
                </div>

                {generating && gymAiTask ? (
                  <AICompactOverlay
                    isOpen={true}
                    isGenerating={true}
                    steps={gymAiTask.steps}
            startedAt={gymAiTask.startedAt}                    title={gymAiTask.label}
                    onCancel={() => aiDismissTask(gymAiTask.id)}
                  />
                ) : (
                  <Button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="w-full h-14 rounded-xs text-[15px] font-semibold"
                    size="lg"
                  >
                    Generate Routine
                  </Button>
                )}
              </motion.div>
            )}

            {/* STEP 5: RESULT */}
            {step === "result" && (
              <motion.div key="result" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }} className="space-y-4">
                <Input
                  placeholder="Routine name..."
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  className="h-12 text-base font-semibold bg-muted/30 border-border/30 rounded-xs focus-visible:ring-2 focus-visible:ring-primary/30"
                />

                {/* AI Recommendations */}
                {(recommendedGymDays || splitUsed) && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {recommendedGymDays && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary">
                        <Calendar className="h-3 w-3" />
                        {recommendedGymDays}x/week recommended
                      </span>
                    )}
                    {splitUsed && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary/10 text-secondary">
                        <Layout className="h-3 w-3" />
                        {splitUsed}
                      </span>
                    )}
                  </div>
                )}

                <ExerciseListGrouped exercises={generatedExercises} />

                {routineNotes && (
                  <div className="card-surface rounded-xs border border-border/30 p-3">
                    <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">Coach Notes</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{routineNotes}</p>
                  </div>
                )}

                {generatedExercises.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No exercises generated. Try again.
                  </div>
                )}

                {generatedExercises.length > 0 && (
                  <Button
                    onClick={handleSave}
                    disabled={saving || !routineName.trim() || generatedExercises.length === 0}
                    className="w-full h-12 rounded-xs text-[15px] font-semibold"
                  >
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save to Library
                  </Button>
                )}

                <div className="h-4" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </SheetContent>
    </Sheet>
  );
}
