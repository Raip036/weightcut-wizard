/**
 * Weigh-in timing normalization (backend).
 *
 * Onboarding now writes a CANONICAL `weighInTiming` of `"day_before"` or
 * `"same_day"` to `profiles.weighInTiming` and `fight_camps.weighInTiming`.
 * Historically `fight_camps.weighInTiming` was a free-form optional string
 * (often unset, or values like "day_of" / "morning_of" / "two_hour" /
 * "same-day" / etc). Readers that branch on, or display, the value must
 * normalize it first to stay backward-compatible.
 *
 * Rule: anything same-day-ish → `"same_day"`; everything else, including
 * null / undefined / unknown, → `"day_before"` (preserves historical default
 * behavior for existing users and camps).
 */
export type WeighInTiming = "same_day" | "day_before";

export function normalizeWeighInTiming(
  value: string | null | undefined,
): WeighInTiming {
  if (!value || typeof value !== "string") return "day_before";
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    v === "same_day" ||
    v === "day_of" ||
    v === "morning_of" ||
    v === "two_hour" ||
    v === "two_hour_rule" ||
    v.includes("same") ||
    v.includes("morning") ||
    v.includes("day_of")
  ) {
    return "same_day";
  }
  return "day_before";
}

/** Human-readable label for display / LLM fact lines. */
export function weighInTimingLabel(value: string | null | undefined): string {
  return normalizeWeighInTiming(value) === "same_day" ? "Same-day" : "Day before";
}
