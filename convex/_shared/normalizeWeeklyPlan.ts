/** Normalises a weekly plan returned by the LLM so the UI always
 *  receives a full N-week array with sane numeric fields. v2 (2026-05-18)
 *  preserves the new card-timeline fields (`phase`, `heroLine`,
 *  `keyMetric`, `dailyFocus`, `risk`, `recovery`) and synthesises
 *  fallbacks when the LLM forgets one. */

import type { WeekPhase } from "./aiSchemas";

export interface WeeklyPlanRow {
  week: number;
  targetWeight: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  phase: WeekPhase;
  heroLine: string;
  keyMetric: string;
  dailyFocus: string[];
  risk?: string;
  recovery?: string;
}

export interface NormaliseInput {
  weeklyPlan: Partial<WeeklyPlanRow>[] | null | undefined;
  weekCount: number;
  startWeight: number;
  finalTarget: number;
  defaultCalories: number;
  defaultProtein: number;
  defaultCarbs: number;
  defaultFats: number;
  /** Flow type — drives default phase classification. Cutting flows
   *  reserve the last week for `fight_week`; weight-loss flows end on
   *  `final`. */
  flow?: "cut" | "weight_loss";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pickRow(rows: Partial<WeeklyPlanRow>[], week: number) {
  return rows.find((r) => Number(r?.week) === week);
}

function nearestFilled(rows: Partial<WeeklyPlanRow>[], week: number) {
  const sorted = [...rows]
    .filter((r) => r && Number.isFinite(Number(r.week)))
    .sort((a, b) => Math.abs(Number(a.week) - week) - Math.abs(Number(b.week) - week));
  return sorted[0];
}

/** Default phase for week `i` (0-indexed) in a `weekCount`-week plan. */
function defaultPhase(
  i: number,
  weekCount: number,
  flow: "cut" | "weight_loss",
): WeekPhase {
  if (weekCount <= 1) return flow === "cut" ? "fight_week" : "final";
  const isLast = i === weekCount - 1;
  if (isLast) return flow === "cut" ? "fight_week" : "final";
  // Cut flows reserve the LAST week for fight_week and the week immediately
  // before it for the single "final" cut week. Everything earlier is
  // foundation → build → peak by position. (Weight-loss flows have no
  // fight week, so their last week is the "final" handled above.)
  if (flow === "cut" && i === weekCount - 2) return "final";
  if (weekCount <= 2) return "build";
  const pct = i / (weekCount - 1);
  if (pct <= 0.2) return "foundation";
  if (pct <= 0.6) return "build";
  return "peak";
}

/** Trim a string to N chars, breaking on word boundary when possible. */
function trim(str: string | undefined | null, max: number): string {
  if (!str) return "";
  const s = String(str).trim();
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim();
}

/** Coerce a focus field into 2-5 short bullets. Accepts an array, a
 *  newline-separated string, a bullet-prefixed string, or a sentence
 *  list. Falls back to a synthesised bullet from the row's numbers. */
function coerceDailyFocus(
  raw: unknown,
  fallback: { week: number; calories: number; protein_g: number },
): string[] {
  let items: string[] = [];
  if (Array.isArray(raw)) {
    items = raw.map((x) => String(x ?? ""));
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    items = raw
      .split(/\n|•|·|•| - |;|(?:^|\s)[-*]\s/u)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length < 2) {
      items = raw
        .split(/[.!?]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }
  items = items
    .map((s) => trim(s.replace(/^[•·•\-*]\s*/u, ""), 60))
    .filter((s) => s.length >= 2)
    .slice(0, 5);
  if (items.length === 0) {
    items = [
      `Hit ${fallback.calories} kcal / ${fallback.protein_g}g protein`,
      "Weigh in 7am pre-water",
      "Log every meal as you eat it",
    ];
  } else if (items.length === 1) {
    items.push("Weigh in 7am pre-water");
  }
  return items;
}

/** Synthesised hero line when the LLM forgot. Keeps it under 80 chars. */
function synthesisedHero(week: number, phase: WeekPhase, kgRemaining: number): string {
  if (phase === "fight_week") return "Fight week — water, sodium, weigh-in.";
  if (phase === "final") return "Final week — hold the line, finish strong.";
  if (phase === "foundation") return "Lock in the routine — same wake, same weigh-in.";
  if (phase === "peak") return `Peak intensity — ${kgRemaining.toFixed(1)} kg to goal.`;
  return `Week ${week} — steady, repeatable, on pace.`;
}

function synthesisedKeyMetric(deltaKg: number): string {
  if (deltaKg <= 0) return "Hold";
  return `−${deltaKg.toFixed(1)} kg`;
}

export function normaliseWeeklyPlan(input: NormaliseInput): WeeklyPlanRow[] {
  const { weekCount, startWeight, finalTarget } = input;
  const flow = input.flow ?? "cut";
  const rows = Array.isArray(input.weeklyPlan) ? input.weeklyPlan : [];
  const totalDelta = finalTarget - startWeight;
  const out: WeeklyPlanRow[] = [];
  let prevWeight = startWeight;
  for (let i = 0; i < weekCount; i++) {
    const weekNum = i + 1;
    const fraction = weekCount === 1 ? 1 : (i + 1) / weekCount;
    const interp = round1(startWeight + totalDelta * fraction);
    const llm = pickRow(rows, weekNum);
    const fallback = nearestFilled(rows, weekNum);
    const isFinal = i === weekCount - 1;
    const targetWeightRaw = isFinal
      ? finalTarget
      : Number.isFinite(Number(llm?.targetWeight))
        ? Number(llm!.targetWeight)
        : interp;
    const targetWeight = round1(targetWeightRaw);
    const pick = (k: keyof WeeklyPlanRow, def: number) =>
      Number.isFinite(Number(llm?.[k]))
        ? Math.round(Number(llm![k]))
        : Number.isFinite(Number(fallback?.[k]))
          ? Math.round(Number(fallback![k]))
          : def;

    const calories = pick("calories", input.defaultCalories);
    const protein_g = pick("protein_g", input.defaultProtein);
    const carbs_g = pick("carbs_g", input.defaultCarbs);
    const fats_g = pick("fats_g", input.defaultFats);

    // Phase is structural/positional, so assign it deterministically rather
    // than trusting the LLM (which would over-apply "final" to many weeks —
    // a 17-week plan came back with weeks 9-16 all tagged "Final Week").
    const phase: WeekPhase = defaultPhase(i, weekCount, flow);

    const kgThisWeek = Math.max(0, prevWeight - targetWeight);
    const heroLine = trim(
      typeof llm?.heroLine === "string" && llm.heroLine.trim().length > 0
        ? llm.heroLine
        : synthesisedHero(weekNum, phase, Math.max(0, targetWeight - finalTarget)),
      80,
    );
    const keyMetric = trim(
      typeof llm?.keyMetric === "string" && llm.keyMetric.trim().length > 0
        ? llm.keyMetric
        : synthesisedKeyMetric(kgThisWeek),
      24,
    );
    const dailyFocus = coerceDailyFocus(llm?.dailyFocus, {
      week: weekNum,
      calories,
      protein_g,
    });
    const risk =
      typeof llm?.risk === "string" && llm.risk.trim().length > 0
        ? trim(llm.risk, 80)
        : undefined;
    const recovery =
      typeof llm?.recovery === "string" && llm.recovery.trim().length > 0
        ? trim(llm.recovery, 80)
        : undefined;

    out.push({
      week: weekNum,
      targetWeight,
      calories,
      protein_g,
      carbs_g,
      fats_g,
      phase,
      heroLine,
      keyMetric,
      dailyFocus,
      risk,
      recovery,
    });
    prevWeight = targetWeight;
  }
  return out;
}
