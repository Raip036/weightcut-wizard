import type { IonIconName } from "@/components/ui/Icon";
import type { SubScoreKey } from "@/scoring/types";

/**
 * Shared Fight Form sub-score presentation constants.
 *
 * Extracted verbatim from `FightFormScoreSheet.tsx` so the refactored sheet
 * and the new pillar components share one source of truth. Values are
 * unchanged — do not edit them here without updating the sheet's visuals
 * intentionally.
 */

export const SUBSCORE_LABEL: Record<string, string> = {
  trainingLoad: "Training Load",
  sleep: "Sleep",
  weightCut: "Weight Cut",
  // The `wellness` key IS the recovery dimension in the UI — the self-report
  // check-in is its base and HealthKit HRV/RHR folds into it (see
  // `mergeRecoveryDimension`). Both keys read "Recovery" so any stray lookup
  // (e.g. an un-remapped topLimiter) still labels correctly.
  wellness: "Recovery",
  nutritionAdherence: "Nutrition",
  recovery: "Recovery",
};

// Icon per sub-score. Matched to TodayStrip where possible so the same
// signal reads consistently across the dashboard chrome and this sheet.
export const SUBSCORE_ICON: Record<string, IonIconName> = {
  trainingLoad: "barbellOutline",
  sleep: "moonOutline",
  weightCut: "speedometerOutline",
  wellness: "heartOutline",
  nutritionAdherence: "restaurantOutline",
};

// "How this is measured" copy shown in the drill-down dialog so the user
// understands what actually feeds each pillar. Wellness/recovery spell out the
// survey → ring link (and the blend) since that's the least obvious of the set.
export const SUBSCORE_EXPLAINER: Record<string, string> = {
  trainingLoad:
    "Your training load balance — recent sessions vs. your 4-week baseline. Ramping too fast or sitting idle both pull it down.",
  sleep: "Hours and consistency from your sleep logs, smoothed over the last week.",
  weightCut: "How your weight is tracking against a sustainable pace to your target.",
  wellness:
    "Your recovery — driven by your daily check-in (sleep, body, soreness and stress), smoothed over 7 days. A better check-in raises this number, which feeds the ring. When Apple Health is connected, heart-rate variability and resting heart rate blend in to sharpen it.",
  recovery:
    "Measured from Apple Health — heart-rate variability and resting heart rate vs. your baseline. Blended into your recovery score when connected.",
  nutritionAdherence: "How closely your logged meals hit your calorie and protein targets.",
};

export const LABEL_ACCENT: Record<string, { stroke: string; fill: string }> = {
  sharp: { stroke: "stroke-func-recovery-green", fill: "fill-func-recovery-green" },
  sharpening: { stroke: "stroke-func-warning-yellow", fill: "fill-func-warning-yellow" },
  off_pace: { stroke: "stroke-func-carbs-orange", fill: "fill-func-carbs-orange" },
  at_risk: { stroke: "stroke-func-danger-red", fill: "fill-func-danger-red" },
};

export const CEILING_LABEL: Record<string, string> = {
  weight_cut_dangerous: "Aggressive weight loss",
  sleep_debt: "Sleep debt over 10h",
  training_spike: "Training load spike",
};

export function ceilingLabel(ruleId: string): string {
  return CEILING_LABEL[ruleId] ?? ruleId;
}

// Canonical ordering for the full set of pillars. Unlike the sheet's local
// 4-item locked-state list, this is the complete six-pillar order used by the
// advice module and tests so every SubScoreKey is covered.
export const SUBSCORE_ORDER: SubScoreKey[] = [
  "trainingLoad",
  "sleep",
  "weightCut",
  "wellness",
  "nutritionAdherence",
  "recovery",
];
