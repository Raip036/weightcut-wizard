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

// gpt-oss-120b is a reasoning model: WITHOUT an explicit low effort it spends
// most/all of max_tokens on hidden reasoning tokens and emits truncated (or
// empty) JSON → callGroqText throws "AI response was truncated". `low` keeps
// the chain-of-thought short so the full budget goes to the JSON payload, and
// is also markedly faster + cheaper. Same fix the diet-analysis action uses.
const REASONING_EFFORT = "low" as const;

// Heavy multi-meal day plans (6 meals × per-ingredient macros) are the largest
// payload this action emits; give them the same 30s ceiling generateFightPlan
// uses rather than the 15s callGroqRaw default.
const HEAVY_TIMEOUT_MS = 30_000;

export const run = action({
  args: {
    prompt: v.string(),
    action: v.optional(v.string()), // "generate" (default) | "swap"
    mealCount: v.optional(v.number()),
    targets: v.optional(
      v.object({ kcal: v.number(), protein: v.number(), carbs: v.number(), fats: v.number() }),
    ),
    trainingContext: v.optional(
      v.object({ sessionType: v.string(), sessionTag: v.optional(v.string()) }),
    ),
    slot: v.optional(v.object({ type: v.string(), timingLabel: v.string() })),
    otherMeals: v.optional(
      v.array(v.object({ protein: v.number(), carbs: v.number(), fats: v.number() })),
    ),
    userData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { prompt } = args;
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
    let targetProteinFallback: number;
    let targetCarbsFallback: number;
    let targetFatsFallback: number;
    if (profile?.manual_nutrition_override && profile?.ai_recommended_calories) {
      dailyCalorieTarget = profile.ai_recommended_calories;
      targetProteinFallback =
        profile.ai_recommended_protein_g ?? Math.round((dailyCalorieTarget * 0.4) / 4);
      targetCarbsFallback =
        profile.ai_recommended_carbs_g ?? Math.round((dailyCalorieTarget * 0.3) / 4);
      targetFatsFallback =
        profile.ai_recommended_fats_g ?? Math.round((dailyCalorieTarget * 0.3) / 9);
    } else {
      dailyCalorieTarget = defaultCalorieTarget;
      targetProteinFallback = Math.round((dailyCalorieTarget * 0.4) / 4);
      targetCarbsFallback = Math.round((dailyCalorieTarget * 0.3) / 4);
      targetFatsFallback = Math.round(
        (dailyCalorieTarget - targetProteinFallback * 4 - targetCarbsFallback * 4) / 9,
      );
    }

    // Authoritative targets: prefer client-supplied targets, fall back to the
    // server-derived values above. mealCount clamped to a sensible 3..6 range.
    const mealCount = Math.max(3, Math.min(6, Math.round(args.mealCount ?? 4)));
    const targetCalories = Math.round(args.targets?.kcal ?? dailyCalorieTarget);
    const targetProtein = Math.round(args.targets?.protein ?? targetProteinFallback);
    const targetCarbs = Math.round(args.targets?.carbs ?? targetCarbsFallback);
    const targetFats = Math.round(args.targets?.fats ?? targetFatsFallback);

    // Shared meal mapper — used by both generate and swap paths to normalise a
    // reconciled meal object into the client-facing DayPlanMeal shape.
    const mapMeal = (m: any, i: number) => ({
      id: `mp_${i}_${cleanPrompt.length}`,
      name: String(m.name ?? m.timingLabel ?? "Meal"),
      type: ["breakfast", "lunch", "dinner", "snack"].includes(m.type) ? m.type : "snack",
      timingLabel: String(m.timingLabel ?? m.type ?? "Meal"),
      timeHint: m.timeHint ?? null,
      calories: Math.round(m.calories) || 0,
      protein: Math.round(m.protein) || 0,
      carbs: Math.round(m.carbs) || 0,
      fats: Math.round(m.fats) || 0,
      why: String(m.why ?? ""),
      prep: String(m.prep ?? m.recipe ?? ""),
      ingredients: (m.ingredients ?? []).map((g: any) => ({
        name: String(g.name ?? ""),
        grams: Number(g.grams) || 0,
        calories: Math.round(g.calories) || 0,
        protein_g: Math.round((Number(g.protein ?? g.protein_g) || 0) * 10) / 10,
        carbs_g: Math.round((Number(g.carbs ?? g.carbs_g) || 0) * 10) / 10,
        fats_g: Math.round((Number(g.fats ?? g.fats_g) || 0) * 10) / 10,
      })),
    });

    // Reusable two-pass reconciliation (meal-level 4/4/9 recompute +
    // per-ingredient macro distribution) applied to a single raw meal object.
    const reconcileMeal = (meal: any) => {
      const p = Number(meal.protein) || 0;
      const c = Number(meal.carbs) || 0;
      const f = Number(meal.fats) || 0;
      meal.protein = p;
      meal.carbs = c;
      meal.fats = f;
      meal.calories = p * 4 + c * 4 + f * 9;

      if (Array.isArray(meal.ingredients) && meal.ingredients.length > 0) {
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

          if (!hasMacros && ingSums.g > 0) {
            const ratio = grams / ingSums.g;
            ingP = p * ratio;
            ingC = c * ratio;
            ingF = f * ratio;
          }

          const ingCal =
            Number(ing.calories) > 0
              ? Number(ing.calories)
              : ingP * 4 + ingC * 4 + ingF * 9;

          return {
            name:
              typeof ing.name === "string" && ing.name.trim() ? ing.name.trim() : "Ingredient",
            grams,
            calories: Math.round(ingCal),
            protein_g: Math.round(ingP * 10) / 10,
            carbs_g: Math.round(ingC * 10) / 10,
            fats_g: Math.round(ingF * 10) / 10,
          };
        });
      }
      return meal;
    };

    // ─── SWAP MODE: regenerate ONE meal to fill the remaining daily macros ───
    if (args.action === "swap" && args.slot) {
      const used = (args.otherMeals ?? []).reduce(
        (a, m) => ({ p: a.p + m.protein, c: a.c + m.carbs, f: a.f + m.fats }),
        { p: 0, c: 0, f: 0 },
      );
      const remP = Math.max(0, targetProtein - used.p);
      const remC = Math.max(0, targetCarbs - used.c);
      const remF = Math.max(0, targetFats - used.f);
      const swapPrompt = `Nutrition AI. Output ONLY raw JSON for ONE meal.
Slot: ${args.slot.timingLabel} (type ${args.slot.type}).
This meal MUST hit: ${remP}g protein, ${remC}g carbs, ${remF}g fat (cal = P*4+C*4+F*9).
User preference: <user_input>${cleanPrompt}</user_input>
JSON: {"name":"","type":"${args.slot.type}","timingLabel":"${args.slot.timingLabel}","timeHint":null,"calories":0,"protein":${remP},"carbs":${remC},"fats":${remF},"why":"","prep":"","ingredients":[{"name":"","grams":0,"calories":0,"protein":0,"carbs":0,"fats":0}]}`;

      const swapCallOpts = {
        model: "openai/gpt-oss-120b" as const,
        messages: [
          { role: "system" as const, content: swapPrompt },
          {
            role: "user" as const,
            content: `User Request: <user_input>${cleanPrompt}</user_input>`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        reasoning_effort: REASONING_EFFORT,
      };

      let swapContent: string;
      try {
        swapContent = await callGroqText({
          ...swapCallOpts,
          response_format: { type: "json_object" },
        });
      } catch (err) {
        const isJsonValidationFail =
          err instanceof GroqError &&
          err.httpStatus === 400 &&
          /validate json/i.test(err.message);
        if (!isJsonValidationFail) throw err;
        swapContent = await callGroqText(swapCallOpts);
      }
      const swapMeal = parseJSON<Record<string, any>>(swapContent);
      const reconciledSingleMeal = reconcileMeal(swapMeal);

      await logDecision(ctx, {
        userId,
        feature: "meal-planner",
        inputSnapshot: { currentWeight, goalWeight, tdee, daysToGoal, mode: "swap" },
        outputJson: reconciledSingleMeal,
        predictionFacts: {
          predicted_kcal: Math.round(Number(reconciledSingleMeal.calories) || 0),
          predicted_protein_g: Math.round(Number(reconciledSingleMeal.protein) || 0),
        },
        model: "openai/gpt-oss-120b",
      });

      return { meal: mapMeal(reconciledSingleMeal, 0) };
    }

    // ─── DAY_PLAN MODE: authoritative-target driven structured day plan ───
    if (args.action === "day_plan") {
      const trainingLine = args.trainingContext
        ? `TODAY'S TRAINING: ${args.trainingContext.sessionType}${args.trainingContext.sessionTag ? " (" + args.trainingContext.sessionTag + ")" : ""}. If the user names a training time, place a pre-training meal ~60-90min before and a post-training meal soon after, label them, and reference the session in the relevant "why".`
        : `If the user names a training time, add labelled pre/post-training meals around it; otherwise use normal meal times.`;

      const dayPlanSystemPrompt = `Nutrition AI for fighters. Output ONLY raw JSON.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Every narrative string (safetyMessage, why, prep) MUST address the user as "you" / "your". This is YOUR meal plan being handed to YOU.

You: ${profile?.sex ?? "unspecified"}${profile?.age ? `, ${profile.age}y` : ""}

AUTHORITATIVE DAILY TARGET: ${targetCalories} cal — ${targetProtein}g protein, ${targetCarbs}g carbs, ${targetFats}g fat. These numbers are fixed; the plan MUST hit them.
Safety: ${safetyIndicator} - ${safetyMessage}

PLAN RULES:
- Produce EXACTLY ${mealCount} ordered meals (in the order they are eaten across the day).
- ${trainingLine}
- Each meal MUST include: name (the actual dish, e.g. "Greek Yogurt, Berries & Granola" or "Chicken Rice Bowl" — 2-5 words, specific to the ingredients. NEVER use the meal type (breakfast/lunch/dinner/snack) or a time as the name — those are shown separately), type (breakfast|lunch|dinner|snack), timingLabel (e.g. "Breakfast · 7:00"), timeHint (e.g. "7:00"), why (one-line beginner-friendly rationale), prep (1-2 sentence prep/cooking hint).

CRITICAL MATH:
- Each meal cal = (P*4)+(C*4)+(F*9), within ±20.
- Sum of all meals' P/C/F = daily targets (${targetProtein}g/${targetCarbs}g/${targetFats}g) within ±5g each.
- Each ingredient MUST include grams + calories + protein + carbs + fats. Sum of ingredient macros = meal macros (within ±5g).

{"meals":[{"name":"","type":"breakfast","timingLabel":"Breakfast · 7:00","timeHint":"7:00","calories":0,"protein":0,"carbs":0,"fats":0,"why":"","prep":"","ingredients":[{"name":"","grams":0,"calories":0,"protein":0,"carbs":0,"fats":0}]}],"safetyStatus":"${safetyIndicator}","safetyMessage":"${safetyMessage}"}

${snap.block}`;

      const dayPlanCallOpts = {
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system" as const, content: dayPlanSystemPrompt },
          {
            role: "user" as const,
            content: `User Request: <user_input>${cleanPrompt}</user_input>`,
          },
        ],
        temperature: 0.3,
        // Higher ceiling than the generate path: a 6-meal day with full
        // per-ingredient macros is the largest payload this action emits, and
        // gpt-oss-120b truncates mid-JSON below this (see diet-analysis fix).
        max_tokens: 7000,
        // Without this the model burns the whole 7000 on reasoning and emits
        // empty content → "AI response was truncated". See REASONING_EFFORT.
        reasoning_effort: REASONING_EFFORT,
        timeoutMs: HEAVY_TIMEOUT_MS,
      };

      let dayPlanContent: string;
      try {
        dayPlanContent = await callGroqText({
          ...dayPlanCallOpts,
          response_format: { type: "json_object" },
        });
      } catch (err) {
        const isJsonValidationFail =
          err instanceof GroqError &&
          err.httpStatus === 400 &&
          /validate json/i.test(err.message);
        if (!isJsonValidationFail) throw err;
        dayPlanContent = await callGroqText(dayPlanCallOpts);
      }
      const dayPlanData = parseJSON<{ meals?: Array<Record<string, any>> }>(
        dayPlanContent,
      );

      // Server-side macro reconciliation (two passes via reconcileMeal):
      //   1. Meal-level: recompute calories from P/C/F so the headline numbers
      //      always satisfy 4/4/9 (the model often drifts within its ±20 band).
      //   2. Ingredient-level: normalise each ingredient to the snake_case shape
      //      the client `Ingredient` type expects and distribute meal macros
      //      across ingredients by gram-ratio when the model omitted them.
      if (Array.isArray(dayPlanData?.meals) && dayPlanData.meals.length > 0) {
        for (const meal of dayPlanData.meals) {
          reconcileMeal(meal);
        }
      }

      // Build the client-facing DayPlan: map reconciled meals, sum totals from
      // the 4/4/9 macros, and flag whether the plan lands on the authoritative
      // targets within tolerance.
      const meals = (dayPlanData.meals ?? []).map(mapMeal);
      const totals = {
        protein: meals.reduce((s, m) => s + m.protein, 0),
        carbs: meals.reduce((s, m) => s + m.carbs, 0),
        fats: meals.reduce((s, m) => s + m.fats, 0),
        kcal: 0,
      };
      totals.kcal = totals.protein * 4 + totals.carbs * 4 + totals.fats * 9;
      const onTarget =
        Math.abs(totals.kcal - targetCalories) <= targetCalories * 0.05 &&
        Math.abs(totals.protein - targetProtein) <= 8 &&
        Math.abs(totals.carbs - targetCarbs) <= 8 &&
        Math.abs(totals.fats - targetFats) <= 8;
      const dayPlan = {
        targets: {
          kcal: targetCalories,
          protein: targetProtein,
          carbs: targetCarbs,
          fats: targetFats,
          basis: "full_day" as const,
        },
        totals,
        onTarget,
        safetyStatus: safetyIndicator,
        safetyMessage,
        meals,
      };

      await logDecision(ctx, {
        userId,
        feature: "meal-planner",
        inputSnapshot: { currentWeight, goalWeight, tdee, daysToGoal, mode: "day_plan" },
        outputJson: dayPlan,
        predictionFacts: {
          predicted_kcal: Math.round(totals.kcal),
          predicted_protein_g: Math.round(totals.protein),
        },
        model: "openai/gpt-oss-120b",
      });

      return dayPlan;
    }

    // ─── GENERATE MODE (default): original advice-style meal plan ───
    // Uses the server-derived fallback targets (NOT the authoritative
    // client targets) and returns the legacy { mealPlan, ... } shape that
    // useNutritionWisdom and useMealPlanGeneration depend on.
    const systemPrompt = `Nutrition AI for fighters. Output ONLY raw JSON.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Every narrative string (safetyMessage, tips, recipe) MUST address the user as "you" / "your". This is YOUR meal plan being handed to YOU.

You: ${profile?.sex ?? "unspecified"}${profile?.age ? `, ${profile.age}y` : ""}
Your target: ${Math.round(dailyCalorieTarget)} cal/day (${currentWeight}kg→${goalWeight}kg, ${daysToGoal} days)
Safety: ${safetyIndicator} - ${safetyMessage}

MACRO TARGETS: ${targetProteinFallback}g protein, ${targetCarbsFallback}g carbs, ${targetFatsFallback}g fat

CRITICAL MATH:
- Each meal cal = (P*4)+(C*4)+(F*9), within ±20
- Sum meal P/C/F equals daily targets
- AT LEAST 3 meals
- Each ingredient MUST include calories/protein/carbs/fats in grams. Sum of ingredient macros = meal macros (within ±5g).

{
  "meals": [{ "name": "...", "calories": n, "protein": n, "carbs": n, "fats": n, "portion": "...", "recipe": "...", "type": "breakfast|lunch|dinner|snack", "ingredients": [{ "name": "...", "grams": n, "calories": n, "protein": n, "carbs": n, "fats": n }] }],
  "totalCalories": ${Math.round(dailyCalorieTarget)},
  "totalProtein": ${targetProteinFallback},
  "totalCarbs": ${targetCarbsFallback},
  "totalFats": ${targetFatsFallback},
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
      reasoning_effort: REASONING_EFFORT,
      timeoutMs: HEAVY_TIMEOUT_MS,
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

    // Server-side macro reconciliation (two passes via reconcileMeal):
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
        reconcileMeal(meal);
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
        predicted_protein_g: Math.round(mealPlanData?.totalProtein ?? targetProteinFallback),
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
