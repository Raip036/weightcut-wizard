import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { DeltaPill } from "./DeltaPill";

interface WeightLog {
  date: string;
  weight_kg: string;
}

interface CutPaceForecastProps {
  weightLogs: WeightLog[];
  currentWeight: number;
  /**
   * Kept for backwards-compatibility with the caller but no longer
   * authoritative — the destination weight now comes from the cut plan
   * (the last non-dehydration week's target weight).
   */
  goalWeight: number;
  targetDate: string | null | undefined;
  /**
   * Authoritative plan source — passed from the parent (which reads
   * `profile.cut_plan_json`). When defined, takes precedence over the
   * legacy `loadPlan()` localStorage cache. The fallback exists so
   * older call sites continue to work until they migrate.
   */
  plan?: PlanData | null;
}

type WeekPhase = "foundation" | "build" | "peak" | "final" | "fight_week";

interface WeekRow {
  week: number;
  targetWeight: number;
  phase: WeekPhase;
}

export interface PlanData {
  weeklyPlan: WeekRow[];
  totalWeeks?: number;
  targetDate?: string;
  currentWeight?: number;
}

type CheckpointStatus = "hit" | "close" | "missed" | "current" | "future" | "no_data";

interface Checkpoint {
  week: number;
  targetWeight: number;
  phase: WeekPhase;
  status: CheckpointStatus;
  actualWeight: number | null;
  weekEndDate: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Tolerance bands. ≤ target+HIT counts as a hit; (HIT, CLOSE] is "slightly
// over" (orange); > CLOSE is missed (red). Drives the per-week dot color.
const HIT_TOLERANCE_KG = 0.2;
const CLOSE_TOLERANCE_KG = 0.6;

// Hero pill — 4-tier summary of "how the focused week is going". Independent
// of the per-week CheckpointStatus used by the dot strip below.
type HeroTier = "on_track" | "slightly_off" | "behind" | "critical" | "no_data";

function tierFromDelta(actual: number | null, target: number): HeroTier {
  if (actual == null) return "no_data";
  const delta = actual - target;
  if (Math.abs(delta) <= 0.5) return "on_track";
  if (delta > 0 && delta <= 1.5) return "slightly_off";
  if (delta > 1.5 && delta <= 2.5) return "behind";
  if (delta > 2.5) return "critical";
  // delta < -0.5: ahead of plan; cutting too fast is its own risk.
  if (delta < -1.0) return "critical";
  return "on_track";
}

const TIER_LABEL: Record<HeroTier, string> = {
  on_track: "ON TRACK",
  slightly_off: "SLIGHTLY OFF",
  behind: "BEHIND",
  critical: "CRITICAL",
  no_data: "NO LOG",
};

// Card left-edge accent — colour-codes the focused week's status in place of
// the old textual status badge. The tier label still rides the card's
// aria-label so the status stays available to screen readers.
const TIER_ACCENT: Record<HeroTier, string> = {
  on_track: "border-l-emerald-500",
  slightly_off: "border-l-amber-500",
  behind: "border-l-orange-500",
  critical: "border-l-rose-500",
  no_data: "border-l-border",
};

function loadPlan(): PlanData | null {
  try {
    const raw = localStorage.getItem("wcw_cut_plan");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.weeklyPlan) || parsed.weeklyPlan.length === 0) return null;
    return parsed as PlanData;
  } catch {
    return null;
  }
}

function isoDateNDaysFrom(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * MS_PER_DAY);
  return d.toISOString().slice(0, 10);
}

// 'Sun May 31' — UTC-anchored so the weekday matches the plan-week boundary.
function fmtWeekDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Days between today and the week's end date (positive = in the future).
function daysUntil(iso: string): number {
  const target = new Date(iso + "T00:00:00Z").getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((target - today) / MS_PER_DAY);
}

// 8-station status row below the hero. Each dot is tappable and drives the
// parent's focused-week state. Colors mirror the per-week semantics.
function DotStrip({
  checkpoints,
  focusedWeek,
  onSelect,
}: {
  checkpoints: Checkpoint[];
  focusedWeek: number | null;
  onSelect: (week: number) => void;
}) {
  // Progress fill stops at the current week (or, if the plan window has
  // passed, at the last completed station) so the two-tone track reads "you
  // are N of M" without the user parsing a single dot.
  const total = checkpoints.length;
  const curIdx = checkpoints.findIndex((c) => c.status === "current");
  const completed = checkpoints.filter(
    (c) => c.status === "hit" || c.status === "close" || c.status === "missed" || c.status === "no_data",
  ).length;
  const progressIdx = curIdx >= 0 ? curIdx : Math.max(0, completed - 1);
  const fillPct = total > 1 ? (progressIdx / (total - 1)) * 100 : 0;

  return (
    <div className="px-1">
      <div className="relative flex items-start justify-between">
        {/* Connecting track — muted base line through the dot centres. */}
        <div
          className="absolute left-1 right-1 top-[7px] h-[3px] rounded-full bg-muted-foreground/15"
          aria-hidden="true"
        />
        {/* Two-tone progress fill — gradient from the start to the current week. */}
        <div
          className="absolute left-1 top-[7px] h-[3px] rounded-full bg-gradient-to-r from-primary to-cyan-400/80 transition-[width] duration-700 ease-out"
          style={{ width: `calc((100% - 0.5rem) * ${fillPct / 100})` }}
          aria-hidden="true"
        />
        {checkpoints.map((c) => {
          const isFocus = focusedWeek === c.week;
          const dotClass = (() => {
            switch (c.status) {
              case "hit":
              case "close":
                return "bg-emerald-400 border-emerald-400";
              case "missed":
                return "bg-orange-400 border-orange-500/70";
              case "current":
                return "bg-primary border-primary ring-2 ring-primary/30 shadow-[0_0_8px_hsl(var(--primary)/0.6)]";
              case "no_data":
                return "bg-transparent border-muted-foreground/40 border-dashed";
              case "future":
              default:
                return "bg-transparent border-muted-foreground/35";
            }
          })();
          return (
            <button
              key={c.week}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticSelection();
                onSelect(c.week);
              }}
              className="relative z-10 flex flex-col items-center gap-1.5 py-1 px-0.5 -mx-0.5 active:scale-95 transition-transform"
              aria-label={`Week ${c.week} ${c.status}`}
              aria-pressed={isFocus}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full border-2 transition-all ${dotClass} ${
                  isFocus ? "scale-125" : ""
                }`}
              />
              {/* Fixed-height slot — label shows only for the focused week so
                  the row isn't an 8-number wall, but spacing stays constant. */}
              <span className="h-3 text-[10px] font-semibold tabular-nums leading-none text-foreground">
                {isFocus ? `W${c.week}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CutPaceForecast({
  weightLogs,
  currentWeight,
  targetDate,
  plan: planProp,
}: CutPaceForecastProps) {
  const navigate = useNavigate();
  // User-driven override of the hero focus. `null` => use the natural focus
  // (current week, or first future week if plan window has passed). Tapping
  // a dot sets this; tapping the same dot again clears it.
  const [focusedWeek, setFocusedWeek] = useState<number | null>(null);

  const data = useMemo(() => {
    const plan = planProp ?? loadPlan();
    if (!plan) return null;

    // Anchor each week on a real calendar range. Prefer the plan's own
    // targetDate; fall back to the profile's target_date passed via props.
    const fightDateIso = plan.targetDate ?? targetDate;
    if (!fightDateIso) return null;
    const fightDate = new Date(fightDateIso + "T00:00:00");
    if (Number.isNaN(fightDate.getTime())) return null;

    const totalWeeks = plan.totalWeeks ?? plan.weeklyPlan.length;
    const planStart = new Date(fightDate.getTime() - totalWeeks * 7 * MS_PER_DAY);

    // "Before dehydration" target = last non-fight-week row.
    const nonDehydrationWeeks = plan.weeklyPlan.filter((w) => w.phase !== "fight_week");
    const finalTarget =
      nonDehydrationWeeks[nonDehydrationWeeks.length - 1] ?? plan.weeklyPlan[plan.weeklyPlan.length - 1];

    const todayIso = new Date().toISOString().slice(0, 10);

    const logsAsc = [...weightLogs]
      .filter((l) => !Number.isNaN(parseFloat(l.weight_kg)))
      .map((l) => ({ date: l.date, kg: parseFloat(l.weight_kg) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const checkpoints: Checkpoint[] = plan.weeklyPlan.map((row) => {
      const weekStartIso = isoDateNDaysFrom(planStart, (row.week - 1) * 7);
      const weekEndIso = isoDateNDaysFrom(planStart, row.week * 7 - 1);

      // End-of-week weight: latest log in the week's window.
      const inWindow = logsAsc.filter((l) => l.date >= weekStartIso && l.date <= weekEndIso);
      const actual = inWindow.length > 0 ? inWindow[inWindow.length - 1].kg : null;

      let status: CheckpointStatus;
      if (todayIso > weekEndIso) {
        if (actual == null) status = "no_data";
        else if (actual <= row.targetWeight + HIT_TOLERANCE_KG) status = "hit";
        else if (actual <= row.targetWeight + CLOSE_TOLERANCE_KG) status = "close";
        else status = "missed";
      } else if (todayIso >= weekStartIso) {
        status = "current";
      } else {
        status = "future";
      }

      return {
        week: row.week,
        targetWeight: row.targetWeight,
        phase: row.phase,
        status,
        actualWeight: actual,
        weekEndDate: weekEndIso,
      };
    });

    // Natural focus: the current week, or the next future week if the plan
    // window has passed (e.g. fight day is behind us).
    const currentIdx = checkpoints.findIndex((c) => c.status === "current");
    const naturalFocus =
      currentIdx >= 0
        ? checkpoints[currentIdx]
        : checkpoints.find((c) => c.status === "future") ?? checkpoints[checkpoints.length - 1];

    const pastWeeks = checkpoints.filter((c) =>
      c.status === "hit" || c.status === "close" || c.status === "missed" || c.status === "no_data"
    );
    const hitCount = pastWeeks.filter((c) => c.status === "hit" || c.status === "close").length;

    // Camp-start weight ≈ the earliest logged weight (falls back to the
    // plan's recorded start). Drives the "distance to pre-dehydration"
    // progress bar's denominator; null-safe so the bar self-hides.
    const startWeight = logsAsc[0]?.kg ?? plan.currentWeight ?? null;

    return {
      checkpoints,
      finalTarget,
      naturalFocus,
      currentIdx,
      hitCount,
      pastCount: pastWeeks.length,
      totalWeeks,
      startWeight,
    };
  }, [weightLogs, targetDate, planProp]);

  if (!data) return null;

  const { checkpoints, finalTarget, naturalFocus, currentIdx, totalWeeks, startWeight } = data;

  // Resolve the focused checkpoint — explicit override first, falling back
  // to the natural focus (current or next-future week).
  const focusCheckpoint =
    (focusedWeek != null && checkpoints.find((c) => c.week === focusedWeek)) ||
    naturalFocus;
  if (!focusCheckpoint) return null;

  const isFinalWeek = focusCheckpoint.week === finalTarget.week;
  const isCurrentWeek = focusCheckpoint.status === "current";
  const isPastWeek =
    focusCheckpoint.status === "hit" ||
    focusCheckpoint.status === "close" ||
    focusCheckpoint.status === "missed" ||
    focusCheckpoint.status === "no_data";
  const isFutureWeek = focusCheckpoint.status === "future";

  // Most-recent log (any date) — used for the "(last Tue)" fallback when the
  // user hasn't logged inside the current calendar week.
  const latestLog = [...weightLogs]
    .filter((l) => !Number.isNaN(parseFloat(l.weight_kg)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();

  // "You" weight per focus mode: past = that week's actual; current = this
  // week's actual or latest log fallback; future = current weight forward-look.
  const displayActual: number | null = isPastWeek
    ? focusCheckpoint.actualWeight
    : isCurrentWeek
      ? (focusCheckpoint.actualWeight ?? (latestLog ? parseFloat(latestLog.weight_kg) : null) ?? (currentWeight || null))
      : currentWeight || null;

  const tier = tierFromDelta(displayActual, focusCheckpoint.targetWeight);
  const heroEyebrow = isFinalWeek
    ? `WEIGH-IN · ${fmtWeekDate(focusCheckpoint.weekEndDate)}`
    : `WEEK ${focusCheckpoint.week} · ${fmtWeekDate(focusCheckpoint.weekEndDate)}`;

  // Top-right chip: days-left for current/future, "Week N of M" for past.
  const chip = (() => {
    if (isCurrentWeek || isFutureWeek) {
      const d = daysUntil(focusCheckpoint.weekEndDate);
      if (d <= 0) return null;
      return { icon: "timeOutline" as const, label: `${d} ${d === 1 ? "day" : "days"} left` };
    }
    return { icon: "calendarOutline" as const, label: `Week ${focusCheckpoint.week} of ${totalWeeks}` };
  })();

  // No log in the current calendar week → drives the inline CTA below.
  const noLogThisWeek = isCurrentWeek && focusCheckpoint.actualWeight == null;
  const kgToFinal = displayActual != null
    ? Math.max(0, displayActual - finalTarget.targetWeight)
    : null;
  const weeksLeftFromFocus = Math.max(0, finalTarget.week - focusCheckpoint.week);

  // Delta value for the "You:" line. Positive = behind/heavy. The colour
  // now lives in <DeltaPill> (unified ramp), so no local tone needed.
  const delta = displayActual != null ? displayActual - focusCheckpoint.targetWeight : null;

  // Progress toward the pre-dehydration target, from camp-start weight.
  // Self-hides when the denominator is non-positive (sparse logs / bad data).
  const totalToLose =
    startWeight != null ? startWeight - finalTarget.targetWeight : null;
  const lost =
    startWeight != null && displayActual != null ? startWeight - displayActual : null;
  const progressPct =
    totalToLose != null && totalToLose > 0 && lost != null
      ? Math.max(0, Math.min(1, lost / totalToLose))
      : null;

  // Dot tap: toggle override. Tapping the natural-focus week clears it.
  const handleDotSelect = (week: number) => {
    setFocusedWeek((prev) => {
      if (prev === week) return null;
      if (currentIdx >= 0 && week === checkpoints[currentIdx].week) return null;
      return week;
    });
  };

  return (
    <div className="space-y-2">
      {/* Dot strip — week timeline sits above the focus card. Kept outside the
          hero button so taps don't bubble into the /cut-plan navigation. */}
      <DotStrip
        checkpoints={checkpoints}
        focusedWeek={focusCheckpoint.week}
        onSelect={handleDotSelect}
      />
      <button
        type="button"
        onClick={() => { triggerHapticSelection(); navigate("/cut-plan"); }}
        aria-label={`${TIER_LABEL[tier]} — ${heroEyebrow}, target ${focusCheckpoint.targetWeight.toFixed(1)} kg`}
        className={`w-full card-surface rounded-2xl border-l-[3px] ${TIER_ACCENT[tier]} p-4 text-left active:scale-[0.99] transition-transform`}
      >
        {/* Subtle fade-in on focus change — key forces remount → re-plays anim. */}
        <div key={focusCheckpoint.week} className="animate-in fade-in duration-200">
          {/* Top row — days-left/position chip. Status is now conveyed by the
              card's left-edge colour accent rather than a textual badge. */}
          {chip && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {chip.label}
              </span>
            </div>
          )}

          {/* Eyebrow — WEEK N · Sun May 31 (or WEIGH-IN · …). */}
          <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/85 font-semibold">
            {heroEyebrow}
          </p>

          {/* Hero target weight. */}
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="display-number font-bold tabular-nums text-foreground text-[32px] leading-none">
              {focusCheckpoint.targetWeight.toFixed(1)}
            </span>
            <span className="text-[13px] text-muted-foreground font-light">kg</span>
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 font-semibold">
            target
          </p>

          {/* You line + context line. Past / current / future each get the
              line that's most actionable for that week. */}
          <div className="mt-3 space-y-1">
            {isPastWeek ? (
              <p className="text-[12.5px] text-muted-foreground">
                {focusCheckpoint.actualWeight != null ? (
                  <>
                    Logged:{" "}
                    <span className="tabular-nums text-foreground/85 font-semibold">
                      {focusCheckpoint.actualWeight.toFixed(1)} kg
                    </span>
                  </>
                ) : (
                  <span className="italic">No log this week</span>
                )}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-muted-foreground">
                {displayActual != null ? (
                  <>
                    <span>
                      You:{" "}
                      <span className="tabular-nums text-foreground/90 font-semibold">
                        {displayActual.toFixed(1)} kg
                      </span>
                    </span>
                    {delta != null && <DeltaPill value={delta} noun="target" />}
                    {isCurrentWeek && noLogThisWeek && latestLog && (
                      <span className="text-[11px] text-muted-foreground/70">
                        (last {fmtWeekDate(latestLog.date)})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="italic">You: no data yet</span>
                )}
              </div>
            )}

            {isCurrentWeek ? (
              <>
                {/* Progress toward pre-dehydration — a bar reads more
                    premium than a comma-jammed sentence. Hidden when the
                    start-weight denominator isn't trustworthy. */}
                {progressPct != null && (
                  <div className="pt-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400 transition-[width] duration-700 ease-out"
                        style={{ width: `${progressPct * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Context line — capped at 2 facts (the chip already shows
                    days-left, so it's dropped here). */}
                <p className="text-[11.5px] text-muted-foreground">
                  {(() => {
                    const parts: string[] = [];
                    if (kgToFinal != null && kgToFinal > 0) {
                      parts.push(`${kgToFinal.toFixed(1)} kg to pre-dehydration`);
                    }
                    if (weeksLeftFromFocus > 0) {
                      parts.push(`${weeksLeftFromFocus} ${weeksLeftFromFocus === 1 ? "week" : "weeks"} left`);
                    }
                    return parts.join(" · ");
                  })()}
                </p>
              </>
            ) : isFutureWeek ? (
              <p className="text-[11.5px] text-muted-foreground">
                Target by {fmtWeekDate(focusCheckpoint.weekEndDate)}
              </p>
            ) : null}
          </div>

          {/* Inline CTA — only when the user hasn't logged this calendar week. */}
          {noLogThisWeek && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticSelection();
                navigate("/weight");
              }}
              className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary active:opacity-80"
            >
              Log this week&apos;s weight
              <Icon name="arrowForwardOutline" size={12} />
            </button>
          )}
        </div>
      </button>
    </div>
  );
}
