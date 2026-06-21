import type { WizardPose } from "@/tutorial/types";
import type { WizardVariant } from "@/tutorial/WizardCharacter";

export type DialogueLine = {
  /** 1-4 words, displayed bold above the body. */
  headline: string;
  /** 1-2 short sentences, typewritten character-by-character. */
  body: string;
  /** Mascot pose. Defaults to "idle" when omitted. */
  pose?: WizardPose;
  /** Mascot variant. Defaults to "3d". Use "food" for nutrition/meal-themed steps. */
  variant?: WizardVariant;
};

/**
 * Lookup keys, in precedence order:
 *   1. `${branch}:${step}:${fightSubStep}`  (only for cutting step 3)
 *   2. `${branch}:${step}`
 *   3. `default:${step}`                    (shared between branches)
 *   4. generic fallback
 *
 * Keep lines tight: ~110 chars body, dry coach voice, no emoji.
 */
const LINES: Record<string, DialogueLine> = {
  // ── Step 1: shared welcome, hero mode ─────────────────────────────
  "default:1": {
    headline: "Round one.",
    body: "Making weight, or losing it? Pick your tribe and we go.",
    pose: "wave",
  },

  // ── Cutting branch ─────────────────────────────────────────────────
  // NOTE: every cutting step shifted +1 on 2026-06-04 when the weigh-in
  // timing screen was inserted as cutting step 2. Keys below are the
  // post-shift step numbers (F.* in Onboarding.tsx). Sub-step keys for
  // the fight-details mini-flow moved 3:N → 4:N with it.

  // Step 2 (F.WEIGH_IN): weigh-in timing, day before vs same day
  "cutting:2": {
    headline: "Weigh-in day.",
    body: "Day before or same day? It changes the whole water-cut math.",
  },

  // Step 3 (F.DISCIPLINES): athlete type (multi-select)
  "cutting:3": {
    headline: "Your sport.",
    body: "Boxers cut different from grapplers. Tell me what you do.",
  },

  // Step 4 (F.FIGHT_DETAILS) sub-steps
  "cutting:4:0": {
    headline: "Level up.",
    body: "Amateur or pro changes the whole protocol. Don't sandbag.",
  },
  "cutting:4:1": {
    headline: "Fight date.",
    body: "This is the gravity well. Every meal and run orbits it.",
  },
  "cutting:4:2": {
    headline: "Weight class.",
    body: "Pick the line you have to cross. Usually lighter than the ego wants.",
  },
  "cutting:4:3": {
    headline: "Fight-week target.",
    body: "How close to weight you'll be before the final stretch. Tailored to your weigh-in.",
  },
  "cutting:4:4": {
    headline: "Camp name.",
    body: "Optional. But naming the camp makes it real.",
  },
  // Step 4 fallback (rare; if substep undefined)
  "cutting:4": {
    headline: "Fight details.",
    body: "A few specifics about your bout. This shapes the cut.",
  },

  // Step 5: age
  "cutting:5": {
    headline: "How old.",
    body: "Metabolism is a real number, not a vibe. We need it.",
    pose: "point",
  },

  // Step 6: height
  "cutting:6": {
    headline: "Stand tall.",
    body: "Height feeds your real burn rate. No rounding up.",
    pose: "point",
  },

  // Step 7: current weight, slam follows, keep grounded
  "cutting:7": {
    headline: "Step on.",
    body: "Honest number, please. This is the starting line.",
    pose: "point",
  },

  // Step 8: body fat slider
  "cutting:8": {
    headline: "Eyeball it.",
    body: "Rough body fat is fine. We calibrate as you log.",
    pose: "point",
  },

  // Step 9: experience
  "cutting:9": {
    headline: "How long.",
    body: "Beginners cut different from vets. Be straight with me.",
  },

  // Step 10: training frequency
  "cutting:10": {
    headline: "Sessions a week.",
    body: "Pads, sparring, gym, runs. Count all of them.",
  },

  // Step 13: training types
  "cutting:13": {
    headline: "The work.",
    body: "Wrestling burns more than shadowbox. Surprising no one.",
  },

  // Step 14: sleep
  "cutting:14": {
    headline: "Sleep hours.",
    body: "This is when fat actually leaves. Wild, I know.",
  },

  // Step 15: struggle
  "cutting:15": {
    headline: "Your demon.",
    body: "Pick the one that wrecks camps. Naming it is half the fight.",
  },

  // Step 16: name
  "cutting:16": {
    headline: "Your name.",
    body: "Your gym needs something to chant at the weigh-in.",
  },

  // Step 17: final
  "cutting:17": {
    headline: "Hold the line.",
    body: "Sign your name, fighter. Then we build the plan.",
    pose: "celebrate",
  },

  // ── Losing branch ──────────────────────────────────────────────────
  // Step 2: weeks
  "losing:2": {
    headline: "How long.",
    body: "How many weeks do you want? Be realistic, not heroic.",
  },

  // Step 3: current weight, slam follows, stay calm
  "losing:3": {
    headline: "Step on.",
    body: "No judgment, just data. This is where we start.",
    pose: "point",
  },

  // Step 4: goal weight
  "losing:4": {
    headline: "Goal weight.",
    body: "The number you actually want to see. Not the dream one.",
    pose: "point",
  },

  // Step 5: height
  "losing:5": {
    headline: "Stand tall.",
    body: "Height feeds the math behind your daily burn.",
    pose: "point",
  },

  // Step 6: body fat
  "losing:6": {
    headline: "Body fat.",
    body: "Estimate is fine. Skip if you don't know and we'll calibrate.",
    pose: "point",
  },

  // Step 7: experience
  "losing:7": {
    headline: "Experience.",
    body: "Where are you on the curve? No judgment, just context.",
  },

  // Step 8: training frequency
  "losing:8": {
    headline: "Sessions a week.",
    body: "All of them count. Walks, lifts, classes: say the number.",
  },

  // Step 9: training types
  "losing:9": {
    headline: "What it looks like.",
    body: "Tell me what training actually means for you. Truth only.",
  },

  // Step 10: sleep
  "losing:10": {
    headline: "Sleep hours.",
    body: "The OG performance enhancer. Skipping it taxes everything.",
  },

  // Step 11: struggle
  "losing:11": {
    headline: "Your demon.",
    body: "Stress, energy, bingeing, plateau: pick the loudest one.",
  },

  // Step 12: plan aggressiveness
  "losing:12": {
    headline: "How hard.",
    body: "Faster is not better. Faster is just faster, and usually shorter.",
  },

  // Step 13: name
  "losing:13": {
    headline: "Your name.",
    body: "Your gym sees this when you post. Pick something you'll answer to.",
  },

  // Step 14: final
  "losing:14": {
    headline: "Lock it in.",
    body: "Sign your name. Then we build the plan around it.",
    pose: "celebrate",
  },
};

const FALLBACK: DialogueLine = {
  headline: "Onward.",
  body: "Keep going.",
};

export function getLine(args: {
  step: number;
  branch: "cutting" | "losing";
  fightSubStep?: number;
}): DialogueLine {
  const { step, branch, fightSubStep } = args;

  // 1. Branch + step + substep (cutting:3 only, but harmless elsewhere)
  if (typeof fightSubStep === "number") {
    const subKey = `${branch}:${step}:${fightSubStep}`;
    if (LINES[subKey]) return LINES[subKey];
  }

  // 2. Branch + step
  const branchKey = `${branch}:${step}`;
  if (LINES[branchKey]) return LINES[branchKey];

  // 3. Shared default for this step
  const defaultKey = `default:${step}`;
  if (LINES[defaultKey]) return LINES[defaultKey];

  // 4. Safe generic
  return FALLBACK;
}
