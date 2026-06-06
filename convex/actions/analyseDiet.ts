/** Analyse diet — micronutrient gaps. Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { loadAthleteSnapshot, requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { deriveNutrientCategory } from "../_shared/nutrientCategories";

export const run = action({
  args: {
    meals: v.array(v.any()),
    profile: v.optional(v.any()),
    macroGoals: v.optional(v.any()),
    date: v.string(),
  },
  handler: async (ctx, { meals, profile, macroGoals, date }) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_DIET_ANALYSIS");
    if (!Array.isArray(meals) || meals.length === 0) {
      throw new Error("At least one meal is required");
    }
    const snap = await loadAthleteSnapshot(ctx, userId);
    // The system prompt MUST spell out every field shape — the previous
    // version only sketched the top-level keys (`{ mealBreakdown: [...] }`)
    // and the model would happily drift to `meal_name`, `key_nutrients`,
    // `percent_rda`, etc. The React card then read those camelCase fields
    // as undefined and rendered the Per Meal / Gaps sections empty.
    //
    // The example below pins every field name AND uses non-trivial values
    // so the model can't shortcut by echoing the schema (Groq tends to
    // return placeholder values when the example uses "...").
    const systemPrompt = `You are a JSON API. Respond with ONLY the JSON object. NEVER use em dashes.
You are the athlete's personal nutrition coach. Speak DIRECTLY to the user using "you" and "your" — never "the athlete", "they", or "the user". The user is reading this themself; address them like you're in the room.

Return JSON in EXACTLY this shape (camelCase keys, do NOT rename or omit):
{
  "summary": "Short paragraph summarising the day.",
  "mealBreakdown": [
    {
      "mealType": "breakfast",
      "mealName": "Oats with berries",
      "keyNutrients": [
        { "name": "Iron", "amount": "3.2 mg" },
        { "name": "Fiber", "amount": "8 g" }
      ]
    }
  ],
  "micronutrients": [
    { "name": "Iron", "percentRDA": 62, "amount": "11 mg", "rdaTarget": "18 mg" }
  ],
  "gaps": [
    {
      "nutrient": "Vitamin D",
      "percentRDA": 28,
      "severity": "critical",
      "reason": "Only fortified milk and no oily fish today."
    }
  ],
  "suggestions": [
    {
      "food": "Salmon (100g)",
      "reason": "Closes the vitamin D and omega-3 gap.",
      "nutrients": ["Vitamin D", "Omega-3"]
    }
  ],
  "mealAdditions": [
    {
      "mealType": "breakfast",
      "mealName": "Oats with berries",
      "additions": [
        {
          "item": "Add a tablespoon of ground flaxseed",
          "benefit": "Bumps your omega-3s and fiber without changing the texture much.",
          "nutrients": ["Omega-3", "Fiber"]
        },
        {
          "item": "Swap the milk for fortified soy milk",
          "benefit": "Adds vitamin D and B12 that your breakfast is missing.",
          "nutrients": ["Vitamin D", "B12"]
        }
      ]
    }
  ],
  "vitaminRounders": [
    {
      "food": "Eggs",
      "vitamins": ["Vitamin D", "B12", "Choline", "Selenium"],
      "reason": "Covers four of your weaker micros in one cheap ingredient you can drop into any meal."
    }
  ],
  "foodContributions": [
    {
      "food": "Salmon",
      "mealType": "dinner",
      "nutrients": [
        { "name": "Omega-3", "amount": "1.2 g" },
        { "name": "Vitamin D", "amount": "10 ug" }
      ]
    }
  ],
  "keyInsights": [
    { "focus": "performance", "text": "Your iron is low today, which can cap aerobic output in hard rounds." },
    { "focus": "health", "text": "Add some colour to your plate for antioxidants that aid recovery." }
  ]
}

Rules:
- Use the EXACT field names shown above (mealType, mealName, keyNutrients, percentRDA, rdaTarget, mealAdditions, vitaminRounders). NEVER use snake_case (no meal_name, no key_nutrients, no percent_rda, no meal_additions, no vitamin_rounders).
- mealBreakdown: ONE entry per input meal, in the same order as the user listed them. keyNutrients = top 3-4 micronutrients by amount.
- micronutrients: 6-10 of the most important micronutrients for combat sport athletes.
- gaps: ONLY include nutrients where percentRDA < 70. Severity: critical < 30, moderate 30-50, low 50-70.
- suggestions: 3-5 whole foods that close the biggest gaps. Each must list which "nutrients" it provides.
- mealAdditions: ONE entry for EACH meal the user logged, in the same order. Each entry has 2-3 specific items the user could ADD or SWAP into THAT meal to raise its nutrient density — keep additions realistic for the meal's flavour profile (don't suggest salmon on porridge). Use imperative phrasing ("Add ...", "Top with ...", "Swap ... for ..."). Each addition must list the nutrients it boosts.
- vitaminRounders: 2-4 "all-rounder" foods or simple pairings that cover MULTIPLE vitamins/minerals at once, with priority on closing the user's gaps. List every vitamin/mineral each food rounds out.
- foodContributions: ONE entry per notable food you can identify from the logged meals' ingredients, listing the top 1-3 micronutrients that food supplied. This shows the user where their nutrients came from.
- keyInsights: 2-4 short takeaways. Tag each with focus "performance" (fighting / training output) or "health" (general wellbeing). Address the user directly.
- Estimate from USDA food composition data.
- RDA targets adjusted for an active combat sport athlete (${profile?.sex === "female" ? "female" : "male"}, ${profile?.age || 25} years).
- percentRDA must be an INTEGER, capped at 100.
- ALL string fields must be present (use "" if you have nothing meaningful).
- Return arrays even if empty (e.g. "gaps": []).

${snap.block}`;

    const mealSummary = meals
      .map(
        (m: any) =>
          `${m.meal_type || "meal"}: ${m.meal_name} (${m.calories} kcal, ${m.protein_g}g P, ${m.carbs_g}g C, ${m.fats_g}g F)${
            m.ingredients?.length
              ? ` - ingredients: ${m.ingredients.map((i: any) => `${i.name} ${i.grams}g`).join(", ")}`
              : ""
          }`,
      )
      .join("\n");
    const userPrompt = `Analyse my full day of eating for ${date}:

${mealSummary}

Daily totals: ${meals.reduce((s, m: any) => s + (m.calories || 0), 0)} kcal, ${meals.reduce((s, m: any) => s + (m.protein_g || 0), 0)}g protein, ${meals.reduce((s, m: any) => s + (m.carbs_g || 0), 0)}g carbs, ${meals.reduce((s, m: any) => s + (m.fats_g || 0), 0)}g fats

My macro targets: ${macroGoals?.calorieTarget || "not set"} kcal, ${macroGoals?.proteinGrams || "?"} P, ${macroGoals?.carbsGrams || "?"} C, ${macroGoals?.fatsGrams || "?"} F

My profile: ${profile?.age || "?"} years, ${profile?.sex || "?"}, ${profile?.current_weight_kg || "?"}kg, training ${profile?.training_frequency || "?"}/week.

Address me directly ("you", "your") in every string field — summary, gap reasons, suggestion reasons.`;

    // gpt-oss-120b is a reasoning model: with a tight max_tokens it spends the
    // budget thinking and truncates the JSON, so micronutrients came back empty
    // and the card showed protein only. Low reasoning effort + a bigger budget
    // leaves room to finish the JSON. We then retry until micronutrients are
    // actually present, since that is the whole point of the feature.
    const MIN_MICROS = 5;
    const MAX_ATTEMPTS = 3;
    let analysisData = normaliseAnalysis(null);
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const sys =
        attempt === 0
          ? systemPrompt
          : `${systemPrompt}\n\nYour previous response had too few micronutrients. You MUST return at least 6 entries in "micronutrients" with integer percentRDA values.`;
      try {
        const content = await callGroqText({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 7000,
          reasoning_effort: "low",
          response_format: { type: "json_object" },
        });
        const candidate = normaliseAnalysis(parseJSON<Record<string, any>>(content));
        if (candidate.micronutrients.length >= MIN_MICROS) {
          analysisData = candidate;
          break;
        }
        if (candidate.micronutrients.length > analysisData.micronutrients.length) {
          analysisData = candidate;
        }
      } catch (err) {
        lastError = err;
      }
    }
    if (!analysisData.summary && analysisData.micronutrients.length === 0 && lastError) {
      throw lastError;
    }

    // ── Deterministic numbers (computed here, NOT by the LLM, so they're
    //    always arithmetically correct) ──────────────────────────────────
    // Protein g/kg target for a combat athlete in a cut. ISSN: 1.2–2.2 g/kg
    // in a deficit, up to ~3.1 when aggressively cutting; 2.0 is a solid
    // muscle-sparing default.
    const TARGET_G_PER_KG = 2.0;
    const bodyKg =
      Number(profile?.current_weight_kg) || snap.snapshot.currentWeight || null;
    const todayProteinG = Math.round(
      meals.reduce(
        (s: number, m: { protein_g?: number }) => s + (Number(m.protein_g) || 0),
        0,
      ),
    );

    let proteinVerdict:
      | {
          actualG: number;
          targetG: number;
          gPerKg: number;
          targetGPerKg: number;
          shortfallG: number;
          verdict: "low" | "on_track" | "high";
        }
      | undefined;
    if (bodyKg && bodyKg > 0) {
      const targetG = Math.round(bodyKg * TARGET_G_PER_KG);
      const gPerKg = +(todayProteinG / bodyKg).toFixed(2);
      const verdict =
        gPerKg < 1.6 ? "low" : gPerKg > 2.6 ? "high" : "on_track";
      proteinVerdict = {
        actualG: todayProteinG,
        targetG,
        gPerKg,
        targetGPerKg: TARGET_G_PER_KG,
        shortfallG: Math.max(0, targetG - todayProteinG),
        verdict,
      };
    }

    const pAvg = snap.snapshot.proteinAvg7d ?? null;
    const cAvg = snap.snapshot.calorieAvg7d ?? null;
    let weeklyTrend:
      | {
          proteinAvgG: number | null;
          proteinAvgGPerKg: number | null;
          calorieAvgKcal: number | null;
          note: string;
        }
      | undefined;
    if (pAvg != null || cAvg != null) {
      const pAvgGPerKg =
        bodyKg && bodyKg > 0 && pAvg != null ? +(pAvg / bodyKg).toFixed(2) : null;
      let note = "";
      if (pAvgGPerKg != null) {
        note =
          pAvgGPerKg < 1.6
            ? `Your protein has averaged ${pAvgGPerKg} g/kg this week - below the ~2.0 g/kg that protects muscle in a cut.`
            : pAvgGPerKg > 2.6
              ? `You're averaging ${pAvgGPerKg} g/kg protein this week - plenty to hold muscle while cutting.`
              : `Your 7-day protein is on track at ${pAvgGPerKg} g/kg.`;
      } else if (pAvg != null) {
        note = `You're averaging ${pAvg}g protein a day this week.`;
      } else if (cAvg != null) {
        note = `You're averaging ${cAvg} kcal a day this week.`;
      }
      weeklyTrend = {
        proteinAvgG: pAvg,
        proteinAvgGPerKg: pAvgGPerKg,
        calorieAvgKcal: cAvg,
        note,
      };
    }

    return { analysisData: { ...analysisData, proteinVerdict, weeklyTrend } };
  },
});

/**
 * Drop duplicate micronutrients (case-insensitive by name, first wins). The
 * model occasionally repeats a nutrient, which would collide on React keys and
 * SVG gradient ids in the rings.
 */
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = (item.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Map common snake_case / aliased keys back to the canonical camelCase
 * shape the React `DietAnalysisCard` expects. Even with a fully-shaped
 * system prompt Groq sometimes returns `meal_name`, `key_nutrients`, or
 * `percent_rda` - without this normaliser the Per Meal / Gaps sections
 * silently render empty.
 */
export function normaliseAnalysis(raw: Record<string, any> | null | undefined) {
  const r = raw ?? {};
  const pick = <T,>(...keys: string[]): T | undefined => {
    for (const k of keys) if (r[k] != null) return r[k] as T;
    return undefined;
  };
  const arr = <T,>(...keys: string[]): T[] => {
    for (const k of keys) {
      const v = r[k];
      if (Array.isArray(v)) return v as T[];
    }
    return [];
  };
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

  return {
    summary: str(pick("summary", "overview", "analysis")),
    mealBreakdown: arr<any>("mealBreakdown", "meal_breakdown", "meals", "perMeal", "per_meal").map((m) => ({
      mealType: str(m?.mealType ?? m?.meal_type ?? m?.type),
      mealName: str(m?.mealName ?? m?.meal_name ?? m?.name),
      keyNutrients: (
        Array.isArray(m?.keyNutrients) ? m.keyNutrients :
        Array.isArray(m?.key_nutrients) ? m.key_nutrients :
        Array.isArray(m?.nutrients) ? m.nutrients : []
      ).map((n: any) => ({
        name: str(n?.name ?? n?.nutrient),
        amount: str(n?.amount ?? n?.value ?? n?.qty),
      })),
    })),
    micronutrients: dedupeByName(
      arr<any>("micronutrients", "micros", "nutrients").map((n) => {
        const name = str(n?.name ?? n?.nutrient);
        return {
          name,
          percentRDA: num(n?.percentRDA ?? n?.percent_rda ?? n?.percent ?? n?.pctRDA),
          amount: str(n?.amount ?? n?.value),
          rdaTarget: str(n?.rdaTarget ?? n?.rda_target ?? n?.target ?? n?.rda),
          category: deriveNutrientCategory(name),
        };
      }),
    ),
    gaps: arr<any>("gaps", "deficiencies", "lowNutrients").map((g) => {
      const sev = str(g?.severity).toLowerCase();
      const severity =
        sev === "critical" || sev === "moderate" || sev === "low"
          ? sev
          : "low";
      return {
        nutrient: str(g?.nutrient ?? g?.name),
        percentRDA: num(g?.percentRDA ?? g?.percent_rda ?? g?.percent),
        severity: severity as "low" | "moderate" | "critical",
        reason: str(g?.reason ?? g?.why ?? g?.note),
      };
    }),
    suggestions: arr<any>("suggestions", "recommendations", "addToYourDiet").map((s) => ({
      food: str(s?.food ?? s?.name ?? s?.item),
      reason: str(s?.reason ?? s?.why ?? s?.note),
      nutrients: Array.isArray(s?.nutrients)
        ? s.nutrients.map((n: any) => str(n))
        : Array.isArray(s?.targets)
        ? s.targets.map((n: any) => str(n))
        : [],
    })),
    mealAdditions: arr<any>("mealAdditions", "meal_additions", "perMealAdditions", "mealUpgrades").map((m) => ({
      mealType: str(m?.mealType ?? m?.meal_type ?? m?.type),
      mealName: str(m?.mealName ?? m?.meal_name ?? m?.name),
      additions: (
        Array.isArray(m?.additions) ? m.additions :
        Array.isArray(m?.adds) ? m.adds :
        Array.isArray(m?.suggestions) ? m.suggestions : []
      ).map((a: any) => ({
        item: str(a?.item ?? a?.food ?? a?.name ?? a?.addition),
        benefit: str(a?.benefit ?? a?.reason ?? a?.why ?? a?.note),
        nutrients: Array.isArray(a?.nutrients)
          ? a.nutrients.map((n: any) => str(n))
          : Array.isArray(a?.boosts)
          ? a.boosts.map((n: any) => str(n))
          : [],
      })),
    })),
    vitaminRounders: arr<any>("vitaminRounders", "vitamin_rounders", "allRounders", "all_rounders", "rounders").map((v) => ({
      food: str(v?.food ?? v?.name ?? v?.item),
      vitamins: Array.isArray(v?.vitamins)
        ? v.vitamins.map((n: any) => str(n))
        : Array.isArray(v?.nutrients)
        ? v.nutrients.map((n: any) => str(n))
        : Array.isArray(v?.covers)
        ? v.covers.map((n: any) => str(n))
        : [],
      reason: str(v?.reason ?? v?.why ?? v?.note),
    })),
    foodContributions: arr<any>("foodContributions", "food_contributions", "foods", "sources").map((f) => ({
      food: str(f?.food ?? f?.name ?? f?.item),
      mealType: str(f?.mealType ?? f?.meal_type ?? f?.meal),
      nutrients: (
        Array.isArray(f?.nutrients) ? f.nutrients :
        Array.isArray(f?.provides) ? f.provides : []
      ).map((n: any) => ({
        name: str(n?.name ?? n?.nutrient),
        amount: str(n?.amount ?? n?.value ?? n?.qty),
      })),
    })),
    keyInsights: arr<any>("keyInsights", "key_insights", "insights").map((k) => {
      const focus = str(k?.focus ?? k?.kind ?? k?.type).toLowerCase();
      return {
        focus: focus === "performance" ? "performance" : "health",
        text: str(k?.text ?? k?.insight ?? k?.note),
      } as { focus: "health" | "performance"; text: string };
    }),
  };
}
