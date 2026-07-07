import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic, celebrateSuccess, confirmDelete } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { calculateVolume } from "@/lib/gymCalculations";
import { logger } from "@/lib/logger";
import { invalidateGymAnalytics } from "./useGymAnalytics";
import type {
  GymSet, Exercise, SessionType, GymSession,
  ExerciseGroup, SessionWithSets, ActiveWorkout,
} from "@/pages/gym/types";

const ACTIVE_SESSION_KEY = "wcw_active_gym_session";

export function useGymSessions() {
  const { userId } = useUser();
  const { toast } = useToast();

  // Active session lives in localStorage so refresh / app-resume restores it.
  const [activeSession, setActiveSession] = useState<ActiveWorkout | null>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_SESSION_KEY);
      return saved ? JSON.parse(saved) as ActiveWorkout : null;
    } catch {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      return null;
    }
  });

  // Reactive history query — Convex pushes updates when sets/sessions change.
  const sessionsRaw = useQuery(api.gym_sessions.listHistory, userId ? { limit: 20 } : "skip");
  const allExercises = useQuery(api.exercises.listForUser, userId ? {} : "skip");

  // `listHistory` now returns sessions with their sets joined server-side.
  // We resolve exerciseId → Exercise from the user's exercise library here so
  // the detail sheet has names/muscle groups to render.
  const exercisesMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const ex of (allExercises ?? []) as unknown as Exercise[]) map.set(ex.id, ex);
    return map;
  }, [allExercises]);

  const history: SessionWithSets[] = useMemo(() => {
    return ((sessionsRaw ?? []) as Array<GymSession & { sets: GymSet[] }>).map((s) => {
      const sets = s.sets ?? [];

      // Group sets by exerciseOrder so exercises render in the order the user
      // performed them. Sets within each group are sorted by set_order.
      const groupsByOrder = new Map<number, { exerciseId: string; sets: GymSet[] }>();
      for (const set of sets) {
        const order = set.exercise_order;
        const existing = groupsByOrder.get(order);
        if (existing) {
          existing.sets.push(set);
        } else {
          groupsByOrder.set(order, { exerciseId: set.exercise_id, sets: [set] });
        }
      }

      const exerciseGroups: ExerciseGroup[] = Array.from(groupsByOrder.entries())
        .sort(([a], [b]) => a - b)
        .map(([exerciseOrder, group]) => {
          const exercise = exercisesMap.get(group.exerciseId);
          // Fallback Exercise stub if the library hasn't loaded yet or the
          // exercise has been deleted — the sheet still needs SOMETHING to
          // render rather than crashing on group.exercise.name.
          const safeExercise: Exercise = exercise ?? {
            id: group.exerciseId,
            user_id: null,
            name: "Exercise",
            category: "full_body",
            muscle_group: "full_body",
            equipment: null,
            is_bodyweight: false,
            is_custom: false,
            created_at: "",
          };
          return {
            exercise: safeExercise,
            exerciseOrder,
            sets: group.sets.sort((a, b) => a.set_order - b.set_order),
          };
        });

      const exercises: Exercise[] = exerciseGroups.map((g) => g.exercise);
      const totalVolume = calculateVolume(sets);
      const exerciseCount = exerciseGroups.length;

      return {
        ...(s as GymSession),
        sets,
        exercises,
        exerciseGroups,
        totalVolume,
        exerciseCount,
      };
    });
  }, [sessionsRaw, exercisesMap]);
  const historyLoading = sessionsRaw === undefined;

  // Persist active session to localStorage on change.
  useEffect(() => {
    if (activeSession) {
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(activeSession));
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }, [activeSession]);

  // Mutations.
  const createSessionMut = useMutation(api.gym_sessions.createSession);
  const completeSessionMut = useMutation(api.gym_sessions.completeSession);
  const deleteSessionMut = useMutation(api.gym_sessions.deleteSession);
  const updateSetMut = useMutation(api.gym_sessions.updateSet);
  const deleteSetMut = useMutation(api.gym_sessions.deleteSet);
  const createCalendarEntryMut = useMutation(api.fight_camp.createCalendarEntry);

  const startSession = useCallback(async (sessionType: SessionType): Promise<string | null> => {
    if (!userId) {
      toast({ description: "Please sign in to start a workout", variant: "destructive" });
      return null;
    }

    if (activeSession) {
      return activeSession.sessionId;
    }

    try {
      const sessionId = await createSessionMut({
        date: new Date().toISOString().split("T")[0],
        sessionType,
        status: "in_progress",
      });
      const workout: ActiveWorkout = {
        sessionId: sessionId as unknown as string,
        sessionType,
        startedAt: Date.now(),
        exerciseGroups: [],
      };
      setActiveSession(workout);
      triggerHaptic(ImpactStyle.Medium);
      return workout.sessionId;
    } catch (err) {
      logger.error("startSession failed", err);
      const msg = (err as any)?.message || "Failed to start workout";
      toast({ description: msg, variant: "destructive" });
      return null;
    }
  }, [userId, activeSession, toast, createSessionMut]);

  const finishSession = useCallback(async (opts: {
    durationMinutes?: number;
    notes?: string;
    perceivedFatigue?: number;
  }): Promise<{ ok: true; calendarEntryId: Id<"fight_camp_calendar"> | null } | { ok: false }> => {
    if (!userId || !activeSession) return { ok: false };

    try {
      const elapsed = Math.round((Date.now() - activeSession.startedAt) / 60000);
      const durationMin = opts.durationMinutes ?? elapsed;

      await completeSessionMut({
        id: activeSession.sessionId as unknown as Id<"gym_sessions">,
        durationMinutes: durationMin,
        notes: opts.notes ?? undefined,
        perceivedFatigue: opts.perceivedFatigue ?? undefined,
      });

      invalidateGymAnalytics(userId);

      // Also log to training calendar so the workout appears alongside
      // fight-camp sessions. We capture the new row's id and return it
      // so the GymTracker UI can immediately offer "Add photo/video" —
      // that's the entry point that lands media in the gym social feed
      // via `session_media + gymId` (stamped server-side in
      // `addSessionMedia`).
      let calendarEntryId: Id<"fight_camp_calendar"> | null = null;
      try {
        calendarEntryId = (await createCalendarEntryMut({
          date: new Date().toISOString().split("T")[0],
          sessionType: activeSession.sessionType,
          durationMinutes: durationMin,
          rpe: opts.perceivedFatigue ?? 5,
          intensity: durationMin >= 60 ? "high" : durationMin >= 30 ? "moderate" : "low",
          notes: opts.notes ?? undefined,
          // Mark this as the gym-synthesized mirror of the gym_sessions row.
          // The Fight Form load pillar excludes source:"gym" calendar rows so
          // the workout (already counted via gym_sessions) isn't double-counted.
          source: "gym",
        })) as unknown as Id<"fight_camp_calendar">;
      } catch (calErr) {
        logger.warn("Failed to log gym session to training calendar", { error: String(calErr) });
      }

      setActiveSession(null);
      celebrateSuccess();
      return { ok: true, calendarEntryId };
    } catch (err) {
      toast({ description: "Failed to finish workout", variant: "destructive" });
      return { ok: false };
    }
  }, [userId, activeSession, toast, completeSessionMut, createCalendarEntryMut]);

  const discardSession = useCallback(async () => {
    if (!activeSession) return;
    try {
      await deleteSessionMut({
        id: activeSession.sessionId as unknown as Id<"gym_sessions">,
      });
    } catch {
      // Best effort — still clear local state.
    }
    setActiveSession(null);
  }, [activeSession, deleteSessionMut]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!userId) return;
    try {
      await deleteSessionMut({ id: sessionId as unknown as Id<"gym_sessions"> });
      invalidateGymAnalytics(userId);
      confirmDelete();
    } catch {
      toast({ description: "Failed to delete session", variant: "destructive" });
    }
  }, [userId, toast, deleteSessionMut]);

  const updateActiveSession = useCallback((updater: (prev: ActiveWorkout) => ActiveWorkout) => {
    setActiveSession(prev => prev ? updater(prev) : prev);
  }, []);

  const updateCompletedSet = useCallback(async (
    setId: string,
    updates: Partial<{ weight_kg: number | null; reps: number; is_warmup: boolean }>,
  ) => {
    if (!userId) return;
    try {
      await updateSetMut({
        id: setId as unknown as Id<"gym_sets">,
        reps: updates.reps,
        weightKg: updates.weight_kg ?? undefined,
        isWarmup: updates.is_warmup,
      });
      invalidateGymAnalytics(userId);
    } catch {
      // Reactive state will resync.
    }
  }, [userId, updateSetMut]);

  const deleteCompletedSet = useCallback(async (setId: string) => {
    if (!userId) return;
    try {
      await deleteSetMut({ id: setId as unknown as Id<"gym_sets"> });
      invalidateGymAnalytics(userId);
    } catch {
      // Reactive state will resync.
    }
  }, [userId, deleteSetMut]);

  const refetchHistory = useCallback(async (_limit = 20) => { /* reactive — no-op */ }, []);

  return {
    history,
    historyLoading,
    activeSession,
    startSession,
    finishSession,
    discardSession,
    deleteSession,
    updateActiveSession,
    updateCompletedSet,
    deleteCompletedSet,
    refetchHistory,
  };
}
