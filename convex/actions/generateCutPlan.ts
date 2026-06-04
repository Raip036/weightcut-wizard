/** Generate cut plan — free for everyone, card-timeline shape. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqWithRetry } from "../_shared/groq";
import { CutPlanAiSchema, type WeekPhase } from "../_shared/aiSchemas";
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
    fightWeekTargetKg: v.optional(v.number()),
    targetDate: v.string(),
    heightCm: v.number(),
    age: v.number(),
    sex: v.union(v.literal("male"), v.literal("female")),
    activityLevel: v.optional(v.string()),
    // "day_before" | "same_day". Drives the cut-strategy branch below.
    // Absent / unrecognised → "day_before" (preserves historical behavior).
    weighInTiming: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    // Free for everyone — see featureGates.ts for the policy reason.
    const snap = await loadAthleteSnapshot(ctx, userId);
    // Canonical weigh-in timing. Default to "day_before" everywhere it's
    // missing or unrecognised so existing callers keep the managed acute-cut
    // behavior. "same_day" switches to the research-backed (ISSN 2025)
    // no-acute-cut strategy.
    const isSameDay = args.weighInTiming === "same_day";
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
    const finalTarget = args.fightWeekTargetKg ?? args.goalWeight;
    const deficit = requiredDeficit({
      currentKg: args.currentWeight,
      targetKg: finalTarget,
      daysRemaining: days,
      tdee: maintenanceCal,
    });
    const targetCal = Math.max(1200, maintenanceCal - deficit.dailyDeficitKcal);
    const baseMacros = macroSplit(targetCal, args.currentWeight, "cut");
    // Same-day weigh-in: there is NO post-weigh-in recovery window, so we
    // must never deplete glycogen. Floor carbohydrates at >=3 g/kg bodyweight
    // (ISSN 2025) — overriding the deficit-driven remainder if it would dip
    // below that. day_before keeps the unchanged cut macro logic.
    const sameDayCarbFloorG = Math.round(args.currentWeight * 3);
    const macros = isSameDay
      ? { ...baseMacros, carb_g: Math.max(baseMacros.carb_g, sameDayCarbFloorG) }
      : baseMacros;

    // ── Same-day context (only meaningful when isSameDay) ──────────────
    // How much of bodyweight the athlete would need to shed to reach the
    // target, and whether the timeline is long enough for a true
    // body-composition descent. These steer the same-day edge cases:
    //  - already at/under goal       → maintenance plan, no cut
    //  - drop > ~5% or short window  → recommend moving UP a weight class
    //  - long timeline               → chronic body-comp mode only
    const totalDropKg = +(args.currentWeight - finalTarget).toFixed(2);
    const pctDrop =
      args.currentWeight > 0 ? (totalDropKg / args.currentWeight) * 100 : 0;
    const alreadyAtGoal = totalDropKg <= 0 || pctDrop <= 1;
    const dropTooBig = pctDrop > 5;
    const shortTimeline = days < 14;

    // Build the same-day EDGE-CASE clauses as a list so they're numbered
    // sequentially (no duplicate "6." / off-by-one) regardless of which
    // ones fire. `alreadyAtGoal` (maintenance) and the move-up-a-class
    // clause are MUTUALLY EXCLUSIVE — maintenance wins when both could
    // apply, so the move-up clause is gated behind `!alreadyAtGoal`.
    const sameDayEdgeClauses: string[] = [];
    if (alreadyAtGoal) {
      sameDayEdgeClauses.push(
        "EDGE CASE — the athlete is already at or under goal weight. Build a MAINTENANCE plan: hold weight, keep carbs and hydration normal, train and recover. Do NOT prescribe any cut or deficit.",
      );
    } else if (dropTooBig || shortTimeline) {
      sameDayEdgeClauses.push(
        `EDGE CASE — reaching the limit would need roughly ${pctDrop.toFixed(0)}% of bodyweight${shortTimeline ? " in a short timeline" : ""}. That cannot be done safely without meaningful dehydration on a same-day weigh-in. RECOMMEND MOVING UP A WEIGHT CLASS rather than cutting, and say so clearly in \`summary\` and \`safetyNotes\`.`,
      );
    }
    if (days > 7 * 16) {
      sameDayEdgeClauses.push(
        "EDGE CASE — the timeline is long/open-ended. Use CHRONIC body-composition mode only: slow, sustainable fat loss with full carbs and hydration; no countdown, no acute phase.",
      );
    }
    // Numbered continuation of the 5 strategy rules above (start at 6).
    const sameDayEdgeCases = sameDayEdgeClauses
      .map((clause, i) => `${i + 6}. ${clause}\n`)
      .join("");

    const DAY_BEFORE_PROMPT = `You are an evidence-based combat-sports nutritionist building a card-based fight-camp plan. Output ONLY valid JSON matching the schema. Use the deterministic numbers below verbatim — never invent calories or macros that contradict them.

${SECOND_PERSON_DIRECTIVE}

USER STRUGGLE: ${primaryStruggle ?? "unspecified"}
You MUST address this struggle directly in \`personalNote\` (1-2 sentences, ≤280 chars) and weave one mitigating tactic into the relevant week's \`dailyFocus\` bullets.

Per week, return:
- \`phase\`: one of foundation | build | peak | final | fight_week (the LAST week MUST be fight_week)
- \`heroLine\`: ≤80 chars, ONE memorable sentence (e.g. "Week 3 is the grind — protein bumps to 2.0 g/kg")
- \`keyMetric\`: ≤24 chars headline (e.g. "−1.2 kg", "Sodium 4 g")
- \`dailyFocus\`: 3-5 bullets, each ≤60 chars, imperative voice ("Weigh in 7am pre-water"). NO PARAGRAPHS.
- \`risk\` / \`recovery\`: ≤80 chars each, optional

Also return:
- \`phases[]\`: 2-3 macro phases with name + label + weekStart + weekEnd + 1-line \`intent\` (≤120 chars)
- \`toughestWeek\`: { week, reason ≤120 chars }
- \`personalNote\`: 10-280 chars, references the struggle above
- \`summary\`: ≤500 chars, ONE paragraph max
- \`safetyNotes\`: ≤300 chars, optional
- \`keyPrinciples\`: 3-5 short rules, each ≤120 chars
(Fight-week numeric protocol — carbs, sodium, water by day — is computed server-side from bodyweight. Do NOT emit a fightWeek block.)

BANNED: paragraph-length focus strings, motivational fluff, repeating numbers already in \`calories\`/\`protein_g\`, generic advice that ignores the user struggle above, em-dashes (—) or en-dashes (–) anywhere in the output — use commas or periods instead.
For \`recovery\` field (optional, per-week): omit unless you have a sport-specific, dose-and-timing directive (e.g. "Casein 30g pre-sleep on sparring days"). Do NOT emit generic wellness lines like contrast showers, 8h sleep, hydration reminders — those duplicate \`dailyFocus\` and were flagged as filler.

DETERMINISTIC FACTS:
- BMR: ${bmr}, maintenance: ${maintenanceCal}, target: ${targetCal} kcal
- Macros: ${macros.protein_g}P / ${macros.carb_g}C / ${macros.fat_g}F
- Weeks: ${weekCount}, days remaining: ${days}
- Starting weight: ${args.currentWeight}kg, final target: ${finalTarget}kg

${snap.block}`;

    // SAME-DAY weigh-in. There is NO recovery window between weigh-in and
    // competition, so the entire managed acute-cut model (water/carb/sodium
    // manipulation → rehydrate/refuel) is the WRONG strategy and is removed.
    // Rules are ISSN 2025 position stand; tone is plain and safety-first
    // because most same-day athletes are amateurs / BJJ / match fighters.
    const SAME_DAY_PROMPT = `You are an evidence-based combat-sports nutritionist building a card-based plan for an athlete who weighs in on the SAME DAY as they compete. There is NO recovery window between weigh-in and the fight. Output ONLY valid JSON matching the schema. Use the deterministic numbers below verbatim — never invent calories or macros that contradict them.

${SECOND_PERSON_DIRECTIVE}

USER STRUGGLE: ${primaryStruggle ?? "unspecified"}
You MUST address this struggle directly in \`personalNote\` (1-2 sentences, ≤280 chars) and weave one mitigating tactic into the relevant week's \`dailyFocus\` bullets.

SAME-DAY WEIGH-IN STRATEGY (this OVERRIDES any acute water-cut you know):
1. Build the whole plan around GRADUAL body-composition change done EARLY in the timeline. The final days are MAINTENANCE plus light training, NOT an acute cut. There is no fight-week water cut and no refuel window.
2. KEEP CARBOHYDRATES throughout. Never deplete glycogen. Hold carbs at >=3-4 g/kg/day right through the descent and right up to competition — the athlete competes on the weight they make, fueled.
3. Cap acute dehydration at <=2-3% of bodyweight, and prefer ~0%. Explicitly tell the athlete: do NOT use sauna, sweat suits, hot baths, or fluid restriction to make weight. Hydrate normally.
4. Explain WHY plainly: even ~2-3% dehydration costs roughly >=10% performance, and with same-day weigh-in that loss is carried straight into the fight with no time to recover. Eating normally and keeping carbs is a performance ADVANTAGE here, not a compromise.
5. Treat the fight-week target as essentially AT goal weight (within ~1-2%). The last days hold weight steady, they do not chase a number.
${sameDayEdgeCases}Per week, return:
- \`phase\`: one of foundation | build | peak | final | fight_week (the LAST week MUST be fight_week). For same-day, treat fight_week as a MAINTENANCE / hold-weight week — eat normally, full carbs, hydrate. It is NOT a water-cut week.
- \`heroLine\`: ≤80 chars, ONE memorable sentence.
- \`keyMetric\`: ≤24 chars headline (e.g. "−0.4 kg", "Carbs 4 g/kg").
- \`dailyFocus\`: 3-5 bullets, each ≤60 chars, imperative voice. NO PARAGRAPHS. The final-week bullets MUST reflect eating normally, keeping carbs, and hydrating — never water/sodium/sweat manipulation.
- \`risk\` / \`recovery\`: ≤80 chars each, optional.

Also return:
- \`phases[]\`: 2-3 macro phases with name + label + weekStart + weekEnd + 1-line \`intent\` (≤120 chars).
- \`toughestWeek\`: { week, reason ≤120 chars }.
- \`personalNote\`: 10-280 chars, references the struggle above.
- \`summary\`: ≤500 chars, ONE paragraph max. MUST state plainly that this is a same-day weigh-in so there is no acute cut, no sauna/sweat suits, full carbs and normal hydration into the fight.
- \`safetyNotes\`: ≤300 chars. MUST include the no-sauna / no-sweat-suit / no-fluid-restriction warning and the ~2-3% dehydration ≈ >=10% performance-loss rationale.
- \`keyPrinciples\`: 3-5 short rules, each ≤120 chars — center them on full carbs, normal hydration, gradual early change, and no acute cut.

BANNED: any sauna / sweat suit / hot bath / water-load / sodium-cliff / fluid-restriction guidance, glycogen depletion, paragraph-length focus strings, motivational fluff, repeating numbers already in \`calories\`/\`protein_g\`, generic advice that ignores the user struggle above, em-dashes (—) or en-dashes (–) anywhere in the output — use commas or periods instead.
For \`recovery\` field (optional, per-week): omit unless you have a sport-specific, dose-and-timing directive. Do NOT emit generic wellness lines.

DETERMINISTIC FACTS:
- BMR: ${bmr}, maintenance: ${maintenanceCal}, target: ${targetCal} kcal
- Macros: ${macros.protein_g}P / ${macros.carb_g}C / ${macros.fat_g}F (carbs floored at >=3 g/kg — do NOT cut below this)
- Weeks: ${weekCount}, days remaining: ${days}
- Starting weight: ${args.currentWeight}kg, target: ${finalTarget}kg (drop ≈ ${pctDrop.toFixed(1)}% of bodyweight)

${snap.block}`;

    const systemPrompt = isSameDay ? SAME_DAY_PROMPT : DAY_BEFORE_PROMPT;

    let aiResult: any = null;
    try {
      aiResult = await callGroqWithRetry({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: isSameDay
              ? `Generate a ${weekCount}-week SAME-DAY-weigh-in plan for an athlete going from ${args.currentWeight}kg toward ${finalTarget}kg in ${days} days. Gradual body-composition change done early, full carbs (>=3 g/kg) and normal hydration held all the way to competition, the final week a maintenance/hold-weight week with NO acute cut. Structured per-week cards with heroLine + dailyFocus bullets, personalNote tied to the struggle, toughestWeek call-out, and a summary + safetyNotes that spell out the no-sauna / no-dehydration rationale. The fightWeek numeric block is computed server-side, so do not emit it.`
              : `Generate a ${weekCount}-week cut plan for an athlete cutting from ${args.currentWeight}kg to ${finalTarget}kg in ${days} days. Tapered weekly targets, 2-3 phase summary, structured per-week cards with heroLine + dailyFocus bullets, personalNote tied to the struggle, toughestWeek call-out. The fightWeek numeric block is computed server-side, so do not emit it.`,
          },
        ],
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        // Speed: gpt-oss-120b defaults to heavy hidden reasoning. The plan's
        // numbers are computed server-side, so the model is only writing the
        // narrative cards — "low" reasoning keeps that quality while cutting
        // latency sharply. Fail fast (1 retry, 12s) to the deterministic
        // fallback below instead of stalling on a slow/failed call.
        reasoning_effort: "low",
        timeoutMs: 12000,
        maxRetries: 1,
        // Permissive: the model returns narrative only; numbers + value
        // limits are enforced by normaliseWeeklyPlan / normalisePlanTopLevel
        // below. Strict validation here just forces needless fallbacks.
        schema: CutPlanAiSchema,
      });
    } catch (err) {
      console.warn(
        `[generateCutPlan] Groq failed, using deterministic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const fallbackPlan =
      aiResult ??
      buildDeterministicCutPlan({
        weekCount,
        startWeight: args.currentWeight,
        finalTarget,
        targetCal,
        deficitKcal: deficit.dailyDeficitKcal,
        macros,
        daysRemaining: days,
        primaryStruggle,
      });

    const weeklyPlan = normaliseWeeklyPlan({
      weeklyPlan: fallbackPlan.weeklyPlan,
      weekCount,
      startWeight: args.currentWeight,
      finalTarget,
      defaultCalories: targetCal,
      defaultProtein: macros.protein_g,
      defaultCarbs: macros.carb_g,
      defaultFats: macros.fat_g,
      flow: "cut",
    });

    const topLevel = normalisePlanTopLevel({
      raw: fallbackPlan,
      weeklyPlan,
      primaryStruggle,
    });

    // Fight-week protocol numbers are math, not narrative — always
    // compute server-side from bodyweight, never trust LLM output for
    // these. This also produces a per-day timeline (fightWeekDays) the
    // UI uses to render a clear day-stack instead of opaque date ranges.
    //
    // SAME-DAY: there is no acute cut, so the day-stack is a MAINTENANCE /
    // hold-weight protocol (full carbs, normal hydration, no water-load,
    // no sodium cliff) rather than the day-before depletion timeline.
    const fightWeekBundle = isSameDay
      ? buildSameDayFinalWeekBundle({
          currentWeight: args.currentWeight,
          daysRemaining: days,
          targetDateISO: args.targetDate,
        })
      : buildFightWeekBundle({
          currentWeight: args.currentWeight,
          finalTarget,
          daysRemaining: days,
          targetDateISO: args.targetDate,
        });

    // SAME-DAY narrative guarantee: the educational messaging (no acute cut,
    // full carbs, normal hydration, ~2-3% dehydration ≈ >=10% performance
    // loss, move-up-a-class when needed) must appear even when the LLM call
    // fails and we fall through to the deterministic fallback. Override the
    // narrative fields rather than trusting normalisePlanTopLevel's output.
    const sameDayNarrative = isSameDay
      ? {
          summary: alreadyAtGoal
            ? `You weigh in the same day you compete and you are already at or under ${finalTarget} kg. No cut needed: hold your weight, keep carbs and fluids normal, train and recover into the fight.`
            : dropTooBig || shortTimeline
              ? `Same-day weigh-in means no recovery window. Reaching ${finalTarget} kg would need about ${pctDrop.toFixed(0)}% of bodyweight, which is not safe to do without dehydration you cannot recover from before you fight. Strongly consider moving up a weight class. If you proceed, change weight gradually and early, keep full carbs and normal hydration, and never use a sauna or sweat suit.`
              : `Same-day weigh-in means you fight on the weight you make, so there is no acute cut. Drop weight gradually and early, keep carbs at or above ${sameDayCarbFloorG} g/day, and hydrate normally right up to the fight. No sauna, sweat suits, or fluid restriction.`,
          safetyNotes: `Do NOT use a sauna, sweat suit, hot bath, or fluid restriction to make weight. Even 2-3% dehydration cuts performance by roughly 10% or more, and with same-day weigh-in you carry that straight into the fight with no time to recover. Keep carbs in and stay hydrated.`,
          keyPrinciples: [
            `Keep carbohydrates at or above ${sameDayCarbFloorG} g/day. Never deplete glycogen, you compete fueled.`,
            "Hydrate normally right up to competition. No sauna, no sweat suits, no fluid restriction.",
            "Make weight by gradual, early body-composition change, not by dehydration in the final days.",
            "If the limit needs more than ~5% loss or any real dehydration, move up a weight class instead.",
          ],
        }
      : {};

    const plan = {
      weeklyPlan,
      ...topLevel,
      ...sameDayNarrative,
      weighInTiming: isSameDay ? "same_day" : "day_before",
      fightWeek: fightWeekBundle.block,
      fightWeekDays: fightWeekBundle.days,
      fightWeekRefeed: fightWeekBundle.refeed,
      fightWeekSafetyFlag: fightWeekBundle.safetyFlag,
      maintenanceCalories: maintenanceCal,
      targetCalories: targetCal,
      deficit: deficit.dailyDeficitKcal,
      totalWeeks: weekCount,
      weeklyLossTarget: `${((args.currentWeight - finalTarget) / weekCount).toFixed(2)} kg/week`,
    };

    await logDecision(ctx, {
      userId,
      feature: "generate-cut-plan",
      inputSnapshot: { ...args, bmr, maintenanceCal, targetCal, primaryStruggle },
      outputJson: plan,
      predictionFacts: {
        predicted_kcal: targetCal,
        predicted_loss_per_week_kg: parseFloat(
          ((args.currentWeight - finalTarget) / weekCount).toFixed(2),
        ),
      },
      model: aiResult ? "openai/gpt-oss-120b" : "deterministic-fallback",
    });
    return plan;
  },
});

/**
 * Deterministic cut plan in the v2 card-timeline shape. Used when Groq
 * is rate-limited or returns a malformed plan. Math-driven, no AI.
 */
function buildDeterministicCutPlan(opts: {
  weekCount: number;
  startWeight: number;
  finalTarget: number;
  targetCal: number;
  deficitKcal: number;
  macros: { protein_g: number; carb_g: number; fat_g: number };
  daysRemaining: number;
  primaryStruggle?: string;
}) {
  const {
    weekCount,
    startWeight,
    finalTarget,
    targetCal,
    deficitKcal,
    macros,
    daysRemaining,
  } = opts;
  const totalKg = +(startWeight - finalTarget).toFixed(2);
  const perWeekKg = +(totalKg / weekCount).toFixed(2);

  const phaseFor = (i: number): WeekPhase => {
    if (i === weekCount - 1) return "fight_week";
    if (weekCount <= 2) return "build";
    const pct = i / (weekCount - 1);
    if (pct <= 0.2) return "foundation";
    if (pct <= 0.6) return "build";
    return "peak";
  };

  const weeklyPlan = Array.from({ length: weekCount }, (_, i) => {
    const week = i + 1;
    const t = (i + 1) / weekCount;
    const targetWeight = +(startWeight - totalKg * t).toFixed(1);
    const phase = phaseFor(i);
    const kgRemaining = +(targetWeight - finalTarget).toFixed(1);
    const heroLine =
      phase === "fight_week"
        ? "Fight week — cut carbs, load water, drop salt."
        : phase === "foundation"
          ? "Lock the routine — same wake, same weigh-in."
          : phase === "peak"
            ? `Peak intensity — ${kgRemaining.toFixed(1)} kg to fight weight.`
            : `Week ${week} — hold pace at ${perWeekKg.toFixed(2)} kg/week.`;
    const keyMetric = phase === "fight_week" ? "Water + salt" : `−${perWeekKg.toFixed(1)} kg`;
    const dailyFocus =
      phase === "fight_week"
        ? [
            "Carbs ≤1 g/kg days -7 to -3",
            "Sodium 4-5 g, then <500 mg from day -2",
            "Water 8L → 4L → 1L → nothing",
            "Sip electrolytes post-weigh-in",
          ]
        : phase === "foundation"
          ? [
              "Weigh in 7am pre-water",
              `Hit ${macros.protein_g}g protein every day`,
              "Sleep 8h+, no screens after 10pm",
              "Log every meal as you eat it",
            ]
          : phase === "peak"
            ? [
                "Sparring + intensity stay on schedule",
                `Carbs around training, fats on rest days`,
                "Track 7-day weight trend, not daily",
                "One flexible meal per week max",
              ]
            : [
                `${targetCal} kcal target, deficit ${Math.round(deficitKcal)} kcal`,
                `${macros.protein_g}g protein split across 4 meals`,
                "Recovery day every 3rd session",
              ];
    const risk =
      phase === "peak"
        ? "Hard sparring days, fuel pre-session with 60g carbs"
        : undefined;
    // Recovery field intentionally omitted from the deterministic
    // fallback. The previous "contrast shower + 8h sleep" line
    // duplicated dailyFocus content and added no peak-week signal.
    // The LLM path may still emit a sport-specific recovery line per
    // the prompt rules; the fallback simply leaves it undefined.
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
      risk,
    };
  });

  // Derive phases array
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
    peak: "Peak",
    final: "Final Week",
    fight_week: "Fight Week",
  };
  const phaseIntent: Record<WeekPhase, string> = {
    foundation: "Lock in the rhythm. Same wake, same weigh-in, same meals.",
    build: "Steady deficit. Weeks 3-4 may stall — that's rebalancing, not failure.",
    peak: "Drive weight down hard. Toughest sessions land here.",
    final: "Hold the deficit, protect lean mass, finish strong.",
    fight_week: "Carbs → water → salt → weigh-in. Then refuel.",
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
      reason: "Deepest deficit + hardest sessions stack here. Sleep is non-negotiable.",
    },
    summary: `${targetCal} kcal/day to drop ~${perWeekKg.toFixed(2)} kg/week, hitting ${finalTarget} kg by fight day in ${daysRemaining} days. Trust the daily reps; the math handles the rest.`,
    totalWeeks: weekCount,
    weeklyLossTarget: `${perWeekKg.toFixed(2)} kg/week`,
    safetyNotes:
      "Stop and reassess if you feel persistently dizzy or sparring drops noticeably. Two-week stalls = ease the deficit by 100-200 kcal.",
    keyPrinciples: [
      `Hit ${macros.protein_g}g protein every day — protect lean mass through the cut.`,
      `Stay within ${Math.round(deficitKcal)} kcal of target. Training days closer to maintenance, rest days deeper.`,
      "Weigh in mornings, post-bathroom, before water. Track the 7-day average.",
      "Sleep 8+ hours. Under-recovery wrecks the cut faster than under-eating.",
    ],
    // fightWeek block is computed deterministically downstream by
    // buildFightWeekBundle() from bodyweight, so we don't include it
    // in the weekly-plan fallback.
  };
}

// ─── Fight-week deterministic compute ────────────────────────────────
// All numbers scale with bodyweight; no flat constants. Used as the
// authoritative source for both the `fightWeek` flat block (kept for
// the existing share card and any other backward-compat consumers)
// and the per-day `fightWeekDays` array consumed by the new
// InlinePlanDisplay day-stack UI.

type FightWeekPhase = "depletion" | "water-load" | "cut" | "weigh-in";

interface FightWeekDay {
  dayOffset: number;
  date: string;
  weekday: string;
  phase: FightWeekPhase;
  carbsGrams: number;
  proteinGrams: number;
  sodiumGrams: number;
  fluidLiters: number;
  notes: string;
  flag?: "sodium-cliff" | "fluid-cliff" | "weigh-in";
}

interface FightWeekBundle {
  days: FightWeekDay[];
  refeed: {
    carbsGPerKgFirstHr: number;
    carbsGPerKgPhase2: number;
    sodiumGPerLiterFluid: number;
    firstMeal: string;
  };
  safetyFlag?: "aggressive-cut";
  block: {
    lowCarb: string;
    sodium: string;
    waterLoading: string;
    nutrition: string;
  };
}

function buildFightWeekBundle(opts: {
  currentWeight: number;
  finalTarget: number;
  daysRemaining: number;
  targetDateISO: string;
}): FightWeekBundle {
  const bw = opts.currentWeight;
  const dropKg = +(bw - opts.finalTarget).toFixed(2);
  const pctDrop = bw > 0 ? (dropKg / bw) * 100 : 0;
  const fightWeekLen = Math.min(7, Math.max(0, opts.daysRemaining));
  const safetyFlag = pctDrop > 5 ? ("aggressive-cut" as const) : undefined;

  // Bodyweight-scaled lookups. Heavier athletes deplete deeper and
  // load more sodium because absolute volumes need bigger ranges to
  // shift the same percentage of body water.
  const sodiumLoadMgKg = bw >= 85 ? 70 : 55;

  // Carbs hold near normal through day -7/-6, then drop SHARP at day -5 to a
  // ~0.6 g/kg depletion floor (≈50 g for an 80 kg athlete), held through day
  // -3, with the final cut on -2/-1. The sharp depletion empties glycogen so
  // the water cut lands clean. Scales with bodyweight by design.
  const CARB_FLOOR_G_PER_KG = 0.6;
  const carbsGPerKg: Record<number, number> = {
    [-7]: 2.5, [-6]: 2.5, [-5]: CARB_FLOOR_G_PER_KG, [-4]: CARB_FLOOR_G_PER_KG,
    [-3]: CARB_FLOOR_G_PER_KG, [-2]: 0.3, [-1]: 0.1, 0: 0,
  };
  const sodiumMgPerKg: Record<number, number> = {
    [-7]: sodiumLoadMgKg, [-6]: sodiumLoadMgKg, [-5]: sodiumLoadMgKg, [-4]: sodiumLoadMgKg,
    [-3]: sodiumLoadMgKg * 0.7, [-2]: 12, [-1]: 4, 0: 0,
  };
  const fluidMlPerKg: Record<number, number> = {
    [-7]: 50, [-6]: 50, [-5]: 100, [-4]: 100,
    [-3]: 50, [-2]: 25, [-1]: 10, 0: 0,
  };

  const targetMs = Date.parse(opts.targetDateISO);
  const validTarget = Number.isFinite(targetMs);
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const days: FightWeekDay[] = [];
  for (let offset = -fightWeekLen; offset <= 0; offset++) {
    const phase: FightWeekPhase =
      offset === 0
        ? "weigh-in"
        : offset >= -2
          ? "cut"
          : offset >= -5
            ? "water-load"
            : "depletion";

    const carbsGrams = Math.round((carbsGPerKg[offset] ?? 0) * bw);
    const proteinGrams = Math.round(2.0 * bw);
    const sodiumGrams =
      Math.round(((sodiumMgPerKg[offset] ?? 0) * bw) / 100) / 10;
    const fluidLiters =
      Math.round(((fluidMlPerKg[offset] ?? 0) * bw) / 100) / 10;

    let notes = "";
    let flag: FightWeekDay["flag"];
    if (offset <= -6) notes = "Carbs stay near normal. Train as usual, your last full-carb days.";
    else if (offset === -5) notes = `Carbs cut sharp to the floor. Water load begins, sip ${fluidLiters} L across the day.`;
    else if (offset === -4) notes = "Hold the water volume. Carbs at the floor.";
    else if (offset === -3) notes = "Carbs at floor. Fluids begin tapering.";
    else if (offset === -2) {
      notes = "Sodium cliff: drop under 500 mg. Last hard session done.";
      flag = "sodium-cliff";
    } else if (offset === -1) {
      notes = "Sips only. Spit if needed. No food after evening meal.";
      flag = "fluid-cliff";
    } else if (offset === 0) {
      notes = "Weigh-in fasted, then refuel.";
      flag = "weigh-in";
    }

    let date = "";
    let weekday = "";
    if (validTarget) {
      const d = new Date(targetMs + offset * 86400000);
      date = d.toISOString().slice(0, 10);
      weekday = WEEKDAYS[d.getDay()];
    }

    days.push({
      dayOffset: offset,
      date,
      weekday,
      phase,
      carbsGrams,
      proteinGrams,
      sodiumGrams,
      fluidLiters,
      notes,
      flag,
    });
  }

  // Derive backward-compat flat strings from the day array so the
  // existing CutPlanCard share card keeps rendering without changes.
  const dMinus7 = days.find((d) => d.dayOffset === -7);
  const dMinus5 = days.find((d) => d.dayOffset === -5);
  const peakWater = days.reduce(
    (m, d) => (d.fluidLiters > (m?.fluidLiters ?? -1) ? d : m),
    days[0],
  );
  const sodiumLoadG = +((sodiumLoadMgKg * bw) / 1000).toFixed(1);
  const peakFluidL = peakWater?.fluidLiters ?? 0;

  const block = {
    lowCarb: `Carbs hold near ${dMinus7?.carbsGrams ?? Math.round(2.5 * bw)} g, then cut sharp to ~${dMinus5?.carbsGrams ?? Math.round(0.6 * bw)} g from day -5 and stay at the floor to day -1. Glycogen empties so the water cut lands clean.`,
    sodium: `Sodium ${sodiumLoadG} g/day days -7 to -4, then under 500 mg from day -2. The body sheds water on the cliff.`,
    waterLoading: `Peak ${peakFluidL} L around day ${peakWater?.dayOffset ?? -5}. Halve to ${Math.round((peakFluidL / 2) * 10) / 10} L by day -3. Sips on day -1. Nothing weigh-in morning.`,
    nutrition: `Post weigh-in: 1.0 g/kg/hr carbs (rice, banana) plus sodium 1.5 g per L fluid for the first 2 hours. Then 0.5 g/kg/hr until refed.`,
  };

  return {
    days,
    refeed: {
      carbsGPerKgFirstHr: 1.0,
      carbsGPerKgPhase2: 0.5,
      sodiumGPerLiterFluid: 1.5,
      firstMeal: "Rice and banana within 30 min of weigh-in.",
    },
    safetyFlag,
    block,
  };
}

// ─── Same-day final-week deterministic compute ───────────────────────
// Mirrors the FightWeekBundle shape so downstream consumers (share card,
// day-stack UI) keep working, but encodes the SAME-DAY strategy: there is
// no acute cut. Every day is a maintenance / hold-weight day with full
// carbs (>=3 g/kg), normal hydration, and NO water-load or sodium cliff.
// The "refeed" block becomes a "fuel for the fight" note (there is no
// post-weigh-in recovery window to refeed into). No aggressive-cut flag is
// ever raised here because no dehydration is prescribed.
function buildSameDayFinalWeekBundle(opts: {
  currentWeight: number;
  daysRemaining: number;
  targetDateISO: string;
}): FightWeekBundle {
  const bw = opts.currentWeight;
  const finalWeekLen = Math.min(7, Math.max(0, opts.daysRemaining));
  // Full carbs and normal sodium/fluids held flat across the final days.
  const carbsGrams = Math.round(3 * bw); // >=3 g/kg floor — never deplete
  const proteinGrams = Math.round(2.0 * bw);
  const sodiumGrams = +((35 * bw) / 1000).toFixed(1); // ~normal intake, no load
  const fluidLiters = +((40 * bw) / 1000).toFixed(1); // ~normal hydration

  const targetMs = Date.parse(opts.targetDateISO);
  const validTarget = Number.isFinite(targetMs);
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const days: FightWeekDay[] = [];
  for (let offset = -finalWeekLen; offset <= 0; offset++) {
    let date = "";
    let weekday = "";
    if (validTarget) {
      const d = new Date(targetMs + offset * 86400000);
      date = d.toISOString().slice(0, 10);
      weekday = WEEKDAYS[d.getDay()];
    }
    days.push({
      dayOffset: offset,
      date,
      weekday,
      // Same-day has no depletion/water-load/cut phases — every day is a
      // hold-weight maintenance day. We reuse "weigh-in" on the last day
      // for the UI marker and "water-load" is intentionally never used.
      phase: offset === 0 ? "weigh-in" : "cut",
      carbsGrams,
      proteinGrams,
      sodiumGrams,
      fluidLiters,
      notes:
        offset === 0
          ? "Weigh in, then eat normally and fuel for the fight. No cut, you compete on this weight."
          : "Hold weight. Eat normally, keep carbs in, hydrate as usual. No sauna, no sweat suits.",
      flag: offset === 0 ? "weigh-in" : undefined,
    });
  }

  const block = {
    lowCarb: `Keep carbs full at about ${carbsGrams} g/day. Same-day weigh-in means no recovery window, so never deplete glycogen, you fight fueled.`,
    sodium: `Keep sodium at your normal intake (around ${sodiumGrams} g/day). No sodium loading and no cliff, there is nothing to cut and recover from.`,
    waterLoading: `Hydrate normally (around ${fluidLiters} L/day). No water loading and no fluid restriction. Even 2-3% dehydration costs roughly 10% or more of your performance with no time to recover.`,
    nutrition: `Eat normally right up to the fight. After weigh-in, have a familiar, carb-forward meal you tolerate well, then top up between weigh-in and bout.`,
  };

  return {
    days,
    refeed: {
      // No depletion to refeed; these stay as gentle fueling guidance.
      carbsGPerKgFirstHr: 1.0,
      carbsGPerKgPhase2: 0.5,
      sodiumGPerLiterFluid: 1.0,
      firstMeal: "A familiar carb-forward meal you tolerate well, soon after weigh-in.",
    },
    // Same-day prescribes no dehydration, so the aggressive-cut flag is N/A.
    safetyFlag: undefined,
    block,
  };
}
