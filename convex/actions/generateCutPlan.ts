/** Generate cut plan — card-timeline shape.
 *
 *  Gating (F8): the ONLY free AI feature is the first-time plan generated
 *  during onboarding. The same action also backs non-onboarding regeneration
 *  (e.g. starting the next camp), which must stay Pro. The caller picks the
 *  gate via the `gate` arg:
 *    - "onboarding" → AI_ONBOARDING_PLAN (free)  [default]
 *    - "regenerate" → AI_CUT_PLAN (pro)
 */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqWithRetry } from "../_shared/groq";
import { CutPlanAiSchema, type WeekPhase } from "../_shared/aiSchemas";
import { mifflinStJeor, requiredDeficit, macroSplit } from "../_shared/math";
import { normaliseWeeklyPlan } from "../_shared/normalizeWeeklyPlan";
import { normalisePlanTopLevel } from "../_shared/normalizePlanTopLevel";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  FIGHT_WEEK_WATER_ML_PER_KG,
  FIGHT_WEEK_SODIUM_MG_PER_KG,
  FIGHT_WEEK_FIBRE_GRAMS,
  SAMEDAY_WATER_ML_PER_KG,
  SAMEDAY_SODIUM_MG_PER_KG,
} from "../_shared/weightProtocolMath";
import {
  loadAthleteSnapshot,
  logDecision,
  requireUserIdFromAction,
  SECOND_PERSON_DIRECTIVE,
} from "./_helpers";
import { createPostHogClient } from "../_shared/posthog";

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
    // Weigh-in timing, e.g. "day_before" | "same_day" | "morning_of" |
    // "two_hour". Drives the cut-strategy branch below: ONLY "day_before"
    // gets the carb-depletion + water cut. Every other value HOLDS carbs and
    // uses a sodium-taper + low-residue (fibre) + light-water final week.
    // Absent / undefined → "day_before" (preserves historical behavior).
    weighInTiming: v.optional(v.string()),
    // Which feature gate to enforce. Onboarding's first-time generation is the
    // only free AI path; everything else (next-camp regeneration, any future
    // caller) is Pro. FAIL-CLOSED: only an explicit `gate: "onboarding"` gets
    // the free gate; omitted/unknown defaults to the Pro gate.
    gate: v.optional(
      v.union(v.literal("onboarding"), v.literal("regenerate")),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    // Gate: explicit onboarding → free (AI_ONBOARDING_PLAN); anything else →
    // Pro (AI_CUT_PLAN). Fail-closed so a new call site can't accidentally
    // open a free AI path.
    await enforceFeatureGate(
      ctx,
      userId,
      args.gate === "onboarding" ? "AI_ONBOARDING_PLAN" : "AI_CUT_PLAN",
    );
    const snap = await loadAthleteSnapshot(ctx, userId);
    // Canonical weigh-in timing. The carb-DEPLETION protocol (glycogen empty +
    // water load/cut) only makes sense when there is a recovery window between
    // the weigh-in and the bout — i.e. "day_before". For EVERY other value
    // (same_day, morning_of, two_hour, unknown, …) carbs are HELD and the final
    // week is a sodium-taper + low-residue (fibre) protocol with light water
    // manipulation. A missing/undefined value defaults to "day_before" so legacy
    // callers keep the managed acute-cut behavior, but the app always passes a
    // value, so a non-day-before pick reliably routes to the carb-hold strategy.
    const isDayBefore = (args.weighInTiming ?? "day_before") === "day_before";
    // Carbs are held (no glycogen depletion) for anything that is NOT day_before.
    const holdCarbs = !isDayBefore;
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
    // Carb-hold (any non-day_before weigh-in): there is NO post-weigh-in
    // recovery window worth depleting for, so we must never empty glycogen.
    // Floor carbohydrates at >=3 g/kg bodyweight (ISSN 2025) — overriding the
    // deficit-driven remainder if it would dip below that. day_before keeps the
    // unchanged cut macro logic and depletes carbs in fight week.
    const heldCarbFloorG = Math.round(args.currentWeight * 3);
    const macros = holdCarbs
      ? { ...baseMacros, carb_g: Math.max(baseMacros.carb_g, heldCarbFloorG) }
      : baseMacros;

    // ── Carb-hold context (only meaningful when holdCarbs / !isDayBefore) ──
    // How much of bodyweight the athlete would need to shed to reach the
    // target, and whether the timeline is long enough for a true
    // body-composition descent. These steer the carb-hold edge cases:
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

    // CARB-HOLD weigh-in (anything that is NOT day_before: same_day, morning_of,
    // two_hour, …). There is NO usable recovery window, so carb depletion AND a
    // water cut are both WRONG here — dehydration carried into a same-day bout
    // costs performance you can't get back. Carbs are HELD so glycogen stays
    // full, and the athlete is kept WATER-NEUTRAL. Any last sliver of weight is
    // made with the GUT and a light taper: a SODIUM TAPER + LOW-RESIDUE (low
    // fibre) protocol with NEAR-NORMAL water (no loading, no flush). No sauna /
    // sweat suit. Rules are ISSN position stand; tone is plain and safety-first.
    const HOLD_CARBS_PROMPT = `You are an evidence-based combat-sports nutritionist building a card-based plan for an athlete whose weigh-in leaves NO usable recovery window before they compete (it is not the day before). Output ONLY valid JSON matching the schema. Use the deterministic numbers below verbatim — never invent calories or macros that contradict them.

${SECOND_PERSON_DIRECTIVE}

USER STRUGGLE: ${primaryStruggle ?? "unspecified"}
You MUST address this struggle directly in \`personalNote\` (1-2 sentences, ≤280 chars) and weave one mitigating tactic into the relevant week's \`dailyFocus\` bullets.

CARB-HOLD WEIGH-IN STRATEGY (this OVERRIDES any acute carb-depletion water-cut you know):
1. Build the whole plan around GRADUAL body-composition change done EARLY in the timeline. The final days are a HOLD plus light training, NOT a glycogen depletion. There is no fight-week carb cut and no refuel window to deplete for.
2. KEEP CARBOHYDRATES throughout. Never deplete glycogen. Hold carbs at >=3 g/kg/day right through the descent and right up to competition — the athlete competes on the weight they make, fueled.
3. Make any final-week weight with the GUT, never with carbs or a water cut. Use a SODIUM TAPER (ease sodium down over the last ~2 days) and a LOW-RESIDUE / LOW-FIBRE diet from about day -4 to empty the gut. Keep water NEAR NORMAL — a small trim on the last day at most, no water load and no fluid restriction.
4. Explain WHY plainly: even ~2-3% dehydration costs roughly >=10% performance, and with no recovery window that loss is carried straight into the fight. Holding carbs and emptying the gut with fibre/sodium is the performance-safe way to make weight here, not depleting glycogen or cutting water.
5. Treat the fight-week target as essentially AT goal weight (within ~1-2%). The last days hold weight steady with sodium + fibre + near-normal water, they do not chase a number with a carb or water cut.
${sameDayEdgeCases}Per week, return:
- \`phase\`: one of foundation | build | peak | final | fight_week (the LAST week MUST be fight_week). Treat fight_week as a HELD-CARB week — full carbs, a sodium taper + low-residue food on the last days, near-normal water. It is NOT a carb-depletion or water-cut week and uses NO sauna/sweat cutting.
- \`heroLine\`: ≤80 chars, ONE memorable sentence.
- \`keyMetric\`: ≤24 chars headline (e.g. "−0.4 kg", "Carbs 3 g/kg").
- \`dailyFocus\`: 3-5 bullets, each ≤60 chars, imperative voice. NO PARAGRAPHS. The final-week bullets MUST reflect holding carbs, tapering sodium, low-residue/low-fibre food, and near-normal water — never carb depletion or water/sweat manipulation.
- \`risk\` / \`recovery\`: ≤80 chars each, optional.

Also return:
- \`phases[]\`: 2-3 macro phases with name + label + weekStart + weekEnd + 1-line \`intent\` (≤120 chars).
- \`toughestWeek\`: { week, reason ≤120 chars }.
- \`personalNote\`: 10-280 chars, references the struggle above.
- \`summary\`: ≤500 chars, ONE paragraph max. MUST state plainly that there is no recovery window so there is no carb depletion and no water cut — carbs are held and the final week uses a sodium taper, low-residue food, and near-normal water, with no sauna/sweat suits.
- \`safetyNotes\`: ≤300 chars. MUST include the no-sauna / no-sweat-suit / no-fluid-restriction warning and the ~2-3% dehydration ≈ >=10% performance-loss rationale.
- \`keyPrinciples\`: 3-5 short rules, each ≤120 chars — center them on held carbs, sodium taper, low-residue/low-fibre, near-normal water, gradual early change, and no glycogen depletion.

BANNED: any sauna / sweat suit / hot bath / water-load / water cut / carb-driven sodium-cliff / fluid-restriction guidance, glycogen depletion, paragraph-length focus strings, motivational fluff, repeating numbers already in \`calories\`/\`protein_g\`, generic advice that ignores the user struggle above, em-dashes (—) or en-dashes (–) anywhere in the output — use commas or periods instead.
For \`recovery\` field (optional, per-week): omit unless you have a sport-specific, dose-and-timing directive. Do NOT emit generic wellness lines.

DETERMINISTIC FACTS:
- BMR: ${bmr}, maintenance: ${maintenanceCal}, target: ${targetCal} kcal
- Macros: ${macros.protein_g}P / ${macros.carb_g}C / ${macros.fat_g}F (carbs HELD at >=3 g/kg — do NOT cut below this)
- Weeks: ${weekCount}, days remaining: ${days}
- Starting weight: ${args.currentWeight}kg, target: ${finalTarget}kg (drop ≈ ${pctDrop.toFixed(1)}% of bodyweight)

${snap.block}`;

    const systemPrompt = holdCarbs ? HOLD_CARBS_PROMPT : DAY_BEFORE_PROMPT;

    let aiResult: any = null;
    try {
      aiResult = await callGroqWithRetry({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: holdCarbs
              ? `Generate a ${weekCount}-week carb-HOLD plan for an athlete going from ${args.currentWeight}kg toward ${finalTarget}kg in ${days} days whose weigh-in leaves no recovery window. Gradual body-composition change done early, full carbs (>=3 g/kg) held all the way to competition, and a final week that makes any last weight with a sodium taper, low-residue/low-fibre food on the last days, and near-normal water — never carb depletion, never a water cut, never sauna/sweat. Structured per-week cards with heroLine + dailyFocus bullets, personalNote tied to the struggle, toughestWeek call-out, and a summary + safetyNotes that spell out the held-carbs / sodium+fibre / near-normal-water / no-sauna rationale. The fightWeek numeric block is computed server-side, so do not emit it.`
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
    // CARB-HOLD: no glycogen depletion AND no water cut, so the day-stack HOLDS
    // carbs flat and stays WATER-NEUTRAL — a light sodium + low-residue/fibre
    // taper with near-normal water, rather than the day-before carb-depletion +
    // water-load + flush timeline. No sauna/sweat cutting.
    const fightWeekBundle = holdCarbs
      ? buildHeldCarbFinalWeekBundle({
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

    // CARB-HOLD narrative guarantee: the educational messaging (carbs held,
    // sodium taper + low-residue/fibre + near-normal water instead of depletion
    // or a water cut, ~2-3% dehydration ≈ >=10% performance loss, no sauna/sweat,
    // move-up-a-class when the cut is too big) must appear even when the LLM call
    // fails and we fall through to the deterministic fallback. Override the
    // narrative fields rather than trusting normalisePlanTopLevel's output.
    const holdCarbsNarrative = holdCarbs
      ? {
          summary: alreadyAtGoal
            ? `Your weigh-in leaves no recovery window and you are already at or under ${finalTarget} kg. No cut needed: hold your weight, keep carbs and fluids normal, train and recover into the fight.`
            : dropTooBig || shortTimeline
              ? `No recovery window after this weigh-in. Reaching ${finalTarget} kg would need about ${pctDrop.toFixed(0)}% of bodyweight, which is not safe to do without dehydration you cannot recover from before you fight. Strongly consider moving up a weight class. If you proceed, change weight gradually and early, hold full carbs, and make any last weight with a sodium taper, low-residue food, and near-normal water. Never use a sauna or sweat suit.`
              : `No recovery window means you fight on the weight you make, so you never deplete carbs or cut water. Drop weight gradually and early, hold carbs at or above ${heldCarbFloorG} g/day, and make any final weight with a sodium taper, low-residue/low-fibre food on the last days, and near-normal water. No sauna, sweat suits, or fluid restriction.`,
          safetyNotes: `Do NOT use a sauna, sweat suit, hot bath, or fluid restriction to make weight. Even 2-3% dehydration cuts performance by roughly 10% or more, and with no recovery window you carry that straight into the fight. Keep carbs in, taper sodium and fibre to empty the gut, and stay close to normally hydrated.`,
          keyPrinciples: [
            `Hold carbohydrates at or above ${heldCarbFloorG} g/day. Never deplete glycogen, you compete fueled.`,
            "Make final weight with a sodium taper and low-residue/low-fibre food, not a carb cut.",
            "Keep water near normal: a small taper at most. No water load, no flush, no sauna, no fluid restriction.",
            "If the limit needs more than ~5% loss or any real dehydration, move up a weight class instead.",
          ],
        }
      : {};

    const plan = {
      weeklyPlan,
      ...topLevel,
      ...holdCarbsNarrative,
      weighInTiming: holdCarbs ? (args.weighInTiming ?? "same_day") : "day_before",
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

    const posthog = createPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: userId,
        event: "cut plan generated",
        properties: {
          gate: args.gate ?? "onboarding",
          weigh_in_timing: args.weighInTiming ?? "day_before",
          hold_carbs: holdCarbs,
          week_count: weekCount,
          model: aiResult ? "openai/gpt-oss-120b" : "deterministic-fallback",
        },
      });
      await posthog.shutdown();
    }

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
    // The week before fight week is the single "final" cut week.
    if (weekCount >= 3 && i === weekCount - 2) return "final";
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
  /** Deterministic per-day fibre target in grams (low-residue taper). Surfaced
   *  as its own chip so the gut-emptying tactic is visible, not buried in notes. */
  fibreGrams: number;
  notes: string;
  // "water-load" / "flush" mark the validated water-loading curve (shared by
  // BOTH paths). "sodium-cliff" / "fluid-cliff" are legacy day_before markers.
  // "low-residue" marks the gut taper. "weigh-in" marks the final day.
  flag?:
    | "water-load"
    | "flush"
    | "sodium-cliff"
    | "fluid-cliff"
    | "sodium-taper"
    | "low-residue"
    | "weigh-in";
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

  // Carbs hold near normal through day -7/-6, then drop SHARP at day -5 to a
  // ~0.6 g/kg depletion floor (≈50 g for an 80 kg athlete), held through day
  // -3, with the final cut on -2/-1. The sharp depletion empties glycogen so
  // the water cut lands clean. Scales with bodyweight by design. (Day-before
  // ONLY — the carb-hold path never touches these.)
  const CARB_FLOOR_G_PER_KG = 0.6;
  const carbsGPerKg: Record<number, number> = {
    [-7]: 2.5, [-6]: 2.5, [-5]: CARB_FLOOR_G_PER_KG, [-4]: CARB_FLOOR_G_PER_KG,
    [-3]: CARB_FLOOR_G_PER_KG, [-2]: 0.3, [-1]: 0.1, 0: 0,
  };
  // Water / sodium / fibre come from the SHARED canonical curve (Reale 2018)
  // keyed by days-to-weigh-in (= -offset), so this matches the fight-week
  // skeleton and the carb-hold bundle to the gram. Validated water-load: normal
  // ~40 mL/kg out to T-5, 100 mL/kg load T-4..T-2, sharp flush 15 mL/kg at T-1,
  // sip 5 mL/kg weigh-in morning.
  const waterMlForOffset = (offset: number): number =>
    FIGHT_WEEK_WATER_ML_PER_KG[-offset] ?? 40;
  const sodiumMgKgForOffset = (offset: number): number =>
    FIGHT_WEEK_SODIUM_MG_PER_KG[-offset] ?? 35;
  const fibreGForOffset = (offset: number): number =>
    FIGHT_WEEK_FIBRE_GRAMS[-offset] ?? 30;

  const targetMs = Date.parse(opts.targetDateISO);
  const validTarget = Number.isFinite(targetMs);
  const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  const days: FightWeekDay[] = [];
  for (let offset = -fightWeekLen; offset <= 0; offset++) {
    // Phase tracks the validated water curve: load runs T-4..T-2, the flush
    // (sharp water cut) lands on T-1, T-5 and earlier are the depletion lead-in.
    const phase: FightWeekPhase =
      offset === 0
        ? "weigh-in"
        : offset === -1
          ? "cut"
          : offset >= -4
            ? "water-load"
            : "depletion";

    const carbsGrams = Math.round((carbsGPerKg[offset] ?? 0) * bw);
    const proteinGrams = Math.round(2.0 * bw);
    const sodiumGrams =
      Math.round((sodiumMgKgForOffset(offset) * bw) / 100) / 10;
    const fluidLiters =
      Math.round((waterMlForOffset(offset) * bw) / 100) / 10;
    const fibreGrams = fibreGForOffset(offset);

    let notes = "";
    let flag: FightWeekDay["flag"];
    if (offset <= -6) {
      notes = "Carbs near normal. Train as usual, your last full-carb days.";
    } else if (offset === -5) {
      notes = "Carbs cut sharp to the floor. Start low-residue food. Hydration still normal.";
    } else if (offset === -4) {
      notes = `Water load begins: drink ~${fluidLiters} L across the day. Carbs at the floor.`;
      flag = "water-load";
    } else if (offset === -3) {
      notes = `Hold the water load (~${fluidLiters} L). Low-residue food to empty the gut.`;
      flag = "water-load";
    } else if (offset === -2) {
      notes = `Final load day (~${fluidLiters} L). Carbs and fibre at the floor.`;
      flag = "water-load";
    } else if (offset === -1) {
      notes = `Flush: water drops to ~${fluidLiters} L and sodium to the floor. This is where the water comes off. No food after the evening meal.`;
      flag = "flush";
    } else if (offset === 0) {
      notes = "Weigh-in, then refuel and rehydrate hard.";
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
      fibreGrams,
      notes,
      flag,
    });
  }

  // Derive backward-compat flat strings from the day array so the
  // existing CutPlanCard share card keeps rendering without changes.
  const dMinus7 = days.find((d) => d.dayOffset === -7);
  const dMinus5 = days.find((d) => d.dayOffset === -5);
  const loadDay = days.find((d) => d.dayOffset === -3) ?? days[0];
  const flushDay = days.find((d) => d.dayOffset === -1);
  const peakFluidL = loadDay?.fluidLiters ?? 0;
  const flushFluidL = flushDay?.fluidLiters ?? 0;

  const block = {
    lowCarb: `Carbs hold near ${dMinus7?.carbsGrams ?? Math.round(2.5 * bw)} g, then cut sharp to ~${dMinus5?.carbsGrams ?? Math.round(0.6 * bw)} g from day -5 and stay at the floor to day -1. Glycogen empties so the water cut lands clean.`,
    sodium: `Keep sodium steady through the water-load days, then drop it to the floor on the day -1 flush. Low sodium WHILE loading is unsafe, so the cut waits for the flush.`,
    waterLoading: `Load ~${peakFluidL} L/day on days -4 to -2, then flush hard to ~${flushFluidL} L on day -1. The sharp drop, not the volume, is what sheds the water. A sip only on weigh-in morning.`,
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

// ─── Carb-HOLD final-week deterministic compute ──────────────────────
// Mirrors the FightWeekBundle shape so downstream consumers (share card,
// day-stack UI) keep working, but encodes the carb-HOLD strategy used for
// any weigh-in that is NOT day_before (same_day, morning_of, two_hour, …):
// there is no usable recovery window, so we NEVER deplete glycogen and we keep
// the athlete WATER-NEUTRAL — dehydration carried into a same-day bout costs
// performance you can't recover. Carbs are HELD at ~3 g/kg and protein at ~2.0
// g/kg every day. Any last sliver of weight is made with the GUT and a light
// taper, never with carbs or a water cut:
//   - WATER stays near-normal (~40 mL/kg) with only a small trim on the last
//     day — NO water loading and NO flush (SAMEDAY_WATER_ML_PER_KG).
//   - SODIUM eases down gently over the final ~2 days (SAMEDAY_SODIUM_MG_PER_KG)
//     — a taper, never a loading spike or a cliff.
//   - LOW-RESIDUE / LOW-FIBRE (shared FIGHT_WEEK_FIBRE_GRAMS) to empty the gut.
//   - NO sauna / sweat suit / fluid restriction.
// The "refeed" block is a "you held carbs, just rehydrate + re-salt" note —
// there is no glycogen to refeed and no flush deficit to chase down.
function buildHeldCarbFinalWeekBundle(opts: {
  currentWeight: number;
  daysRemaining: number;
  targetDateISO: string;
}): FightWeekBundle {
  const bw = opts.currentWeight;
  const finalWeekLen = Math.min(7, Math.max(0, opts.daysRemaining));
  // Carbs and protein held flat across the final days — never deplete.
  const carbsGrams = Math.round(3 * bw); // >=3 g/kg floor — held, not cut
  const proteinGrams = Math.round(2.0 * bw);

  // WATER-NEUTRAL: water + sodium come from the SAMEDAY_* curves (near-normal
  // water, light sodium taper — NO loading, NO flush). Fibre is the SAME shared
  // low-residue taper as the day-before plan. Keyed by days-to-weigh-in (= -offset).
  const waterMlForOffset = (offset: number): number =>
    SAMEDAY_WATER_ML_PER_KG[-offset] ?? 40;
  const sodiumMgKgForOffset = (offset: number): number =>
    SAMEDAY_SODIUM_MG_PER_KG[-offset] ?? 35;
  const fibreGForOffset = (offset: number): number =>
    FIGHT_WEEK_FIBRE_GRAMS[-offset] ?? 30;

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

    const sodiumGrams =
      Math.round((sodiumMgKgForOffset(offset) * bw) / 100) / 10;
    const fluidLiters =
      Math.round((waterMlForOffset(offset) * bw) / 100) / 10;
    const fibreGrams = fibreGForOffset(offset);

    // No depletion / water-load phases. Earlier days are a steady HOLD; the
    // last days are a light low-residue/sodium taper; offset 0 is weigh-in.
    const phase: FightWeekPhase = offset === 0 ? "weigh-in" : "cut";

    let notes: string;
    let flag: FightWeekDay["flag"];
    if (offset === 0) {
      notes =
        "Weigh in, then rehydrate and re-salt. You held your carbs, so there is no refeed, just top fluids and sodium back up and fuel for the fight.";
      flag = "weigh-in";
    } else if (offset === -1) {
      notes =
        "Low-residue food today, drop fibre to empty the gut. Ease sodium and keep water near normal. Carbs stay held. No sauna.";
      flag = "low-residue";
    } else if (offset === -2) {
      notes =
        "Start low-residue eating and begin easing sodium down. Carbs stay held, hydration stays near normal.";
      flag = "sodium-taper";
    } else {
      notes =
        "Hold weight. Keep carbs in, eat normally, hydrate as usual. No sauna, no sweat suits.";
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
      fibreGrams,
      notes,
      flag,
    });
  }

  const lastDay = days[days.length - 1];
  const taperDay = days.find((d) => d.dayOffset === -1) ?? lastDay;
  const normalDay = days.find((d) => d.dayOffset <= -3) ?? days[0];

  const block = {
    lowCarb: `Keep carbs HELD at about ${carbsGrams} g/day right through fight week. With no recovery window after weigh-in, you never deplete glycogen, you fight fueled.`,
    sodium: `Keep sodium near normal early in the week (around ${normalDay.sodiumGrams} g/day), then ease it down over the last 2 days (to around ${taperDay.sodiumGrams} g) to shed a little water. This is a gentle taper, not a cliff, re-salt after weigh-in.`,
    waterLoading: `Hydrate near normal (around ${normalDay.fluidLiters} L/day), with only a light trim on the last day (around ${taperDay.fluidLiters} L). No water loading and no fluid restriction. Even 2-3% dehydration costs roughly 10% or more of your performance with no time to recover.`,
    nutrition: `Make any last weight with the gut, not with carbs or water: eat low-residue / low-fibre food on the final days to empty the digestive tract. After weigh-in, rehydrate, re-salt, and have a familiar carb-forward meal you tolerate well.`,
  };

  return {
    days,
    refeed: {
      // No glycogen to refeed — this is rehydrate + re-salt guidance.
      carbsGPerKgFirstHr: 0,
      carbsGPerKgPhase2: 0,
      sodiumGPerLiterFluid: 1.0,
      firstMeal:
        "You held your carbs, so just rehydrate and re-salt: fluids with ~1 g sodium per litre, then a familiar carb-forward meal you tolerate well.",
    },
    // No meaningful dehydration is prescribed, so the aggressive-cut flag is N/A.
    safetyFlag: undefined,
    block,
  };
}
