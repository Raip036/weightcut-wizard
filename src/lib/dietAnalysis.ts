import type { MicronutrientData } from "@/types/dietAnalysis";

/**
 * Status colour for a micronutrient: red (low) -> amber (getting there) ->
 * emerald (good). Reads "am I covered?" at a glance.
 */
export function status(pct: number): { color: string; label: string } {
  if (pct >= 70) return { color: "rgb(16 185 129)", label: "good" };
  if (pct >= 40) return { color: "rgb(245 158 11)", label: "getting there" };
  return { color: "rgb(239 68 68)", label: "low" };
}

export interface CoverageStats {
  /** Mean of each micronutrient's capped percentRDA, rounded to an integer. */
  coveragePct: number;
  /** Count with percentRDA >= 70. */
  onPoint: number;
  /** Count with percentRDA < 70. */
  toImprove: number;
}

export function coverageStats(micros: MicronutrientData[]): CoverageStats {
  if (micros.length === 0) return { coveragePct: 0, onPoint: 0, toImprove: 0 };
  const capped = micros.map((m) => Math.min(100, Math.max(0, m.percentRDA)));
  const coveragePct = Math.round(capped.reduce((a, b) => a + b, 0) / micros.length);
  const onPoint = micros.filter((m) => m.percentRDA >= 70).length;
  return { coveragePct, onPoint, toImprove: micros.length - onPoint };
}

export interface MicronutrientGroups {
  vitamins: MicronutrientData[];
  minerals: MicronutrientData[];
  fattyAcids: MicronutrientData[];
  other: MicronutrientData[];
}

/** Split micronutrients by category, lows first within each group. */
export function groupByCategory(micros: MicronutrientData[]): MicronutrientGroups {
  const byPct = (a: MicronutrientData, b: MicronutrientData) => a.percentRDA - b.percentRDA;
  return {
    vitamins: micros.filter((m) => m.category === "vitamin").sort(byPct),
    minerals: micros.filter((m) => m.category === "mineral").sort(byPct),
    fattyAcids: micros.filter((m) => m.category === "fatty_acid").sort(byPct),
    other: micros.filter((m) => m.category === "other").sort(byPct),
  };
}

/** Strip a trailing quantity so "Salmon (100g)" seeds search as "Salmon". */
export function cleanFoodName(food: string): string {
  return food.replace(/\s*\([^)]*\)\s*$/, "").trim() || food.trim();
}

/** Defensive: strip em/en dashes the AI sometimes returns despite instructions.
 *  Numeric ranges (e.g. "2–3 g/kg") collapse to a hyphen; every other dash,
 *  which the model uses as a clause break, becomes a comma. Never leaves a
 *  spaced hyphen behind, which still reads as a dash. */
export function clean(t: string | null | undefined): string {
  if (typeof t !== "string") return "";
  return t
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*/g, ", ");
}
