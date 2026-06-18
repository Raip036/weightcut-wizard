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
        "Aggressive timeline. Less than 3 days to drop more than 5% bodyweight — protocol may not be safe.",
    });
  }

  if (d.isFirstTimeCutter && d.cutDepthPct > 5) {
    out.push({
      severity: "critical",
      code: "FIRST_TIMER_DEEP_CUT",
      message:
        "First cut — keep this one under 5% bodyweight and work with a coach who has done it.",
    });
  }

  if (d.historicalReboundPct != null && d.historicalReboundPct > 10) {
    out.push({
      severity: "warn",
      code: "PRIOR_HIGH_REBOUND",
      message:
        "Your prior cuts show large rebound. Expect a high physiological cost — prioritise recovery.",
    });
  }

  if (d.avgSleepHours7d > 0 && d.avgSleepHours7d < 6.5) {
    out.push({
      severity: "warn",
      code: "SLEEP_DEBT",
      message:
        "Average sleep under 6.5h this week — your tolerance for a cut is reduced.",
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
        "Female athletes have a tighter physiological margin — be ready to abort if signs of distress appear.",
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
}

// Index = daysToWeighIn (0 = weigh-in day, 7 = T-7). Water/sodium/fibre per
// spec §3. Carbs are intentionally NOT in this table — they follow the
// body-weight-scaled RESTRICTION model in `carbsForDay` below (which replaces
// the previous gradual per-kg taper of 3→2→1 g/kg).
const FIGHT_WEEK_ANCHORS: Record<number, DayAnchor> = {
  7: { waterMlPerKg: 100, sodiumMgAt75kg: 2500, fibreNote: "normal" },
  6: { waterMlPerKg: 100, sodiumMgAt75kg: 2500, fibreNote: "normal" },
  5: { waterMlPerKg: 100, sodiumMgAt75kg: 2500, fibreNote: "reduce" },
  4: { waterMlPerKg: 75, sodiumMgAt75kg: 2500, fibreNote: "eliminate" },
  3: { waterMlPerKg: 50, sodiumMgAt75kg: 1000, fibreNote: "eliminate" },
  2: { waterMlPerKg: 30, sodiumMgAt75kg: 500, fibreNote: "low_residue_only" },
  1: { waterMlPerKg: 15, sodiumMgAt75kg: 200, fibreNote: "low_residue_only" },
  0: { waterMlPerKg: 5, sodiumMgAt75kg: 0, fibreNote: "low_residue_only" },
};

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

function carbsForDay(daysToWeighIn: number, bodyWeightKg: number): number {
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
  if (approach === "gradual") return daysToWeighIn + 1;
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
): FightPlanSkeleton {
  const horizon = Math.min(14, Math.max(1, d.daysToWeighIn));
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
    );

    const waterMl = anchor.waterMlPerKg * d.currentWeightKg;
    const waterLitres = round2(waterMl / 1000);

    const sodiumMg = Math.round(anchor.sodiumMgAt75kg * scale);

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
      trainingRecommendation: trainingForDay(dtw),
      sleepTargetHours: sleepTargetForDay(dtw),
    });
  }

  // Expected weight loss decomposition.
  const glycogen = 0.015 * d.currentWeightKg;
  const water = 0.025 * d.currentWeightKg;
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
