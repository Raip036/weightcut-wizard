import type { SubScore, SubScoreKey, ScoringPhase } from "@/scoring/types";

/**
 * Pure, deterministic "how to improve" advice for a Fight Form pillar.
 *
 * No React, no side effects — given a sub-score (its `value` band, `reason`
 * string and `meta`) it returns a one-line `headline` explaining why the
 * pillar sits where it does plus 1–3 concrete, tappable `actions`. Routes
 * mirror (and upgrade) the sheet's existing `LIMITER_ACTIONS` map so a tap
 * lands the user on the page that actually moves that pillar.
 *
 * Copy follows house style: tight, no em-dashes.
 */

export interface PillarAdviceAction {
  label: string;
  route?: string;
}

export interface PillarAdvice {
  headline: string;
  actions: PillarAdviceAction[];
}

// Value at or above which a pillar is considered healthy/affirming.
const HEALTHY = 80;

// Shared "you're doing fine" outcome so every healthy branch reads identically.
function maintain(headline: string): PillarAdvice {
  return { headline, actions: [{ label: "Maintain current routine" }] };
}

/** Pull a numeric meta field, tolerating the `number | string` union. */
function metaNum(sub: SubScore, key: string): number | null {
  const v = sub.meta?.[key];
  return typeof v === "number" ? v : null;
}

function reasonHas(sub: SubScore, needle: string): boolean {
  return (sub.reason ?? "").toLowerCase().includes(needle.toLowerCase());
}

export function pillarAdvice(
  key: SubScoreKey,
  sub: SubScore,
  phase?: ScoringPhase | string | null,
): PillarAdvice {
  switch (key) {
    case "weightCut":
      return weightCutAdvice(sub);
    case "sleep":
      return sleepAdvice(sub);
    case "trainingLoad":
      return trainingLoadAdvice(sub, phase);
    case "wellness":
      return wellnessAdvice(sub);
    case "nutritionAdherence":
      return nutritionAdvice(sub);
    case "recovery":
      return recoveryAdvice(sub);
    default:
      return maintain("On track.");
  }
}

// ─── weightCut ───────────────────────────────────────────────────────────────
function weightCutAdvice(sub: SubScore): PillarAdvice {
  const delta = metaNum(sub, "deltaKg"); // + = heavy/behind, - = light/ahead
  const week = metaNum(sub, "weekNumber");
  const weekStr = week != null ? `week ${week}'s` : "this week's";

  // No plan / no weight yet — engine paused the pillar.
  if (sub.weight === 0 || delta == null) {
    return {
      headline: "Log your weight to track your cut.",
      actions: [
        { label: "Log this morning's weight", route: "/weight" },
        { label: "Check your weekly pace", route: "/weight" },
      ],
    };
  }

  // Behind plan: heavier than target.
  if (delta > 0.3) {
    const kg = delta.toFixed(1);
    return {
      headline: `${kg} kg behind ${weekStr} target.`,
      actions: [
        { label: "Trim ~150 kcal/day", route: "/nutrition" },
        { label: "Add an easy cardio session", route: "/training-calendar" },
        { label: "Check your weekly pace", route: "/weight" },
      ],
    };
  }

  // Cutting too fast: lighter than target.
  if (delta < -0.5) {
    const kg = Math.abs(delta).toFixed(1);
    return {
      headline: `${kg} kg under target — easing the cut protects muscle.`,
      actions: [
        { label: "Add back some calories", route: "/nutrition" },
        { label: "Keep hydration steady", route: "/weight" },
      ],
    };
  }

  // On target band.
  return maintain("On target for this week's weight.");
}

// ─── sleep ───────────────────────────────────────────────────────────────────
function sleepAdvice(sub: SubScore): PillarAdvice {
  // Not enough nights logged — engine paused the pillar.
  if (sub.weight === 0) {
    return {
      headline: "Log a few nights to unlock your sleep score.",
      actions: [
        { label: "Log last night's sleep", route: "/sleep" },
        { label: "Set a wind-down alarm", route: "/sleep" },
      ],
    };
  }

  if (sub.value >= HEALTHY) {
    return maintain("Sleep on track.");
  }

  // Estimate the hours short of a 7.5h target from the linear sleep curve:
  // value = 100 * (avg - 5.5) / 2.0  ⇒  avg = 5.5 + value/50.
  const avg = 5.5 + sub.value / 50;
  const shortBy = Math.max(0, 7.5 - avg);
  const headline =
    shortBy >= 0.3
      ? `Roughly +${shortBy.toFixed(1)}h a night clears the debt.`
      : "Sleep is dipping below your target.";
  return {
    headline,
    actions: [
      { label: "Set a wind-down alarm", route: "/sleep" },
      { label: "Log last night's sleep", route: "/sleep" },
    ],
  };
}

// ─── trainingLoad ────────────────────────────────────────────────────────────
function trainingLoadAdvice(
  sub: SubScore,
  phase?: ScoringPhase | string | null,
): PillarAdvice {
  // Cold start / not enough history — engine paused the pillar.
  if (sub.weight === 0) {
    return {
      headline: "Log a few sessions to build your load baseline.",
      actions: [{ label: "Log today's session", route: "/training-calendar" }],
    };
  }

  if (sub.value >= HEALTHY) {
    return maintain("Training load in the sweet spot.");
  }

  // ACWR reason carries the ratio — high vs. low determines the fix.
  // High ACWR = ramping too fast (overload risk); low = sitting idle.
  const acwr = parseAcwr(sub.reason);
  const tooHigh = acwr != null ? acwr > 1.4 : false;
  const tooLow = acwr != null ? acwr < 0.7 : false;

  if (tooHigh) {
    return {
      headline: "Training load is spiking too fast.",
      actions: [
        { label: "Drop one hard session this week", route: "/training-calendar" },
        { label: "Add a recovery day", route: "/training-calendar" },
      ],
    };
  }

  if (tooLow) {
    const peaking = phase === "peak" || phase === "fightWeek";
    return {
      headline: peaking
        ? "Load is low for this phase."
        : "Training has dropped off your baseline.",
      actions: [
        { label: "Add a session this week", route: "/training-calendar" },
        { label: "Log today's session", route: "/training-calendar" },
      ],
    };
  }

  // Off the sweet spot but ratio unparseable — generic nudge.
  return {
    headline: "Training load is off your usual balance.",
    actions: [
      { label: "Log today's session", route: "/training-calendar" },
      { label: "Add a recovery day", route: "/training-calendar" },
    ],
  };
}

function parseAcwr(reason: string | undefined): number | null {
  if (!reason) return null;
  const m = reason.match(/ACWR\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ─── wellness ────────────────────────────────────────────────────────────────
function wellnessAdvice(sub: SubScore): PillarAdvice {
  // No check-ins logged — engine paused the pillar.
  if (sub.weight === 0) {
    return {
      headline: "Do today's check-in to read your freshness.",
      actions: [{ label: "Do today's 4-tap check-in", route: "/recovery/check-in" }],
    };
  }

  if (sub.value >= HEALTHY) {
    return maintain("Feeling fresh.");
  }

  // Low wellness = high fatigue/stress. Distinguish moderate vs. high from band.
  const headline =
    sub.value < 33
      ? "Fatigue and stress are running high."
      : "Fatigue is building.";
  return {
    headline,
    actions: [
      { label: "Take a rest day", route: "/training-calendar" },
      { label: "Walk for 20 minutes", route: "/recovery" },
      { label: "Do today's 4-tap check-in", route: "/recovery/check-in" },
    ],
  };
}

// ─── nutritionAdherence ──────────────────────────────────────────────────────
function nutritionAdvice(sub: SubScore): PillarAdvice {
  // No target or too few logged days — engine paused the pillar.
  if (sub.weight === 0) {
    const noTarget = reasonHas(sub, "no calorie target");
    return {
      headline: noTarget
        ? "Set a calorie target to score your nutrition."
        : "Log full days to unlock your nutrition score.",
      actions: [
        { label: "Log today's meals", route: "/nutrition" },
        { label: "Hit your protein target", route: "/nutrition" },
      ],
    };
  }

  if (sub.value >= HEALTHY) {
    return maintain("Nutrition close to target.");
  }

  return {
    headline: "Calorie adherence is drifting from target.",
    actions: [
      { label: "Log today's meals", route: "/nutrition" },
      { label: "Tighten to your calorie target", route: "/nutrition" },
    ],
  };
}

// ─── recovery ────────────────────────────────────────────────────────────────
function recoveryAdvice(sub: SubScore): PillarAdvice {
  // No HealthKit signals — recovery sits out of the composite entirely.
  if (sub.weight === 0) {
    return {
      headline: "Connect Apple Health to read recovery.",
      actions: [
        { label: "Enable Apple Health", route: "/recovery" },
        { label: "Do today's 4-tap check-in", route: "/recovery/check-in" },
      ],
    };
  }

  if (sub.value >= HEALTHY) {
    return maintain("Recovery looking strong.");
  }

  return {
    headline: "Recovery is below your baseline.",
    actions: [
      { label: "Prioritise sleep tonight", route: "/sleep" },
      { label: "Take a rest day", route: "/training-calendar" },
    ],
  };
}
