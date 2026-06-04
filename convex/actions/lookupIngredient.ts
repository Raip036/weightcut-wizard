/** Lookup ingredient — fast nutrition lookup for a single ingredient. Pro-only. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { sanitizeUserText } from "../_shared/sanitizeUserText";

export const run = action({
  args: {
    name: v.string(),
    grams: v.optional(v.number()),
  },
  handler: async (ctx, { name, grams }) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_LOOKUP_INGREDIENT");
    const safe = sanitizeUserText(name, { maxLength: 200, raw: true });
    if (!safe) throw new Error("Ingredient name required");
    const targetGrams = grams ?? 100;
    const systemPrompt = `You are a JSON API. Return ONLY this exact JSON:
{ "name": "string", "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fats_g": number, "per100g": { "calories": number, "protein_g": number, "carbs_g": number, "fats_g": number } }
Use USDA values. The "grams" must equal ${targetGrams}. All numeric values must reflect the actual quantity, not per-100g. The per100g block shows per-100g equivalents.`;
    const content = await callGroqText({
      // Heavy-tier model — ingredient lookup needs accurate per-gram
      // macro computation (Atwater scaling, portion conversions). The same
      // model runs on both providers (OPENROUTER_MODEL_MAP keeps it as
      // gpt-oss-120b); OpenRouter just routes it to the fastest backend.
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Ingredient: <user_input>${safe}</user_input>, ${targetGrams}g.`,
        },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });
    return parseJSON(content);
  },
});
