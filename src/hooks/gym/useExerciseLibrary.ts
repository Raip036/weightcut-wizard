import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { customExerciseSchema } from "@/lib/validation";
import { EXERCISE_DATABASE } from "@/data/exerciseDatabase";
import type { Exercise, ExerciseCategory, Equipment, MuscleGroup } from "@/pages/gym/types";
import type { TrackingType } from "@/lib/exerciseTypes";

let _fallbackCache: Exercise[] | null = null;
function getFallbackExercises(): Exercise[] {
  if (_fallbackCache) return _fallbackCache;
  _fallbackCache = EXERCISE_DATABASE.map((seed, i) => ({
    id: `local-${i}`,
    ...seed,
    user_id: null,
    is_custom: false,
    created_at: new Date().toISOString(),
  })) as Exercise[];
  return _fallbackCache;
}

export function useExerciseLibrary() {
  const { userId } = useUser();
  const { toast } = useToast();
  // Reactive query — returns the union of built-in + user-custom rows.
  const rows = useQuery(api.exercises.listForUser, userId ? {} : "skip");
  const createCustomMut = useMutation(api.exercises.createCustom);
  const deleteCustomMut = useMutation(api.exercises.deleteCustom);

  // Always present the union of {user-custom rows from Convex} ∪ {fallback
  // EXERCISE_DATABASE library}. Without this merge, the moment a user has even
  // one custom row in Convex (e.g. auto-created during set-saving or routine
  // import), the entire fallback library disappears from pickers — the manual
  // routine sheet, exercise picker, etc. would only show those few customs.
  // Dedupe by lowercased name so a user-renamed custom shadows the built-in
  // and a seeded global library would naturally take over.
  const exercises: Exercise[] = useMemo(() => {
    if (rows === undefined) return getFallbackExercises();
    const customs = rows as unknown as Exercise[];
    const fallback = getFallbackExercises();
    const customNames = new Set(customs.map((e) => e.name.toLowerCase()));
    const fallbackUnique = fallback.filter((e) => !customNames.has(e.name.toLowerCase()));
    return [...customs, ...fallbackUnique];
  }, [rows]);
  const loading = rows === undefined;

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ExerciseCategory | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<Equipment | null>(null);

  // Optimistic insert via Convex mutation. The reactive query refreshes the
  // list automatically once the mutation commits — no manual cache writes
  // and no syncQueue fallback needed for a beta app.
  const addCustomExercise = useCallback(async (data: {
    name: string;
    category: ExerciseCategory;
    muscle_group: string;
    equipment: Equipment | null;
    is_bodyweight: boolean;
    tracking_type?: TrackingType;
  }): Promise<Exercise | null> => {
    // Don't fail silently if auth isn't ready yet — surfacing the error keeps a
    // "created" exercise from quietly never being saved.
    if (!userId) {
      toast({ description: "Still signing in — try again in a moment.", variant: "destructive" });
      return null;
    }

    const result = customExerciseSchema.safeParse(data);
    if (!result.success) {
      toast({ description: result.error.errors[0].message, variant: "destructive" });
      return null;
    }

    try {
      const id = await createCustomMut({
        name: data.name,
        category: data.category,
        muscleGroup: data.muscle_group,
        equipment: data.equipment ?? undefined,
        isBodyweight: data.is_bodyweight,
        trackingType: data.tracking_type,
      });
      toast({ description: `${data.name} added` });
      return {
        id: id as unknown as string,
        user_id: userId,
        name: data.name,
        category: data.category,
        muscle_group: data.muscle_group as MuscleGroup,
        equipment: data.equipment,
        is_bodyweight: data.is_bodyweight,
        tracking_type: data.tracking_type ?? null,
        is_custom: true,
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      toast({ description: "Failed to add exercise", variant: "destructive" });
      return null;
    }
  }, [userId, toast, createCustomMut]);

  const deleteCustomExercise = useCallback(async (exerciseId: string) => {
    if (!userId) return;
    try {
      await deleteCustomMut({ id: exerciseId as unknown as Id<"exercises"> });
    } catch {
      toast({ description: "Failed to delete exercise", variant: "destructive" });
    }
  }, [userId, toast, deleteCustomMut]);

  const filteredExercises = useMemo(() => {
    let filtered = exercises;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.muscle_group.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) filtered = filtered.filter(e => e.category === categoryFilter);
    if (equipmentFilter) filtered = filtered.filter(e => e.equipment === equipmentFilter);
    return filtered;
  }, [exercises, searchQuery, categoryFilter, equipmentFilter]);

  const groupedByMuscle = useMemo(() => {
    const groups: Record<string, Exercise[]> = {};
    for (const ex of filteredExercises) {
      const key = ex.muscle_group;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ex);
    }
    return groups;
  }, [filteredExercises]);

  // No-op refetch retained for backward compat.
  const refetch = useCallback(async () => { /* reactive */ }, []);

  return {
    exercises,
    filteredExercises,
    groupedByMuscle,
    loading,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    equipmentFilter,
    setEquipmentFilter,
    addCustomExercise,
    deleteCustomExercise,
    refetch,
  };
}
