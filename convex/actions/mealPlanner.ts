/** Meal planner — heavy reasoning, Pro-only, logs decision for reconcile. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText, GroqError } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";
import {
  loadAthleteSnapshot,
  logDecision,
  requireUserIdFromAction,
  SECOND_PERSON_DIRECTIVE,
} from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

export const run = action({
  args: {
    prompt: v.string(),
    action: v.optional(v.string()),
    userData: v.optional(v.any()),
  },
  handler: async (ctx, { prompt }) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_MEAL_PLANNER");
    // Strip control chars, bidi overrides, zero-width chars, and known
    // injection patterns ("ignore previous instructions", role headers,
    // chat-template tokens) before the prompt ever reaches Groq.
    const cleanPrompt = sanitizeUserText(prompt, { maxLength: 1000, raw: true });
    const snap = await loadAthleteSnapshot(ctx, userId);
    const profile = snap.profile;
    const currentWeight = profile?.current_weight_kg ?? 70;
    const goalWeight = profile?.goal_weight_kg ?? 65;
    const tdee = profile?.tdee ?? 2000;
    const daysToGoal = profile?.target_date
      ? Math.max(
          1,
          Math.ceil(
            (new Date(profile.target_date).getTime() - Date.now()) / 86400000,
          ),
        )
      : 60;

    const weeklyWeightLoss = (currentWeight - goalWeight) / (daysToGoal / 7);
    const safeWeeklyLoss = Math.min(weeklyWeightLoss, 1);
    const dailyDeficit = (safeWeeklyLoss * 7700) / 7;
    const defaultCalorieTarget = Math.max(tdee - dailyDeficit, tdee * 0.8);
    const weeklyLossPercent = (weeklyWeightLoss / currentWeight) * 100;
    let safetyIndicator = "green";
    let safetyMessage = "Safe and sustainable weight loss pace";
    if (weeklyLossPercent > 1.5 || weeklyWeightLoss > 1) {
      safetyIndicator = "red";
      safetyMessage = "WARNING: Weight loss rate exceeds safe limits.";
    } else if (weeklyLossPercent > 1 || weeklyWeightLoss > 0.75) {
      safetyIndicator = "yellow";
      safetyMessage = "CAUTION: Approaching max safe weight loss rate";
    }

    let dailyCalorieTarget: number;
    let targetProtein: number;
    let targetCarbs: number;
    let targetFats: number;
    if (profile?.manual_nutrition_override && profile?.ai_recommended_calories) {
      dailyCalorieTarget = profile.ai_recommended_calories;
      targetProtein =
        profile.ai_recommended_protein_g ?? Math.round((dailyCalorieTarget * 0.4) / 4);
      targetCarbs =
        profile.ai_recommended_carbs_g ?? Math.round((dailyCalorieTarget * 0.3) / 4);
      targetFats =
        profile.ai_recommended_fats_g ?? Math.round((dailyCalorieTarget * 0.3) / 9);
    } else {
      dailyCalorieTarget = defaultCalorieTarget;
      targetProtein = Math.round((dailyCalorieTarget * 0.4) / 4);
      targetCarbs = Math.round((dailyCalorieTarget * 0.3) / 4);
      targetFats = Math.round(
        (dailyCalorieTarget - targetProtein * 4 - targetCarbs * 4) / 9,
      );
    }

    const systemPrompt = `Nutrition AI for fighters. Output ONLY raw JSON.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Every narrative string (safetyMessage, tips, recipe) MUST address the user as "you" / "your". This is YOUR meal plan being handed to YOU.

You: ${profile?.sex ?? "unspecified"}${profile?.age ? `, ${profile.age}y` : ""}
Your target: ${Math.round(dailyCalorieTarget)} cal/day (${currentWeight}kg→${goalWeight}kg, ${daysToGoal} days)
Safety: ${safetyIndicator} - ${safetyMessage}

MACRO TARGETS: ${targetProtein}g protein, ${targetCarbs}g carbs, ${targetFats}g fat

CRITICAL MATH:
- Each meal cal = (P*4)+(C*4)+(F*9), within ±20
- Sum meal P/C/F equals daily targets
- AT LEAST 3 meals
- Each ingredient MUST include calories/protein/carbs/fats in grams. Sum of ingredient macros = meal macros (within ±5g).

{
  "meals": [{ "name": "...", "calories": n, "protein": n, "carbs": n, "fats": n, "portion": "...", "recipe": "...", "type": "breakfast|lunch|dinner|snack", "ingredients": [{ "name": "...", "grams": n, "calories": n, "protein": n, "carbs": n, "fats": n }] }],
  "totalCalories": ${Math.round(dailyCalorieTarget)},
  "totalProtein": ${targetProtein},
  "totalCarbs": ${targetCarbs},
  "totalFats": ${targetFats},
  "safetyStatus": "${safetyIndicator}",
  "safetyMessage": "${safetyMessage}",
  "tips": "..."
}

${snap.block}`;

    // Token-budget tuning. Two competing failure modes:
    //   - 4096 truncates mid-JSON → Groq returns "Failed to validate JSON".
    //   - 8192 + a fat athlete snapshot blows past the on-demand TPM cap
    //     (8000 tokens/min) → Groq returns "Request too large".
    // 5500 is the sweet spot: comfortable headroom for 4 meals with
    // detailed ingredient breakdowns, while leaving room for prompt
    // (system + sanitized user input + snapshot block ≈ 2-3k tokens).
    const callOpts = {
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content: `User Request: <user_input>${cleanPrompt}</user_input>`,
        },
      ],
      temperature: 0.3,
      max_tokens: 5500,
    };

    // First attempt uses Groq's strict json_object mode. On its
    // "Failed to validate JSON" 400, retry once WITHOUT the strict
    // response_format — the model still emits JSON because the system
    // prompt commands "Output ONLY raw JSON", and our `parseJSON` helper
    // tolerates a stray prefix/suffix where Groq's validator wouldn't.
    let content: string;
    try {
      content = await callGroqText({
        ...callOpts,
        response_format: { type: "json_object" },
      });
    } catch (err) {
      const isJsonValidationFail =
        err instanceof GroqError &&
        err.httpStatus === 400 &&
        /validate json/i.test(err.message);
      if (!isJsonValidationFail) throw err;
      content = await callGroqText(callOpts);
    }
    const mealPlanData = parseJSON<{
      meals?: Array<Record<string, any>>;
      totalProtein?: number;
      totalCarbs?: number;
      totalFats?: number;
      totalCalories?: number;
    }>(content);

    // Server-side macro reconciliation. Two passes:
    //   1. Meal-level: recompute calories from P/C/F so the headline numbers
    //      always satisfy 4/4/9 (the model often drifts within its ±20 band).
    //   2. Ingredient-level: normalise each ingredient to the snake_case shape
    //      the client `Ingredient` type expects (`protein_g`/`carbs_g`/`fats_g`/
    //      `calories`) and distribute meal macros across ingredients by gram-
    //      ratio when the model omitted per-ingredient macros. Without this
    //      step, `ingredientsToRpcItems` builds meal_items rows with zero
    //      macros and `meals.listWithTotals` returns 0 cal for the meal.
    if (Array.isArray(mealPlanData?.meals) && mealPlanData.meals.length > 0) {
      for (const meal of mealPlanData.meals) {
        const p = Number(meal.protein) || 0;
        const c = Number(meal.carbs) || 0;
        const f = Number(meal.fats) || 0;
        meal.protein = p;
        meal.carbs = c;
        meal.fats = f;
        meal.calories = p * 4 + c * 4 + f * 9;

        if (Array.isArray(meal.ingredients) && meal.ingredients.length > 0) {
          // Sum per-ingredient macros (accepting either the AI's `protein/
          // carbs/fats/calories` shape or our `_g` shape). Treat 0 as "missing"
          // for the proportional fallback — the AI returning a literal 0 for
          // every ingredient is equivalent to omitting them, and any real
          // ingredient has at least trace macros.
          const ingSums = meal.ingredients.reduce(
            (acc: { p: number; c: number; f: number; g: number }, ing: any) => {
              acc.p += Number(ing.protein ?? ing.protein_g ?? 0) || 0;
              acc.c += Number(ing.carbs ?? ing.carbs_g ?? 0) || 0;
              acc.f += Number(ing.fats ?? ing.fats_g ?? 0) || 0;
              acc.g += Number(ing.grams) || 0;
              return acc;
            },
            { p: 0, c: 0, f: 0, g: 0 },
          );
          const hasMacros = ingSums.p > 0 || ingSums.c > 0 || ingSums.f > 0;

          meal.ingredients = meal.ingredients.map((ing: any) => {
            const grams = Number(ing.grams) || 0;
            let ingP = Number(ing.protein ?? ing.protein_g ?? 0) || 0;
            let ingC = Number(ing.carbs ?? ing.carbs_g ?? 0) || 0;
            let ingF = Number(ing.fats ?? ing.fats_g ?? 0) || 0;

            // Fall back to gram-weighted distribution when the AI skipped
            // per-ingredient macros, so the totals still match the meal.
            if (!hasMacros && ingSums.g > 0) {
              const ratio = grams / ingSums.g;
              ingP = p * ratio;
              ingC = c * ratio;
              ingF = f * ratio;
            }

            const ingCal =
              Number(ing.calories) > 0 ? Number(ing.calories) : ingP * 4 + ingC * 4 + ingF * 9;

            return {
              name: typeof ing.name === "string" && ing.name.trim() ? ing.name.trim() : "Ingredient",
              grams,
              calories: Math.round(ingCal),
              protein_g: Math.round(ingP * 10) / 10,
              carbs_g: Math.round(ingC * 10) / 10,
              fats_g: Math.round(ingF * 10) / 10,
            };
          });
        }
      }
      const totals = {
        p: mealPlanData.meals.reduce((s: number, m: any) => s + (m.protein || 0), 0),
        c: mealPlanData.meals.reduce((s: number, m: any) => s + (m.carbs || 0), 0),
        f: mealPlanData.meals.reduce((s: number, m: any) => s + (m.fats || 0), 0),
      };
      mealPlanData.totalProtein = totals.p;
      mealPlanData.totalCarbs = totals.c;
      mealPlanData.totalFats = totals.f;
      mealPlanData.totalCalories = totals.p * 4 + totals.c * 4 + totals.f * 9;
    }

    await logDecision(ctx, {
      userId,
      feature: "meal-planner",
      inputSnapshot: { currentWeight, goalWeight, tdee, daysToGoal },
      outputJson: mealPlanData,
      predictionFacts: {
        predicted_kcal: Math.round(mealPlanData?.totalCalories ?? dailyCalorieTarget),
        predicted_protein_g: Math.round(mealPlanData?.totalProtein ?? targetProtein),
      },
      model: "openai/gpt-oss-120b",
    });

    return {
      mealPlan: mealPlanData,
      dailyCalorieTarget: Math.round(dailyCalorieTarget),
      safetyStatus: safetyIndicator,
      safetyMessage,
    };
  },
});
