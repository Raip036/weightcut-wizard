/** Workout generator — fast Groq, Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { sanitizeUserText } from "../_shared/sanitizeUserText";
import { requireUserIdFromAction, loadAthleteSnapshot, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

const VALID_GOALS = new Set([
  "hypertrophy",
  "strength",
  "explosiveness",
  "conditioning",
]);
const VALID_SPORTS = new Set([
  "mma",
  "bjj",
  "boxing",
  "muay_thai",
  "wrestling",
  "general",
]);
const VALID_SPLITS = new Set([
  "upper_lower",
  "push_pull_legs",
  "full_body",
  "bro_split",
  "ai_recommended",
]);

export const run = action({
  args: {
    // Frontend (useRoutines) sends the flattened shape — keep it backwards compatible.
    goal: v.string(),
    duration: v.optional(v.number()),
    equipment: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WORKOUT_GENERATOR");
    const snap = await loadAthleteSnapshot(ctx, userId);

    // Sanitize and recover the rich generation context that the hook flattens
    // into `notes` (see src/hooks/gym/useRoutines.ts generateRoutine).
    const cleanNotes = args.notes
      ? sanitizeUserText(args.notes, { maxLength: 600, raw: true })
      : "";

    const parseField = (label: string): string | null => {
      const re = new RegExp(`${label}:\\s*([^.]+?)(?:\\.|$)`, "i");
      const m = cleanNotes.match(re);
      return m ? m[1].trim() : null;
    };
    const splitField = (label: string): string[] => {
      const raw = parseField(label);
      if (!raw) return [];
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    };

    const primaryGoal = VALID_GOALS.has(args.goal) ? args.goal : "hypertrophy";
    const goalsFromNotes = splitField("Goals");
    const goals = (goalsFromNotes.length > 0 ? goalsFromNotes : [primaryGoal])
      .filter((g) => VALID_GOALS.has(g));
    const goalsStr = goals.length > 0 ? goals.join(", ") : primaryGoal;

    const sportRaw = parseField("Sport") ?? "general";
    const sport = VALID_SPORTS.has(sportRaw) ? sportRaw : "general";

    const trainingDaysRaw = parseField("Training days");
    const sportTrainingDays = (() => {
      const n = Number(trainingDaysRaw);
      if (Number.isFinite(n) && n >= 2 && n <= 7) return Math.round(n);
      return 4;
    })();

    const focusAreas = splitField("Focus areas");
    const focusStr =
      focusAreas.length > 0
        ? focusAreas.join(", ")
        : "no specific focus — balanced program";

    const splitRaw = parseField("Preferred split") ?? "ai_recommended";
    const preferredSplit = VALID_SPLITS.has(splitRaw)
      ? splitRaw
      : "ai_recommended";
    const splitStr =
      preferredSplit === "ai_recommended"
        ? "choose the best split for their goals and schedule"
        : preferredSplit.replace("_", "/");

    const sessionDurationMinutes = (() => {
      const n = Number(args.duration);
      if (Number.isFinite(n) && n >= 30 && n <= 90) return Math.round(n);
      return 60;
    })();

    const equipmentList =
      Array.isArray(args.equipment) && args.equipment.length > 0
        ? args.equipment
        : ["bodyweight"];

    const systemPrompt = `You are an expert strength & conditioning coach for combat sports athletes. Your job is to design a gym program that COMPLEMENTS YOUR athlete's martial arts training without causing overtraining. Speak directly to them ("you", "your") in every "notes" string.

${SECOND_PERSON_DIRECTIVE}

You train your combat sport ${sportTrainingDays} days per week. Based on this, you MUST first determine how many gym sessions per week to do and include it as "recommended_gym_days" in the response. Guidelines:
- 6-7 sport days → 2 gym sessions max
- 4-5 sport days → 2-3 gym sessions
- 2-3 sport days → 3-4 gym sessions

Their training goals: ${goalsStr}
Preferred workout split: ${splitStr}
Areas to focus on: ${focusStr}
Session duration: ${sessionDurationMinutes} minutes
Available equipment: ${equipmentList.join(", ")}

If multiple goals are selected, blend them intelligently. For example, hypertrophy + explosiveness means moderate rep ranges with some power movements. Strength + conditioning means heavy compounds with metabolic finishers.

MANDATORY MOVEMENT PATTERNS — every routine MUST include at least one exercise from each of these categories, distributed across the split:
1. HINGE (posterior chain/hamstrings) — e.g. deadlift, Romanian deadlift, hip thrust, good morning, kettlebell swing
2. SQUAT (quads/glutes) — e.g. back squat, front squat, goblet squat, split squat, Bulgarian split squat, leg press
3. PUSH (chest/shoulders/triceps) — e.g. bench press, overhead press, dumbbell press, push-ups, dips
4. PULL (back/biceps) — e.g. pull-ups, chin-ups, barbell row, dumbbell row, cable row, lat pulldown
These four patterns are non-negotiable. Additional isolation or accessory work can be added after these are covered.

CRITICAL: Total weekly volume (sport + gym) must not risk overtraining. Keep gym volume moderate and prioritise compound movements that transfer to combat sports. Explain your programming decisions in the notes.

Return ONLY valid JSON. IMPORTANT: Each exercise MUST include a "day" field that groups it into the correct session of the split (e.g. "Day 1: Push", "Day 2: Pull", "Day 3: Legs" for PPL, or "Day 1: Upper", "Day 2: Lower" for upper/lower). For full body, use "Day 1: Full Body", "Day 2: Full Body", etc. Exercises must be ordered by day.

{
  "routine_name": "string",
  "recommended_gym_days": number,
  "split_used": "string (e.g. Upper/Lower, Full Body, Push/Pull/Legs)",
  "exercises": [
    {
      "day": "Day 1: Push",
      "name": "Exercise Name",
      "muscle_group": "chest|back|shoulders|triceps|biceps|quads|hamstrings|glutes|calves|abs|full_body",
      "sets": 3,
      "reps": "8-12",
      "rpe": 7,
      "rest_seconds": 90,
      "notes": "technique cue or why this exercise"
    }
  ],
  "notes": "Explain YOUR programming decisions to the user, how this avoids overtraining, and how it complements your ${sport} training ${sportTrainingDays}x/week (address them as 'you')."
}

${snap.block}`;

    const userPrompt = `Generate a gym workout routine for me. I'm a ${sport.replace("_", " ")} athlete training my sport ${sportTrainingDays} days per week. Goals: ${goalsStr}. Focus areas: ${focusStr}. Split preference: ${splitStr}. Session length: ${sessionDurationMinutes} minutes. Equipment: ${equipmentList.join(", ")}. Address me directly in every notes field.`;

    const content = await callGroqText({
      // Heavy-tier model — workout generation benefits from stronger
      // structured reasoning (split logic, exercise selection, sets/reps
      // sequencing). On OpenRouter this resolves to qwen3-235b via
      // OPENROUTER_MODEL_MAP; on Groq direct it stays as gpt-oss-120b.
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });

    const routine = parseJSON<{ exercises?: Array<Record<string, any>>; [key: string]: any }>(content);

    // Normalise exercise fields so the frontend's RoutineExercise type holds.
    if (Array.isArray(routine?.exercises)) {
      routine.exercises = routine.exercises.map((ex: any) => ({
        exercise_id: null,
        name: String(ex?.name ?? "Exercise"),
        muscle_group: String(ex?.muscle_group ?? "full_body"),
        sets: Number(ex?.sets) > 0 ? Number(ex.sets) : 3,
        reps: String(ex?.reps ?? "8-12"),
        rpe: Number.isFinite(Number(ex?.rpe)) ? Number(ex.rpe) : null,
        rest_seconds: Number.isFinite(Number(ex?.rest_seconds))
          ? Number(ex.rest_seconds)
          : 90,
        notes: ex?.notes ? String(ex.notes) : null,
        day: ex?.day ? String(ex.day) : undefined,
      }));
    }

    return routine;
  },
});
