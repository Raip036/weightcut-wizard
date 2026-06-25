/**
 * Weight Protocol math (foundation module, WP-T1).
 *
 * Pure TS, no Convex imports. Deterministic, server-authoritative. Provides
 * the derived inputs, safety warnings, fight-week day skeleton, and post-
 * weigh-in rehydration hour skeleton consumed by:
 *   - WP-T6  generateFightPlan
 *   - WP-T7  generateRehydrationProtocol
 *   - WP-T20 weight protocol page assembly
 *   - WP-T23 unit tests
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
 *       sections §3 (algorithms) and §6 (research-grounded values).
 *
 * NOTE: The frontend exposes a richer sportLoadMultiplier table from
 * src/lib/sessionTypes.ts. Convex cannot import from src/, so a smaller
 * table is inlined below. If this table drifts from the source of truth,
 * promote it to convex/_shared/sportMultipliers.ts and share via a thin
 * helper that both contexts can re-export.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type CutCategory = "light" | "moderate" | "heavy" | "extreme";

export type Approach = "gradual" | "standard" | "aggressive";

export interface DerivedInputs {
  currentWeightKg: number;
  targetWeightKg: number;
  cutDepthKg: number;
  cutDepthPct: number;
  cutCategory: CutCategory;
  leanBodyMassKg: number;
  weighInIso: string;             // YYYY-MM-DD
  fightIso: string;               // YYYY-MM-DD
  weighInToFightHours: number;
  daysToFight: number;
  daysToWeighIn: number;
  trainingLoadIndex7d: number;
  avgSleepHours7d: number;
  recoveryReadinessToday: number | null;
  historicalReboundKg: number | null;
  historicalReboundPct: number | null;
  sex: "male" | "female" | "other";
  isFirstTimeCutter: boolean;
}

export interface GatheredInputs {
  profile: {
    age: number;
    sex: string;
    heightCm: number;
    currentWeightKg: number;
    tdee?: number | null;
    /** Onboarding weigh-in timing. Canonical: "day_before" | "same_day"
     *  (other strings treated as same-day). Drives the carb-hold branch. */
    weighInTiming?: string | null;
  };
  camp: {
    fightDate: string;
    weighInDate?: string | null;
    weighInTime?: string | null;
    targetWeightKg: number;
  };
  weights28d: Array<{ date: string; weightKg: number }>;
  sessions7d: Array<{
    date: string;
    sessionType: string;
    rpe: number;
    durationMinutes: number;
  }>;
  sleep7d: Array<{ date: string; hours: number }>;
  wellness14d: Array<{
    date: string;
    sorenessLevel?: number;
    fatigueLevel?: number;
    hooperIndex?: number;
  }>;
  priorCamps: Array<{
    startingWeightKg?: number | null;
    endWeightKg?: number | null;
    weightViaDehydration?: number | null;
  }>;
  today: string;
}

export interface SafetyWarning {
  severity: "info" | "warn" | "critical";
  code: string;
  message: string;
}

export interface FightPlanDaySkeleton {
  dayIso: string;
  dayLabel: string;             // 'T-7' | 'T-1' | 'Weigh-in'
  daysToWeighIn: number;
  targetWeightKg: number | null;
  carbsGrams: number;
  waterLitres: number;
  sodiumMg: number;
  fibreNote: "normal" | "reduce" | "eliminate" | "low_residue_only";
  /** Deterministic fibre target (g) for the day — drives the cut-plan UI. */
  fiberGrams: number;
  trainingRecommendation: string;
  sleepTargetHours: number;
}

export interface FightPlanSkeleton {
  days: FightPlanDaySkeleton[];
  expectedWeightLossKg: {
    glycogen: number;
    water: number;
    gut: number;
    fat: number;
    total: number;
  };
}

export interface RehydrationHourSkeleton {
  hourOffset: number;
  liquidsMl: number;
  foodGrams: {
    carbs: number;
    protein: number;
    fat: number;
    sodium: number;
  };
}

export interface RehydrationSkeleton {
  weighInWeightKg: number;
  fightWeightTargetKg: number;
  weighInToFightGapHours: number;
  hours: RehydrationHourSkeleton[];
  totalFluidTargetMl: number;
  totalCarbTargetGrams: number;
  totalSodiumTargetMg: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Sport multiplier (inlined; see header note)
// ────────────────────────────────────────────────────────────────────────────

const SPORT_MULTIPLIERS: Record<string, number> = {
  sparring: 1.3,
  "live grappling": 1.3,
  "pad work": 1.1,
  "bag work": 1.0,
  strength: 1.0,
  conditioning: 0.9,
  run: 0.9,
  mobility: 0.5,
};

function sportMultiplier(sessionType: string): number {
  if (!sessionType) return 1.0;
  return SPORT_MULTIPLIERS[sessionType.trim().toLowerCase()] ?? 1.0;
}

// ────────────────────────────────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Parse a YYYY-MM-DD as midnight UTC. Returns NaN-safe milliseconds. */
function isoMidnightMs(iso: string): number {
  if (!iso) return NaN;
  // Accept full ISO; truncate to date.
  const datePart = iso.slice(0, 10);
  const ms = Date.parse(`${datePart}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** YYYY-MM-DD of `dateMs - offsetDays` (UTC). */
function isoOffsetDays(baseIso: string, offsetDays: number): string {
  const base = isoMidnightMs(baseIso);
  if (!Number.isFinite(base)) return baseIso.slice(0, 10);
  const t = base + offsetDays * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

/** Parse "HH:MM" → hours as float. Defaults to 11.0 if missing/invalid. */
function parseTimeToHours(time: string | null | undefined, fallback = 11): number {
  if (!time || typeof time !== "string") return fallback;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return fallback;
  return h + min / 60;
}

function ceilDaysBetween(targetMs: number, todayMs: number): number {
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return 0;
  const diff = targetMs - todayMs;
  return Math.max(0, Math.ceil(diff / MS_PER_DAY));
}

// ────────────────────────────────────────────────────────────────────────────
// Number helpers
// ────────────────────────────────────────────────────────────────────────────

function clampNonNeg(n: number): number {
  return n < 0 || !Number.isFinite(n) ? 0 : n;
}

/** Round to nearest integer, or to 0.5 if magnitude < 1. */
function roundProtocol(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) < 1) return Math.round(n * 2) / 2;
  return Math.round(n);
}

function round1(n: number): number {
  return Number.isFinite(n) ? parseFloat(n.toFixed(1)) : 0;
}

function round2(n: number): number {
  return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : 0;
}

function round3(n: number): number {
  return Number.isFinite(n) ? parseFloat(n.toFixed(3)) : 0;
}

function categorizeCut(kg: number): CutCategory {
  if (kg < 2) return "light";
  if (kg < 4) return "moderate";
  if (kg <= 6) return "heavy";
  return "extreme";
}

function normalizeSex(raw: string | undefined | null): "male" | "female" | "other" {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (s === "male" || s === "m") return "male";
  if (s === "female" || s === "f") return "female";
  return "other";
}

// ────────────────────────────────────────────────────────────────────────────
// 2. computeDerived
// ────────────────────────────────────────────────────────────────────────────

export function computeDerived(
  inputs: GatheredInputs,
  _approach: Approach,
): DerivedInputs {
  const { profile, camp, weights28d, sessions7d, sleep7d, priorCamps, today } = inputs;

  // Most recent weight log; else profile weight.
  let currentWeightKg = Number(profile.currentWeightKg) || 0;
  if (Array.isArray(weights28d) && weights28d.length > 0) {
    const sorted = weights28d
      .filter((w) => Number.isFinite(w.weightKg) && typeof w.date === "string")
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (sorted.length > 0 && Number.isFinite(sorted[0].weightKg)) {
      currentWeightKg = Number(sorted[0].weightKg);
    }
  }
  currentWeightKg = Math.max(0, currentWeightKg);

  const targetWeightKg = Math.max(0, Number(camp.targetWeightKg) || 0);
  const cutDepthKg = clampNonNeg(currentWeightKg - targetWeightKg);
  const cutDepthPct =
    currentWeightKg > 0 ? (cutDepthKg / currentWeightKg) * 100 : 0;
  const cutCategory = categorizeCut(cutDepthKg);

  // Lean body mass (Boer). 'other' uses male formula per spec.
  const sex = normalizeSex(profile.sex);
  const heightCm = Math.max(0, Number(profile.heightCm) || 0);
  const leanBodyMassKg =
    sex === "female"
      ? 0.252 * currentWeightKg + 0.473 * heightCm - 48.3
      : 0.407 * currentWeightKg + 0.267 * heightCm - 19.2;

  // Dates.
  const fightIso = (camp.fightDate || "").slice(0, 10);
  const weighInIso =
    camp.weighInDate && camp.weighInDate.length >= 10
      ? camp.weighInDate.slice(0, 10)
      : fightIso
        ? isoOffsetDays(fightIso, -1)
        : "";

  const weighInHourLocal = parseTimeToHours(camp.weighInTime, 11);
  const fightHourLocal = 18; // default fight time per spec
  const weighInMsBase = isoMidnightMs(weighInIso);
  const fightMsBase = isoMidnightMs(fightIso);

  let weighInToFightHours = 0;
  if (Number.isFinite(weighInMsBase) && Number.isFinite(fightMsBase)) {
    const weighInMs = weighInMsBase + weighInHourLocal * 3_600_000;
    const fightMs = fightMsBase + fightHourLocal * 3_600_000;
    const diffH = (fightMs - weighInMs) / 3_600_000;
    weighInToFightHours = diffH > 0 ? diffH : 0;
  }

  const todayMs = isoMidnightMs(today);
  const daysToFight = ceilDaysBetween(fightMsBase, todayMs);
  const daysToWeighIn = ceilDaysBetween(weighInMsBase, todayMs);

  // Training load 7d.
  let trainingLoadIndex7d = 0;
  for (const s of sessions7d ?? []) {
    const rpe = Number(s.rpe) || 0;
    const dur = Number(s.durationMinutes) || 0;
    if (rpe <= 0 || dur <= 0) continue;
    trainingLoadIndex7d += rpe * dur * sportMultiplier(s.sessionType);
  }

  // Avg sleep hours 7d.
  let avgSleepHours7d = 0;
  if (Array.isArray(sleep7d) && sleep7d.length > 0) {
    const vals = sleep7d
      .map((s) => Number(s.hours))
      .filter((h) => Number.isFinite(h) && h >= 0);
    if (vals.length > 0) {
      avgSleepHours7d = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  // Recovery readiness (today): no source signal in GatheredInputs → null.
  // Caller may extend the input shape; passthrough for future-proofing.
  const recoveryReadinessToday: number | null = null;

  // Historical rebound. Approximation:
  // For each priorCamp with both startingWeightKg and endWeightKg, treat
  // startingWeightKg as fight-week start and (1 - weightViaDehydration/100) as
  // the share of the cut that was *not* dehydration (i.e., fat / lean / gut /
  // glycogen that would not bounce back). The implied post-weigh-in floor is
  // approximated as startingWeightKg * (1 - weightViaDehydration/100). Rebound
  // is endWeightKg − that floor.
  let historicalReboundKg: number | null = null;
  let historicalReboundPct: number | null = null;
  if (Array.isArray(priorCamps) && priorCamps.length > 0) {
    const samples: number[] = [];
    for (const p of priorCamps) {
      const start = Number(p.startingWeightKg);
      const end = Number(p.endWeightKg);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const dehydPct = Number(p.weightViaDehydration);
      const nonDehydFraction = Number.isFinite(dehydPct)
        ? Math.max(0, Math.min(1, 1 - dehydPct / 100))
        : 1;
      const impliedFloor = start * nonDehydFraction;
      samples.push(end - impliedFloor);
    }
    if (samples.length > 0) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      historicalReboundKg = round2(mean);
      historicalReboundPct =
        currentWeightKg > 0 ? round2((mean / currentWeightKg) * 100) : null;
    }
  }

  const isFirstTimeCutter = !Array.isArray(priorCamps) || priorCamps.length === 0;

  return {
    currentWeightKg: round2(currentWeightKg),
    targetWeightKg: round2(targetWeightKg),
    cutDepthKg: round2(cutDepthKg),
    cutDepthPct: round2(cutDepthPct),
    cutCategory,
    leanBodyMassKg: round2(Math.max(0, leanBodyMassKg)),
    weighInIso,
    fightIso,
    weighInToFightHours: round2(weighInToFightHours),
    daysToFight,
    daysToWeighIn,
    trainingLoadIndex7d: round1(trainingLoadIndex7d),
    avgSleepHours7d: round2(avgSleepHours7d),
    recoveryReadinessToday,
    historicalReboundKg,
    historicalReboundPct,
    sex,
    isFirstTimeCutter,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. buildSafetyWarnings
// ────────────────────────────────────────────────────────────────────────────

export function buildSafetyWarnings(
  d: DerivedInputs,
  _priorCamps: GatheredInputs["priorCamps"],
): SafetyWarning[] {
  const out: SafetyWarning[] = [];

  if (d.cutDepthPct > 8) {
    out.push({
      severity: "critical",
      code: "DEPTH_GT_8PCT",
      message:
        "This cut exceeds 8% bodyweight. See a coach or sports doctor before continuing.",
    });
  }

  if (d.cutDepthPct > 5 && d.daysToWeighIn < 3) {
    out.push({
      severity: "critical",
      code: "AGGRESSIVE_TIMELINE",
      message:
        "Aggressive timeline. Less than 3 days to drop more than 5% bodyweight. This protocol may not be safe.",
    });
  }

  if (d.isFirstTimeCutter && d.cutDepthPct > 5) {
    out.push({
      severity: "critical",
      code: "FIRST_TIMER_DEEP_CUT",
      message:
        "First cut. Keep this one under 5% bodyweight and work with a coach who has done it.",
    });
  }

  if (d.historicalReboundPct != null && d.historicalReboundPct > 10) {
    out.push({
      severity: "warn",
      code: "PRIOR_HIGH_REBOUND",
      message:
        "Your prior cuts show large rebound. Expect a high physiological cost, so prioritise recovery.",
    });
  }

  if (d.avgSleepHours7d > 0 && d.avgSleepHours7d < 6.5) {
    out.push({
      severity: "warn",
      code: "SLEEP_DEBT",
      message:
        "Average sleep under 6.5h this week, so your tolerance for a cut is reduced.",
    });
  }

  if (d.recoveryReadinessToday != null && d.recoveryReadinessToday < 40) {
    out.push({
      severity: "warn",
      code: "LOW_READINESS",
      message:
        "Recovery readiness is in the at-risk band. Consider deloading before the cut window.",
    });
  }

  if (d.sex === "female" && d.cutDepthPct > 7) {
    out.push({
      severity: "warn",
      code: "FEMALE_CAP",
      message:
        "Female athletes have a tighter physiological margin, so be ready to abort if signs of distress appear.",
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. buildFightPlanSkeleton
// ────────────────────────────────────────────────────────────────────────────

interface DayAnchor {
  /** Water mL/kg (will be scaled with currentWeightKg/75 below). */
  waterMlPerKg: number;
  /** Absolute sodium mg (scaled with currentWeightKg/75 below). */
  sodiumMgAt75kg: number;
  fibreNote: "normal" | "reduce" | "eliminate" | "low_residue_only";
  /** Deterministic per-day fibre target in grams. Authoritative (the AI no
   *  longer supplies this) so the cut-plan UI always renders the correct taper
   *  instead of "None" on every day. */
  fiberGrams: number;
}

// ── CANONICAL VALIDATED FIGHT-WEEK CURVE — SINGLE SOURCE OF TRUTH ──
// Keyed by daysToWeighIn (0 = weigh-in morning, 7 = T-7). These exported records
// are consumed by BOTH plan generators — this skeleton (generateFightPlan) AND
// generateCutPlan's day-by-day bundles — so every cut plan the app produces uses
// IDENTICAL water/sodium/fibre numbers and cannot drift apart. Carbs are NOT
// here: they follow `carbsForDay` (day-before depletes; same-day holds).
//
// Evidence base — Reale, Slater & Burke 2018 water-loading RCT (IJSNEM 28:565);
// Reale/Burke acute-weight-loss reviews; ISSN 2025 combat-sports position stand;
// aldosterone-escape renal physiology:
//   • WATER: 4-day load at 100 mL/kg (T-5..T-2), then a SHARP flush to 15 mL/kg
//     at T-1 — the cut lands here, while renal output is still elevated — then
//     NIL on weigh-in morning (T-0). T-7..T-6 sit at normal (~40 mL/kg). Holding
//     the load to T-2 or tapering it gently blunts the flush, so we don't.
//   • SODIUM: a GRADUAL taper that begins ~T-5 (NOT a flat hold then a late
//     cliff). Aldosterone-escape natriuresis takes ~3-5 days to develop, so the
//     taper has to start 4-5 days out for the renal water loss to land during
//     fight week. It stays MODERATE through the high-water load days (T-4..T-2 =
//     26→18 mg/kg ≈ 1350-1950 mg at 75 kg) — the hyponatremia danger zone is
//     NEAR-ZERO sodium combined with high water, not a moderate taper — then
//     eases to a low floor at the T-1 flush / weigh-in (never literally 0).
//   • FIBRE: low-residue (≤13 g) from ~T-4 (48-96 h out) captures ~1.5% BW of gut
//     content; restricting earlier just adds GI stress for no extra loss.
export const FIGHT_WEEK_WATER_ML_PER_KG: Record<number, number> = {
  7: 40, 6: 40, 5: 100, 4: 100, 3: 100, 2: 100, 1: 15, 0: 0,
};
export const FIGHT_WEEK_SODIUM_MG_PER_KG: Record<number, number> = {
  7: 35, 6: 35, 5: 30, 4: 26, 3: 22, 2: 18, 1: 12, 0: 6,
};
export const FIGHT_WEEK_FIBRE_GRAMS: Record<number, number> = {
  7: 30, 6: 30, 5: 18, 4: 13, 3: 12, 2: 10, 1: 8, 0: 0,
};

// ── SAME-DAY weigh-in: WATER-NEUTRAL overrides ──
// Same-day fighters have NO recovery window, so we do NOT water-load or flush —
// dehydration carried into a same-day bout costs performance you can't get back.
// Weight is made with held carbs + low-residue fibre (shared FIBRE table above)
// + a LIGHT sodium/water taper only. Water stays near-normal (~40 mL/kg) with a
// small trim on the last day; sodium eases down over the final 2 days (never a
// loading spike or a cliff). FIBRE is shared with the day-before curve.
export const SAMEDAY_WATER_ML_PER_KG: Record<number, number> = {
  7: 40, 6: 40, 5: 40, 4: 40, 3: 40, 2: 40, 1: 32, 0: 30,
};
export const SAMEDAY_SODIUM_MG_PER_KG: Record<number, number> = {
  // Gentle monotonic taper over the final ~3 days (never a spike) — re-salting
  // happens AFTER the scale via the refeed block, not as a weigh-in-day bump.
  7: 35, 6: 35, 5: 35, 4: 35, 3: 35, 2: 30, 1: 25, 0: 22,
};
export function fightWeekFibreNote(
  daysToWeighIn: number,
): DayAnchor["fibreNote"] {
  if (daysToWeighIn >= 6) return "normal";
  if (daysToWeighIn === 5) return "reduce";
  if (daysToWeighIn === 0) return "eliminate";
  return "low_residue_only";
}

const FIGHT_WEEK_ANCHORS: Record<number, DayAnchor> = Object.fromEntries(
  [7, 6, 5, 4, 3, 2, 1, 0].map((d) => [
    d,
    {
      waterMlPerKg: FIGHT_WEEK_WATER_ML_PER_KG[d],
      // Stored at-75kg so the skeleton's `* scale` (weight/75) yields the
      // canonical per-kg value: (mgPerKg * 75) * (weight/75) = mgPerKg * weight.
      sodiumMgAt75kg: FIGHT_WEEK_SODIUM_MG_PER_KG[d] * 75,
      fibreNote: fightWeekFibreNote(d),
      fiberGrams: FIGHT_WEEK_FIBRE_GRAMS[d],
    } as DayAnchor,
  ]),
) as Record<number, DayAnchor>;

/**
 * Fight-week carb target in grams — a body-weight-scaled RESTRICTION rather
 * than a gradual taper. Mirrors the onboarding cut-plan model:
 *   • Weigh-in (T-0):  fixed 30 g — glycogen is already stripped by here.
 *   • T-1 … T-5:       0.5 g/kg, capped strictly under 50 g — the low-carb
 *                      restriction that drives glycogen + bound water down.
 *   • T-6 … T-7:       2.0 g/kg — the early fight-week step-down.
 *   • T-8+:            3.0 g/kg — normal carbs (outside the manipulation window).
 * Scales with bodyweight but the restriction phase never reaches 50 g
 * (60 kg → 30 g, 80 kg → 40 g, 100 kg → 49 g cap).
 */
const CARB_WEIGH_IN_G = 30;
const CARB_RESTRICT_PER_KG = 0.5;
const CARB_RESTRICT_MAX_G = 49; // strictly under 50 g
const CARB_EARLY_PER_KG = 2.0;
const CARB_NORMAL_PER_KG = 3.0;

function carbsForDay(
  daysToWeighIn: number,
  bodyWeightKg: number,
  weighInSameDay: boolean,
): number {
  // SAME-DAY weigh-in: the athlete fights with no rehydration window, so
  // glycogen must stay loaded — carbs are HELD at maintenance EVERY day (no
  // depletion). Weight is made through water-loading + sodium taper + fibre
  // (and a little sweating) only. This mirrors the onboarding carb-hold path.
  if (weighInSameDay) return Math.round(CARB_NORMAL_PER_KG * bodyWeightKg);
  if (daysToWeighIn <= 0) return CARB_WEIGH_IN_G;
  if (daysToWeighIn >= 8) return Math.round(CARB_NORMAL_PER_KG * bodyWeightKg);
  if (daysToWeighIn >= 6) return Math.round(CARB_EARLY_PER_KG * bodyWeightKg);
  return Math.min(CARB_RESTRICT_MAX_G, Math.round(CARB_RESTRICT_PER_KG * bodyWeightKg));
}

/** The approach shifts the curve by a day: gradual = lighter (use the next,
 *  higher-carb day), aggressive = harsher (use the previous day), standard =
 *  no shift. Used for BOTH the anchor lookup and the carb target so the three
 *  approaches stay meaningful. */
function approachShiftedDay(daysToWeighIn: number, approach: Approach): number {
  if (approach === "gradual") {
    // Gradual = a LIGHTER cut: shift the early water-load / carb ramp a day
    // later so the loading phase is shorter and gentler. But the T-1 FLUSH and
    // the NIL-water weigh-in morning (T-0) are what actually make weight — a dry
    // flush day, then nothing on the scale — and must hold for EVERY approach.
    // Shifting those would drag the full 7.6 L load onto T-1 and leave 1.1 L on
    // weigh-in morning (no flush at all), so we only shift T-2 and earlier.
    return daysToWeighIn >= 2 ? daysToWeighIn + 1 : daysToWeighIn;
  }
  if (approach === "aggressive") return Math.max(0, daysToWeighIn - 1);
  return daysToWeighIn;
}

function anchorForDay(daysToWeighIn: number, approach: Approach): DayAnchor {
  // Per spec: gradual shifts right (T-4 uses T-5 values → lighter); aggressive
  // shifts left (T-4 uses T-3 values → harsher). Clamp to the table range.
  let key = approachShiftedDay(daysToWeighIn, approach);
  if (key < 0) key = 0;
  if (key > 7) key = 7;
  return FIGHT_WEEK_ANCHORS[key];
}

function trainingForDay(daysToWeighIn: number): string {
  if (daysToWeighIn >= 4) {
    return "Reduced volume technical work; conditioning at low intensity";
  }
  if (daysToWeighIn >= 2) {
    return "Light technical drills only; no sparring, no conditioning";
  }
  return "Rest or 20-min light movement";
}

function sleepTargetForDay(daysToWeighIn: number): number {
  return daysToWeighIn >= 2 ? 8.5 : 8.0;
}

function dayLabelForDay(daysToWeighIn: number): string {
  return daysToWeighIn === 0 ? "Weigh-in" : `T-${daysToWeighIn}`;
}

export function buildFightPlanSkeleton(
  d: DerivedInputs,
  effectiveApproach: Approach,
  // SAME-DAY weigh-in holds carbs (no glycogen depletion) AND is water-neutral
  // (no water-load / flush) — see SAMEDAY_* curves. Fibre is shared with the
  // day-before curve. Defaults to false (day-before full taper) so legacy
  // callers and tests keep the original behaviour.
  weighInSameDay: boolean = false,
): FightPlanSkeleton {
  // The water-loading / cut window is ALWAYS the final 7 days up to weigh-in,
  // regardless of how far out the athlete currently is — most fighters only
  // start manipulating ~7 days out, and anything earlier is overkill. So we
  // cap the horizon at 7 (T-7 .. weigh-in = 8 cards). If the athlete is already
  // inside 7 days, daysToWeighIn naturally produces a shorter window.
  const horizon = Math.min(7, Math.max(1, d.daysToWeighIn));
  const scale = d.currentWeightKg > 0 ? d.currentWeightKg / 75 : 1;
  const days: FightPlanDaySkeleton[] = [];

  for (let dtw = horizon; dtw >= 0; dtw--) {
    const anchor = anchorForDay(dtw, effectiveApproach);

    // Carbs follow the body-weight-scaled restriction model (see carbsForDay),
    // NOT the anchor table. Approach still shifts the day so gradual/aggressive
    // remain meaningful; standard uses the raw day → matches the spec curve.
    const carbsGrams = carbsForDay(
      approachShiftedDay(dtw, effectiveApproach),
      d.currentWeightKg,
      weighInSameDay,
    );

    // Day-before uses the validated water-load + flush curve (the anchor table).
    // Same-day is WATER-NEUTRAL: a near-normal water + light sodium taper from
    // the SAMEDAY_* curves, no loading or flush. Fibre is shared (anchor) either
    // way. Clamp the lookup to 0..7 to match the anchor key range.
    const dtwKey = Math.min(7, Math.max(0, dtw));
    const waterMlPerKg = weighInSameDay
      ? SAMEDAY_WATER_ML_PER_KG[dtwKey]
      : anchor.waterMlPerKg;
    const waterMl = waterMlPerKg * d.currentWeightKg;
    const waterLitres = round2(waterMl / 1000);

    const sodiumMg = weighInSameDay
      ? Math.round(SAMEDAY_SODIUM_MG_PER_KG[dtwKey] * d.currentWeightKg)
      : Math.round(anchor.sodiumMgAt75kg * scale);

    // Linear interpolation of target weight from current → target across horizon.
    // dtw === horizon → currentWeightKg ; dtw === 0 → targetWeightKg.
    const progress = horizon > 0 ? (horizon - dtw) / horizon : 1;
    const targetWeightKgForDay = round2(
      d.currentWeightKg - progress * d.cutDepthKg,
    );

    const dayIso = d.weighInIso ? isoOffsetDays(d.weighInIso, -dtw) : "";

    days.push({
      dayIso,
      dayLabel: dayLabelForDay(dtw),
      daysToWeighIn: dtw,
      targetWeightKg: targetWeightKgForDay,
      carbsGrams,
      waterLitres,
      sodiumMg,
      fibreNote: anchor.fibreNote,
      fiberGrams: anchor.fiberGrams,
      trainingRecommendation: trainingForDay(dtw),
      sleepTargetHours: sleepTargetForDay(dtw),
    });
  }

  // Expected weight loss decomposition. Same-day weigh-in holds carbs (no
  // glycogen stripped) and is water-neutral (only a light water trim), so far
  // less comes off as glycogen/bound-water — the cut is mostly gut + fat.
  const glycogen = weighInSameDay ? 0 : 0.015 * d.currentWeightKg;
  const water = weighInSameDay ? 0.008 * d.currentWeightKg : 0.025 * d.currentWeightKg;
  const gut = 0.012 * d.currentWeightKg;
  const fat = Math.max(0, d.cutDepthKg - (glycogen + water + gut));
  const total = glycogen + water + gut + fat;

  return {
    days,
    expectedWeightLossKg: {
      glycogen: round3(glycogen),
      water: round3(water),
      gut: round3(gut),
      fat: round3(fat),
      total: round3(total),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. buildRehydrationSkeleton
// ────────────────────────────────────────────────────────────────────────────

interface LiquidsBand {
  /** Inclusive lower bound (hours since weigh-in). */
  fromH: number;
  /** Exclusive upper bound. Use Infinity for tail. */
  toH: number;
  /** mL per hour, before clamp / scaling. */
  mlPerHr: number;
  /** Optional first-hours cap (e.g. clamp first 2 hours to 500 mL/hr). */
  firstHoursCap?: { hours: number; mlPerHr: number };
}

const LIQUIDS_BANDS: LiquidsBand[] = [
  { fromH: 0, toH: 4, mlPerHr: 800, firstHoursCap: { hours: 2, mlPerHr: 500 } },
  { fromH: 4, toH: 12, mlPerHr: 400 },
  { fromH: 12, toH: 20, mlPerHr: 250 },
  { fromH: 20, toH: Infinity, mlPerHr: 150 },
];

function liquidsRateAt(hour: number): number {
  for (const band of LIQUIDS_BANDS) {
    if (hour >= band.fromH && hour < band.toH) {
      if (band.firstHoursCap && hour < band.fromH + band.firstHoursCap.hours) {
        return band.firstHoursCap.mlPerHr;
      }
      return band.mlPerHr;
    }
  }
  return 150;
}

function sodiumRateAt(hour: number): number {
  if (hour < 4) return 1000;
  if (hour < 12) return 500;
  if (hour < 24) return 300;
  return 200;
}

function carbsRateAt(hour: number, weighInWeightKg: number): number {
  // Per spec: spread per-kg dosing evenly within each band.
  if (hour < 4) return (1.0 * weighInWeightKg) / 4;          // ~1.0 g/kg over 4h
  if (hour < 12) return (0.6 * weighInWeightKg) / 8;          // ~0.6 g/kg over 8h
  if (hour < 20) return (0.3 * weighInWeightKg) / 8;          // ~0.3 g/kg over 8h
  return 0;
}

function proteinPulseAt(hour: number): number {
  // 30g pulses every 4h starting at H+0 — simplest deterministic distribution.
  return hour % 4 === 0 ? 30 : 0;
}

function fatPulseAt(hour: number): number {
  if (hour < 4) return 0;                  // avoid slowing gastric emptying
  return hour % 4 === 0 ? 5 : 0;           // ~5g per meal pulse
}

export function buildRehydrationSkeleton(d: DerivedInputs): RehydrationSkeleton {
  const weighInWeightKg = Math.max(0, d.targetWeightKg);
  const fightWeightTargetKg = weighInWeightKg + d.cutDepthKg;
  const gap = Math.min(30, Math.max(2, d.weighInToFightHours));
  const gapWholeHours = Math.max(2, Math.round(gap));

  // ── Liquids: per-hour rates with optional scale-up to meet 150% deficit ──
  const baseRates: number[] = [];
  for (let h = 0; h <= gapWholeHours; h++) {
    baseRates.push(liquidsRateAt(h));
  }
  const baseSum = baseRates.reduce((a, b) => a + b, 0);
  const desiredTotal = Math.max(0, 1500 * d.cutDepthKg); // mL

  let scale = 1;
  if (desiredTotal > baseSum && baseSum > 0) {
    // Scale up only the H+0..H+4 window (the "rapid rehydration" window)
    // because spec calls for raising those rates if total is short.
    const earlyHours = baseRates.slice(0, Math.min(5, baseRates.length));
    const lateHours = baseRates.slice(Math.min(5, baseRates.length));
    const earlySum = earlyHours.reduce((a, b) => a + b, 0);
    const lateSum = lateHours.reduce((a, b) => a + b, 0);
    const needed = desiredTotal - lateSum;
    if (earlySum > 0 && needed > 0) {
      scale = needed / earlySum;
    }
  }

  const hours: RehydrationHourSkeleton[] = [];
  for (let h = 0; h <= gapWholeHours; h++) {
    let liquidsMl = baseRates[h];
    if (h <= 4) liquidsMl = Math.min(1000, liquidsMl * scale);
    liquidsMl = roundProtocol(liquidsMl);

    hours.push({
      hourOffset: h,
      liquidsMl,
      foodGrams: {
        carbs: roundProtocol(carbsRateAt(h, weighInWeightKg)),
        protein: roundProtocol(proteinPulseAt(h)),
        fat: roundProtocol(fatPulseAt(h)),
        sodium: roundProtocol(sodiumRateAt(h)),
      },
    });
  }

  const totalFluidTargetMl = Math.max(0, Math.round(1500 * d.cutDepthKg));
  const totalCarbTargetGrams = Math.round(9 * weighInWeightKg);
  const totalSodiumTargetMg = hours.reduce(
    (sum, r) => sum + r.foodGrams.sodium,
    0,
  );

  return {
    weighInWeightKg: round2(weighInWeightKg),
    fightWeightTargetKg: round2(fightWeightTargetKg),
    weighInToFightGapHours: round2(gap),
    hours,
    totalFluidTargetMl,
    totalCarbTargetGrams,
    totalSodiumTargetMg,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. buildRehydrationHourlyPlan (WP-T7b)
//
// HOUR-BY-HOUR post-weigh-in rehydrate + refuel plan that ALSO understands a
// SLEEP window and a fight time, distributing fluid/electrolytes/carbs across
// WAKING hours only. Mirrors the fight-plan pattern: every numeric here is
// deterministic + server-authoritative; the AI only authors cue / meal copy.
//
// Research constants (hard rules — see spec §3 / §6):
//   • Total to ingest = 1.4 × deficitLitres (140% of fluid lost).
//   • Hourly ceiling 1.0 L/h (1.2 L only hour 1). Taper floor 0.2 L/h awake.
//   • Sodium: first ~55% of volume at ORS strength ~1600 mg/L; later ~700 mg/L.
//   • Carbs: ~6 g/kg total, ≤60 g/h, start H+2, taper to 0 in final ~75 min.
//   • Sleep hours → 0 fluid + 0 carbs ("Sleep — no intake").
//   • Pre-sleep top-up: last 1–2 waking hours before sleep → ceiling + salty snack.
//   • Wake dose: first waking hour after sleep → ~0.9 L ORS bolus.
//   • Pre-fight buffer: final 30–60 min → sips only (≤200 ml), no carbs/boluses.
// ────────────────────────────────────────────────────────────────────────────

/** Phase a rehydration hour belongs to — drives the timeline's grouping. */
export type RehydrationPlanPhase =
  | "front-load"
  | "refeed"
  | "pre-sleep"
  | "sleep"
  | "wake-dose"
  | "top-up"
  | "pre-fight";

/** A single, fully-resolved per-hour row of the deterministic plan. */
export interface RehydrationPlanHour {
  /** Hours after weigh-in. H+0 is the weigh-in hour. */
  hourOffset: number;
  /** Fluid to ingest this hour, ml. 0 during sleep. */
  liquidsMl: number;
  /** Sodium delivered with this hour's fluid, mg (mass-independent, per-litre). */
  sodiumMg: number;
  /** Carbohydrate to eat/drink this hour, g. 0 during sleep + pre-fight. */
  carbG: number;
  /** Whether to treat this hour as a meal slot. */
  isMeal: boolean;
  /** Meal name when `isMeal`, else null. */
  mealLabel: string | null;
  /** True for hours inside the sleep window (no intake). */
  isSleep: boolean;
  /** Phase classification. */
  phase: RehydrationPlanPhase;
  /** Imperative cue text (deterministic default; AI may overwrite). */
  cue: string;
}

export interface RehydrationHourlyPlan {
  hours: RehydrationPlanHour[];
  /** Litres we actually scheduled across waking hours. */
  totalLitresScheduled: number;
  /** Total carbohydrate scheduled, g. */
  totalCarbScheduled: number;
  /** Total sodium scheduled, mg. */
  totalSodiumScheduled: number;
  /** Whether a sleep block was placed. */
  hasSleep: boolean;
  /** First/last waking hour offsets bordering the sleep block (null when none). */
  sleepStartHour: number | null;
  sleepEndHour: number | null;
  /**
   * Set when deficit/waking-hours exceeds the hourly ceiling so we cannot
   * safely replace the full target — the UI surfaces a "you cut too much for
   * this gap" warning.
   */
  deficitTooLarge: boolean;
}

export interface BuildRehydrationHourlyPlanArgs {
  /** Litres of fluid lost (≈ sweat-loss kg). Drives total volume. */
  deficitLitres: number;
  /** Whole hours from weigh-in to fight. */
  hoursUntilFight: number;
  /** Hour-of-day the athlete falls asleep (0–24), e.g. 23. Null/undefined ⇒ no sleep. */
  sleepStartHour?: number | null;
  /** Hour-of-day the athlete wakes (0–24), e.g. 7. */
  sleepEndHour?: number | null;
  /** Wall-clock hour-of-day at weigh-in (0–24). Default 11:00 per spec. */
  weighInClockHour?: number | null;
  /** Body mass (kg) at weigh-in, for carb scaling. ≤0 ⇒ skip carbs gracefully. */
  bodyMassKg?: number | null;
}

// ── Hard research constants ──────────────────────────────────────────────────
const REHYDRATION_REPLACEMENT_FACTOR = 1.4; // 140% of fluid lost
const HOURLY_CEILING_ML = 1000; // 1.0 L/h hard cap
const HOUR_ONE_CEILING_ML = 1200; // 1.2 L allowed only in hour 1
const TAPER_FLOOR_ML = 200; // 0.2 L/h floor while awake
const SODIUM_STRONG_MG_PER_L = 1600; // ORS strength (~70 mmol/L Na)
const SODIUM_WEAK_MG_PER_L = 700; // maintenance (~30 mmol/L Na)
const SODIUM_STRONG_VOLUME_FRACTION = 0.55; // first ~55% of volume at ORS strength
const CARB_G_PER_KG = 6; // refeed default
const CARB_MAX_PER_HOUR = 60; // gut tolerance ceiling
const WAKE_DOSE_ML = 900; // fresh ORS bolus on waking
const PRE_FIGHT_BUFFER_ML = 200; // sips only in the final hour
const MIN_SHORT_GAP_FOR_SLEEP = 10; // gaps < 10h are treated as same-day (no sleep)

/** Round to nearest 50 ml. */
function roundTo50ml(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 50) * 50;
}

/** Normalise an hour-of-day to [0, 24). */
function normHour(h: number): number {
  const r = ((h % 24) + 24) % 24;
  return r;
}

/**
 * Decide which absolute hour offsets fall inside the sleep window.
 *
 * The sleep window is expressed as wall-clock hours (sleepStartHour →
 * sleepEndHour, possibly wrapping past midnight). We project it onto the
 * H+offset axis using the weigh-in clock hour. An offset h sits at wall-clock
 * (weighInClockHour + h) mod 24; it's a sleep hour when that clock time is in
 * [sleepStart, sleepEnd). We only mark the FIRST overnight occurrence so a very
 * long (multi-night) gap still produces a single contiguous block near the
 * front — fights are scheduled within ~36h so one night is the norm.
 */
function computeSleepOffsets(
  hoursUntilFight: number,
  weighInClockHour: number,
  sleepStartHour: number,
  sleepEndHour: number,
): Set<number> {
  const offsets = new Set<number>();
  const start = normHour(sleepStartHour);
  const end = normHour(sleepEndHour);
  // Window length in hours (handles wrap past midnight). 0 ⇒ treat as no sleep.
  const windowLen = ((end - start + 24) % 24) || 0;
  if (windowLen <= 0) return offsets;

  let foundFirst = false;
  let sleeping = false;
  for (let h = 0; h <= hoursUntilFight; h++) {
    const clock = normHour(weighInClockHour + h);
    // Distance from sleep start, wrapping; in-window when < windowLen.
    const sinceStart = (clock - start + 24) % 24;
    const inWindow = sinceStart < windowLen;
    if (inWindow && !foundFirst) {
      foundFirst = true;
      sleeping = true;
    }
    if (foundFirst) {
      if (inWindow && sleeping) {
        // Never sleep through the final hour (must be awake to fight).
        if (h < hoursUntilFight) offsets.add(h);
      } else if (!inWindow && sleeping) {
        // Exited the first window — stop (single contiguous night).
        break;
      }
    }
  }
  return offsets;
}

/**
 * Deterministic hour-by-hour rehydration + refeed plan.
 *
 * Distributes 140% of the fluid deficit across WAKING hours with a front-loaded
 * descending ramp (each hour clamped to [floor, ceiling], overflow pushed to the
 * next earliest unclamped hour). Layers sodium (per-litre), carbs (g/kg, capped,
 * tapering to 0 pre-fight), a sleep block (0 intake), a pre-sleep top-up + salty
 * snack, a wake-dose bolus, and a pre-fight sips-only buffer. Pure — no I/O.
 */
export function buildRehydrationHourlyPlan(
  args: BuildRehydrationHourlyPlanArgs,
): RehydrationHourlyPlan {
  const deficitLitres = Math.max(0, Number(args.deficitLitres) || 0);
  const gap = Math.max(1, Math.round(Number(args.hoursUntilFight) || 0));
  const bodyMassKg = Math.max(0, Number(args.bodyMassKg) || 0);
  const weighInClockHour = normHour(
    Number.isFinite(args.weighInClockHour as number)
      ? (args.weighInClockHour as number)
      : 11,
  );

  // ── Sleep block. Only when both bounds present AND the gap is long enough
  //    to actually span a night. Short same-day gaps get no sleep. ──
  const sleepRequested =
    args.sleepStartHour != null &&
    args.sleepEndHour != null &&
    Number.isFinite(args.sleepStartHour) &&
    Number.isFinite(args.sleepEndHour);
  const sleepOffsets =
    sleepRequested && gap >= MIN_SHORT_GAP_FOR_SLEEP
      ? computeSleepOffsets(
          gap,
          weighInClockHour,
          args.sleepStartHour as number,
          args.sleepEndHour as number,
        )
      : new Set<number>();
  const hasSleep = sleepOffsets.size > 0;

  // ── Hours 0..gap inclusive. Final hour (gap) is the pre-fight buffer. ──
  const n = gap + 1;
  const wakingOffsets: number[] = [];
  for (let h = 0; h < n; h++) {
    if (!sleepOffsets.has(h)) wakingOffsets.push(h);
  }

  // The pre-fight buffer hour (final hour) is awake but sips-only — it does NOT
  // receive ramp volume; we hand it a fixed small dose at the end.
  const preFightHour = gap;
  const wakeHour = hasSleep
    ? wakingOffsets.find((h) => h > Math.max(...Array.from(sleepOffsets))) ??
      null
    : null;

  // Hours eligible for the ramp = waking hours minus the pre-fight buffer.
  const rampHours = wakingOffsets.filter((h) => h !== preFightHour);

  // ── Total volume + ceiling check. ──
  const targetMl = deficitLitres * REHYDRATION_REPLACEMENT_FACTOR * 1000;
  const totalCeilingMl = rampHours.reduce(
    (sum, h) => sum + (h === 0 ? HOUR_ONE_CEILING_ML : HOURLY_CEILING_ML),
    0,
  );
  const deficitTooLarge = targetMl > totalCeilingMl + 1;
  // What we can actually schedule (never above the aggregate ceiling).
  const scheduleMl = Math.min(targetMl, totalCeilingMl);

  // ── Front-loaded descending ramp across rampHours. Weight earlier hours
  //    more (linear descending), then clamp to [floor, ceiling] and push
  //    overflow to the next earliest unclamped hour. ──
  const fluidByOffset = new Map<number, number>();
  for (const h of rampHours) fluidByOffset.set(h, 0);

  if (rampHours.length > 0 && scheduleMl > 0) {
    const m = rampHours.length;
    // Descending weights m, m-1, …, 1 over the ordered ramp hours.
    const sortedRamp = [...rampHours].sort((a, b) => a - b);
    const weights = sortedRamp.map((_, i) => m - i);
    const weightSum = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < sortedRamp.length; i++) {
      const h = sortedRamp[i];
      fluidByOffset.set(h, (scheduleMl * weights[i]) / weightSum);
    }

    // Clamp + redistribute overflow forward (to the next earliest unclamped
    // hour). Several passes converge because total ≤ aggregate ceiling.
    const ceilingFor = (h: number) =>
      h === 0 ? HOUR_ONE_CEILING_ML : HOURLY_CEILING_ML;
    for (let pass = 0; pass < sortedRamp.length + 2; pass++) {
      let overflow = 0;
      for (const h of sortedRamp) {
        const v = fluidByOffset.get(h) ?? 0;
        const cap = ceilingFor(h);
        if (v > cap) {
          overflow += v - cap;
          fluidByOffset.set(h, cap);
        }
      }
      if (overflow <= 0.01) break;
      // Find earliest hours with headroom and pour the overflow in order.
      let remaining = overflow;
      for (const h of sortedRamp) {
        if (remaining <= 0.01) break;
        const v = fluidByOffset.get(h) ?? 0;
        const cap = ceilingFor(h);
        const headroom = cap - v;
        if (headroom <= 0) continue;
        const add = Math.min(headroom, remaining);
        fluidByOffset.set(h, v + add);
        remaining -= add;
      }
      if (remaining > 0.01) break; // no headroom left
    }

    // Apply the awake floor: any ramp hour below the floor is bumped up.
    for (const h of sortedRamp) {
      const v = fluidByOffset.get(h) ?? 0;
      if (v > 0 && v < TAPER_FLOOR_ML) fluidByOffset.set(h, TAPER_FLOOR_ML);
    }
  }

  // ── Pre-sleep top-up: the last 1–2 waking hours BEFORE the sleep block get
  //    pushed to the ceiling (bank fluid before bed). ──
  const preSleepOffsets = new Set<number>();
  if (hasSleep) {
    const firstSleep = Math.min(...Array.from(sleepOffsets));
    for (let k = 1; k <= 2; k++) {
      const h = firstSleep - k;
      if (h >= 0 && !sleepOffsets.has(h) && h !== preFightHour) {
        preSleepOffsets.add(h);
      }
    }
    for (const h of preSleepOffsets) {
      const cap = h === 0 ? HOUR_ONE_CEILING_ML : HOURLY_CEILING_ML;
      fluidByOffset.set(h, cap);
    }
  }

  // ── Wake dose: first waking hour after sleep → fresh ORS bolus. ──
  if (wakeHour != null && wakeHour !== preFightHour) {
    fluidByOffset.set(wakeHour, WAKE_DOSE_ML);
  }

  // ── Carbs. ~6 g/kg total, ≤60 g/h, start H+2, taper to 0 in the final
  //    ~75 min (the last carb hour before pre-fight gets a half dose, the
  //    pre-fight buffer gets none). 0 during sleep. ──
  const carbByOffset = new Map<number, number>();
  for (let h = 0; h < n; h++) carbByOffset.set(h, 0);
  const totalCarbTarget = bodyMassKg > 0 ? CARB_G_PER_KG * bodyMassKg : 0;

  if (totalCarbTarget > 0) {
    // Carb-eligible: waking, hour >= 2, not pre-fight buffer.
    const carbHours = wakingOffsets
      .filter((h) => h >= 2 && h !== preFightHour)
      .sort((a, b) => a - b);
    if (carbHours.length > 0) {
      // Even base dose, capped per hour; the FINAL carb hour is halved (taper).
      const lastCarbHour = carbHours[carbHours.length - 1];
      // Provisional even split across full-dose-equivalent slots (last = 0.5).
      const equivalentSlots = carbHours.length - 0.5;
      let perHour = totalCarbTarget / Math.max(1, equivalentSlots);
      perHour = Math.min(perHour, CARB_MAX_PER_HOUR);
      for (const h of carbHours) {
        const dose = h === lastCarbHour ? perHour * 0.5 : perHour;
        carbByOffset.set(h, Math.round(dose));
      }
    }
  }

  // ── Meals: pre-sleep salty snack (always a meal when present) + ~2–4 refeed
  //    meals across the window at carb-bearing hours. ──
  // Meal labels are intentionally GENERIC TIMING markers — we do NOT prescribe
  // a specific food here (the app surfaces separate meal ideas). The marker
  // (isMeal) stays; only the food naming is removed.
  const mealLabels = new Map<number, string>();
  // Pre-sleep top-up marker.
  for (const h of preSleepOffsets) {
    mealLabels.set(h, "Top up before bed");
  }
  // Refeed meals: first carb hour, mid-window, and (if room) a late refeed.
  // All carry the same neutral timing label — no prescribed dish.
  const carbBearing = [...carbByOffset.entries()]
    .filter(([h, g]) => g > 0 && !mealLabels.has(h) && !sleepOffsets.has(h))
    .map(([h]) => h)
    .sort((a, b) => a - b);
  if (carbBearing.length > 0) {
    const first = carbBearing[0];
    mealLabels.set(first, "Fuel up");
    const mid = carbBearing[Math.floor(carbBearing.length / 2)];
    if (!mealLabels.has(mid)) {
      mealLabels.set(mid, "Fuel up");
    }
    const last = carbBearing[carbBearing.length - 1];
    if (carbBearing.length >= 4 && !mealLabels.has(last)) {
      mealLabels.set(last, "Fuel up");
    }
  }

  // ── Sodium: per-litre, mass-independent. First ~55% of CUMULATIVE volume at
  //    ORS strength, the remainder at maintenance strength. ──
  // We resolve fluid first so cumulative volume is known.
  const orderedFluid: Array<{ h: number; ml: number }> = [];
  for (let h = 0; h < n; h++) {
    if (sleepOffsets.has(h)) {
      orderedFluid.push({ h, ml: 0 });
      continue;
    }
    if (h === preFightHour) {
      orderedFluid.push({ h, ml: roundTo50ml(PRE_FIGHT_BUFFER_ML) });
      continue;
    }
    orderedFluid.push({ h, ml: roundTo50ml(fluidByOffset.get(h) ?? 0) });
  }
  const scheduledTotalMl = orderedFluid.reduce((s, x) => s + x.ml, 0);
  const strongCutoffMl = scheduledTotalMl * SODIUM_STRONG_VOLUME_FRACTION;

  let cumulativeMl = 0;
  const sodiumByOffset = new Map<number, number>();
  for (const { h, ml } of orderedFluid) {
    const litres = ml / 1000;
    // Split this hour's litres at the strong/weak boundary.
    const strongRemaining = Math.max(0, strongCutoffMl - cumulativeMl) / 1000;
    const strongLitres = Math.min(litres, strongRemaining);
    const weakLitres = litres - strongLitres;
    const sodium =
      strongLitres * SODIUM_STRONG_MG_PER_L + weakLitres * SODIUM_WEAK_MG_PER_L;
    sodiumByOffset.set(h, Math.round(sodium));
    cumulativeMl += ml;
  }

  // ── Assemble rows. ──
  const lastSleep = hasSleep ? Math.max(...Array.from(sleepOffsets)) : null;
  const firstSleep = hasSleep ? Math.min(...Array.from(sleepOffsets)) : null;

  const phaseFor = (h: number): RehydrationPlanPhase => {
    if (sleepOffsets.has(h)) return "sleep";
    if (h === preFightHour) return "pre-fight";
    if (preSleepOffsets.has(h)) return "pre-sleep";
    if (wakeHour != null && h === wakeHour) return "wake-dose";
    if (h <= 1) return "front-load";
    if (lastSleep != null && h > lastSleep) return "top-up";
    return "refeed";
  };

  const cueFor = (
    h: number,
    ml: number,
    carbG: number,
    isMeal: boolean,
    phase: RehydrationPlanPhase,
  ): string => {
    switch (phase) {
      case "sleep":
        return "Sleep, no intake";
      case "pre-fight":
        return "Fast sugar now: gummy bears, honey, or a gel.";
      case "pre-sleep":
        return `Top up to ~${ml} ml ORS and top up before bed`;
      case "wake-dose":
        return `Fresh ORS bolus ~${ml} ml on waking to restart absorption`;
      case "front-load":
        return `Front-load: sip ~${ml} ml ORS steadily, do not chug`;
      default:
        if (isMeal) return `Fuel up, see meal ideas; sip ~${ml} ml ORS alongside`;
        if (carbG > 0) return `Sip ~${ml} ml ORS; ~${carbG} g easy carbs`;
        return `Sip ~${ml} ml ORS steadily`;
    }
  };

  const hours: RehydrationPlanHour[] = orderedFluid.map(({ h, ml }) => {
    const isSleep = sleepOffsets.has(h);
    const phase = phaseFor(h);
    const carbG = isSleep || h === preFightHour ? 0 : carbByOffset.get(h) ?? 0;
    const isMeal = mealLabels.has(h);
    const mealLabel = isMeal ? mealLabels.get(h) ?? null : null;
    const sodiumMg = isSleep ? 0 : sodiumByOffset.get(h) ?? 0;
    return {
      hourOffset: h,
      liquidsMl: isSleep ? 0 : ml,
      sodiumMg,
      carbG,
      isMeal,
      mealLabel,
      isSleep,
      phase,
      cue: cueFor(h, ml, carbG, isMeal, phase),
    };
  });

  const totalLitresScheduled = round2(
    hours.reduce((s, x) => s + x.liquidsMl, 0) / 1000,
  );
  const totalCarbScheduled = Math.round(
    hours.reduce((s, x) => s + x.carbG, 0),
  );
  const totalSodiumScheduled = Math.round(
    hours.reduce((s, x) => s + x.sodiumMg, 0),
  );

  return {
    hours,
    totalLitresScheduled,
    totalCarbScheduled,
    totalSodiumScheduled,
    hasSleep,
    sleepStartHour: firstSleep,
    sleepEndHour: lastSleep,
    deficitTooLarge,
  };
}
