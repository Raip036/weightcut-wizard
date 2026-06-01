/**
 * Exercise tracking types — how a set is logged & how it counts toward volume.
 *
 * - `standard`   — external load × reps (barbell/dumbbell/machine).
 * - `bodyweight` — reps only; no external load (push-ups, air squats).
 * - `weighted`   — bodyweight movement with added load (weighted pull-ups/dips).
 *                  The user logs the TOTAL weight (bodyweight + added) × reps;
 *                  volume counts the ADDED portion only.
 */
export type TrackingType = "standard" | "bodyweight" | "weighted";

export const TRACKING_TYPES: { value: TrackingType; label: string; hint: string }[] = [
  { value: "standard", label: "Standard", hint: "Weight × reps" },
  { value: "bodyweight", label: "Bodyweight", hint: "Reps only" },
  { value: "weighted", label: "Weighted", hint: "BW + added load" },
];

/**
 * Resolve an exercise's tracking type. Falls back to the legacy `is_bodyweight`
 * flag when no explicit `trackingType` is stored (back-compat for existing rows).
 */
export function resolveTrackingType(
  trackingType: string | null | undefined,
  isBodyweight: boolean,
): TrackingType {
  if (trackingType === "standard" || trackingType === "bodyweight" || trackingType === "weighted") {
    return trackingType;
  }
  return isBodyweight ? "bodyweight" : "standard";
}

/**
 * The weight that a single set contributes to VOLUME for a given tracking type.
 *
 * Weighted exercises log the TOTAL load (bodyweight + added); volume should
 * reflect only the ADDED portion, so we subtract the athlete's bodyweight.
 * When no bodyweight is on file we fall back to counting the logged total —
 * better than reporting zero.
 */
export function effectiveVolumeWeight(
  weightKg: number,
  trackingType: TrackingType,
  bodyweightKg: number | null | undefined,
): number {
  if (trackingType === "weighted" && bodyweightKg && bodyweightKg > 0) {
    return Math.max(0, weightKg - bodyweightKg);
  }
  return weightKg;
}
