/** Generate weight plan — free for everyone, card-timeline shape.
 *  Sibling of generateCutPlan for the non-fighter flow. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqWithRetry } from "../_shared/groq";
import { CutPlanSchema, type WeekPhase } from "../_shared/aiSchemas";
import { mifflinStJeor, requiredDeficit, macroSplit } from "../_shared/math";
import { normaliseWeeklyPlan } from "../_shared/normalizeWeeklyPlan";
import { normalisePlanTopLevel } from "../_shared/normalizePlanTopLevel";
import {
  loadAthleteSnapshot,
  logDecision,
  requireUserIdFromAction,
  SECOND_PERSON_DIRECTIVE,
} from "./_helpers";

export const run = action({
  args: {
    currentWeight: v.number(),
    goalWeight: v.number(),
    targetDate: v.string(),
    heightCm: v.number(),
    age: v.number(),
    sex: v.union(v.literal("male"), v.literal("female")),
    activityLevel: v.optional(v.string()),
    goalType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    const snap = await loadAthleteSnapshot(ctx, userId);
    const primaryStruggle: string | undefined =
      typeof snap.profile?.primaryStruggle === "string"
        ? snap.profile.primaryStruggle
        : undefined;
    const days = Math.max(
      1,
      Math.ceil((new Date(args.targetDate).getTime() - Date.now()) / 86400000),
    );
    const weekCount = Math.max(1, Math.min(20, Math.ceil(days / 7)));
    const bmr = mifflinStJeor({
      weightKg: args.currentWeight,
      heightCm: args.heightCm,
      ageYears: args.age,
      sex: args.sex,
    });
    const maintenanceCal = Math.round(bmr * 1.55);
    const deficit = requiredDeficit({
      currentKg: args.currentWeight,
      targetKg: args.goalWeight,
      daysRemaining: days,
      tdee: maintenanceCal,
    });
    const goalIsLoss = args.currentWeight > args.goalWeight;
    const targetCal = goalIsLoss
      ? Math.max(1200, maintenanceCal - deficit.dailyDeficitKcal)
      : maintenanceCal + 300;
    const macros = macroSplit(
      targetCal,
      args.currentWeight,
      goalIsLoss ? "cut" : "maintain",
    );

    const systemPrompt = `You are an evidence-based nutritionist building a card-based ${goalIsLoss ? "weight-loss" : "weight-gain"} plan. Output ONLY valid JSON matching the schema. Use the deterministic numbers below verbatim — never invent calories or macros that contradict them.

${SECOND_PERSON_DIRECTIVE}

USER STRUGGLE: ${primaryStruggle ?? "unspecified"}
You MUST address this struggle directly in \`personalNote\` (1-2 sentences, ≤280 chars) and weave one mitigating tactic into the relevant week's \`dailyFocus\` bullets.

Per week, return:
- \`phase\`: one of foundation | build | peak | final (the LAST week MUST be \`final\` — there is no fight_week in this flow)
- \`heroLine\`: ≤80 chars, ONE memorable sentence
- \`keyMetric\`: ≤24 chars headline (e.g. "−0.6 kg")
- \`dailyFocus\`: 3-5 bullets, each ≤60 chars, imperative voice. NO PARAGRAPHS.
- \`risk\` / \`recovery\`: ≤80 chars each, optional

Also return:
- \`phases[]\`: 2-3 macro phases with name + label + weekStart + weekEnd + 1-line \`intent\` (≤120 chars)
- \`toughestWeek\`: { week, reason ≤120 chars }
- \`personalNote\`: 10-280 chars, references the struggle above
- \`summary\`: ≤500 chars, ONE paragraph max
- \`safetyNotes\`: ≤300 chars, optional
- \`keyPrinciples\`: 3-5 short rules, each ≤120 chars
- Do NOT include \`fightWeek\` — this is the general weight-goal flow.

BANNED: paragraph-length focus strings, motivational fluff, repeating numbers already in \`calories\`/\`protein_g\`, generic advice that ignores the user struggle above, em-dashes (—) or en-dashes (–) anywhere in the output — use commas or periods instead.

DETERMINISTIC FACTS:
- BMR: ${bmr}, maintenance: ${maintenanceCal}, target: ${targetCal} kcal
- Macros: ${macros.protein_g}P / ${macros.carb_g}C / ${macros.fat_g}F
- Weeks: ${weekCount}, days remaining: ${days}
- Start: ${args.currentWeight}kg, goal: ${args.goalWeight}kg

${snap.block}`;

    let aiResult: any = null;
    try {
      aiResult = await callGroqWithRetry({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Generate a ${weekCount}-week ${goalIsLoss ? "weight-loss" : "weight-gain"} plan with structured per-week cards (heroLine + dailyFocus bullets), 2-3 phases, personalNote tied to the user's struggle, and a toughestWeek call-out.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        schema: CutPlanSchema,
      });
    } catch (err) {
      console.warn(
        `[generateWeightPlan] Groq failed, using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const fallbackPlan =
      aiResult ??
      buildDeterministicWeightPlan({
        weekCount,
        startWeight: args.currentWeight,
        finalTarget: args.goalWeight,
        goalIsLoss,
        targetCal,
        deficitKcal: deficit.dailyDeficitKcal,
        macros,
      });

    const weeklyPlan = normaliseWeeklyPlan({
      weeklyPlan: fallbackPlan.weeklyPlan,
      weekCount,
      startWeight: args.currentWeight,
      finalTarget: args.goalWeight,
      defaultCalories: targetCal,
      defaultProtein: macros.protein_g,
      defaultCarbs: macros.carb_g,
      defaultFats: macros.fat_g,
      flow: "weight_loss",
    });

    const topLevel = normalisePlanTopLevel({
      raw: fallbackPlan,
      weeklyPlan,
      primaryStruggle,
    });

    // Strip any fightWeek the LLM may have added — wrong flow.
    const { fightWeek: _drop, ...topLevelNoFW } = topLevel;
    void _drop;

    const plan = {
      weeklyPlan,
      ...topLevelNoFW,
      maintenanceCalories: maintenanceCal,
      targetCalories: targetCal,
      deficit: deficit.dailyDeficitKcal,
      totalWeeks: weekCount,
      weeklyLossTarget: `${((args.currentWeight - args.goalWeight) / weekCount).toFixed(2)} kg/week`,
    };

    await logDecision(ctx, {
      userId,
      feature: "generate-weight-plan",
      inputSnapshot: { ...args, bmr, maintenanceCal, targetCal, primaryStruggle },
      outputJson: plan,
      predictionFacts: {
        predicted_kcal: targetCal,
        predicted_loss_per_week_kg: parseFloat(
          ((args.currentWeight - args.goalWeight) / weekCount).toFixed(2),
        ),
      },
      model: aiResult ? "openai/gpt-oss-120b" : "deterministic-fallback",
    });
    return plan;
  },
});

/** Deterministic weight-loss / gain plan in the v2 card-timeline shape.
 *  No fight_week phase — the last week is `final`. */
function buildDeterministicWeightPlan(opts: {
  weekCount: number;
  startWeight: number;
  finalTarget: number;
  goalIsLoss: boolean;
  targetCal: number;
  deficitKcal: number;
  macros: { protein_g: number; carb_g: number; fat_g: number };
}) {
  const {
    weekCount,
    startWeight,
    finalTarget,
    goalIsLoss,
    targetCal,
    deficitKcal,
    macros,
  } = opts;
  const totalChangeKg = +(startWeight - finalTarget).toFixed(2);
  const perWeekKg = +(totalChangeKg / weekCount).toFixed(2);
  const direction = goalIsLoss ? "loss" : "gain";

  const phaseFor = (i: number): WeekPhase => {
    if (i === weekCount - 1) return "final";
    if (weekCount <= 2) return "build";
    const pct = i / (weekCount - 1);
    if (pct <= 0.25) return "foundation";
    if (pct <= 0.75) return "build";
    return "peak";
  };

  const weeklyPlan = Array.from({ length: weekCount }, (_, i) => {
    const week = i + 1;
    const t = (i + 1) / weekCount;
    const targetWeight = +(startWeight - totalChangeKg * t).toFixed(1);
    const phase = phaseFor(i);
    const heroLine =
      phase === "final"
        ? "Final week — hold the routine, finish strong."
        : phase === "foundation"
          ? "Lock in calorie target + morning weigh-in."
          : phase === "peak"
            ? `Steady ${direction} — ${perWeekKg.toFixed(2)} kg/week.`
            : `Week ${week} — repeat, repeat, repeat.`;
    const keyMetric =
      perWeekKg > 0
        ? `−${perWeekKg.toFixed(2)} kg`
        : `+${Math.abs(perWeekKg).toFixed(2)} kg`;
    const dailyFocus =
      phase === "foundation"
        ? [
            "Weigh in 7am pre-water",
            `Hit ${targetCal} kcal target every day`,
            `${macros.protein_g}g protein split across 3-4 meals`,
            "Log every meal as you eat it",
          ]
        : phase === "peak"
          ? [
              "Track 7-day average, not daily scale",
              "One flexible meal per week max",
              "Strength + 2 conditioning sessions",
              "Sleep 7-9 hours every night",
            ]
          : phase === "final"
            ? [
                "Hold target — no last-minute changes",
                "Mornings: weigh, log, repeat",
                "Prep next week's meals on Sunday",
              ]
            : [
                `${targetCal} kcal target`,
                `${macros.protein_g}g protein floor`,
                "Track every meal as you eat it",
              ];
    return {
      week,
      targetWeight,
      calories: targetCal,
      protein_g: macros.protein_g,
      carbs_g: macros.carb_g,
      fats_g: macros.fat_g,
      phase,
      heroLine,
      keyMetric,
      dailyFocus,
    };
  });

  // phases summary
  const phaseGroups: { name: WeekPhase; weekStart: number; weekEnd: number }[] = [];
  for (const row of weeklyPlan) {
    const last = phaseGroups[phaseGroups.length - 1];
    if (last && last.name === row.phase) last.weekEnd = row.week;
    else
      phaseGroups.push({ name: row.phase, weekStart: row.week, weekEnd: row.week });
  }
  const phaseLabel: Record<WeekPhase, string> = {
    foundation: "Foundation",
    build: "Build",
    peak: "Drive",
    final: "Final Week",
    fight_week: "Fight Week",
  };
  const phaseIntent: Record<WeekPhase, string> = {
    foundation: "Lock in the rhythm. Same wake, same weigh-in, same meals.",
    build: "Steady deficit. The scale moves; trust the trend.",
    peak: "Hardest stretch. Routine carries you through the dip.",
    final: "Hold the line. No last-minute changes.",
    fight_week: "Fight week — not applicable to this plan.",
  };
  const phases = phaseGroups.map((g) => ({
    name: g.name,
    label: phaseLabel[g.name],
    weekStart: g.weekStart,
    weekEnd: g.weekEnd,
    intent: phaseIntent[g.name],
  }));

  return {
    weeklyPlan,
    phases,
    personalNote: "Built around your numbers and your timeline — repeat the daily reps and the math handles the rest.",
    toughestWeek: {
      week: Math.max(1, Math.ceil(weekCount * 0.6)),
      reason: "Plateau zone. The scale slows; the work doesn't. Eat to plan, sleep, repeat.",
    },
    summary: goalIsLoss
      ? `${targetCal} kcal/day to drop about ${perWeekKg.toFixed(2)} kg per week, hitting ${finalTarget} kg in ${weekCount} weeks. Trust the daily reps; the math handles the rest.`
      : `${targetCal} kcal/day with a small surplus to gain ~${Math.abs(perWeekKg).toFixed(2)} kg per week, reaching ${finalTarget} kg in ${weekCount} weeks.`,
    totalWeeks: weekCount,
    weeklyLossTarget: `${perWeekKg.toFixed(2)} kg/week`,
    safetyNotes:
      "Persistent fatigue, dizziness, or a 2-week stall? Ease the deficit by 100-200 kcal. Don't drop below 1200 kcal women / 1500 men.",
    keyPrinciples: [
      `${macros.protein_g}g protein every day — protect lean mass.`,
      "Weigh in daily, same conditions; track the 7-day average.",
      `Stay within ${Math.round(deficitKcal)} kcal of target on training days.`,
      "Sleep 7-9 hours; under-recovery wrecks adherence.",
    ],
  };
}
