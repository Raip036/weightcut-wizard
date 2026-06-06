import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, ChevronRight, List, CalendarDays, Sparkles, Dumbbell, Target, Award, Zap, Footprints, RotateCw, Activity, Flame } from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import wizardLogo from "@/assets/wizard_3D.png";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useGymSessions } from "@/hooks/gym/useGymSessions";
import { useGymSets } from "@/hooks/gym/useGymSets";
import { useExerciseLibrary } from "@/hooks/gym/useExerciseLibrary";
import { useExercisePRs } from "@/hooks/gym/useExercisePRs";
import { useGymAnalytics } from "@/hooks/gym/useGymAnalytics";
import { usePreviousSets } from "@/hooks/gym/usePreviousSets";
import { useRoutines } from "@/hooks/gym/useRoutines";
import { ActiveSessionView } from "@/components/gym/ActiveSessionView";
import { SessionHistoryList } from "@/components/gym/SessionHistoryList";
import { SessionHistoryCalendar } from "@/components/gym/SessionHistoryCalendar";
import { SessionDetailSheet } from "@/components/gym/SessionDetailSheet";
import { PostWorkoutMediaSheet } from "@/components/gym/PostWorkoutMediaSheet";
import type { Id } from "@/../convex/_generated/dataModel";
import { SessionAnalyticsCard } from "@/components/gym/SessionAnalyticsCard";
import { ExercisePickerSheet } from "@/components/gym/ExercisePickerSheet";
import { ExerciseStatsSheet } from "@/components/gym/ExerciseStatsSheet";
import { CreateExerciseDialog } from "@/components/gym/CreateExerciseDialog";
import { RoutineLibrary } from "@/components/gym/RoutineLibrary";
import { RoutineGeneratorSheet } from "@/components/gym/RoutineGeneratorSheet";
import { ManualRoutineSheet } from "@/components/gym/ManualRoutineSheet";
import { VolumeAreaChart, MuscleBalanceRing } from "@/components/gym/GymProgressCharts";
import { SESSION_TYPES } from "@/data/exerciseDatabase";

// Restrict the start-workout picker to the 3 disciplines the user wants
// surfaced. Other types (Powerlifting / Conditioning / Circuit / etc.)
// stay in the schema so historical sessions still render, but they're
// not pickable from the new-session UI.
const VISIBLE_SESSION_TYPES: ReadonlyArray<"Strength" | "Hypertrophy" | "Explosiveness"> = [
  "Strength",
  "Hypertrophy",
  "Explosiveness",
];

// Compact volume formatter shared between the page render and the
// Progress sub-tab helper. Lifted to module scope so the helper can
// use it without prop-drilling.
function formatVol(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;
}

// Icon + accent color per session type for the start-workout grid.
// The three picker chips (Strength / Hypertrophy / Explosiveness) render
// with Ionicons for visual consistency with the rest of the app; the
// remaining entries stay on Lucide because they're only used by legacy
// surfaces (history badges, etc.).
const SESSION_TYPE_META: Record<string, { icon: typeof Dumbbell; accent: string }> = {
  "Powerlifting":  { icon: Award,       accent: "text-amber-400" },
  "Conditioning":  { icon: Flame,       accent: "text-orange-400" },
  "Circuit":       { icon: RotateCw,    accent: "text-rose-400" },
  "Endurance":     { icon: Footprints,  accent: "text-emerald-400" },
  "Mobility":      { icon: Activity,    accent: "text-cyan-400" },
  "Custom":        { icon: Plus,        accent: "text-muted-foreground" },
};

import { triggerHaptic } from "@/lib/haptics";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { ImpactStyle } from "@capacitor/haptics";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { GymSessionCard } from "@/components/share/cards/GymSessionCard";
import type { SessionType, SessionWithSets, Exercise, SavedRoutine } from "@/pages/gym/types";

type GymTab = "workouts" | "routines" | "progress";
type HistoryView = "list" | "calendar";
const HISTORY_VIEW_KEY = "wcw_gym_history_view";

export default function GymTracker() {
  const { toast } = useToast();
  const {
    history, historyLoading, activeSession,
    startSession, finishSession, discardSession,
    deleteSession, updateActiveSession,
    updateCompletedSet, deleteCompletedSet,
  } = useGymSessions();

  const {
    addExerciseToSession, removeExerciseFromSession,
    addSet, updateSet, deleteSet, duplicateLastSet,
  } = useGymSets({ activeSession, updateActiveSession });

  const { exercises, filteredExercises, loading: exercisesLoading, addCustomExercise } = useExerciseLibrary();
  const { userId, profile } = useUser();
  // Recent exercises derived from logged-set history (newest-first, deduped) —
  // drives the picker's "Recent" tab so it spans all past workouts.
  const recentExerciseIds = useQuery(api.exercises.listRecent, userId ? {} : "skip");
  // Latest bodyweight — lets weighted exercises count added-load-only volume.
  const bodyweightKg = profile?.current_weight_kg ?? null;
  // Used by handleStartFromRoutine to upgrade routine exercises that aren't in
  // the library into real Convex rows — set-saving requires a valid Convex id.
  const createCustomExerciseMut = useMutation(api.exercises.createCustom);
  const { prs, checkAndUpdatePR, getPRForExercise } = useExercisePRs();
  const { analytics, fetchExerciseHistory } = useGymAnalytics(history);
  const previousSetsMap = usePreviousSets(activeSession, history);
  const {
    routines, routinesLoading, generatingRoutine,
    generateRoutine, saveRoutine, deleteRoutine, renameRoutine,
  } = useRoutines();

  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<GymTab>(() => searchParams.get("tab") === "routines" ? "routines" : "workouts");
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false);
  const [createExerciseOpen, setCreateExerciseOpen] = useState(false);
  const [detailSession, setDetailSession] = useState<SessionWithSets | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Share-card flow — driven from the detail sheet's share button. We hold
  // the session in state (rather than reading it back from detailSession) so
  // the dialog keeps a stable snapshot even if the user closes the sheet.
  const [shareSession, setShareSession] = useState<SessionWithSets | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Swipe-to-toggle dark ↔ transparent card variant, mirroring the
  // training calendar share flow so the gesture is consistent across cards.
  const [shareCardVariant, setShareCardVariant] = useState<"dark" | "transparent">("dark");
  const [statsExercise, setStatsExercise] = useState<Exercise | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [sessionType, setSessionType] = useState<SessionType>("Strength");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [manualRoutineOpen, setManualRoutineOpen] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>(() => {
    try {
      return (localStorage.getItem(HISTORY_VIEW_KEY) as HistoryView) === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  });
  useEffect(() => {
    try { localStorage.setItem(HISTORY_VIEW_KEY, historyView); } catch { /* ignore */ }
  }, [historyView]);
  const newPRSetIdsRef = useRef(new Set<string>());

  // Track the just-saved calendar entry id so we can prompt the user to
  // attach a photo/video. The id resolves to a Convex `fight_camp_calendar`
  // row that `addSessionMedia` will stamp with the user's gym, landing the
  // post in the gym social feed.
  const [pendingMediaSessionId, setPendingMediaSessionId] = useState<Id<"fight_camp_calendar"> | null>(null);
  const [pendingMediaSessionType, setPendingMediaSessionType] = useState<string | undefined>(undefined);

  // Wrap `finishSession` so the GymTracker (not the inner ActiveSessionView)
  // owns the post-save UX. We capture the active session's type BEFORE
  // calling finish since it clears `activeSession` on success.
  const handleFinishSession = useCallback(async (opts: { durationMinutes?: number; notes?: string; perceivedFatigue?: number }) => {
    const sessionTypeAtFinish = activeSession?.sessionType;
    const result = await finishSession(opts);
    if (result.ok && result.calendarEntryId) {
      setPendingMediaSessionType(sessionTypeAtFinish);
      setPendingMediaSessionId(result.calendarEntryId);
    }
  }, [activeSession?.sessionType, finishSession]);

  const [startingWorkout, setStartingWorkout] = useState(false);
  const handleStartWorkout = useCallback(async () => {
    if (startingWorkout) return; // Debounce double-tap
    setStartingWorkout(true);
    try {
      await startSession(sessionType);
      // startSession surfaces its own error toast with the underlying message;
      // no need for a second generic toast here.
    } finally {
      setStartingWorkout(false);
    }
  }, [startSession, sessionType, startingWorkout]);

  const handleStartFromRoutine = useCallback(async (routine: SavedRoutine, dayFilter?: string) => {
    if (exercisesLoading) {
      toast({ description: "Loading exercises, please try again", variant: "destructive" });
      return;
    }

    const typeMap: Record<string, SessionType> = {
      hypertrophy: "Hypertrophy",
      strength: "Strength",
      explosiveness: "Explosiveness",
      conditioning: "Conditioning",
      powerlifting: "Powerlifting",
      circuit: "Circuit",
      endurance: "Endurance",
      mobility: "Mobility",
    };
    const sType = typeMap[routine.goal] || "Strength";
    const sessionId = await startSession(sType as SessionType);
    if (!sessionId) {
      toast({ description: "Failed to start session", variant: "destructive" });
      return;
    }

    // Filter exercises by day if specified
    const routineExercises = dayFilter
      ? routine.exercises.filter(re => re.day === dayFilter)
      : routine.exercises;

    if (routineExercises.length === 0) {
      toast({ description: "No exercises in this routine", variant: "destructive" });
      discardSession();
      return;
    }

    // Map muscle group to valid ExerciseCategory
    const muscleToCategory = (mg: string): import("@/pages/gym/types").ExerciseCategory => {
      const m = mg.toLowerCase();
      if (["chest", "shoulders", "triceps"].includes(m)) return "push";
      if (["back", "biceps", "lats"].includes(m)) return "pull";
      if (["legs", "quads", "hamstrings", "glutes", "calves"].includes(m)) return "legs";
      if (["core", "abs", "obliques"].includes(m)) return "core";
      if (["cardio"].includes(m)) return "cardio";
      return "full_body";
    };

    // Resolve every routine exercise to a real Convex `exercises` row. Anything
    // not already in the library is created on the fly so the eventual set
    // mutation has a valid `Id<"exercises">`. Without this, sets fail with an
    // opaque ArgumentValidationError because a fabricated string id can't pass
    // `v.id("exercises")`.
    let createdCount = 0;
    const resolved: import("@/pages/gym/types").Exercise[] = [];
    for (const re of routineExercises) {
      let matched = (re.exercise_id && exercises.find(e => e.id === re.exercise_id))
        || exercises.find(e => e.name.toLowerCase() === re.name.toLowerCase());

      if (!matched) {
        try {
          const category = muscleToCategory(re.muscle_group);
          const insertedId = await createCustomExerciseMut({
            name: re.name,
            category,
            muscleGroup: re.muscle_group,
            isBodyweight: false,
          });
          matched = {
            id: insertedId as unknown as string,
            user_id: null,
            name: re.name,
            category,
            muscle_group: re.muscle_group,
            equipment: null,
            is_bodyweight: false,
            is_custom: true,
            created_at: new Date().toISOString(),
          };
          createdCount++;
        } catch {
          // If creation fails, skip this exercise so the session stays usable
          // for the rest of the routine.
          continue;
        }
      }

      resolved.push(matched);
    }

    if (resolved.length === 0) {
      toast({ description: "Couldn't import any exercises from this routine", variant: "destructive" });
      discardSession();
      return;
    }

    const groups: import("@/pages/gym/types").ExerciseGroup[] = resolved.map((exercise, idx) => ({
      exercise,
      exerciseOrder: idx + 1,
      sets: [],
    }));

    updateActiveSession(prev => ({ ...prev, exerciseGroups: groups }));
    if (createdCount > 0) {
      toast({ description: `Added ${createdCount} new exercise${createdCount > 1 ? "s" : ""} to your library` });
    }
    setTab("workouts");
  }, [startSession, exercises, exercisesLoading, updateActiveSession, discardSession, toast, createCustomExerciseMut]);

  const handleAddSet = useCallback(async (exerciseOrder: number, data: any) => {
    const set = await addSet(exerciseOrder, data);
    if (set) {
      const prRecords = await checkAndUpdatePR(set);
      if (prRecords.length > 0) {
        newPRSetIdsRef.current.add(set.id);
      }
    }
  }, [addSet, checkAndUpdatePR]);

  const handleExerciseSelect = useCallback((exercise: Exercise) => {
    addExerciseToSession(exercise);
  }, [addExerciseToSession]);

  const handleSessionTap = useCallback((session: SessionWithSets) => {
    setDetailSession(session);
    setDetailOpen(true);
  }, []);

  const handleExerciseTap = useCallback((exerciseId: string) => {
    const exercise = exercises.find(e => e.id === exerciseId);
    if (exercise) {
      setStatsExercise(exercise);
      setStatsOpen(true);
    }
  }, [exercises]);

  // When history refreshes (after edits), re-sync the open detail session by id
  // so inline weight/reps edits become visible without re-opening the sheet.
  useEffect(() => {
    if (!detailOpen || !detailSession) return;
    const fresh = history.find(s => s.id === detailSession.id);
    if (fresh && fresh !== detailSession) setDetailSession(fresh);
  }, [history, detailOpen, detailSession]);

  const { tasks: aiTasks, dismissTask: aiDismiss } = useAITask();
  const gymAiTask = aiTasks.find(t => t.status === "running" && t.type === "gym-routine");

  // Detect completed AI routine generation (e.g. user navigated away during generation)
  const [completedRoutineResult, setCompletedRoutineResult] = useState<any>(null);
  const handledTaskRef = useRef<string | null>(null);
  useEffect(() => {
    const completedTask = aiTasks.find(
      t => t.status === "done" && t.type === "gym-routine" && t.result?.exercises
    );
    if (completedTask && handledTaskRef.current !== completedTask.id) {
      handledTaskRef.current = completedTask.id;
      setCompletedRoutineResult(completedTask.result);
      setTab("routines");
      setGeneratorOpen(true);
      // Dismiss after a short delay to ensure state is applied first
      setTimeout(() => aiDismiss(completedTask.id), 100);
    }
  }, [aiTasks, aiDismiss]);

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const weeklyVolume = analytics.weeklyVolumes.length > 0
    ? analytics.weeklyVolumes[analytics.weeklyVolumes.length - 1].volume
    : 0;
  // formatVol lifted to module scope above

  return (
    <div className="space-y-2.5 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto md:pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
      <header className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
        <h1 className="text-title font-semibold leading-tight">Gym Tracker</h1>
      </header>
      {gymAiTask && (
        <AICompactOverlay
          isOpen={true}
          isGenerating={true}
          steps={gymAiTask.steps}
            startedAt={gymAiTask.startedAt}          title={gymAiTask.label}
          onCancel={() => aiDismiss(gymAiTask.id)}
        />
      )}
      <div className="space-y-3">
        {/* Animated pill tabs */}
        <LayoutGroup id="gym-tabs">
          <div className="relative grid grid-cols-3 gap-1 rounded-full bg-muted/30 p-1 border border-border/30">
            {(["workouts", "routines", "progress"] as const).map((tk) => {
              const active = tab === tk;
              const label = tk === "workouts" ? "Workouts" : tk === "routines" ? "Routines" : "Progress";
              return (
                <button
                  key={tk}
                  type="button"
                  onClick={() => { setTab(tk); triggerHaptic(ImpactStyle.Light); }}
                  aria-pressed={active}
                  className="relative h-9 text-[12px] font-bold transition-colors"
                >
                  {active && (
                    <motion.span
                      layoutId="gym-tab-pill"
                      className="absolute inset-0 rounded-full bg-primary"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className={`relative z-10 inline-flex items-center gap-1.5 ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                    {label}
                    {tk === "workouts" && activeSession && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* Tab content */}
        {tab === "workouts" ? (
          activeSession ? (
            <ActiveSessionView
              workout={activeSession}
              exercises={exercises}
              prs={prs}
              newPRSetIds={newPRSetIdsRef.current}
              previousSetsMap={previousSetsMap}
              onOpenExercisePicker={() => setExercisePickerOpen(true)}
              onAddSet={handleAddSet}
              onUpdateSet={updateSet}
              onDeleteSet={deleteSet}
              onDuplicateLastSet={duplicateLastSet}
              onRemoveExercise={removeExerciseFromSession}
              onFinish={handleFinishSession}
              onDiscard={discardSession}
              onExerciseTap={handleExerciseTap}
              bodyweightKg={bodyweightKg}
            />
          ) : (
            <>
              {/* Quick stats row */}
              {analytics.totalSessions > 0 && (
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="relative overflow-hidden card-surface rounded-xs p-3 pt-3.5 text-center">
                    <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" />
                    <div className="display-number text-[30px] font-extrabold leading-none text-foreground">{analytics.sessionsThisWeek}</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mt-1.5">This Week</div>
                  </div>
                  <div className="relative overflow-hidden card-surface rounded-xs p-3 pt-3.5 text-center">
                    <span className="absolute inset-x-0 top-0 h-[3px] bg-secondary" />
                    <div className="display-number text-[30px] font-extrabold leading-none text-foreground">{analytics.avgDuration}<span className="text-sm text-muted-foreground font-medium">m</span></div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mt-1.5">Avg Duration</div>
                  </div>
                  <div className="relative overflow-hidden card-surface rounded-xs p-3 pt-3.5 text-center">
                    <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "hsl(25 85% 58%)" }} />
                    <div className="display-number text-[30px] font-extrabold leading-none text-foreground">{formatVol(weeklyVolume)}<span className="text-sm text-muted-foreground font-medium">kg</span></div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mt-1.5">Week Volume</div>
                  </div>
                </div>
              )}

              {/* Wizard-led start hero — restricted to Strength /
                  Hypertrophy / Explosiveness. Wizard avatar uses the
                  transparent tutorial PNG so it sits chrome-free. */}
              <div className="card-surface rounded-xs p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="h-12 w-12 shrink-0 flex items-center justify-center">
                    <img
                      src={wizardLogo}
                      alt=""
                      className="h-full w-full object-contain pointer-events-none select-none"
                      draggable={false}
                    />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">Coach</p>
                    <p className="mt-0.5 text-[15px] font-bold leading-tight text-foreground">Ready to train?</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">Pick a focus — we'll start the timer.</p>
                  </div>
                </div>

                {/* Restricted session-type picker — single horizontally
                    scrollable row so all chips read in one glance and
                    extra options (when added) just extend the scroll. */}
                <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
                  <div className="flex items-center gap-2 w-max">
                    {VISIBLE_SESSION_TYPES.map((t) => {
                      const active = sessionType === t;
                      return (
                        <button
                          key={t}
                          onClick={() => {
                            setSessionType(t as SessionType);
                            triggerHaptic(ImpactStyle.Light);
                          }}
                          className={`relative shrink-0 flex items-center justify-center rounded-xs border px-4 py-2.5 active:scale-[0.97] transition-all ${
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/30 border-border/30 hover:bg-muted/50"
                          }`}
                        >
                          <span className="text-[13px] font-semibold whitespace-nowrap">{t}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Big start button — no sparkle icon */}
                <button
                  onClick={handleStartWorkout}
                  disabled={startingWorkout}
                  className="mt-3 w-full h-12 rounded-xs text-[15px] font-bold text-primary-foreground bg-primary flex items-center justify-center active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  {startingWorkout ? "Starting…" : `Start ${sessionType.toLowerCase()} workout`}
                </button>
              </div>

              {/* Analytics card */}
              <SessionAnalyticsCard
                sessionsThisWeek={analytics.sessionsThisWeek}
                avgDuration={analytics.avgDuration}
                totalSessions={analytics.totalSessions}
                mostTrainedMuscle={analytics.mostTrainedMuscle}
                weeklyVolumes={analytics.weeklyVolumes}
              />

              {/* Session history */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-sm">Workout History</h2>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-muted/40 border border-border/30">
                    <button
                      onClick={() => { setHistoryView("list"); triggerHaptic(ImpactStyle.Light); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        historyView === "list"
                          ? "bg-background text-foreground"
                          : "text-muted-foreground"
                      }`}
                      aria-label="List view"
                    >
                      <List className="h-3 w-3" />
                      List
                    </button>
                    <button
                      onClick={() => { setHistoryView("calendar"); triggerHaptic(ImpactStyle.Light); }}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-all ${
                        historyView === "calendar"
                          ? "bg-background text-foreground"
                          : "text-muted-foreground"
                      }`}
                      aria-label="Calendar view"
                    >
                      <CalendarDays className="h-3 w-3" />
                      Calendar
                    </button>
                  </div>
                </div>
                {historyView === "list" ? (
                  <SessionHistoryList
                    sessions={history}
                    loading={historyLoading}
                    onSessionTap={handleSessionTap}
                  />
                ) : (
                  <SessionHistoryCalendar
                    sessions={history}
                    loading={historyLoading}
                    onSessionTap={handleSessionTap}
                  />
                )}
              </div>
            </>
          )
        ) : tab === "routines" ? (
          /* Routines tab */
          <RoutineLibrary
            routines={routines}
            loading={routinesLoading}
            onDelete={deleteRoutine}
            onRename={renameRoutine}
            onStartWorkout={handleStartFromRoutine}
            onOpenGenerator={() => setGeneratorOpen(true)}
            onOpenManualCreator={() => setManualRoutineOpen(true)}
          />
        ) : (
          /* Progress tab — internal sub-tabs: PRs / Volume / Frequency */
          <ProgressTabContent
            history={history}
            exercises={exercises}
            analytics={analytics}
            weeklyVolume={weeklyVolume}
            onExerciseTap={(ex) => { setStatsExercise(ex); setStatsOpen(true); triggerHaptic(ImpactStyle.Light); }}
          />
        )}
      </div>

      {/* Sheets + dialogs */}
      <ExercisePickerSheet
        open={exercisePickerOpen}
        onOpenChange={setExercisePickerOpen}
        exercises={exercises}
        loading={exercisesLoading}
        onSelect={handleExerciseSelect}
        onCreateCustom={() => setCreateExerciseOpen(true)}
        recentExerciseIds={recentExerciseIds ?? undefined}
      />

      <CreateExerciseDialog
        open={createExerciseOpen}
        onOpenChange={setCreateExerciseOpen}
        onSubmit={addCustomExercise}
      />

      <SessionDetailSheet
        session={detailSession}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={deleteSession}
        onUpdateSet={updateCompletedSet}
        onDeleteSet={deleteCompletedSet}
        onShare={(session) => {
          // Close the detail sheet so its bottom-sheet doesn't sit behind
          // the share dialog and steal taps. The session is captured in
          // shareSession so the dialog renders the right snapshot.
          setShareSession(session);
          setDetailOpen(false);
          setShareOpen(true);
        }}
      />

      <ShareCardDialog
        open={shareOpen}
        onOpenChange={(v) => { setShareOpen(v); if (v) setShareCardVariant("dark"); }}
        transparent={shareCardVariant === "transparent"}
        showSwipeHint
        title="Share Workout"
        shareTitle={shareSession ? `${shareSession.session_type} workout` : "Workout"}
        shareText="Check out my workout on FightCamp Wizard"
      >
        {({ cardRef, aspect, transparent }) => {
          if (!shareSession) return null;
          let touchStartX = 0;
          const flashCardWrapper = (el: HTMLElement | null) => {
            if (!el) return;
            el.classList.remove("share-variant-flash");
            // Force reflow so the animation re-triggers on rapid swipes.
            void el.offsetWidth;
            el.classList.add("share-variant-flash");
          };
          return (
            <div
              onTouchStart={(e) => { touchStartX = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const delta = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(delta) > 40) {
                  setShareCardVariant((v) => (v === "dark" ? "transparent" : "dark"));
                  flashCardWrapper(e.currentTarget as HTMLElement);
                }
              }}
            >
              <GymSessionCard
                ref={cardRef}
                sessionType={shareSession.session_type}
                date={shareSession.date}
                durationMinutes={shareSession.duration_minutes}
                exerciseGroups={shareSession.exerciseGroups}
                totalVolume={shareSession.totalVolume}
                aspect={aspect}
                transparent={transparent}
              />
            </div>
          );
        }}
      </ShareCardDialog>

      <ExerciseStatsSheet
        exercise={statsExercise}
        pr={statsExercise ? getPRForExercise(statsExercise.id) : null}
        open={statsOpen}
        onOpenChange={setStatsOpen}
      />

      <PostWorkoutMediaSheet
        sessionId={pendingMediaSessionId}
        sessionType={pendingMediaSessionType}
        onClose={() => {
          setPendingMediaSessionId(null);
          setPendingMediaSessionType(undefined);
        }}
      />

      <RoutineGeneratorSheet
        open={generatorOpen}
        onOpenChange={(open) => {
          setGeneratorOpen(open);
          if (!open) setCompletedRoutineResult(null);
        }}
        onGenerate={generateRoutine}
        onSave={saveRoutine}
        generating={generatingRoutine}
        completedResult={completedRoutineResult}
      />

      <ManualRoutineSheet
        open={manualRoutineOpen}
        onOpenChange={setManualRoutineOpen}
        exercises={exercises}
        onSave={saveRoutine}
      />
    </div>
  );
}

// ── ProgressTabContent ─────────────────────────────────────────────
// 3 inner tabs: PRs / Volume / Frequency. Replaces the flat PR-only
// list with a tabbed analytical view.
type ProgressSubTab = "prs" | "volume" | "frequency";

function ProgressTabContent({
  history,
  exercises,
  analytics,
  weeklyVolume,
  onExerciseTap,
}: {
  history: SessionWithSets[];
  exercises: Exercise[];
  analytics: { totalSessions: number; sessionsThisWeek: number; avgDuration: number; topMuscle: string | null };
  weeklyVolume: number;
  onExerciseTap: (ex: Exercise) => void;
}) {
  const [sub, setSub] = useState<ProgressSubTab>("prs");

  // PRs — per-exercise heaviest set
  const exerciseStats = new Map<string, { bestWeight: number; bestReps: number; exercise: Exercise | undefined }>();
  for (const session of history) {
    for (const group of session.exerciseGroups) {
      for (const set of group.sets) {
        if (set.is_warmup) continue;
        const w = set.weight_kg ?? 0;
        const r = set.reps ?? 0;
        const prev = exerciseStats.get(group.exercise.id);
        if (!prev) {
          exerciseStats.set(group.exercise.id, { bestWeight: w, bestReps: r, exercise: exercises.find(e => e.id === group.exercise.id) || (group.exercise as Exercise) });
        } else if (w > prev.bestWeight) {
          prev.bestWeight = w;
          prev.bestReps = r;
        } else if (w === prev.bestWeight && r > prev.bestReps) {
          prev.bestReps = r;
        }
      }
    }
  }
  const loggedExercises = Array.from(exerciseStats.entries())
    .map(([id, stats]) => ({ id, exercise: stats.exercise!, bestWeight: stats.bestWeight, bestReps: stats.bestReps }))
    .filter(item => !!item.exercise);

  // Volume — last 7 days of session volume
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayVolume = history
      .filter((s) => s.date === dateStr)
      .reduce((sum, s) => sum + (s.totalVolume || 0), 0);
    return { date: dateStr, label: d.toLocaleDateString("en-US", { weekday: "short" })[0], volume: dayVolume };
  });

  // Frequency — sessions per muscle group across all history
  const muscleFreq = new Map<string, number>();
  for (const session of history) {
    const groupsSeen = new Set<string>();
    for (const group of session.exerciseGroups) {
      const mg = (group.exercise.muscle_group ?? "other").replace(/_/g, " ");
      if (groupsSeen.has(mg)) continue;
      groupsSeen.add(mg);
      muscleFreq.set(mg, (muscleFreq.get(mg) ?? 0) + 1);
    }
  }
  const muscleRows = Array.from(muscleFreq.entries())
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-3">
      {/* Inner sub-tab pills */}
      <LayoutGroup id="gym-progress-subtabs">
        <div className="relative grid grid-cols-3 gap-1 rounded-full bg-muted/30 p-1 border border-border/30">
          {(["prs", "volume", "frequency"] as const).map((s) => {
            const active = sub === s;
            const label = s === "prs" ? "PRs" : s === "volume" ? "Volume" : "Frequency";
            return (
              <button
                key={s}
                type="button"
                onClick={() => { setSub(s); triggerHaptic(ImpactStyle.Light); }}
                aria-pressed={active}
                className="relative h-8 text-[11px] font-bold transition-colors"
              >
                {active && (
                  <motion.span
                    layoutId="gym-progress-subtab-pill"
                    className="absolute inset-0 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className={`relative z-10 ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Tab content */}
      {sub === "prs" && (
        loggedExercises.length === 0 ? (
          <div className="card-surface rounded-xs p-6 text-center">
            <p className="text-[13px] text-muted-foreground">No exercises logged yet</p>
            <p className="text-[12px] text-muted-foreground/60 mt-0.5">Complete a workout to track PRs</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(() => {
              const top = [...loggedExercises].filter((e) => e.bestWeight > 0).sort((a, b) => b.bestWeight - a.bestWeight)[0];
              if (!top) return null;
              return (
                <button
                  onClick={() => onExerciseTap(top.exercise)}
                  className="relative w-full overflow-hidden rounded-xs p-4 text-left active:scale-[0.99] transition-transform"
                  style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.22), hsl(var(--secondary) / 0.10))", border: "1px solid hsl(var(--primary) / 0.25)" }}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                      <Award className="h-5 w-5 text-primary" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Top lift</p>
                      <p className="text-[15px] font-bold truncate text-foreground">{top.exercise.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="display-number text-[24px] leading-none text-foreground">
                        {top.bestWeight}<span className="text-[12px] font-medium text-muted-foreground ml-0.5">kg</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">× {top.bestReps} reps</p>
                    </div>
                  </div>
                </button>
              );
            })()}
            <div className="space-y-1.5">
            {loggedExercises.map(({ id, exercise: ex, bestWeight, bestReps }) => (
              <button
                key={id}
                onClick={() => onExerciseTap(ex)}
                className="w-full flex items-center gap-3 rounded-xs card-surface px-3 py-2.5 active:bg-muted/30 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate text-foreground">{ex.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{ex.muscle_group?.replace(/_/g, " ")}</p>
                </div>
                {bestWeight > 0 ? (
                  <div className="text-right shrink-0">
                    <p className="text-[16px] font-bold tabular-nums text-primary leading-none">
                      {bestWeight}<span className="text-[11px] font-medium text-muted-foreground ml-0.5">kg</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">× {bestReps} reps</p>
                  </div>
                ) : bestReps > 0 ? (
                  <div className="text-right shrink-0">
                    <p className="text-[16px] font-bold tabular-nums text-primary leading-none">{bestReps}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">reps</p>
                  </div>
                ) : null}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              </button>
            ))}
            </div>
          </div>
        )
      )}

      {sub === "volume" && (
        <div className="card-surface rounded-xs p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Last 7 days</p>
            <p className="text-[18px] font-bold tabular-nums text-foreground">
              {formatVol(weeklyVolume)}
              <span className="text-[11px] text-muted-foreground font-medium ml-0.5">kg</span>
            </p>
          </div>
          {/* Smooth gradient area chart */}
          <div className="mt-3">
            <VolumeAreaChart days={days} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            Daily training volume across all working sets (warmups excluded).
          </p>
        </div>
      )}

      {sub === "frequency" && (
        muscleRows.length === 0 ? (
          <div className="card-surface rounded-xs p-6 text-center">
            <p className="text-[13px] text-muted-foreground">No data yet</p>
            <p className="text-[12px] text-muted-foreground/60 mt-0.5">Log workouts to see muscle frequency</p>
          </div>
        ) : (
          <div className="card-surface rounded-xs p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Muscle balance</p>
              <p className="text-[10px] text-muted-foreground/70">All-time</p>
            </div>
            <MuscleBalanceRing rows={muscleRows} />
          </div>
        )
      )}
    </div>
  );
}
