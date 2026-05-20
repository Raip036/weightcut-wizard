/** Post-Zod sanity pass for the top-level plan fields. Groq routinely
 *  ignores `.max()` char limits in JSON mode and stuffs paragraphs
 *  into fields we want to render in tight UI tiles. Truncates strings,
 *  caps array lengths, synthesises phases/personalNote/toughestWeek
 *  when the LLM omits them. v2 (2026-05-18) — pairs with the new
 *  card-timeline `CutPlanSchema`. */

import type { WeeklyPlanRow } from "./normalizeWeeklyPlan";
import type { WeekPhase } from "./aiSchemas";

function trim(str: string | undefined | null, max: number): string {
  if (!str) return "";
  const s = String(str).trim();
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim();
}

const STRUGGLE_COPY: Record<string, string> = {
  cut_stress:
    "You said cut stress hits you hard — this plan front-loads predictable habits so weigh-in days feel like routine, not pressure.",
  low_energy:
    "You flagged low training energy — protein and carb timing are built around your sessions so the gym still feels powerful.",
  binge_eating:
    "You told us binge eating after cuts is the wall — we leave room for one flexible meal weekly so the all-or-nothing trap doesn't snap shut.",
  no_progress:
    "You said you stop seeing progress — this plan tracks the right metric (7-day trend, not daily scale) so motion stays visible even when the scale lies.",
};

function defaultPersonalNote(struggle: string | undefined): string {
  if (struggle && STRUGGLE_COPY[struggle]) return STRUGGLE_COPY[struggle];
  return "Built around your numbers and your timeline — repeat the daily reps and the math handles the rest.";
}

/** Group consecutive weeks of the same phase into a phase summary. */
function derivePhases(
  weeklyPlan: WeeklyPlanRow[],
): {
  name: WeekPhase;
  label: string;
  weekStart: number;
  weekEnd: number;
  intent: string;
}[] {
  if (weeklyPlan.length === 0) return [];
  const groups: { name: WeekPhase; weekStart: number; weekEnd: number }[] = [];
  for (const row of weeklyPlan) {
    const last = groups[groups.length - 1];
    if (last && last.name === row.phase) {
      last.weekEnd = row.week;
    } else {
      groups.push({ name: row.phase, weekStart: row.week, weekEnd: row.week });
    }
  }
  return groups.map((g) => ({
    name: g.name,
    label: PHASE_LABEL[g.name],
    weekStart: g.weekStart,
    weekEnd: g.weekEnd,
    intent: PHASE_INTENT[g.name],
  }));
}

const PHASE_LABEL: Record<WeekPhase, string> = {
  foundation: "Foundation",
  build: "Build",
  peak: "Peak",
  final: "Final Week",
  fight_week: "Fight Week",
};

const PHASE_INTENT: Record<WeekPhase, string> = {
  foundation:
    "Lock in the rhythm — same wake, same weigh-in, same meals every day.",
  build:
    "Steady deficit. Weeks 3-4 may stall — this is glycogen rebalancing, not failure.",
  peak:
    "Drive weight down hard. Toughest sessions land here.",
  final:
    "Hold the deficit, protect lean mass, finish strong.",
  fight_week:
    "Cut carbs → load water → drop salt → make weight.",
};

export interface NormalisePlanInput {
  raw: unknown;
  weeklyPlan: WeeklyPlanRow[];
  primaryStruggle?: string;
}

export function normalisePlanTopLevel(input: NormalisePlanInput) {
  const { raw, weeklyPlan, primaryStruggle } = input;
  const rawObj = (raw ?? {}) as Record<string, unknown>;

  // phases[]
  const rawPhases = Array.isArray(rawObj.phases) ? rawObj.phases : null;
  let phases: ReturnType<typeof derivePhases> = derivePhases(weeklyPlan);
  if (rawPhases && rawPhases.length > 0) {
    const cleaned = rawPhases
      .map((p: unknown) => {
        const phase = (p ?? {}) as Record<string, unknown>;
        const name = ["foundation", "build", "peak", "final", "fight_week"].includes(
          String(phase.name),
        )
          ? (phase.name as WeekPhase)
          : null;
        if (!name) return null;
        return {
          name,
          label: trim(typeof phase.label === "string" ? phase.label : PHASE_LABEL[name], 24),
          weekStart: Math.max(1, Math.min(20, Math.round(Number(phase.weekStart) || 1))),
          weekEnd: Math.max(1, Math.min(20, Math.round(Number(phase.weekEnd) || 1))),
          intent: trim(
            typeof phase.intent === "string" ? phase.intent : PHASE_INTENT[name],
            120,
          ),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (cleaned.length > 0) phases = cleaned;
  }

  // personalNote — falls back to a struggle-specific line
  const personalNote =
    typeof rawObj.personalNote === "string" && rawObj.personalNote.trim().length >= 10
      ? trim(rawObj.personalNote, 280)
      : defaultPersonalNote(primaryStruggle);

  // toughestWeek — defaults to the middle peak/build week
  const rawToughest = rawObj.toughestWeek as
    | { week?: number; reason?: string }
    | undefined;
  let toughestWeek: { week: number; reason: string };
  if (
    rawToughest &&
    Number.isFinite(Number(rawToughest.week)) &&
    typeof rawToughest.reason === "string" &&
    rawToughest.reason.trim().length > 0
  ) {
    toughestWeek = {
      week: Math.max(1, Math.min(20, Math.round(Number(rawToughest.week)))),
      reason: trim(rawToughest.reason, 120),
    };
  } else {
    const middle = Math.max(1, Math.ceil(weeklyPlan.length * 0.6));
    toughestWeek = {
      week: middle,
      reason: "Deepest deficit + hardest sessions stack here. Eat to plan; sleep is non-negotiable.",
    };
  }

  // Tighten narrative
  const summary = trim(
    typeof rawObj.summary === "string" ? rawObj.summary : "",
    500,
  );
  const safetyNotes = trim(
    typeof rawObj.safetyNotes === "string" ? rawObj.safetyNotes : "",
    300,
  );
  const keyPrinciples = Array.isArray(rawObj.keyPrinciples)
    ? (rawObj.keyPrinciples as unknown[])
        .map((p) => trim(String(p ?? ""), 120))
        .filter((p) => p.length > 0)
        .slice(0, 6)
    : undefined;

  // Tighten fight-week block per-field
  const rawFightWeek = rawObj.fightWeek as
    | { lowCarb?: string; sodium?: string; waterLoading?: string; nutrition?: string }
    | undefined;
  const fightWeek = rawFightWeek
    ? {
        lowCarb: trim(rawFightWeek.lowCarb, 240),
        sodium: trim(rawFightWeek.sodium, 240),
        waterLoading: trim(rawFightWeek.waterLoading, 240),
        nutrition: trim(rawFightWeek.nutrition, 240),
      }
    : undefined;

  return {
    phases,
    personalNote,
    toughestWeek,
    summary,
    safetyNotes,
    keyPrinciples,
    fightWeek,
  };
}
