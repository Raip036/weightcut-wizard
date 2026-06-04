/** Workout generator — combat-sports S&C engine. Heavy Groq, Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { sanitizeUserText } from "../_shared/sanitizeUserText";
import { requireUserIdFromAction, loadAthleteSnapshot, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

const VALID_GOALS = new Set(["hypertrophy", "strength", "explosiveness", "conditioning"]);
const VALID_SPORTS = new Set(["mma", "bjj", "boxing", "muay_thai", "wrestling", "general"]);
const VALID_SPLITS = new Set(["upper_lower", "push_pull_legs", "full_body", "bro_split", "ai_recommended"]);
const VALID_PHASES = new Set(["off", "pre", "camp"]);
const VALID_EXPERIENCE = new Set(["beginner", "intermediate", "advanced"]);

// Keyword sets used to validate that a generated plan covers the four
// non-negotiable compound patterns. Matched against exercise names.
const PATTERN_KEYWORDS: Record<string, string[]> = {
  hinge: ["deadlift", "rdl", "romanian", "hip thrust", "good morning", "swing", "hinge", "back extension", "pull-through", "pull through"],
  squat: ["squat", "lunge", "split squat", "step-up", "step up", "leg press", "goblet"],
  push: ["bench", "press", "push-up", "push up", "dip", "overhead", "ohp", "landmine press", "push press"],
  pull: ["pull-up", "pull up", "chin-up", "chin up", " row", "pulldown", "lat pull", "face pull", "inverted row"],
};

function missingPatterns(exercises: Array<{ name?: string }>): string[] {
  const text = exercises.map((e) => ` ${String(e?.name ?? "").toLowerCase()} `).join("|");
  const missing: string[] = [];
  for (const [pattern, kws] of Object.entries(PATTERN_KEYWORDS)) {
    if (!kws.some((k) => text.includes(k))) missing.push(pattern);
  }
  return missing;
}

export const run = action({
  args: {
    // Legacy/flattened shape (kept for backwards compatibility).
    goal: v.string(),
    duration: v.optional(v.number()),
    equipment: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    // V2 structured context (preferred — set by useRoutines.generateRoutine).
    goals: v.optional(v.array(v.string())),
    sport: v.optional(v.string()),
    sportTrainingDays: v.optional(v.number()),
    focusAreas: v.optional(v.array(v.string())),
    preferredSplit: v.optional(v.string()),
    description: v.optional(v.string()),
    hardSparringDays: v.optional(v.array(v.string())),
    campPhase: v.optional(v.string()),
    experience: v.optional(v.string()),
    weakPoints: v.optional(v.array(v.string())),
    injuries: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WORKOUT_GENERATOR");
    const snap = await loadAthleteSnapshot(ctx, userId);

    // Legacy `notes` fallback parsing (older clients flatten context here).
    const cleanNotes = args.notes ? sanitizeUserText(args.notes, { maxLength: 600, raw: true }) : "";
    const parseField = (label: string): string | null => {
      const m = cleanNotes.match(new RegExp(`${label}:\\s*([^.]+?)(?:\\.|$)`, "i"));
      return m ? m[1].trim() : null;
    };
    const splitField = (label: string): string[] => {
      const raw = parseField(label);
      return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    };

    // ── Resolve context (structured args win, notes-parse is the fallback) ──
    const primaryGoal = VALID_GOALS.has(args.goal) ? args.goal : "hypertrophy";
    const goals = ((args.goals && args.goals.length ? args.goals : splitField("Goals")) ?? [])
      .filter((g) => VALID_GOALS.has(g));
    const goalsStr = goals.length ? goals.join(", ") : primaryGoal;

    const sportRaw = args.sport ?? parseField("Sport") ?? "general";
    const sport = VALID_SPORTS.has(sportRaw) ? sportRaw : "general";

    const sportTrainingDays = (() => {
      const n = Number(args.sportTrainingDays ?? parseField("Training days"));
      return Number.isFinite(n) && n >= 1 && n <= 7 ? Math.round(n) : 4;
    })();

    const focusAreas = (args.focusAreas && args.focusAreas.length ? args.focusAreas : splitField("Focus areas")) ?? [];
    const focusStr = focusAreas.length ? focusAreas.join(", ") : "no specific focus — keep it balanced";

    const splitRaw = args.preferredSplit ?? parseField("Preferred split") ?? "ai_recommended";
    const preferredSplit = VALID_SPLITS.has(splitRaw) ? splitRaw : "ai_recommended";
    const splitStr = preferredSplit === "ai_recommended"
      ? "choose the best split for the goals, schedule and phase"
      : preferredSplit.replace(/_/g, "/");

    const sessionDurationMinutes = (() => {
      const n = Number(args.duration);
      return Number.isFinite(n) && n >= 30 && n <= 90 ? Math.round(n) : 60;
    })();

    const equipmentList = Array.isArray(args.equipment) && args.equipment.length ? args.equipment : ["bodyweight"];

    const campPhase = args.campPhase && VALID_PHASES.has(args.campPhase) ? args.campPhase : null;
    const experience = args.experience && VALID_EXPERIENCE.has(args.experience) ? args.experience : null;
    const hardSparringDays = (args.hardSparringDays ?? []).filter(Boolean).slice(0, 7);
    const weakPoints = (args.weakPoints ?? []).filter(Boolean).slice(0, 6);
    const description = args.description ? sanitizeUserText(args.description, { maxLength: 600, raw: true }) : "";
    const injuries = args.injuries ? sanitizeUserText(args.injuries, { maxLength: 300, raw: true }) : "";

    const phaseLabel = campPhase === "off" ? "off-camp (base building)"
      : campPhase === "pre" ? "pre-camp (transition to power)"
      : campPhase === "camp" ? "in fight camp (peak + recover)"
      : "no specific camp phase given";

    const systemPrompt = `You are an elite strength & conditioning coach for combat-sports athletes (MMA, boxing, BJJ, Muay Thai, wrestling). You design a gym plan that makes the fighter STRONGER and MORE EXPLOSIVE without compromising their martial-arts training.

${SECOND_PERSON_DIRECTIVE}

PRIME DIRECTIVE: Skill work (their martial art) is the priority. S&C is supplemental and must NEVER leave them too sore or fatigued to train their sport well. As martial-arts frequency rises, you SUBTRACT gym volume — you do not stack it on top. The sport itself handles most conditioning, so the weight room focuses on STRENGTH and POWER, not bodybuilding or gassers.

ATHLETE CONTEXT
- Sport: ${sport.replace(/_/g, " ")}, trained ${sportTrainingDays} day(s)/week.
- Hard sparring/intense days: ${hardSparringDays.length ? hardSparringDays.join(", ") : "not specified"}.
- Camp phase: ${phaseLabel}.
- Lifting experience: ${experience ?? "not specified — assume intermediate, prefer safe variations"}.
- Goals: ${goalsStr}.
- Weak points to bias toward: ${weakPoints.length ? weakPoints.join(", ") : "none specified — keep balanced"}.
- Injuries / limitations to work around: ${injuries || "none specified"}.
- Preferred split: ${splitStr}.
- Session length: ${sessionDurationMinutes} min. Equipment: ${equipmentList.join(", ")}.
${description ? `- In their own words: "${description}"` : ""}

1) LIFTING FREQUENCY (set "recommended_gym_days", then build exactly that many days)
- 6-7 sport days OR in fight camp → 2 gym days.
- 4-5 sport days → 2-3 gym days.
- 2-3 sport days → 3-4 gym days.
- Off-camp can lean to the higher end; fight camp leans to 2.

2) SCHEDULING AROUND SPARRING (hard rules)
- NEVER program a heavy lower-body (squat/deadlift) day to land the day BEFORE a hard sparring day — the soreness wrecks the week. Put heavy legs ON a hard day or late in the week.
- Alternate hard/easy. End-of-week day = lower-CNS accessory/grip ("armor").
- When lifting and hard sparring share a day, lift power/strength first while fresh.
Mention the scheduling logic briefly in "notes".

3) COMPOUND-FIRST, COMBAT-BIASED SELECTION
Build every week from the big patterns. Lower = a HINGE (trap-bar/RDL deadlift) + a SQUAT (back/front/split squat) + lower-body PLYO (box/broad jump). Upper = horizontal + vertical PUSH (bench/DB press, overhead press) + horizontal + vertical PULL (row, pull-up) + upper-body POWER (med-ball throw/slam, plyo push-up). Favor combat-friendly variants: trap-bar over straight-bar deadlift, DB press & neutral-grip pulls for shoulder health, heavy UNILATERAL work (Bulgarian split squat), and CARRIES/GRIP (farmer's carry) for the clinch. Add neck work for wrestlers/MMA.

4) SET/REP/INTENSITY BY GOAL (strength-power, NOT bodybuilding)
- Strength: main compounds 3-5 × 3-5 @ RPE 7-9 (~85-92%), rest 2-3 min.
- Power/explosiveness: jumps/throws/Olympic 3-5 × 1-5, full rest, QUALITY over fatigue, done FIRST. Cap ~40 lower-body plyo contacts/session.
- Hypertrophy: accessories 3 × 8-12 — use SPARINGLY and mostly off-camp (added mass can break weight class).
- Conditioning/work-capacity: carries & higher-rep accessories 2-3 × 12-20, short rest; intervals that mimic round structure.
Order each session: power/plyo → heavy strength → accessories → core/grip/carries.

5) WEEKLY PATTERN CHECKLIST — across the week you MUST cover: squat, hinge, horizontal push, vertical push, horizontal pull, vertical pull, lower-body plyo/power, core/anti-rotation, and a loaded carry/grip. Every single routine MUST contain at least one HINGE, one SQUAT, one PUSH and one PULL — non-negotiable.

6) WEAK POINTS — bias by priority/selection, NOT by deleting opposing patterns: put the weak point FIRST when fresh, add 1-2 targeted slots, and trim (don't remove) other accessories so total volume stays constant. Respect injuries — swap any contraindicated lift for a safe variation.

FEW-SHOT EXAMPLES (adapt, don't copy verbatim)
• 2-DAY FULL-BODY (5-6x sport / in camp): Day 1 — Box Jump 4×3, Trap-Bar Deadlift 4×4 @ RPE8, 1-Arm DB Bench 3×8/side, Weighted Pull-up 3×6, Bulgarian Split Squat 2×10/side, Pallof Press 3×10 + Farmer's Carry 3×30m. Day 2 — Med-Ball Rotational Throw 4×5/side, Front Squat 4×5, Overhead Press 3×5, Barbell Row 3×8, Plyo Push-up 3×5, Hanging Leg Raise 3×10.
• 3-DAY FULL-BODY (3-4x sport, off-camp): D1 hinge focus — Trap-Bar DL 4×5, Broad Jump 4×3, Weighted Pull-up 3×6, 1-Arm DB Bench 3×10, Hanging Leg Raise 3×10. D2 push focus — Close-Grip Bench 4×5, Plyo Push-up 4×5, Goblet Bulgarian Split Squat 3×10, DB Row 3×10, Overhead Press 3×5. D3 squat focus — Front Squat 4×5, Box Jump 4×3, Barbell Row 3×8, Suitcase Carry 3×30m, Pallof Press 3×10.

OUTPUT — return ONLY valid JSON. Every exercise MUST include a "day" field grouping it into its session (e.g. "Day 1: Lower", "Day 2: Upper", or "Day 1: Push" for PPL). Order exercises by day, power/strength before accessories.
{
  "routine_name": "string",
  "recommended_gym_days": number,
  "split_used": "string (e.g. Upper/Lower, Full Body, Push/Pull/Legs)",
  "exercises": [
    { "day": "Day 1: Lower", "name": "Trap-Bar Deadlift", "muscle_group": "hamstrings|glutes|quads|chest|back|shoulders|triceps|biceps|calves|abs|full_body", "sets": 4, "reps": "4", "rpe": 8, "rest_seconds": 150, "notes": "why / cue" }
  ],
  "notes": "Explain YOUR plan to them: the gym-day count vs their sport load, how it sits around sparring, the compound focus, and how it targets any weak point (address them as 'you')."
}

${snap.block}`;

    const userPrompt = `Build my gym routine. I'm a ${sport.replace(/_/g, " ")} athlete training my sport ${sportTrainingDays}x/week${hardSparringDays.length ? ` (hard days: ${hardSparringDays.join(", ")})` : ""}. Phase: ${phaseLabel}. Goals: ${goalsStr}. ${weakPoints.length ? `Weak points: ${weakPoints.join(", ")}. ` : ""}${injuries ? `Injuries: ${injuries}. ` : ""}Split: ${splitStr}. Session: ${sessionDurationMinutes} min. Equipment: ${equipmentList.join(", ")}.${description ? ` In my words: "${description}".` : ""} Address me directly in every notes field.`;

    const generate = async (corrective?: string) => {
      const content = await callGroqText({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: corrective ? `${userPrompt}\n\n${corrective}` : userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      });
      return parseJSON<{ exercises?: Array<Record<string, any>>; [key: string]: any }>(content);
    };

    let routine = await generate();

    // Validate the four mandatory patterns; one corrective retry if missing.
    if (Array.isArray(routine?.exercises) && routine.exercises.length) {
      const missing = missingPatterns(routine.exercises);
      if (missing.length > 0) {
        const retry = await generate(
          `Your previous plan was missing these mandatory compound patterns: ${missing.join(", ")}. Regenerate the FULL routine and ensure it includes at least one ${missing.join(", one ")} movement, keeping everything else balanced.`,
        );
        // Keep the retry only if it actually fixes more patterns.
        if (Array.isArray(retry?.exercises) && retry.exercises.length && missingPatterns(retry.exercises).length < missing.length) {
          routine = retry;
        }
      }
    }

    // Normalise exercise fields so the frontend's RoutineExercise type holds.
    if (Array.isArray(routine?.exercises)) {
      routine.exercises = routine.exercises.map((ex: any) => ({
        exercise_id: null,
        name: String(ex?.name ?? "Exercise"),
        muscle_group: String(ex?.muscle_group ?? "full_body"),
        sets: Number(ex?.sets) > 0 ? Number(ex.sets) : 3,
        reps: String(ex?.reps ?? "8-12"),
        rpe: Number.isFinite(Number(ex?.rpe)) ? Number(ex.rpe) : null,
        rest_seconds: Number.isFinite(Number(ex?.rest_seconds)) ? Number(ex.rest_seconds) : 90,
        notes: ex?.notes ? String(ex.notes) : null,
        day: ex?.day ? String(ex.day) : undefined,
      }));
    }

    return routine;
  },
});
