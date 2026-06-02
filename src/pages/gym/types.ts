export type ExerciseCategory = "push" | "pull" | "legs" | "core" | "cardio" | "full_body";

export type MuscleGroup =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes" | "calves" | "abs"
  | "forearms" | "traps" | "full_body" | "cardio";

export type Equipment =
  | "barbell" | "dumbbell" | "cable" | "machine"
  | "bodyweight" | "kettlebell" | "bands" | "none";

export type SessionType =
  | "Strength" | "Hypertrophy" | "Powerlifting" | "Explosiveness"
  | "Conditioning" | "Circuit" | "Endurance" | "Mobility"
  | "Muay Thai S&C" | "Custom";

export type SessionStatus = "in_progress" | "completed";

import type { TrackingType } from "@/lib/exerciseTypes";

export interface Exercise {
  id: string;
  user_id: string | null;
  name: string;
  category: ExerciseCategory;
  muscle_group: MuscleGroup;
  equipment: Equipment | null;
  is_bodyweight: boolean;
  is_custom: boolean;
  /** "standard" | "bodyweight" | "weighted"; null/absent ⇒ resolve via is_bodyweight. */
  tracking_type?: TrackingType | null;
  created_at: string;
}

export interface GymSession {
  id: string;
  user_id: string;
  date: string;
  /** PRIMARY discipline for this row (gym styles act as custom primaries). */
  session_type: SessionType;
  /** OPTIONAL activity descriptor returned by migrate-on-read; null when absent. */
  session_tag?: string | null;
  duration_minutes: number | null;
  notes: string | null;
  perceived_fatigue: number | null;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export interface GymSet {
  id: string;
  session_id: string;
  exercise_id: string;
  user_id: string;
  set_order: number;
  exercise_order: number;
  weight_kg: number | null;
  reps: number;
  rpe: number | null;
  is_warmup: boolean;
  is_bodyweight: boolean;
  assisted_weight_kg: number | null;
  notes: string | null;
  created_at: string;
}

export interface ExercisePR {
  id: string;
  user_id: string;
  exercise_id: string;
  max_weight_kg: number | null;
  max_reps: number | null;
  max_volume: number | null;
  estimated_1rm: number | null;
  best_set_id: string | null;
  updated_at: string;
}

export interface ExerciseGroup {
  exercise: Exercise;
  exerciseOrder: number;
  sets: GymSet[];
}

export interface ActiveWorkout {
  sessionId: string;
  sessionType: SessionType;
  startedAt: number;
  exerciseGroups: ExerciseGroup[];
}

export interface SessionWithSets extends GymSession {
  sets: GymSet[];
  exercises: Exercise[];
  exerciseGroups: ExerciseGroup[];
  totalVolume: number;
  exerciseCount: number;
}

// ─── Routine Types ───

export type TrainingGoal = "hypertrophy" | "strength" | "explosiveness" | "conditioning";

export type CombatSport = "mma" | "bjj" | "boxing" | "muay_thai" | "wrestling" | "general";

export interface RoutineExercise {
  exercise_id: string | null;
  name: string;
  muscle_group: MuscleGroup;
  sets: number;
  reps: string; // e.g. "8-12" or "5"
  rpe: number | null;
  rest_seconds: number;
  notes: string | null;
  day?: string; // e.g. "Day 1: Upper", "Day 2: Lower"
}

export interface SavedRoutine {
  id: string;
  user_id: string;
  name: string;
  goal: TrainingGoal;
  sport: CombatSport | null;
  training_days_per_week: number | null;
  exercises: RoutineExercise[];
  is_ai_generated: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type WorkoutSplit = "upper_lower" | "push_pull_legs" | "full_body" | "bro_split" | "ai_recommended";

export type FocusArea = "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "explosiveness" | "grip";

export interface RoutineGenerationParams {
  goals: TrainingGoal[];
  sport: CombatSport;
  sportTrainingDays: number;
  availableEquipment: Equipment[];
  sessionDurationMinutes: number;
  focusAreas: FocusArea[];
  preferredSplit: WorkoutSplit;
}

export type PRType = "weight" | "reps" | "volume" | "1rm";

export interface PRRecord {
  type: PRType;
  value: number;
  previousValue: number | null;
}
