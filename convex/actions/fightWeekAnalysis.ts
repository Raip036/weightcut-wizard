/** Fight-week analysis — deterministic engine + LLM narrative. Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { callGroqText, GroqError } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { requireUserIdFromAction, logDecision, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { createPostHogClient } from "../_shared/posthog";
import {
  computeFightWeekProjection,
  estimateSaunaSessions,
  type FightWeekDayProjection,
  type FightWeekProjection,
} from "../_shared/fightWeekMath";

interface DehydrationTactic {
  method: "dry_sauna" | "hot_bath" | "active_sweat" | "sauna_suit";
  session: string;
  expectedLossKg: number;
  daysOut: number;
  safetyNote: string;
}

interface PostWeighInData {
  targetRegainKg: number;
  fluidPlan: string;
  carbPlan: string;
  sodiumPlan: string;
  caffeineNote: string | null;
}

interface FightWeekAIPlan {
  summary: string;
  riskLevel: "green" | "orange" | "red";
  safetyWarning: string | null;
  breakdown: FightWeekProjection["breakdown"];
  dehydration: FightWeekProjection["dehydration"];
  timeline: FightWeekDayProjection[];
  dehydrationTactics: DehydrationTactic[];
  postWeighIn: PostWeighInData;
  medicalRedFlags: string[];
}

function buildPostWeighIn(currentWeight: number, dehydrationNeeded: number): PostWeighInData {
  const targetRegainKg = parseFloat(Math.max(0, dehydrationNeeded * 1.5).toFixed(2));
  const fluidMl = Math.round(targetRegainKg * 1000);
  const sodiumMg = Math.round(targetRegainKg * 1000);
  const carbsG = Math.min(Math.round(currentWeight * 8), 600);
  return {
    targetRegainKg,
    fluidPlan: `Drink ${fluidMl} ml fluid over the recovery window. Start with 500 ml ORS in the first 30 min, then ${Math.round(fluidMl / 6)} ml every 30 min.`,
    carbPlan: `Eat ${carbsG}g carbs (white rice, banana, honey, sports drinks). Split across 4-5 meals to avoid GI distress.`,
    sodiumPlan: `Target ${sodiumMg} mg sodium total. Use ORS, salted broth, or pickle juice. Aim for 1 g sodium per litre of fluid.`,
    caffeineNote: `Caffeine ${Math.round(currentWeight * 3)}-${Math.round(currentWeight * 6)} mg 60 min before the fight.`,
  };
}

function buildDehydrationTactics(dehydrationNeeded: number, currentWeight: number): DehydrationTactic[] {
  if (dehydrationNeeded <= 0) return [];
  const sessions = estimateSaunaSessions(dehydrationNeeded, currentWeight);
  const perSauna = Math.min(0.8, dehydrationNeeded / Math.max(1, sessions));
  const tactics: DehydrationTactic[] = [
    {
      method: "dry_sauna",
      session: `${sessions} x 4 rounds of 10 min at 85-90C`,
      expectedLossKg: parseFloat((perSauna * sessions).toFixed(2)),
      daysOut: 1,
      safetyNote: "Re-hydrate ~150 ml between rounds. Stop immediately on dizziness or HR > 170.",
    },
  ];
  if (dehydrationNeeded > 1.2) {
    tactics.push({
      method: "hot_bath",
      session: "2 x 20 min at 40C, 10 min recovery between",
      expectedLossKg: parseFloat(Math.min(0.6, dehydrationNeeded * 0.2).toFixed(2)),
      daysOut: 1,
      safetyNote: "Wrap in towels post-bath to sustain sweat. Monitor for orthostatic dizziness.",
    });
  }
  if (dehydrationNeeded > 2) {
    tactics.push({
      method: "sauna_suit",
      session: "20-30 min light shadowboxing in sauna suit",
      expectedLossKg: parseFloat(Math.min(0.5, dehydrationNeeded * 0.15).toFixed(2)),
      daysOut: 1,
      safetyNote: "Keep heart rate under 140 bpm. Stop if cramping or weakness.",
    });
  }
  return tactics;
}

function defaultMedicalRedFlags(): string[] {
  return [
    "Sustained heart rate above 170 bpm at rest — stop and rehydrate.",
    "Cramping, dizziness, or confusion — stop the cut and seek medical help.",
    "Urine becomes dark amber and stays dark after 30 min of fluid — kidney stress.",
    "Cannot keep fluids down post weigh-in — medical attention required.",
  ];
}

function deterministicSummary(p: FightWeekProjection, daysOut: number, currentWeight: number, target: number): string {
  const totalKg = p.breakdown.totalToCut;
  if (totalKg <= 0) {
    return `You are at or below ${target} kg with ${daysOut} day${daysOut === 1 ? "" : "s"} to weigh-in. Hold weight, prioritise glycogen restoration, and keep training light.`;
  }
  const dehydPart = p.breakdown.dehydrationNeeded > 0
    ? ` ${p.breakdown.dehydrationNeeded.toFixed(1)} kg of that needs to come from dehydration on the final 24h.`
    : " The full cut can come from diet without dehydration.";
  return `Cut ${totalKg.toFixed(1)} kg over ${daysOut} day${daysOut === 1 ? "" : "s"} from ${currentWeight.toFixed(1)} kg to ${target.toFixed(1)} kg.${dehydPart} Risk level: ${p.riskLevel}.`;
}

export const run = action({
  args: {
    currentWeightKg: v.optional(v.number()),
    targetWeightKg: v.optional(v.number()),
    daysUntilWeighIn: v.optional(v.number()),
    normalDailyCarbsG: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_FIGHT_WEEK_ANALYSIS");

    const data = await ctx.runQuery(internal.actions_internal.fetchFightWeekData, { userId });
    const camp = data.upcomingCamp;
    const profile = data.profile;

    // Resolve inputs in priority order: explicit client args > camp record > profile > recent weight log.
    const currentWeight =
      args.currentWeightKg ??
      data.weight14d[0]?.weight_kg ??
      camp?.starting_weight_kg ??
      profile?.current_weight_kg ??
      null;

    const targetWeighIn =
      args.targetWeightKg ??
      profile?.fight_week_target_kg ??
      profile?.goal_weight_kg ??
      null;

    const daysOut = (() => {
      if (args.daysUntilWeighIn != null && args.daysUntilWeighIn > 0) {
        return Math.max(1, Math.round(args.daysUntilWeighIn));
      }
      if (camp?.fight_date) {
        return Math.max(
          1,
          Math.ceil((new Date(camp.fight_date).getTime() - Date.now()) / 86400000),
        );
      }
      return 7; // sensible default — a week out
    })();

    if (currentWeight == null || targetWeighIn == null) {
      return {
        ok: false as const,
        reason: "Enter your current weight and weigh-in target to generate a fight-week plan.",
      };
    }

    const projection = computeFightWeekProjection({
      currentWeight,
      targetWeighIn,
      daysUntilWeighIn: daysOut,
      sex: profile?.sex === "female" ? "female" : "male",
    });

    const postWeighIn = buildPostWeighIn(currentWeight, projection.breakdown.dehydrationNeeded);
    const dehydrationTactics = buildDehydrationTactics(
      projection.breakdown.dehydrationNeeded,
      currentWeight,
    );

    // ── LLM narrative pass (Llama 3.1 8B, fast) ──────────────────────────
    let summary = deterministicSummary(projection, daysOut, currentWeight, targetWeighIn);
    let medicalRedFlags = defaultMedicalRedFlags();
    let timelineNotes: Record<number, string> = {};
    let llmError: string | null = null;

    const systemPrompt = `You are a JSON API. Return ONLY:
{ "summary": "string (3-4 sentences, plain English, no em dashes)",
  "timelineNotes": [{ "day": -3, "note": "string max 18 words" }],
  "medicalRedFlags": ["string", "string", "string"] }

${SECOND_PERSON_DIRECTIVE}

Numbers are already computed; do NOT alter them. Address the user directly ("your weigh-in", "you'll need...") in every string. Concise, no fluff.`;

    const campLine = camp
      ? `Your camp: ${camp.name}. Fight ${camp.fight_date} (${daysOut} days out).`
      : `${daysOut} days until your weigh-in (no camp record).`;
    const carbLine = args.normalDailyCarbsG
      ? `Your normal daily carbs: ${args.normalDailyCarbsG}g.`
      : "";
    const userPrompt = `${campLine}
Start ${currentWeight}kg, target ${targetWeighIn}kg, cut ${projection.breakdown.totalToCut.toFixed(1)}kg (${projection.breakdown.percentBW.toFixed(1)}% BW).
Risk: ${projection.riskLevel}. Dehydration needed: ${projection.breakdown.dehydrationNeeded.toFixed(1)}kg.
${carbLine}

Recent fight-week logs:
${data.fightWeekLogs.slice(0, 5).map((l: { log_date: string; weight_kg?: number | null; fluid_intake_ml?: number | null; carbs_g?: number | null }) => `${l.log_date}: ${l.weight_kg ?? "?"}kg, fluid ${l.fluid_intake_ml ?? "?"}ml, carbs ${l.carbs_g ?? "?"}g`).join("\n") || "(none)"}

Days to comment on: ${projection.timeline.map((d) => d.day).join(", ")}.`;

    try {
      const content = await callGroqText({
        // Heavy-tier model — fight-week analysis spans a multi-day
        // projection and needs accurate, structured reasoning. The same
        // model runs on both providers (OPENROUTER_MODEL_MAP keeps it as
        // gpt-oss-120b); OpenRouter just routes it to the fastest backend.
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        timeoutMs: 20000,
      });
      const parsed = parseJSON<Record<string, unknown>>(content);
      if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
        summary = String(parsed.summary).replace(/—/g, " - ").replace(/–/g, "-").trim();
      }
      if (Array.isArray(parsed.medicalRedFlags) && parsed.medicalRedFlags.length > 0) {
        medicalRedFlags = (parsed.medicalRedFlags as unknown[])
          .slice(0, 6)
          .map((s: unknown) => String(s).replace(/—/g, " - ").trim())
          .filter((s: string) => s.length > 0);
        if (medicalRedFlags.length === 0) medicalRedFlags = defaultMedicalRedFlags();
      }
      if (Array.isArray(parsed.timelineNotes)) {
        for (const tn of parsed.timelineNotes as Array<{ day?: unknown; note?: unknown }>) {
          if (typeof tn.day === "number" && typeof tn.note === "string") {
            timelineNotes[tn.day] = tn.note.replace(/—/g, " - ").trim();
          }
        }
      }
    } catch (err) {
      if (err instanceof GroqError && err.code === "AI_AUTH") throw err;
      llmError = err instanceof Error ? err.message : String(err);
    }

    // Merge AI notes into deterministic timeline.
    const timeline = projection.timeline.map((d) => ({
      ...d,
      notes: timelineNotes[d.day] || d.notes,
    }));

    const plan: FightWeekAIPlan = {
      summary,
      riskLevel: projection.riskLevel,
      safetyWarning: projection.safetyWarning,
      breakdown: projection.breakdown,
      dehydration: projection.dehydration,
      timeline,
      dehydrationTactics,
      postWeighIn,
      medicalRedFlags,
    };

    const posthog = createPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: userId,
        event: "fight week analyzed",
        properties: {
          risk_level: plan.riskLevel,
          total_to_cut_kg: projection.breakdown.totalToCut,
          dehydration_needed_kg: projection.breakdown.dehydrationNeeded,
          llm_error: llmError ?? null,
        },
      });
      await posthog.shutdown();
    }

    await logDecision(ctx, {
      userId,
      feature: "fight-week-analysis",
      inputSnapshot: {
        currentWeight,
        targetWeighIn,
        daysOut,
        campId: camp?.id ?? null,
        clientArgs: args,
        llmError,
      },
      outputJson: plan,
      predictionFacts: {
        total_to_cut_kg: projection.breakdown.totalToCut,
        dehydration_needed_kg: projection.breakdown.dehydrationNeeded,
      },
      model: "openai/gpt-oss-120b",
    });

    return { plan };
  },
});
