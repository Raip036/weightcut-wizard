/** Rehydration protocol — deterministic numerics + LLM narrative. Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText, GroqError } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { requireUserIdFromAction, logDecision, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  buildDeterministicRehydration,
  DEFAULT_WARNINGS,
} from "../_shared/rehydrationMath";

interface HourlyStepFull {
  hour: number;
  phase: string;
  fluidML: number;
  sodiumMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  carbsG: number;
  drinkRecipe?: string;
  notes?: string;
  foods?: string[];
}

interface MealPlan {
  timing: string;
  carbsG: number;
  foods: string[];
  rationale: string;
}

interface RehydrationProtocolShape {
  summary: string;
  totals: ReturnType<typeof buildDeterministicRehydration>["totals"];
  hourlyProtocol: HourlyStepFull[];
  electrolyteRatio: { sodium: string; potassium: string; magnesium: string };
  carbRefuelPlan: {
    strategy: string;
    meals: MealPlan[];
    targetCarbsG: number;
    maxCarbsPerHour: number;
  };
  warnings: string[];
}

function defaultCarbRefuel(totalCarbsG: number): { strategy: string; meals: MealPlan[] } {
  const halfWindow = Math.round(totalCarbsG * 0.45);
  return {
    strategy: `Spread ${totalCarbsG}g of fast carbs across 4-5 meals. Prioritise low-fibre, low-fat sources. Pair with fluids for rehydration.`,
    meals: [
      {
        timing: "0-1h post weigh-in",
        carbsG: Math.round(halfWindow * 0.5),
        foods: ["White rice (200g cooked)", "Banana", "Sports drink (500ml)"],
        rationale: "Rapid glucose + potassium restores plasma volume and starts glycogen refill.",
      },
      {
        timing: "2-4h post weigh-in",
        carbsG: Math.round(halfWindow * 0.5),
        foods: ["White bread + honey", "Rice cakes", "Sweetened milk (500ml)"],
        rationale: "Sustained glycogen restoration. Milk adds protein for satiety.",
      },
      {
        timing: "Final meal (2-3h pre-fight)",
        carbsG: Math.max(40, Math.round(totalCarbsG * 0.15)),
        foods: ["White rice + sea salt", "Banana", "Honey"],
        rationale: "Top-up glycogen and sodium without GI burden. Avoid fibre and fat.",
      },
    ],
  };
}

function deterministicSummary(totals: ReturnType<typeof buildDeterministicRehydration>["totals"]): string {
  return `Replace ${totals.totalFluidLitres.toFixed(1)}L of fluid with ${totals.totalSodiumMg}mg sodium and ${totals.totalCarbsG}g carbs across ${totals.rehydrationWindowHours}h. Start aggressive in hours 1-2, taper in the final pre-comp window.`;
}

export const run = action({
  args: {
    weighInWeightKg: v.number(),
    fightWeightKg: v.optional(v.number()),
    hoursUntilFight: v.number(),
    sex: v.union(v.literal("male"), v.literal("female")),
    dehydrationPercent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_REHYDRATION_PROTOCOL");

    const det = buildDeterministicRehydration({
      weighInWeightKg: args.weighInWeightKg,
      fightWeightKg: args.fightWeightKg,
      hoursUntilFight: args.hoursUntilFight,
    });

    let summary = deterministicSummary(det.totals);
    let warnings = [...DEFAULT_WARNINGS];
    let carbRefuelPlan = {
      ...defaultCarbRefuel(det.totals.totalCarbsG),
      targetCarbsG: det.totals.totalCarbsG,
      maxCarbsPerHour: det.totals.maxCarbsPerHour,
    };
    const narrativeByHour: Record<number, Pick<HourlyStepFull, "drinkRecipe" | "notes" | "foods">> = {};
    let llmError: string | null = null;

    const systemPrompt = `You are a JSON API for a combat-sports rehydration protocol. Numbers are pre-computed; do NOT alter them. Return ONLY:
{
  "summary": "2-3 sentences, plain English, no em dashes",
  "hourlyNotes": [{ "hour": 1, "drinkRecipe": "string max 20 words", "notes": "string max 25 words", "foods": ["string", "string"] }],
  "carbRefuelStrategy": "string max 30 words",
  "extraWarnings": ["string"]
}

${SECOND_PERSON_DIRECTIVE}

Address the user directly in every string ("Sip 500ml...", "Your sodium target...", "Avoid fibre right now"). This is THEIR rehydration protocol.`;

    const userPrompt = `You: ${args.sex}, just weighed in at ${args.weighInWeightKg}kg, ${args.hoursUntilFight}h until fight.
Totals to distribute: ${det.totals.totalFluidLitres}L fluid, ${det.totals.totalSodiumMg}mg Na, ${det.totals.totalCarbsG}g carbs.
Hourly phases (hour, phase, fluid_ml, carbs_g):
${det.hourlyProtocol.map((h) => `${h.hour} ${h.phase} ${h.fluidML}ml ${h.carbsG}g`).join("\n")}

Write per-hour drinkRecipe + foods + notes. Foods: white rice, banana, honey, rice cakes, sports drinks, ORS, sweetened milk. Avoid fibre/fat.`;

    try {
      const content = await callGroqText({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        timeoutMs: 30000,
      });
      const parsed = parseJSON<Record<string, unknown>>(content);
      if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
        summary = String(parsed.summary).replace(/—/g, " - ").replace(/–/g, "-").trim();
      }
      if (typeof parsed.carbRefuelStrategy === "string" && parsed.carbRefuelStrategy.trim().length > 0) {
        carbRefuelPlan.strategy = String(parsed.carbRefuelStrategy).replace(/—/g, " - ").trim();
      }
      if (Array.isArray(parsed.hourlyNotes)) {
        for (const hn of parsed.hourlyNotes as Array<{ hour?: unknown; drinkRecipe?: unknown; notes?: unknown; foods?: unknown }>) {
          if (typeof hn.hour === "number") {
            narrativeByHour[hn.hour] = {
              drinkRecipe: typeof hn.drinkRecipe === "string" ? hn.drinkRecipe.replace(/—/g, " - ").trim() : undefined,
              notes: typeof hn.notes === "string" ? hn.notes.replace(/—/g, " - ").trim() : undefined,
              foods: Array.isArray(hn.foods) ? hn.foods.map((f) => String(f)).slice(0, 6) : undefined,
            };
          }
        }
      }
      if (Array.isArray(parsed.extraWarnings)) {
        for (const w of parsed.extraWarnings as unknown[]) {
          if (typeof w === "string" && w.trim().length > 0 && warnings.length < 8) {
            warnings.push(w.replace(/—/g, " - ").trim());
          }
        }
      }
    } catch (err) {
      if (err instanceof GroqError && err.code === "AI_AUTH") throw err;
      llmError = err instanceof Error ? err.message : String(err);
    }

    const hourlyProtocol: HourlyStepFull[] = det.hourlyProtocol.map((h) => ({
      ...h,
      drinkRecipe: narrativeByHour[h.hour]?.drinkRecipe ?? "ORS or sports drink with a pinch of salt.",
      notes: narrativeByHour[h.hour]?.notes ?? "",
      foods: narrativeByHour[h.hour]?.foods ?? [],
    }));

    const protocol: RehydrationProtocolShape = {
      summary,
      totals: det.totals,
      hourlyProtocol,
      electrolyteRatio: det.electrolyteRatio,
      carbRefuelPlan,
      warnings,
    };

    logDecision(ctx, {
      userId,
      feature: "rehydration-protocol",
      inputSnapshot: {
        weighInWeightKg: args.weighInWeightKg,
        fightWeightKg: args.fightWeightKg,
        hoursUntilFight: args.hoursUntilFight,
        sex: args.sex,
        llmError,
      },
      outputJson: protocol,
      predictionFacts: {
        total_fluid_l: det.totals.totalFluidLitres,
        total_carbs_g: det.totals.totalCarbsG,
      },
      model: "openai/gpt-oss-120b",
    });

    return { protocol };
  },
});
