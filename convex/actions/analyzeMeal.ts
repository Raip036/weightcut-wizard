/**
 * Multi-stage meal analyser.
 *
 * Stage 1 (when imageBase64): Llama-4 Scout vision -> structured food items.
 * Stage 2: gpt-oss-120b reasoning -> calories + macros JSON.
 * Stage 3 (persist=true): atomic insert via api.meals.createMealWithItems.
 *
 * Pro-only.
 */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";
import { requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

/**
 * Strip whitespace + any inadvertent `data:image/*;base64,` prefix from the
 * incoming payload. The client SHOULD send only the raw base64 body, but
 * defensive cleaning here removes one entire class of "invalid image data"
 * errors from Groq when the prefix gets included twice.
 */
function cleanBase64(b64: string): string {
  return b64.replace(/^data:[^,]+,/i, "").replace(/\s/g, "");
}

/**
 * Sniff the first 16 bytes of an image to recover the real MIME type. The
 * Camera plugin defaults to JPEG but iOS users on "High Efficiency" mode
 * can produce HEIC, and gallery-picked images may be PNG/WebP. Hardcoding
 * `image/jpeg` for all of those makes Groq reject the request with the
 * generic "invalid image data" message — sniffing lets us either send the
 * correct MIME or fail fast with a user-readable error.
 */
function detectImageMime(b64: string): { mime: string; isHeic: boolean } {
  if (b64.length < 32) return { mime: "", isHeic: false };
  let head: Buffer;
  try {
    head = Buffer.from(b64.slice(0, 32), "base64");
  } catch {
    return { mime: "", isHeic: false };
  }
  if (head.length < 12) return { mime: "", isHeic: false };
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: "image/jpeg", isHeic: false };
  }
  // PNG: 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { mime: "image/png", isHeic: false };
  }
  // WebP: "RIFF"...."WEBP"
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return { mime: "image/webp", isHeic: false };
  }
  // HEIC/HEIF: bytes 4..7 spell "ftyp"
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return { mime: "image/heic", isHeic: true };
  }
  return { mime: "", isHeic: false };
}

export const run = action({
  args: {
    mealDescription: v.optional(v.string()),
    imageBase64: v.optional(v.string()),
    date: v.optional(v.string()),
    mealType: v.optional(v.string()),
    persist: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { mealDescription, imageBase64, date, mealType, persist },
  ) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_MEAL_ANALYSIS");

    const cleanDesc = mealDescription
      ? sanitizeUserText(mealDescription, { maxLength: 1000, raw: true })
      : "";
    if (!cleanDesc && !imageBase64) {
      throw new Error("Provide a meal description or photo");
    }

    // Clean + validate the image early so we never fan out an obviously
    // bad payload to Groq (which surfaces only a generic "invalid image
    // data" error). Size cap tightened to 4 MB to match Groq's vision
    // input limit; previous 5 MB allowed borderline images that Groq then
    // rejected, leading to the exact error we're guarding against here.
    let cleanedImage: string | null = null;
    let imageMime: string | null = null;
    if (imageBase64) {
      cleanedImage = cleanBase64(imageBase64);
      if (cleanedImage.length === 0) {
        throw new Error("Photo data was empty. Please retake the photo.");
      }
      if (cleanedImage.length > 4_000_000) {
        throw new Error("Photo is too large. Please retake at lower quality.");
      }
      const { mime, isHeic } = detectImageMime(cleanedImage);
      if (isHeic) {
        throw new Error(
          "HEIC photos aren't supported yet. Open iOS Settings → Camera → Formats and choose 'Most Compatible', then retake.",
        );
      }
      if (!mime) {
        throw new Error("Photo format not recognized. Please retake the photo.");
      }
      imageMime = mime;
    }

    let nutritionData: any;

    if (cleanedImage && imageMime) {
      const visionPrompt = `You are a JSON API. Respond with ONLY the JSON object.
You are a visual food identification expert helping a combat-sports athlete log a meal accurately. No macro math here — that's the next stage's job.

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Think step by step before responding:
1. Scan the whole frame: main proteins, starches/grains, vegetables, fruits, sauces, dressings, oils, butter, garnishes, drinks. Don't skip small items.
2. For repeated items, count exact units (e.g. "3 chicken thighs", not "chicken").
3. Estimate portion using visual references: a dinner plate ≈ 25-28 cm, a teaspoon ≈ 5 ml, a closed fist ≈ 1 cup, a deck of cards ≈ 85 g of meat. Anchor your estimate to whatever reference is visible.
4. Identify cooking method (grilled / fried / pan-seared / steamed / boiled / raw / baked) — fried/sautéed items carry added oil calories that are easy to miss.
5. Surface hidden calories: cooking oil on the surface, butter on bread, cheese melted on top, dressing on salad, sauce coating, syrup, sugar, honey, nuts/seeds sprinkled on top.
6. Distinguish raw vs cooked weight when relevant (rice doubles in weight cooked; meat loses ~25%).
7. For each item, give a bounding box in normalized image coordinates (0.0 = top/left edge, 1.0 = bottom/right edge). x,y = top-left corner; w,h = width/height. Coords must be in [0,1] and tight around the item.
8. confidence: "high" if you're certain of the item and quantity, "medium" if quantity is approximate, "low" if the item itself is ambiguous.

{ "meal_name": "...", "items": [{ "name": "...", "count": "...", "portion_estimate": "...", "cooking_method": "...", "visible_additions": "...", "confidence": "high|medium|low", "bbox": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 } }], "overall_notes": "..." }`;
      // When the user supplies a free-text caption alongside the photo, lean
      // on it as authoritative hints for things the camera can't reliably
      // see — ingredients hidden underneath, the cooking method, brand of a
      // sauce, or "actual" portion when their plate's odd. The image stays
      // primary for visual quantity; the text fills in the gaps.
      const visionUserContent: any = [
        {
          type: "image_url",
          image_url: { url: `data:${imageMime};base64,${cleanedImage}` },
        },
        {
          type: "text",
          text: cleanDesc
            ? `Identify every visible food item with portion + bounding box. Return JSON only.

USER DESCRIPTION (use as authoritative hints for portions, ingredients, or details the photo may not show clearly):
<user_input>${cleanDesc}</user_input>

Combine the visual evidence and the description. If they conflict, trust the description for ingredients and the photo for visual quantity. If the description mentions a brand or specific item not visible in the photo, factor it in.`
            : "Identify every visible food item with portion + bounding box. Return JSON only.",
        },
      ];
      const visionContent = await callGroqText({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          { role: "system", content: visionPrompt },
          { role: "user", content: visionUserContent },
        ],
        temperature: 0.1,
        max_tokens: 900,
      });
      const visionObservation = parseJSON(visionContent);

      const reasoningPrompt = `You are a JSON API. FIRST character MUST be "{". Compute calories + macros from the vision observation.

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Rules:
- Use USDA cooked-weight values when the item was cooked. Account for added oil/butter/sauce that the vision stage surfaced under "cooking_method" or "visible_additions".
- Each item's macros reflect ACTUAL quantity (count × portion), not per-100g.
- Macros must be self-consistent with calories under Atwater (protein 4, carbs 4, fat 9 kcal/g). If your numbers don't sum, prefer accurate macros and let calories follow.
- Totals (top-level calories/protein_g/carbs_g/fats_g) equal the sum of items.
- Copy each item's "bbox" verbatim from the vision observation. If absent, omit it — do not invent coordinates.
- "meal_name": copy verbatim from the vision observation's meal_name. If missing/empty, generate a short (<=40 chars), specific descriptive name based on the visible items (e.g. "Grilled chicken & rice bowl"). Never use "Meal" or "Logged meal".

{ "meal_name": "...", "calories": n, "protein_g": n, "carbs_g": n, "fats_g": n, "items": [{ "name": "...", "quantity": "...", "calories": n, "protein_g": n, "carbs_g": n, "fats_g": n, "bbox": { "x": n, "y": n, "w": n, "h": n } }] }`;
      const reasoningUser = cleanDesc
        ? `Vision observation:
${JSON.stringify(visionObservation, null, 2)}

USER DESCRIPTION (authoritative for ingredients, brands, and details the photo can't show; the photo stays primary for visual quantity):
<user_input>${cleanDesc}</user_input>

Reconcile the vision observation with the description. Trust the description for hidden ingredients, cooking method, brand, and clarifications. Trust the photo for visible portion size. Return ONLY the JSON object.`
        : `Vision observation:
${JSON.stringify(visionObservation, null, 2)}

Return ONLY the JSON object.`;
      const reasoningContent = await callGroqText({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: reasoningPrompt },
          { role: "user", content: reasoningUser },
        ],
        temperature: 0,
        max_tokens: 1200,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      });
      nutritionData = parseJSON(reasoningContent);
    } else {
      const textPrompt = `You are a JSON API. Respond with ONLY the JSON object.
Nutrition analysis expert.

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Parse quantities precisely (e.g. "4 chicken breasts" = 4x). Per-item totals reflect the ACTUAL quantity.

{ "meal_name": "...", "calories": n, "protein_g": n, "carbs_g": n, "fats_g": n, "items": [{ "name": "...", "quantity": "...", "calories": n, "protein_g": n, "carbs_g": n, "fats_g": n }] }`;
      const content = await callGroqText({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: textPrompt },
          {
            role: "user",
            content: `Analyze this meal: <user_input>${cleanDesc}</user_input>`,
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: "json_object" },
      });
      nutritionData = parseJSON(content);
    }

    let savedMealId: string | null = null;
    if (persist !== false && nutritionData) {
      const mt =
        typeof mealType === "string" &&
        ["breakfast", "lunch", "dinner", "snack"].includes(mealType.toLowerCase())
          ? mealType.toLowerCase()
          : "snack";
      const todayIso = new Date().toISOString().slice(0, 10);
      const pDate =
        typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso;
      const mealName =
        (typeof nutritionData.meal_name === "string" && nutritionData.meal_name.trim()) ||
        "Logged meal";
      const items = Array.isArray(nutritionData.items)
        ? nutritionData.items.map((it: any) => ({
            name: (typeof it?.name === "string" && it.name.trim()) || "Item",
            grams: Number.isFinite(Number(it?.grams)) ? Number(it.grams) : 100,
            calories: Number.isFinite(Number(it?.calories)) ? Number(it.calories) : 0,
            proteinG: Number.isFinite(Number(it?.protein_g)) ? Number(it.protein_g) : 0,
            carbsG: Number.isFinite(Number(it?.carbs_g)) ? Number(it.carbs_g) : 0,
            fatsG: Number.isFinite(Number(it?.fats_g)) ? Number(it.fats_g) : 0,
          }))
        : [
            {
              name: mealName,
              grams: 100,
              calories: Number(nutritionData.calories) || 0,
              proteinG: Number(nutritionData.protein_g) || 0,
              carbsG: Number(nutritionData.carbs_g) || 0,
              fatsG: Number(nutritionData.fats_g) || 0,
            },
          ];
      const mealId = await ctx.runMutation(api.meals.createMealWithItems, {
        date: pDate,
        mealType: mt,
        mealName,
        isAiGenerated: true,
        items,
      });
      savedMealId = mealId as string;
    }
    return { nutritionData, meal_id: savedMealId };
  },
});
