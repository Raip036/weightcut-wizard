import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useAITask } from "@/contexts/AITaskContext";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { logger } from "@/lib/logger";
import { Dumbbell, Activity, CheckCircle } from "lucide-react";
import type {
  SavedRoutine,
  RoutineExercise,
  RoutineGenerationParams,
  TrainingGoal,
  CombatSport,
} from "@/pages/gym/types";

export function useRoutines() {
  const { userId } = useUser();
  const { safeAsync, isMounted } = useSafeAsync();
  const { toast } = useToast();
  const { addTask, completeTask, failTask } = useAITask();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_WORKOUT_GENERATOR");
  const workoutGeneratorAction = useAIAction(api.actions.workoutGenerator.run, "AI_WORKOUT_GENERATOR");
  const rawRoutines = useQuery(api.routines.listForUser, userId ? {} : "skip");
  const createRoutineMut = useMutation(api.routines.createRoutine);
  const updateRoutineMut = useMutation(api.routines.updateRoutine);
  const deleteRoutineMut = useMutation(api.routines.deleteRoutine);

  const routines: SavedRoutine[] = useMemo(
    () => (rawRoutines ?? []).map((r: any) => ({
      id: r._id,
      user_id: r.userId,
      name: r.name,
      goal: r.goal,
      sport: r.sport ?? null,
      training_days_per_week: r.trainingDaysPerWeek ?? null,
      exercises: r.exercises as RoutineExercise[],
      is_ai_generated: !!r.isAiGenerated,
      sort_order: r.sortOrder ?? 0,
      created_at: new Date(r._creationTime).toISOString(),
      updated_at: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
    })),
    [rawRoutines],
  );
  const routinesLoading = rawRoutines === undefined;
  const [generatingRoutine, setGeneratingRoutine] = useState(false);

  const fetchRoutines = useCallback(async () => { /* reactive — no-op */ }, []);

  const generateRoutine = useCallback(
    async (params: RoutineGenerationParams) => {
      if (!hasAiAccess) {
        openPaywall();
        return null;
      }

      safeAsync(setGeneratingRoutine)(true);
      const taskId = addTask({
        id: `gym-routine-${Date.now()}`,
        type: "gym-routine",
        label: "Generating Routine",
        steps: [
          { icon: Dumbbell, label: "Planning exercises" },
          { icon: Activity, label: "Optimizing sets & reps" },
          { icon: CheckCircle, label: "Finalizing routine" },
        ],
        returnPath: "/gym?tab=routines",
      });

      try {
        // The Convex workoutGenerator action signature is narrower than the
        // legacy edge function. Flatten the rich RoutineGenerationParams into
        // {goal, duration, equipment, notes} the action expects.
        const primaryGoal = params.goals?.[0] ?? "hypertrophy";
        const notes = [
          `Sport: ${params.sport}`,
          `Training days: ${params.sportTrainingDays}`,
          `Goals: ${(params.goals ?? []).join(", ")}`,
          `Focus areas: ${(params.focusAreas ?? []).join(", ")}`,
          `Preferred split: ${params.preferredSplit}`,
        ].join(". ");
        let data: any;
        try {
          data = await workoutGeneratorAction({
            goal: primaryGoal,
            duration: params.sessionDurationMinutes,
            equipment: params.availableEquipment as string[],
            notes,
            // V2 structured context — the action prefers these over `notes`.
            goals: params.goals as string[],
            sport: params.sport,
            sportTrainingDays: params.sportTrainingDays,
            focusAreas: params.focusAreas as string[],
            preferredSplit: params.preferredSplit,
            description: params.description,
            hardSparringDays: params.hardSparringDays,
            campPhase: params.campPhase,
            experience: params.experience,
            weakPoints: params.weakPoints as string[] | undefined,
            injuries: params.injuries,
          });
        } catch (error: any) {
          if (await handlePaywallError(error)) { failTask(taskId, "Pro required"); return null; }
          throw error;
        }

        const routine = data?.routineData || data;
        if (!routine?.exercises) {
          failTask(taskId, "No exercises returned");
          return null;
        }
        const result = {
          exercises: routine.exercises as RoutineExercise[],
          name: routine.routine_name || routine.name || "Generated Routine",
          notes: routine.notes || "",
          recommendedGymDays: routine.recommended_gym_days || null,
          splitUsed: routine.split_used || null,
        };
        completeTask(taskId, result);
        return result;
      } catch (err: any) {
        failTask(taskId, err?.message || "Failed to generate routine");
        logger.error("Failed to generate routine", err);
        toast({
          description: "Failed to generate routine",
          variant: "destructive",
        });
        return null;
      } finally {
        if (isMounted()) safeAsync(setGeneratingRoutine)(false);
      }
    },
    [
      hasAiAccess,
      openPaywall,
      handlePaywallError,
      workoutGeneratorAction,
      addTask,
      completeTask,
      failTask,
      safeAsync,
      isMounted,
      toast,
    ]
  );

  const saveRoutine = useCallback(
    async (
      name: string,
      goal: TrainingGoal,
      exercises: RoutineExercise[],
      sport?: CombatSport,
      trainingDays?: number,
      isAiGenerated?: boolean
    ) => {
      if (!userId) return;
      try {
        await createRoutineMut({
          name,
          goal,
          exercises,
          sport: sport ?? undefined,
          trainingDaysPerWeek: trainingDays ?? undefined,
          isAiGenerated: isAiGenerated ?? false,
        });
      } catch (err) {
        logger.error("Failed to save routine", err);
        toast({ description: "Failed to save routine", variant: "destructive" });
      }
    },
    [userId, createRoutineMut, toast]
  );

  const deleteRoutine = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await deleteRoutineMut({ id: id as unknown as Id<"saved_routines"> });
      } catch (err) {
        logger.error("Failed to delete routine", err);
        toast({ description: "Failed to delete routine", variant: "destructive" });
      }
    },
    [userId, deleteRoutineMut, toast]
  );

  const renameRoutine = useCallback(
    async (id: string, name: string) => {
      if (!userId) return;
      try {
        await updateRoutineMut({ id: id as unknown as Id<"saved_routines">, name });
      } catch (err) {
        logger.error("Failed to rename routine", err);
        toast({ description: "Failed to rename routine", variant: "destructive" });
      }
    },
    [userId, updateRoutineMut, toast]
  );

  return {
    routines,
    routinesLoading,
    generatingRoutine,
    fetchRoutines,
    generateRoutine,
    saveRoutine,
    deleteRoutine,
    renameRoutine,
  };
}
