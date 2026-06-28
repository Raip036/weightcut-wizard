/** Wizard chat — Pro-only, conversational coach with broad athlete context. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { callGroqText } from "../_shared/groq";
import { requireUserIdFromAction, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";
import { RESEARCH_SUMMARY } from "../_shared/researchSummary";

function buildDataContext(r: any): string {
  const sections: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const p = r.profile;
  if (p) {
    const daysLeft = p.target_date
      ? Math.ceil((new Date(p.target_date).getTime() - Date.now()) / 86400000)
      : null;
    const macros = p.ai_recommended_protein_g
      ? `P${p.ai_recommended_protein_g}/C${p.ai_recommended_carbs_g}/F${p.ai_recommended_fats_g}`
      : "not set";
    sections.push(
      `PROFILE: ${p.current_weight_kg}kg -> ${p.goal_weight_kg}kg, target ${p.target_date || "none"}${daysLeft != null ? ` (${daysLeft} days)` : ""}, ${p.sex}, age ${p.age}, ${p.height_cm}cm, activity ${p.activity_level}, TDEE ${p.tdee ?? "unknown"}, macros ${macros}`,
    );
  }
  if (r.weightLogs?.length) {
    const entries = r.weightLogs.slice(0, 10).map((w: any) => `${w.date.slice(5)}:${w.weight_kg}`);
    sections.push(`WEIGHT (last ${entries.length}): ${entries.join(", ")}`);
  }
  if (r.nutritionLogs?.length) {
    const logs = r.nutritionLogs;
    const days = new Set(logs.map((l: any) => l.date));
    const numDays = days.size || 1;
    const sum = (k: string) => logs.reduce((s: number, l: any) => s + (l[k] || 0), 0);
    const avgCal = Math.round(sum("calories") / numDays);
    const avgP = Math.round(sum("protein_g") / numDays);
    const avgC = Math.round(sum("carbs_g") / numDays);
    const avgF = Math.round(sum("fats_g") / numDays);
    const todayMeals = logs.filter((l: any) => l.date === today);
    const todayCal = todayMeals.reduce((s: number, l: any) => s + (l.calories || 0), 0);
    let line = `NUTRITION (${numDays}d avg): ${avgCal} cal, P${avgP}g C${avgC}g F${avgF}g`;
    if (todayMeals.length > 0) line += ` | Today: ${todayCal} cal (${todayMeals.length} meals)`;
    sections.push(line);
  }
  if (r.trainingLogs?.length) {
    const logs = r.trainingLogs;
    const avgRpe = (logs.reduce((s: number, l: any) => s + (l.rpe || 0), 0) / logs.length).toFixed(1);
    sections.push(`TRAINING (7d): ${logs.length} sessions, avg RPE ${avgRpe}`);
  }
  if (r.hydrationLogs?.length) {
    const logs = r.hydrationLogs;
    const days = new Set(logs.map((l: any) => l.date));
    const numDays = days.size || 1;
    const totalMl = logs.reduce((s: number, l: any) => s + (l.amount_ml || 0), 0);
    sections.push(`HYDRATION (${numDays}d avg): ${Math.round(totalMl / numDays)}ml/day`);
  }
  if (r.fightWeekPlan) {
    sections.push(
      `FIGHT WEEK: fight ${r.fightWeekPlan.fight_date}, start ${r.fightWeekPlan.starting_weight_kg}kg -> target ${r.fightWeekPlan.target_weight_kg}kg`,
    );
  }
  if (r.dietPrefs) {
    const parts: string[] = [];
    if (r.dietPrefs.dietary_restrictions?.length)
      parts.push(`restrictions=[${r.dietPrefs.dietary_restrictions.join(", ")}]`);
    if (r.dietPrefs.disliked_foods?.length)
      parts.push(`dislikes=[${r.dietPrefs.disliked_foods.join(", ")}]`);
    if (r.dietPrefs.favorite_cuisines?.length)
      parts.push(`cuisines=[${r.dietPrefs.favorite_cuisines.join(", ")}]`);
    if (parts.length) sections.push(`DIET: ${parts.join(", ")}`);
  }
  if (r.wellnessLogs?.length) {
    sections.push(`WELLNESS: ${r.wellnessLogs.length} check-ins logged in the last week`);
  }
  return sections.join("\n");
}

export const run = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, { messages, userName }) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_WIZARD_CHAT");

    const data = await ctx.runQuery(
      internal.actions_internal.fetchWizardChatData,
      { userId },
    );
    const dataContext = buildDataContext(data);
    const capped = messages.slice(-20);
    const safeMessages = capped.map((m) =>
      m.role === "user"
        ? { ...m, content: sanitizeUserText(m.content, { maxLength: 2000, raw: true }) }
        : m,
    );
    const athleteName = userName ? sanitizeUserText(userName, { maxLength: 80, raw: true }) : null;
    const systemPrompt = `You are the "FightCamp Wizard" - an elite combat sports nutritionist and performance coach.${athleteName ? ` Your athlete's name is "${athleteName}" - call them by name when it lands naturally.` : ""}

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

<your_athlete_data>
${dataContext}
</your_athlete_data>

<research>
${RESEARCH_SUMMARY}
</research>

Base every reply on the data and research above and speak to them directly. Markdown output. 150-300 words. Full natural English, never shorthand.`;

    const content = await callGroqText({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        ...safeMessages,
      ],
      temperature: 0.65,
      max_tokens: 1500,
    });

    return {
      choices: [{ message: { content, role: "assistant" } }],
    };
  },
});
