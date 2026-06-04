/**
 * Deterministic rehydration protocol math (server-authoritative).
 *
 * Computes totals (fluid, electrolytes, carbs) and distributes them across an
 * N-hour window in three phases per Reale 2018 / ISSN 2025. The LLM only fills
 * narrative fields (summary, notes, drinkRecipe, foods, carbRefuelPlan).
 */

export interface RehydrationTotals {
  totalFluidLitres: number;
  totalSodiumMg: number;
  totalPotassiumMg: number;
  totalMagnesiumMg: number;
  totalCarbsG: number;
  carbTargetPerKg: string;
  maxCarbsPerHour: number;
  rehydrationWindowHours: number;
  bodyWeightKg: number;
  caffeineLowMg: number;
  caffeineHighMg: number;
}

export interface HourlyStepDeterministic {
  hour: number;
  phase: string;
  fluidML: number;
  sodiumMg: number;
  potassiumMg: number;
  magnesiumMg: number;
  carbsG: number;
}

export interface RehydrationDeterministic {
  totals: RehydrationTotals;
  hourlyProtocol: HourlyStepDeterministic[];
  electrolyteRatio: { sodium: string; potassium: string; magnesium: string };
}

// Default safety warnings — duplicated verbatim from
// src/pages/hydration/types.ts (DEFAULT_WARNINGS) because Convex actions
// cannot import from src/.
export const DEFAULT_WARNINGS = [
  "Do not exceed 1L of fluid per hour. Exceeding gastric emptying rate causes bloating and impairs absorption.",
  "Avoid high-fibre and high-fat foods until after competition. They slow gastric emptying and nutrient absorption.",
  "Monitor urine colour and aim for pale yellow. Clear urine may indicate over-hydration risk (hyponatremia).",
  "If you feel nauseous, dizzy, or confused, stop the protocol and seek medical attention immediately.",
  "This protocol assumes weight was lost via dehydration. If weight was lost via other means, fluid targets may be excessive.",
];

export function computeRehydrationTotals(args: {
  weighInWeightKg: number;
  fightWeightKg?: number;
  hoursUntilFight: number;
}): RehydrationTotals {
  const bw = Math.max(40, args.weighInWeightKg);
  const hours = Math.max(1, Math.round(args.hoursUntilFight));

  // Fluid deficit estimate. 150% replacement of lost fluid.
  const deficitKg = args.fightWeightKg && args.fightWeightKg > args.weighInWeightKg
    ? args.fightWeightKg - args.weighInWeightKg
    : bw * 0.045;
  const totalFluidLitres = round2(Math.max(0.5, deficitKg * 1.5));

  // Electrolytes — 1g Na / L, 250mg K / L, 100mg Mg / L (Reale 2018)
  const totalSodiumMg = Math.round(totalFluidLitres * 1000);
  const totalPotassiumMg = Math.round(totalFluidLitres * 250);
  const totalMagnesiumMg = Math.round(totalFluidLitres * 100);

  // Carbs — 10 g/kg target, capped at 90 g/h gut ceiling.
  const carbCap = hours * 90;
  const totalCarbsG = Math.min(Math.round(bw * 10), carbCap);
  const carbTargetPerKg = `${(totalCarbsG / bw).toFixed(1)} g/kg`;

  // Pre-comp caffeine (3-6 mg/kg).
  const caffeineLowMg = Math.round(bw * 3);
  const caffeineHighMg = Math.round(bw * 6);

  return {
    totalFluidLitres,
    totalSodiumMg,
    totalPotassiumMg,
    totalMagnesiumMg,
    totalCarbsG,
    carbTargetPerKg,
    maxCarbsPerHour: 90,
    rehydrationWindowHours: hours,
    bodyWeightKg: round1(bw),
    caffeineLowMg,
    caffeineHighMg,
  };
}

/**
 * Distribute totals across hours using a 25%/50%/25% phased curve:
 *  - First 25% of hours: 40% of fluid + sodium ("Rapid Rehydration")
 *  - Middle 50%:         40% of fluid + sodium + 60% of carbs ("Active Recovery")
 *  - Last 25%:           20% of fluid + 40% of carbs ("Pre-Comp Top-Up")
 */
export function buildHourlyProtocol(totals: RehydrationTotals): HourlyStepDeterministic[] {
  const hours = totals.rehydrationWindowHours;
  const phaseAEnd = Math.max(1, Math.round(hours * 0.25));
  const phaseBEnd = Math.max(phaseAEnd + 1, Math.round(hours * 0.75));

  const phaseHours: Array<{ phase: string; share: { fluid: number; carbs: number } }> = [];
  for (let h = 1; h <= hours; h++) {
    if (h <= phaseAEnd)
      phaseHours.push({ phase: "Rapid Rehydration", share: { fluid: 0.4, carbs: 0 } });
    else if (h <= phaseBEnd)
      phaseHours.push({ phase: "Active Recovery", share: { fluid: 0.4, carbs: 0.6 } });
    else
      phaseHours.push({ phase: "Pre-Comp Top-Up", share: { fluid: 0.2, carbs: 0.4 } });
  }

  const counts: Record<string, number> = {};
  for (const p of phaseHours) counts[p.phase] = (counts[p.phase] ?? 0) + 1;

  const protocol: HourlyStepDeterministic[] = [];
  for (let i = 0; i < hours; i++) {
    const { phase, share } = phaseHours[i];
    const n = counts[phase] || 1;

    const fluidShare = share.fluid / n;
    const carbsShare = share.carbs / n;

    let fluidML = Math.round(totals.totalFluidLitres * 1000 * fluidShare);
    // Honour gastric emptying cap (max 1000 ml/h).
    if (fluidML > 1000) fluidML = 1000;

    const sodiumMg = Math.round(totals.totalSodiumMg * fluidShare);
    const potassiumMg = Math.round(totals.totalPotassiumMg * fluidShare);
    const magnesiumMg = Math.round(totals.totalMagnesiumMg * fluidShare);
    let carbsG = Math.round(totals.totalCarbsG * carbsShare);
    if (carbsG > totals.maxCarbsPerHour) carbsG = totals.maxCarbsPerHour;

    protocol.push({
      hour: i + 1,
      phase,
      fluidML,
      sodiumMg,
      potassiumMg,
      magnesiumMg,
      carbsG,
    });
  }
  return protocol;
}

export function buildDeterministicRehydration(args: {
  weighInWeightKg: number;
  fightWeightKg?: number;
  hoursUntilFight: number;
}): RehydrationDeterministic {
  const totals = computeRehydrationTotals(args);
  const hourlyProtocol = buildHourlyProtocol(totals);
  return {
    totals,
    hourlyProtocol,
    electrolyteRatio: {
      sodium: "1000 mg/L",
      potassium: "250 mg/L",
      magnesium: "100 mg/L",
    },
  };
}

function round1(n: number) {
  return parseFloat(n.toFixed(1));
}
function round2(n: number) {
  return parseFloat(n.toFixed(2));
}

// ───────────────────────────────────────────────────────────────────────
// Sweat-loss-driven rehydration fallback (sports-science vetted curve)
// ───────────────────────────────────────────────────────────────────────

/**
 * A single fallback hour. Numeric-only — copy (cues, meal labels) is
 * synthesised by the caller in `generateRehydrationProtocol.ts`.
 */
export interface RehydrationFallbackHour {
  hourOffset: number;
  liquidsMl: number;
  cumulativeMl: number;
}

const MAX_ML_PER_HOUR = 1500;

/** Round to the nearest 50 ml. */
function roundTo50(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 50) * 50;
}

/**
 * Deterministic per-hour rehydration curve, used when the AI call fails or
 * returns invalid / out-of-tolerance JSON. Pure — no Convex, no I/O.
 *
 * Algorithm (matches the spec for the AI path so the fallback is a faithful
 * stand-in):
 *   - totalMl = totalLitresTarget * 1000
 *   - Front-load:  H+0 = 20%, H+1 = 17.5%
 *   - Top-up:      final 3h (H-2 / H-1 / H) share 15% split 40 / 40 / 20
 *   - Overnight:   only when gapHours >= 20, H+8..min(15, gap-3) flat 75 ml/h
 *   - Refeed:      remainder spread evenly across daytime hours 2..gap-3
 *                  (excluding overnight hours)
 *   - Clamp any hour to MAX_ML_PER_HOUR (1500), redistribute overflow into
 *     refeed hours
 *   - Round each hour to nearest 50 ml, reconcile rounding drift onto the
 *     largest daytime hour
 *   - Build cumulativeMl
 *
 * Returns EVERY hour from H+0..H+gapHours inclusive (length gapHours + 1).
 */
export function buildRehydrationFallback(
  totalLitresTarget: number,
  gapHours: number,
): RehydrationFallbackHour[] {
  const gap = Math.max(1, Math.round(Number(gapHours) || 0));
  const totalMl = Math.max(0, (Number(totalLitresTarget) || 0) * 1000);

  const n = gap + 1; // hours H+0..H+gap inclusive
  const raw = new Array<number>(n).fill(0);

  // Identify the overnight band (only when the window is long enough).
  const hasOvernight = gap >= 20;
  const overnightStart = 8;
  const overnightEnd = Math.min(15, gap - 3); // inclusive
  const isOvernight = (h: number): boolean =>
    hasOvernight && h >= overnightStart && h <= overnightEnd && overnightEnd >= overnightStart;

  // The three top-up hours at the tail (H-2, H-1, H). Guard tiny windows.
  const topupHours = [gap - 2, gap - 1, gap].filter((h) => h >= 0 && h < n);
  const topupShare = [0.4, 0.4, 0.2];
  const isTopup = (h: number): boolean => topupHours.includes(h);

  // Front-load hours.
  const frontHours: Array<{ h: number; pct: number }> = [];
  if (n > 0) frontHours.push({ h: 0, pct: 0.2 });
  if (n > 1) frontHours.push({ h: 1, pct: 0.175 });
  const isFront = (h: number): boolean => frontHours.some((f) => f.h === h);

  // 1. Front-load.
  let allocated = 0;
  for (const { h, pct } of frontHours) {
    // Don't double-allocate if the window is so short a front hour is also a
    // top-up hour — top-up takes priority for the tail.
    if (isTopup(h)) continue;
    raw[h] = totalMl * pct;
    allocated += raw[h];
  }

  // 2. Top-up (final 3h). 15% of total, split 40/40/20.
  const topupTotal = totalMl * 0.15;
  topupHours.forEach((h, i) => {
    raw[h] = (raw[h] || 0) + topupTotal * topupShare[i];
  });
  allocated += topupTotal;

  // 3. Overnight flat 75 ml/h.
  let overnightMl = 0;
  for (let h = 0; h < n; h++) {
    if (isOvernight(h) && !isTopup(h) && !isFront(h)) {
      raw[h] = 75;
      overnightMl += 75;
    }
  }
  allocated += overnightMl;

  // 4. Refeed: spread remainder evenly across daytime hours 2..gap-3,
  //    excluding overnight / front / top-up hours.
  const refeedHours: number[] = [];
  for (let h = 2; h <= gap - 3; h++) {
    if (h < 0 || h >= n) continue;
    if (isOvernight(h) || isTopup(h) || isFront(h)) continue;
    refeedHours.push(h);
  }
  // Fallback: if the window is too tight to have any refeed hour, dump the
  // remainder onto any non-tail interior hours we can find.
  let refeedTargets = refeedHours;
  if (refeedTargets.length === 0) {
    for (let h = 0; h < n; h++) {
      if (isTopup(h)) continue;
      if (!refeedTargets.includes(h)) refeedTargets.push(h);
    }
  }

  const remainder = Math.max(0, totalMl - allocated);
  if (refeedTargets.length > 0 && remainder > 0) {
    const perHour = remainder / refeedTargets.length;
    for (const h of refeedTargets) raw[h] = (raw[h] || 0) + perHour;
  }

  // 5. Clamp to MAX_ML_PER_HOUR, redistribute overflow into refeed hours
  //    that still have headroom.
  for (let pass = 0; pass < 4; pass++) {
    let overflow = 0;
    for (let h = 0; h < n; h++) {
      if (raw[h] > MAX_ML_PER_HOUR) {
        overflow += raw[h] - MAX_ML_PER_HOUR;
        raw[h] = MAX_ML_PER_HOUR;
      }
    }
    if (overflow <= 0) break;
    const headroom = refeedTargets.filter((h) => raw[h] < MAX_ML_PER_HOUR);
    if (headroom.length === 0) break;
    const add = overflow / headroom.length;
    for (const h of headroom) raw[h] = Math.min(MAX_ML_PER_HOUR, raw[h] + add);
  }

  // 6. Round each to nearest 50 ml.
  const rounded = raw.map(roundTo50);

  // 7. Reconcile rounding drift onto the largest daytime (refeed) hour.
  const roundedTotal = rounded.reduce((a, b) => a + b, 0);
  let drift = roundTo50(totalMl) - roundedTotal;
  if (drift !== 0) {
    const driftPool = refeedTargets.length > 0 ? refeedTargets : rounded.map((_, i) => i);
    let bestH = driftPool[0];
    for (const h of driftPool) if (rounded[h] > rounded[bestH]) bestH = h;
    rounded[bestH] = Math.max(0, Math.min(MAX_ML_PER_HOUR, rounded[bestH] + drift));
  }

  // 8. Build cumulative.
  const out: RehydrationFallbackHour[] = [];
  let cum = 0;
  for (let h = 0; h < n; h++) {
    cum += rounded[h];
    out.push({ hourOffset: h, liquidsMl: rounded[h], cumulativeMl: cum });
  }
  return out;
}
