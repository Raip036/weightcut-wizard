import { z } from "zod";

// Nutrition validation schemas
export const nutritionLogSchema = z.object({
  meal_name: z.string().trim().min(1, "Meal name is required").max(200, "Meal name too long"),
  calories: z.number().int().positive("Calories must be positive").min(1).max(10000, "Calories must be less than 10,000"),
  protein_g: z.number().nonnegative("Protein cannot be negative").max(500, "Protein must be less than 500g").optional().nullable(),
  carbs_g: z.number().nonnegative("Carbs cannot be negative").max(1000, "Carbs must be less than 1000g").optional().nullable(),
  fats_g: z.number().nonnegative("Fats cannot be negative").max(500, "Fats must be less than 500g").optional().nullable(),
  meal_type: z.string().optional().nullable(),
  portion_size: z.string().max(100, "Portion size too long").optional().nullable(),
  recipe_notes: z.string().max(1000, "Recipe notes too long").optional().nullable(),
});

// Weight log validation schema
export const weightLogSchema = z.object({
  weight_kg: z.number().positive("Weight must be positive").min(30, "Weight must be at least 30kg").max(250, "Weight must be less than 250kg"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
});

// Fight week log validation schema
export const fightWeekLogSchema = z.object({
  weight_kg: z.number().positive("Weight must be positive").min(30).max(250).optional().nullable(),
  carbs_g: z.number().nonnegative("Carbs cannot be negative").max(1000).optional().nullable(),
  fluid_intake_ml: z.number().int().nonnegative("Fluid intake cannot be negative").max(20000, "Fluid intake too high").optional().nullable(),
  sweat_session_min: z.number().int().nonnegative("Minutes cannot be negative").max(480, "Session too long (max 8 hours)").optional().nullable(),
  notes: z.string().max(1000, "Notes too long").optional().nullable(),
  supplements: z.string().max(500, "Supplements text too long").optional().nullable(),
});

// Profile validation schema
export const profileSchema = z.object({
  age: z.number().int().positive("Age must be positive").min(13, "Must be at least 13 years old").max(120, "Invalid age"),
  height_cm: z.number().positive("Height must be positive").min(100, "Height too short").max(250, "Height too tall"),
  current_weight_kg: z.number().positive("Weight must be positive").min(30, "Weight must be at least 30kg").max(250, "Weight must be less than 250kg"),
  goal_weight_kg: z.number().positive("Goal weight must be positive").min(30).max(250),
  fight_week_target_kg: z.number().positive("Fight week target must be positive").min(30).max(250).optional().nullable(),
  training_frequency: z.number().int().nonnegative("Training frequency cannot be negative").max(21, "Training frequency too high").optional().nullable(),
  body_fat_pct: z.number().min(3).max(60).optional().nullable(),
});

// Gym set validation schema
export const gymSetSchema = z.object({
  weight_kg: z.number().nonnegative("Weight cannot be negative").max(500, "Weight must be less than 500kg").optional().nullable(),
  reps: z.number().int().positive("Reps must be at least 1").max(999, "Reps too high"),
  rpe: z.number().min(1, "RPE must be 1-10").max(10, "RPE must be 1-10").optional().nullable(),
  is_warmup: z.boolean().optional(),
  is_bodyweight: z.boolean().optional(),
  assisted_weight_kg: z.number().nonnegative().max(200).optional().nullable(),
  notes: z.string().max(500, "Notes too long").optional().nullable(),
});

// Gym session validation schema
export const gymSessionSchema = z.object({
  session_type: z.enum(["Strength", "Conditioning", "Muay Thai S&C", "Hypertrophy", "Powerlifting", "Circuit", "Custom"]),
  duration_minutes: z.number().int().positive().max(600, "Duration too long").optional().nullable(),
  notes: z.string().max(2000, "Notes too long").optional().nullable(),
  perceived_fatigue: z.number().int().min(1).max(10).optional().nullable(),
});

// Custom exercise validation schema
export const customExerciseSchema = z.object({
  name: z.string().trim().min(1, "Exercise name is required").max(100, "Name too long"),
  category: z.enum(["push", "pull", "legs", "core", "cardio", "full_body"]),
  muscle_group: z.enum(["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "abs", "forearms", "traps", "full_body", "cardio"]),
  equipment: z.enum(["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell", "bands", "none"]).optional().nullable(),
  is_bodyweight: z.boolean().optional(),
  tracking_type: z.enum(["standard", "bodyweight", "weighted"]).optional(),
});

// Hydration log validation schema
export const hydrationLogSchema = z.object({
  amount_ml: z.number().int().positive("Amount must be positive").min(1).max(20000, "Amount too high"),
  sodium_mg: z.number().int().nonnegative("Sodium cannot be negative").max(50000, "Sodium too high").optional().nullable(),
  sweat_loss_percent: z.number().nonnegative("Sweat loss cannot be negative").max(15, "Sweat loss too high").optional().nullable(),
  training_weight_pre: z.number().positive().min(30).max(250).optional().nullable(),
  training_weight_post: z.number().positive().min(30).max(250).optional().nullable(),
  notes: z.string().max(500, "Notes too long").optional().nullable(),
});
