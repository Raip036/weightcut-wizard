/**
 * Deterministic safety guardrail for the Fight Camp Coach (Phase 3).
 *
 * Pure functions — NO ctx / IO. A sibling loader produces `SafetyInput` from
 * weight logs, protocol feel-checks and fight-week math (HRV/RHR readiness
 * signals are no longer collected and are always null — Apple HealthKit was
 * removed); this module turns those facts into a safety verdict that the coach action
 * prepends to its blocks. Safety guidance is ALWAYS free and NEVER paywalled,
 * and a `danger` verdict must override any "make weight" tone (slow down /
 * rehydrate / see a professional) — never advise pushing harder.
 *
 * Design notes:
 *  - Null-safe: a missing input is simply not evaluated (no false alarms).
 *  - The `callout` block matches the `CoachBlock` "callout" variant in
 *    aiSchemas.ts (tone: "info"|"warn"|"danger", text ≤ 200 chars).
 *  - Thresholds below are conservative and grounded in cut-safety guidance
 *    (≈1% bodyweight/week is a sustainable loss rate; faster risks lean-mass
 *    loss and performance/health decline).
 */

import type { CoachBlock } from "./aiSchemas";

// ─── Thresholds (named constants, tunable in one place) ────────────────────

/** Rate-of-loss (% bodyweight/week) above which the cut is dangerously fast. */
const RATE_DANGER_PCT = 1.5;
/** Rate-of-loss (% bodyweight/week) above which the cut is faster than ideal. */
const RATE_WARN_PCT = 1.0;

/** RHR elevation (bpm above baseline) considered a clear readiness red flag. */
const RHR_ELEVATED_BPM = 8;
/** HRV at or below this fraction of baseline is considered suppressed. */
const HRV_SUPPRESSED_FRAC = 0.8;

/** Callout text hard cap (mirrors the schema `.max(200)` on callout.text). */
const CALLOUT_MAX = 200;

// ─── Input contract (kept identical to the sibling loader's output) ─────────

export interface SafetyInput {
  /** % bodyweight per week implied by last 7 days of logs (positive = losing). */
  rateOfLossPct7d: number | null;
  /** Latest protocol_feel_check tier. */
  feelCheckTier: "green" | "amber" | "red" | null;
  /** Heart-rate-variability (ms) and its rolling baseline. */
  hrv: number | null;
  hrvBaseline: number | null;
  /** Resting heart rate (bpm) and its rolling baseline. */
  rhr: number | null;
  rhrBaseline: number | null;
  /** Days remaining until weigh-in. */
  daysToWeighIn: number | null;
  /** Risk level from fight-week math, when available. */
  fightWeekRiskLevel: "low" | "moderate" | "high" | null;
}

export type SafetyTier = "ok" | "warn" | "danger";

export interface SafetyResult {
  tier: SafetyTier;
  /** Short human strings, one per fired trigger. */
  reasons: string[];
  /** A tone-matched callout block, or null when tier is "ok". */
  callout: CoachBlock | null;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** True when both RHR and HRV are present and a value above zero baseline. */
const has = (v: number | null): v is number => v !== null && Number.isFinite(v);

/** RHR is elevated well above its baseline. */
function rhrElevated(input: SafetyInput): boolean {
  return (
    has(input.rhr) &&
    has(input.rhrBaseline) &&
    input.rhr - input.rhrBaseline >= RHR_ELEVATED_BPM
  );
}

/** HRV is suppressed relative to its baseline. */
function hrvSuppressed(input: SafetyInput): boolean {
  return (
    has(input.hrv) &&
    has(input.hrvBaseline) &&
    input.hrvBaseline > 0 &&
    input.hrv <= input.hrvBaseline * HRV_SUPPRESSED_FRAC
  );
}

/** Clamp text to the callout schema cap (defensive; messages are short). */
function clampText(text: string): string {
  return text.length <= CALLOUT_MAX ? text : `${text.slice(0, CALLOUT_MAX - 1)}…`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluate the deterministic safety guardrail. Any single danger trigger forces
 * tier "danger"; otherwise any warn trigger forces "warn"; else "ok".
 */
export function evaluateSafety(input: SafetyInput): SafetyResult {
  const dangerReasons: string[] = [];
  const warnReasons: string[] = [];

  // 1. Rate of loss.
  if (has(input.rateOfLossPct7d)) {
    if (input.rateOfLossPct7d > RATE_DANGER_PCT) {
      dangerReasons.push(
        `Cutting too fast (${input.rateOfLossPct7d.toFixed(1)}%/week)`,
      );
    } else if (input.rateOfLossPct7d > RATE_WARN_PCT) {
      warnReasons.push(
        `Cut pace is high (${input.rateOfLossPct7d.toFixed(1)}%/week)`,
      );
    }
  }

  // 2. Subjective feel-check tier.
  if (input.feelCheckTier === "red") {
    dangerReasons.push("You flagged feeling rough (red check-in)");
  } else if (input.feelCheckTier === "amber") {
    warnReasons.push("Your last check-in was amber");
  }

  // 3. Readiness signals (RHR / HRV). Both together = danger; either alone = warn.
  const rhrUp = rhrElevated(input);
  const hrvDown = hrvSuppressed(input);
  if (rhrUp && hrvDown) {
    dangerReasons.push("Resting HR up and HRV suppressed — readiness is down");
  } else if (rhrUp) {
    warnReasons.push("Resting heart rate is elevated");
  } else if (hrvDown) {
    warnReasons.push("HRV is suppressed vs baseline");
  }

  // 4. Fight-week math risk level.
  if (input.fightWeekRiskLevel === "high") {
    dangerReasons.push("Fight-week projection is high risk");
  } else if (input.fightWeekRiskLevel === "moderate") {
    warnReasons.push("Fight-week projection is moderate risk");
  }

  if (dangerReasons.length > 0) {
    return {
      tier: "danger",
      reasons: dangerReasons,
      callout: buildCallout("danger", dangerReasons),
    };
  }
  if (warnReasons.length > 0) {
    return {
      tier: "warn",
      reasons: warnReasons,
      callout: buildCallout("warn", warnReasons),
    };
  }
  return { tier: "ok", reasons: [], callout: null };
}

/**
 * Combine fired reasons into firm, safety-first guidance. Danger guidance never
 * softens into "push harder" — it directs slowing down, rehydration, and seeing
 * a professional if unwell.
 */
function buildCallout(
  tone: "warn" | "danger",
  reasons: string[],
): CoachBlock {
  const lead = reasons[0] ?? "";
  const text =
    tone === "danger"
      ? clampText(
          `${lead}. Slow the cut, prioritise rehydration, and speak to a professional if you feel unwell.`,
        )
      : clampText(
          `${lead}. Ease off, hydrate, and recheck before pushing the cut harder.`,
        );
  return { type: "callout", tone, text };
}

/**
 * One-sentence summary of the key safety facts for the LLM prompt (numbers
 * rounded). Returns "" when everything is ok / unknown so the prompt stays lean.
 */
export function summarizeSafety(input: SafetyInput): string {
  const { tier, reasons } = evaluateSafety(input);
  if (tier === "ok" || reasons.length === 0) return "";
  const prefix =
    tier === "danger" ? "SAFETY (danger)" : "SAFETY (warn)";
  return `${prefix}: ${reasons.join("; ")}.`;
}
