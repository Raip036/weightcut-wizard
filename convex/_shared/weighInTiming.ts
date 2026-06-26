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

/**
 * Resolve the WEIGH-IN date (the true make-weight day, and therefore the
 * end/target day of every cut plan) from the fight date + weigh-in timing.
 *
 *   day_before → fightDate − 1 day   (weigh-in is the day before the bout)
 *   same_day   → fightDate           (weigh-in is the morning of the bout)
 *
 * This is the SINGLE source of truth for the offset — every consumer that
 * needs the plan's end day must call this rather than re-deriving it, so the
 * fight date never silently doubles as the weigh-in date. Self-contained UTC
 * date math so it stays pure (importable from both Convex and the frontend).
 * `fightIso` is "YYYY-MM-DD" (longer ISO strings are sliced); an unparseable
 * value is returned unchanged.
 */
export function resolveWeighInIso(
  fightIso: string,
  weighInTiming: string | null | undefined,
): string {
  if (normalizeWeighInTiming(weighInTiming) === "same_day") return fightIso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fightIso || "");
  if (!m) return fightIso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
