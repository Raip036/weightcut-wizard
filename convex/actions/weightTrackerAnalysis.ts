/**
 * weightTrackerAnalysis — refreshes the weight-tracker plan using the SAME
 * card-timeline shape as `generateWeightPlan`, so the WeightTracker page can
 * render the result through the shared `InlinePlanDisplay` component without
 * any per-surface forking.
 *
 * Functionally a sibling of `generateWeightPlan.run`: it uses the same
 * Mifflin-St Jeor BMR -> activity multiplier -> requiredDeficit -> macroSplit
 * math helpers and the same CutPlanSchema scaffold. The key differences:
 *
 *   1. It accepts the user's recent weight history so the prompt can lean on
 *      observed trend / plateau context (the post-onboarding generator only
 *      sees the static profile snapshot).
 *   2. It pulls height / age / sex / activity from the profile snapshot
 *      rather than requiring the client to pass them.
 *   3. It is FREE for everyone (no feature gate), matching the policy used by
 *      `generateWeightPlan`.
 *   4. It auto-derives sensible defaults when the profile lacks a target date
 *      (12-week horizon) or goal weight (no-op pass-through).
 *
 * Output shape is intentionally identical to `generateWeightPlan`'s output so
 * the front-end can swap in `InlinePlanDisplay` directly.
 */
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
import { enforceFeatureGate } from "../_shared/featureGates";

const DAY_MS = 86_400_000;

/** Cap the camp horizon at 20 weeks so the timeline UI stays scrollable. */
const MAX_WEEKS = 20;
/** Minimum 1 week so we always render at least one card. */
const MIN_WEEKS = 1;

/** Default horizon when the profile has no target date. Picks a comfortable
 *  12-week window which is the most common goal length. */
const DEFAULT_WEEK_HORIZON = 12;

export const run = action({
  args: {
    weightHistory: v.optional(
      v.array(
        v.object({ date: v.string(), weight_kg: v.union(v.number(), v.string()) }),
      ),
    ),
    currentWeight: v.optional(v.number()),
    goalWeight: v.optional(v.number()),
    targetDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    // Pro-gated. The onboarding sibling (`generateWeightPlan`) stays
    // free — a new user needs a plan to start — but post-onboarding
    // refreshes are a paying-tier feature. The gate throws
    // `PRO_FEATURE_REQUIRED:AI_WEIGHT_ANALYSIS` which the client's
    // `useAIAction` wrapper catches and opens the paywall.
    await enforceFeatureGate(ctx, userId, "AI_WEIGHT_ANALYSIS");
    const snap = await loadAthleteSnapshot(ctx, userId);
    // `snap.profile` can be null when the user is new — carry the
    // typed shape through the fallback so downstream property reads
    // stay typed instead of degrading to `{}`.
    const profile = snap.profile ?? ({} as NonNullable<typeof snap.profile>);

    // ── Resolve inputs from args, then fall back to profile ────────────
    const currentWeight =
      typeof args.currentWeight === "number" && Number.isFinite(args.currentWeight)
        ? args.currentWeight
        : Number(profile.current_weight_kg);

    const goalWeight =
      typeof args.goalWeight === "number" && Number.isFinite(args.goalWeight)
        ? args.goalWeight
        : Number(profile.fight_week_target_kg ?? profile.goal_weight_kg);

    if (!Number.isFinite(currentWeight) || !Number.isFinite(goalWeight)) {
      throw new Error(
        "Current weight and goal weight are required. Please complete your profile.",
      );
    }

    const heightCm = Number(profile.height_cm);
    const age = Number(profile.age);
    const sexRaw = String(profile.sex ?? "").toLowerCase();
    const sex: "male" | "female" = sexRaw === "female" ? "female" : "male";

    if (!Number.isFinite(heightCm) || !Number.isFinite(age)) {
      throw new Error(
        "Height and age are required for plan math. Please update your profile.",
      );
    }

    // ── Resolve timeline horizon ───────────────────────────────────────
    const targetDateRaw = args.targetDate ?? profile.target_date ?? null;
    const today = new Date();
    let daysRemaining: number;
    if (targetDateRaw) {
      const t = new Date(targetDateRaw).getTime();
      daysRemaining = Number.isFinite(t)
        ? Math.max(1, Math.ceil((t - today.getTime()) / DAY_MS))
        : DEFAULT_WEEK_HORIZON * 7;
    } else {
      daysRemaining = DEFAULT_WEEK_HORIZON * 7;
    }
    const weekCount = Math.max(
      MIN_WEEKS,
      Math.min(MAX_WEEKS, Math.ceil(daysRemaining / 7)),
    );
    const targetDateIso = targetDateRaw
      ? new Date(targetDateRaw).toISOString().slice(0, 10)
      : new Date(today.getTime() + weekCount * 7 * DAY_MS)
          .toISOString()
          .slice(0, 10);

    // ── Deterministic math ─────────────────────────────────────────────
    const bmr = mifflinStJeor({
      weightKg: currentWeight,
      heightCm,
      ageYears: age,
      sex,
    });
    const maintenanceCal = Math.round(bmr * 1.55);
    const deficit = requiredDeficit({
      currentKg: currentWeight,
      targetKg: goalWeight,
      daysRemaining,
      tdee: maintenanceCal,
    });
    const goalIsLoss = currentWeight > goalWeight;
    const targetCal = goalIsLoss
      ? Math.max(1200, maintenanceCal - deficit.dailyDeficitKcal)
      : maintenanceCal + 300;
    const macros = macroSplit(
      targetCal,
      currentWeight,
      goalIsLoss ? "cut" : "maintain",
    );

    // ── Pull a primary struggle for the personalNote, when available ───
    const primaryStruggle: string | undefined =
      typeof (profile as any)?.primaryStruggle === "string"
        ? (profile as any).primaryStruggle
        : undefined;

    // ── Build trend context from history ───────────────────────────────
    const history = Array.isArray(args.weightHistory) ? args.weightHistory : [];
    const numericHistory = history
      .map((h) => ({ date: h.date, weight: Number(h.weight_kg) }))
      .filter((h) => Number.isFinite(h.weight))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let trendBlock = "";
    if (numericHistory.length >= 2) {
      const first = numericHistory[0];
      const last = numericHistory[numericHistory.length - 1];
      const days =
        (new Date(last.date).getTime() - new Date(first.date).getTime()) / DAY_MS;
      const weeks = days / 7;
      const avgWeeklyLoss = weeks > 0 ? (first.weight - last.weight) / weeks : 0;
      const recent7 = numericHistory.slice(-7).map((p) => p.weight);
      const plateau =
        recent7.length >= 5 && Math.max(...recent7) - Math.min(...recent7) < 0.3;
      trendBlock = `\n\nOBSERVED TREND (${numericHistory.length} logs over ${Math.round(days)} days):
- Avg weekly change: ${avgWeeklyLoss.toFixed(2)} kg/wk
- Plateau (last 7 entries within 0.3kg): ${plateau ? "Yes" : "No"}`;
    }

    // ── Prompt scaffold mirrors generateWeightPlan, sans em-dashes ─────
    const systemPrompt = `You are an evidence-based nutritionist refreshing a card-based ${goalIsLoss ? "weight-loss" : "weight-gain"} plan based on the user's latest weigh-ins. Output ONLY valid JSON matching the schema. Use the deterministic numbers below verbatim, never invent calories or macros that contradict them.

${SECOND_PERSON_DIRECTIVE}

USER STRUGGLE: ${primaryStruggle ?? "unspecified"}
You MUST address this struggle directly in \`personalNote\` (1-2 sentences, max 280 chars) and weave one mitigating tactic into the relevant week's \`dailyFocus\` bullets.

Per week, return:
- \`phase\`: one of foundation | build | peak | final (the LAST week MUST be \`final\`, there is no fight_week in this flow)
- \`heroLine\`: max 80 chars, ONE memorable sentence
- \`keyMetric\`: max 24 chars headline (e.g. "-0.6 kg")
- \`dailyFocus\`: 3-5 bullets, each max 60 chars, imperative voice. NO PARAGRAPHS.
- \`risk\` / \`recovery\`: max 80 chars each, optional

Also return:
- \`phases[]\`: 2-3 macro phases with name + label + weekStart + weekEnd + 1-line \`intent\` (max 120 chars)
- \`toughestWeek\`: { week, reason max 120 chars }
- \`personalNote\`: 10-280 chars, references the struggle above
- \`summary\`: max 500 chars, ONE paragraph max
- \`safetyNotes\`: max 300 chars, optional
- \`keyPrinciples\`: 3-5 short rules, each max 120 chars
- Do NOT include \`fightWeek\`, this is the general weight-goal flow.

BANNED: paragraph-length focus strings, motivational fluff, repeating numbers already in \`calories\`/\`protein_g\`, generic advice that ignores the user struggle above, em-dashes or en-dashes anywhere in the output. Use commas or periods instead.

DETERMINISTIC FACTS:
- BMR: ${bmr}, maintenance: ${maintenanceCal}, target: ${targetCal} kcal
- Macros: ${macros.protein_g}P / ${macros.carb_g}C / ${macros.fat_g}F
- Weeks: ${weekCount}, days remaining: ${daysRemaining}
- Start: ${currentWeight}kg, goal: ${goalWeight}kg${trendBlock}

${snap.block}`;

    // ── Call LLM with retry, fall back to deterministic plan on failure ─
    //
    // Uses the global heavy-reasoning model (gpt-oss-120b on both
    // providers via OPENROUTER_MODEL_MAP — OpenRouter just routes it to the
    // fastest backend; matches every other heavy-tier feature). The
    // `callGroqWithRetry` machinery already runs 4 attempts with appended
    // schema feedback, and falls back to a deterministic plan if the
    // model can't produce a valid CutPlanSchema after the retries.
    const HEAVY_MODEL = "openai/gpt-oss-120b";

    let aiResult: any = null;
    try {
      aiResult = await callGroqWithRetry({
        model: HEAVY_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Refresh the ${weekCount}-week ${goalIsLoss ? "weight-loss" : "weight-gain"} plan with structured per-week cards (heroLine + dailyFocus bullets), 2-3 phases, personalNote tied to the user's struggle, and a toughestWeek call-out. Account for the observed trend above when picking the toughest week and any adjustment tactics.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        schema: CutPlanSchema,
      });
    } catch (err) {
      console.warn(
        `[weightTrackerAnalysis] Groq failed, using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const fallbackPlan =
      aiResult ??
      buildDeterministicWeightPlan({
        weekCount,
        startWeight: currentWeight,
        finalTarget: goalWeight,
        goalIsLoss,
        targetCal,
        deficitKcal: deficit.dailyDeficitKcal,
        macros,
      });

    const weeklyPlan = normaliseWeeklyPlan({
      weeklyPlan: fallbackPlan.weeklyPlan,
      weekCount,
      startWeight: currentWeight,
      finalTarget: goalWeight,
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

    // Drop fightWeek if the LLM hallucinated one, this surface is non-fighter.
    const { fightWeek: _drop, ...topLevelNoFW } = topLevel;
    void _drop;

    const plan = {
      weeklyPlan,
      ...topLevelNoFW,
      maintenanceCalories: maintenanceCal,
      targetCalories: targetCal,
      deficit: deficit.dailyDeficitKcal,
      totalWeeks: weekCount,
      weeklyLossTarget: `${((currentWeight - goalWeight) / weekCount).toFixed(2)} kg/week`,
      // Echo back the inputs so InlinePlanDisplay can render the hero ring
      // and the "by <date>" goal label without an extra props prop chain.
      currentWeight,
      goalWeight,
      targetDate: targetDateIso,
      planType: "weight_loss" as const,
    };

    await logDecision(ctx, {
      userId,
      feature: "weight-tracker-analysis",
      inputSnapshot: {
        currentWeight,
        goalWeight,
        targetDate: targetDateIso,
        bmr,
        maintenanceCal,
        targetCal,
        primaryStruggle,
        historyPoints: numericHistory.length,
      },
      outputJson: plan,
      predictionFacts: {
        predicted_kcal: targetCal,
        predicted_loss_per_week_kg: parseFloat(
          ((currentWeight - goalWeight) / weekCount).toFixed(2),
        ),
      },
      model: aiResult ? HEAVY_MODEL : "deterministic-fallback",
    });

    return plan;
  },
});

/** Deterministic fallback in the v2 card-timeline shape. Used when Groq is
 *  unavailable so the UI never crashes on an empty plan. Mirrors the helper
 *  in `generateWeightPlan.ts` so both surfaces degrade identically. */
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
        ? "Final week, hold the routine, finish strong."
        : phase === "foundation"
          ? "Lock in calorie target plus morning weigh-in."
          : phase === "peak"
            ? `Steady ${direction}, ${perWeekKg.toFixed(2)} kg/week.`
            : `Week ${week}, repeat, repeat, repeat.`;
    const keyMetric =
      perWeekKg > 0
        ? `-${perWeekKg.toFixed(2)} kg`
        : `+${Math.abs(perWeekKg).toFixed(2)} kg`;
    const dailyFocus =
      phase === "foundation"
        ? [
            "Weigh in 7am pre water",
            `Hit ${targetCal} kcal target every day`,
            `${macros.protein_g}g protein across 3 to 4 meals`,
            "Log every meal as you eat it",
          ]
        : phase === "peak"
          ? [
              "Track 7 day average, not daily scale",
              "One flexible meal per week max",
              "Strength plus 2 conditioning sessions",
              "Sleep 7 to 9 hours every night",
            ]
          : phase === "final"
            ? [
                "Hold target, no last minute changes",
                "Mornings: weigh, log, repeat",
                "Prep next week meals on Sunday",
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
    foundation: "Lock in the rhythm. Same wake, same weigh in, same meals.",
    build: "Steady deficit. The scale moves; trust the trend.",
    peak: "Hardest stretch. Routine carries you through the dip.",
    final: "Hold the line. No last minute changes.",
    fight_week: "Fight week, not applicable to this plan.",
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
    personalNote:
      "Built around your numbers and your timeline, repeat the daily reps and the math handles the rest.",
    toughestWeek: {
      week: Math.max(1, Math.ceil(weekCount * 0.6)),
      reason:
        "Plateau zone. The scale slows; the work does not. Eat to plan, sleep, repeat.",
    },
    summary: goalIsLoss
      ? `${targetCal} kcal/day to drop about ${perWeekKg.toFixed(2)} kg per week, hitting ${finalTarget} kg in ${weekCount} weeks. Trust the daily reps; the math handles the rest.`
      : `${targetCal} kcal/day with a small surplus to gain about ${Math.abs(perWeekKg).toFixed(2)} kg per week, reaching ${finalTarget} kg in ${weekCount} weeks.`,
    totalWeeks: weekCount,
    weeklyLossTarget: `${perWeekKg.toFixed(2)} kg/week`,
    safetyNotes:
      "Persistent fatigue, dizziness, or a 2 week stall? Ease the deficit by 100 to 200 kcal. Do not drop below 1200 kcal women, 1500 men.",
    keyPrinciples: [
      `${macros.protein_g}g protein every day, protect lean mass.`,
      "Weigh in daily, same conditions; track the 7 day average.",
      `Stay within ${Math.round(deficitKcal)} kcal of target on training days.`,
      "Sleep 7 to 9 hours; under recovery wrecks adherence.",
    ],
  };
}
