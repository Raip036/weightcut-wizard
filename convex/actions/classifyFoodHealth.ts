/**
 * Fallback whole-food health grader.
 *
 * The AI meal-scanner (analyzeMeal.ts) already returns per-food processing
 * signals, but meals logged any OTHER way (manual entry, meal-plan idea,
 * day-plan log, recents pick) arrive without a grade. This action classifies
 * those foods with a cheap fast model and computes the same NOVA-based score,
 * so every logged meal ends up graded consistently.
 *
 * Deliberately NO enforceFeatureGate / Pro gate: manual meal logging is a
 * free-tier feature, and grading is passive enrichment the client fires after
 * an insert, not user-requested AI content. Gating it would silently strip the
 * health rating from free users' manually logged meals.
 */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { sanitizeUserText } from "../_shared/sanitizeUserText";
import { requireUserIdFromAction } from "./_helpers";
import {
  coerceHealthInputs,
  scoreFood,
  scoreMeal,
  type FoodHealthInputs,
} from "../_shared/foodHealthScore";

// Used when the model omits or garbles a food so a meal is never half-graded:
// a middle-of-the-road "processed, not whole food" assumption.
const DEFAULT_INPUTS: FoodHealthInputs = {
  novaClass: 3,
  ingredientCount: 3,
  additivesCount: 0,
  isWholeFood: false,
};

export const run = action({
  args: {
    mealId: v.optional(v.id("meals")),
    items: v.array(
      v.object({
        name: v.string(),
        calories: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { mealId, items }) => {
    const userId = await requireUserIdFromAction(ctx);

    if (items.length < 1 || items.length > 20) {
      throw new Error("Provide between 1 and 20 items to classify");
    }

    // Sanitize + drop empties, keeping calories aligned to each surviving name.
    const cleaned = items
      .map((it) => ({
        name: sanitizeUserText(it.name, { maxLength: 120, raw: true }),
        calories: Number.isFinite(Number(it.calories)) ? Number(it.calories) : 0,
      }))
      .filter((it) => it.name.length > 0);
    if (cleaned.length === 0) throw new Error("No valid food names to classify");

    const systemPrompt = `You are a JSON API. For EACH food name given, report how processed it is using standard nutrition knowledge of the named food. No macros, no calories, no opinions — only these four raw processing signals per food:
- "novaClass": 1 to 4. 1 = unprocessed or minimally processed whole foods (meat, fish, eggs, vegetables, fruit, plain grains, nuts). 2 = processed culinary ingredients (oil, butter, sugar, salt). 3 = processed foods (cheese, fresh bread, canned fish, cured meat). 4 = ultra-processed (fast food, soda, candy, packaged snacks, crisps, most protein bars, instant noodles).
- "ingredientCount": number of distinct ingredients in the food, 1 for a single whole ingredient.
- "additivesCount": count of artificial additives (preservatives, sweeteners, colors, flavors, emulsifiers, thickeners), 0 for whole foods.
- "isWholeFood": true ONLY for a single recognizable whole ingredient (a steak, an egg, an apple, plain oats).
Return ONLY this JSON, with items in the SAME ORDER as the input:
{ "items": [ { "name": "string", "novaClass": 1, "ingredientCount": 1, "additivesCount": 0, "isWholeFood": true } ] }`;

    const userContent = `Classify these foods, in order:
${cleaned.map((it, i) => `${i + 1}. <user_input>${it.name}</user_input>`).join("\n")}`;

    const content = await callGroqText({
      // Fast/cheap tier — this is a small, cheap classification call fired
      // passively after a meal insert, not a heavy reasoning task.
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 700,
      response_format: { type: "json_object" },
    });

    const parsed = parseJSON<{ items?: unknown[] }>(content);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

    // Align to input ORDER by index (the model echoes names, but trust order);
    // fall back to a conservative default for any item it omitted or garbled.
    const scored = cleaned.map((it, i) => {
      const health = coerceHealthInputs(rawItems[i]) ?? DEFAULT_INPUTS;
      return {
        name: it.name,
        health,
        score: scoreFood(health),
        calories: it.calories,
      };
    });

    const { score } = scoreMeal(
      scored.map((s) => ({ calories: s.calories, healthScore: s.score })),
    );

    if (mealId) {
      await ctx.runMutation(internal.meals.setHealthScoreInternal, {
        mealId: mealId as Id<"meals">,
        userId,
        healthScore: score,
      });
    }

    return {
      score,
      items: scored.map((s) => ({
        name: s.name,
        health: s.health,
        score: s.score,
      })),
    };
  },
});
