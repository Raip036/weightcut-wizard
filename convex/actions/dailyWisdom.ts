/** Daily wisdom — fast Groq call producing a small JSON envelope. Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { loadAthleteSnapshot, requireUserIdFromAction, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

export const run = action({
  args: {
    currentWeight: v.number(),
    goalWeight: v.number(),
    fightWeekTarget: v.optional(v.number()),
    targetDate: v.string(),
    tdee: v.optional(v.number()),
    bmr: v.optional(v.number()),
    activityLevel: v.optional(v.string()),
    age: v.optional(v.number()),
    sex: v.optional(v.string()),
    heightCm: v.optional(v.number()),
    aiRecommendedCalories: v.optional(v.number()),
    todayCalories: v.number(),
    dailyCalorieGoal: v.number(),
    weightHistory: v.array(
      v.object({ date: v.string(), weight_kg: v.union(v.number(), v.string()) }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_DAILY_WISDOM");
    const today = new Date();
    const target = new Date(args.targetDate);
    const daysRemaining = Math.ceil((target.getTime() - today.getTime()) / 86400000);
    const weeksRemaining = Math.max(0.14, daysRemaining / 7);
    const dietTarget = args.fightWeekTarget ?? args.goalWeight;
    const weightToLose = Math.max(0, args.currentWeight - dietTarget);
    const requiredWeeklyKg = weightToLose > 0 ? weightToLose / weeksRemaining : 0;
    const calorieGoal = args.aiRecommendedCalories ?? args.dailyCalorieGoal;
    const caloriePercentage = calorieGoal > 0 ? (args.todayCalories / calorieGoal) * 100 : 0;

    const last7 = args.weightHistory.slice(-7);
    const historyText =
      last7.length > 0
        ? last7.map((l) => `${l.date}: ${l.weight_kg}kg`).join(", ")
        : "No recent logs";
    let weeklyPaceKg = 0;
    if (last7.length >= 2) {
      const sorted = [...last7].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      const firstW = parseFloat(String(sorted[0].weight_kg));
      const lastW = parseFloat(String(sorted[sorted.length - 1].weight_kg));
      const days =
        (new Date(sorted[sorted.length - 1].date).getTime() -
          new Date(sorted[0].date).getTime()) /
        86400000;
      if (days > 0) weeklyPaceKg = ((firstW - lastW) / days) * 7;
    }
    let paceStatus = "at_target";
    if (requiredWeeklyKg > 0) {
      if (weeklyPaceKg >= requiredWeeklyKg * 1.1) paceStatus = "ahead";
      else if (weeklyPaceKg >= requiredWeeklyKg * 0.9) paceStatus = "on_track";
      else paceStatus = "behind";
    }

    const snap = await loadAthleteSnapshot(ctx, userId);
    const systemPrompt = `You are a JSON API. Respond with ONLY valid JSON.
You are the FightCamp Wizard - evidence-based fight sports nutritionist. Speak directly to the user in every string field.

${SECOND_PERSON_DIRECTIVE}

RULES:
- Reference YOUR athlete's actual numbers (kg, kcal, days) and address them as "you" / "your".
- riskLevel: "orange" if requiredWeeklyKg > 1.0, else "green"
- summary: <=10 words
- adviceParagraph: max 2 short sentences, written to the user
- actionItems: exactly 3 short items, each phrased as a directive ("Hit ___", "Cut ___", "Add ___")
- nutritionStatus: one short sentence to the user
- NEVER use em dashes; use periods or commas

OUTPUT:
{ "summary": "string", "riskLevel": "green|orange", "riskReason": "string", "adviceParagraph": "string", "actionItems": ["a","b","c"], "nutritionStatus": "string" }

${snap.block}`;
    const userPrompt = `Your snapshot:
- Weight: ${args.currentWeight}kg -> Diet target: ${dietTarget}kg -> Weigh-in: ${args.goalWeight}kg
- Days left: ${daysRemaining} | Required: ${requiredWeeklyKg.toFixed(2)} kg/wk | Pace: ${weeklyPaceKg.toFixed(2)} kg/wk (${paceStatus})
- TDEE: ${args.tdee ?? "unknown"}${args.bmr ? ` | BMR: ${args.bmr}` : ""} | Activity: ${args.activityLevel ?? "unknown"}
- ${args.sex ?? "unknown"}, ${args.age ?? "unknown"}y, ${args.heightCm ?? "unknown"}cm
- Today: ${args.todayCalories} / ${calorieGoal} kcal (${caloriePercentage.toFixed(0)}%)
- Last 7 logs: ${historyText}`;

    const content = await callGroqText({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
    const wisdom = parseJSON<Record<string, unknown>>(content);
    wisdom.daysToFight = daysRemaining;
    wisdom.requiredWeeklyKg = parseFloat(requiredWeeklyKg.toFixed(2));
    wisdom.weeklyPaceKg = parseFloat(weeklyPaceKg.toFixed(2));
    wisdom.paceStatus = paceStatus;
    return { wisdom };
  },
});
