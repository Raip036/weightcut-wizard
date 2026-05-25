import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

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
// over" (orange — almost there); > CLOSE is missed (red). Daily weight
// fluctuates more than HIT from water alone, so a tight boundary would feel
// punitive; the CLOSE band lets us encourage rather than scold.
const HIT_TOLERANCE_KG = 0.2;
const CLOSE_TOLERANCE_KG = 0.6;

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

export function CutPaceForecast({
  weightLogs,
  currentWeight,
  targetDate,
  plan: planProp,
}: CutPaceForecastProps) {
  const navigate = useNavigate();

  const data = useMemo(() => {
    const plan = planProp ?? loadPlan();
    if (!plan) return null;

    // Derive the plan-start date so we can place each week on a real
    // calendar range. Prefer the plan's own `targetDate`; fall back to the
    // profile's target_date passed via props.
    const fightDateIso = plan.targetDate ?? targetDate;
    if (!fightDateIso) return null;
    const fightDate = new Date(fightDateIso + "T00:00:00");
    if (Number.isNaN(fightDate.getTime())) return null;

    const totalWeeks = plan.totalWeeks ?? plan.weeklyPlan.length;
    const planStart = new Date(fightDate.getTime() - totalWeeks * 7 * MS_PER_DAY);

    // The "before dehydration" weight is the target of the last non-fight-week
    // row. Falls back to the absolute last week if no fight_week phase exists.
    const nonDehydrationWeeks = plan.weeklyPlan.filter((w) => w.phase !== "fight_week");
    const finalTarget =
      nonDehydrationWeeks[nonDehydrationWeeks.length - 1] ?? plan.weeklyPlan[plan.weeklyPlan.length - 1];

    const todayIso = new Date().toISOString().slice(0, 10);

    // Build a sorted ascending list of weight logs (numeric) once, so per-week
    // lookups are O(weeks * logs) at worst — fine for typical N≤30 logs.
    const logsAsc = [...weightLogs]
      .filter((l) => !Number.isNaN(parseFloat(l.weight_kg)))
      .map((l) => ({ date: l.date, kg: parseFloat(l.weight_kg) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const checkpoints: Checkpoint[] = plan.weeklyPlan.map((row) => {
      const weekStartIso = isoDateNDaysFrom(planStart, (row.week - 1) * 7);
      const weekEndIso = isoDateNDaysFrom(planStart, row.week * 7 - 1);

      // Pick the user's "weight at end of this week" — the latest log in the
      // week's range. Falls back to the most recent log on or before weekEnd
      // when nothing was logged inside the window itself.
      const inWindow = logsAsc.filter((l) => l.date >= weekStartIso && l.date <= weekEndIso);
      const actual = inWindow.length > 0 ? inWindow[inWindow.length - 1].kg : null;

      let status: CheckpointStatus;
      if (todayIso > weekEndIso) {
        // Past week
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

    // Current-week detail: prefer the explicit "current" checkpoint; fall
    // back to the next future checkpoint if today is past the plan window
    // (e.g. fight day has passed).
    const currentIdx =
      checkpoints.findIndex((c) => c.status === "current");
    const focusCheckpoint =
      currentIdx >= 0
        ? checkpoints[currentIdx]
        : checkpoints.find((c) => c.status === "future") ?? checkpoints[checkpoints.length - 1];

    const pastWeeks = checkpoints.filter((c) =>
      c.status === "hit" || c.status === "close" || c.status === "missed" || c.status === "no_data"
    );
    // "Hit" count tolerates the close band — the user was within striking
    // distance of the weekly target, which still earns the encouragement.
    const hitCount = pastWeeks.filter((c) => c.status === "hit" || c.status === "close").length;

    return {
      checkpoints,
      finalTarget,
      focusCheckpoint,
      hitCount,
      pastCount: pastWeeks.length,
      totalWeeks,
    };
  }, [weightLogs, targetDate, planProp]);

  if (!data) return null;

  const { checkpoints, finalTarget, focusCheckpoint, hitCount, pastCount, totalWeeks } = data;

  // Headline status: derived from the focus checkpoint + overall hit rate.
  const onTrack = focusCheckpoint
    ? focusCheckpoint.status === "current"
      ? currentWeight <= focusCheckpoint.targetWeight + HIT_TOLERANCE_KG
      : focusCheckpoint.status === "future" && pastCount > 0 && hitCount === pastCount
    : false;

  const statusChip = (() => {
    if (pastCount === 0 && focusCheckpoint?.status === "current") {
      return { label: "WEEK 1", text: "text-func-protein-blue", dot: "bg-func-protein-blue" };
    }
    if (onTrack) {
      return { label: "ON TRACK", text: "text-func-recovery-green", dot: "bg-func-recovery-green" };
    }
    if (focusCheckpoint && currentWeight > focusCheckpoint.targetWeight + 1.0) {
      return { label: "BEHIND", text: "text-func-warning-yellow", dot: "bg-func-warning-yellow" };
    }
    return { label: "PUSHING", text: "text-func-carbs-orange", dot: "bg-func-carbs-orange" };
  })();

  // Tube-map progress fill: the colored line extends to the last PAST
  // checkpoint — any settled week the user has reached, including misses.
  // "Hit", "close", "missed", and "no_data" all advance the fill; only
  // "current" / "future" stop it. The dot color still encodes hit vs
  // missed; the bar reads as "time elapsed", not "earned distance".
  // The fill width is expressed as a percentage of station-to-station
  // spacing so CSS transitions animate when a new station settles.
  const stationCount = checkpoints.length;
  const lastSettledIdx = (() => {
    let idx = -1;
    for (let i = 0; i < checkpoints.length; i++) {
      const s = checkpoints[i].status;
      if (s === "hit" || s === "close" || s === "missed" || s === "no_data") {
        idx = i;
      } else {
        // "current" or "future" — stop here; everything past this is not yet reached.
        break;
      }
    }
    return idx;
  })();
  // Each station sits at i/(N-1) of the track width. The line stretches
  // from station 0 to the last settled station so the visual reads as
  // "you've reached here."
  const progressPct =
    stationCount > 1 && lastSettledIdx >= 0
      ? (lastSettledIdx / (stationCount - 1)) * 100
      : 0;

  return (
    <button
      type="button"
      onClick={() => { triggerHapticSelection(); navigate("/cut-plan"); }}
      className="w-full card-surface card-glow rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
    >
      {/* Header — status chip + summary count */}
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider ${statusChip.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusChip.dot}`} aria-hidden />
          {statusChip.label}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          <span className="text-foreground font-semibold">{hitCount}/{pastCount}</span> weeks hit
        </span>
      </div>

      {/* Tube-map line. Stations are equally spaced on a flat horizontal
          track. A colored progress line grows from station 0 → last settled
          station; the transition animates whenever a new station settles
          (the `progressPct` style change drives `transition-all`). */}
      <div className="mt-4 px-1">
        <div className="relative h-3.5">
          {/* Background track — sits behind the stations, inset slightly so
              the first / last station circles sit ON the track ends rather
              than past them. */}
          <div className="absolute top-1/2 -translate-y-1/2 left-1.5 right-1.5 h-[3px] rounded-full bg-muted/50" />

          {/* Filled progress line — animates on width change. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 left-1.5 h-[3px] rounded-full bg-primary transition-[width] duration-1000 ease-out"
            style={{
              width: `calc((100% - 12px) * ${progressPct / 100})`,
              boxShadow: progressPct > 0 ? "0 0 8px hsl(var(--primary) / 0.55)" : undefined,
            }}
          />

          {/* Stations */}
          <div className="absolute inset-0 flex justify-between items-center">
            {checkpoints.map((c) => {
              const stationStyle = (() => {
                switch (c.status) {
                  case "hit":
                    return "bg-func-recovery-green border-func-recovery-green text-white";
                  case "close":
                    return "bg-func-carbs-orange border-func-carbs-orange text-white";
                  case "missed":
                    return "bg-func-danger-red border-func-danger-red text-white";
                  case "current":
                    return "bg-background border-func-protein-blue ring-2 ring-func-protein-blue/30";
                  case "no_data":
                    return "bg-muted border-muted-foreground/40";
                  case "future":
                  default:
                    return "bg-background border-muted-foreground/35";
                }
              })();
              const isCurrent = c.status === "current";
              return (
                <span
                  key={c.week}
                  className={`relative h-3 w-3 rounded-full border-2 transition-all duration-300 ${stationStyle}`}
                  aria-label={`Week ${c.week} ${c.status}`}
                >
                  {isCurrent && (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full animate-ping bg-func-protein-blue/40"
                    />
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* Weight numbers — `px-1.5` matches the track inset so the
            first/last labels sit exactly under the first/last station
            centers. Each label is a zero-width flex child with its content
            translated -50% so it self-centers at its parent's position. */}
        <div className="mt-2 flex justify-between items-start px-1.5">
          {checkpoints.map((c) => {
            const isFocus = focusCheckpoint?.week === c.week;
            const tone =
              isFocus
                ? "text-foreground font-semibold"
                : c.status === "hit"
                  ? "text-func-recovery-green/90"
                  : c.status === "close"
                    ? "text-func-carbs-orange/90"
                    : c.status === "missed"
                      ? "text-func-danger-red/90"
                      : "text-muted-foreground/55";
            return (
              <span
                key={c.week}
                className={`text-[10px] tabular-nums leading-tight text-center w-0 ${tone}`}
                style={{ minWidth: 0 }}
              >
                <span className="inline-block -translate-x-1/2 whitespace-nowrap">
                  {c.targetWeight.toFixed(1)}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Detail block. The tube map already shows every week's TARGET
          weight, so this section adds the information the map can't carry:
          the user's CURRENT weight, the delta vs this week's target
          (actionable signal), and how far they still have to travel to
          pre-dehydration. */}
      <div className="mt-4 pt-3.5 border-t border-border/40">
        {focusCheckpoint && focusCheckpoint.status === "current" ? (() => {
          const deltaToWeek = currentWeight - focusCheckpoint.targetWeight;
          const deltaToFinal = currentWeight - finalTarget.targetWeight;
          const weeksLeft = Math.max(0, finalTarget.week - focusCheckpoint.week);

          // Tone the delta chip by which band the user lands in. Matches
          // the station-color logic above so the card reads as one piece.
          const deltaTone =
            deltaToWeek <= HIT_TOLERANCE_KG
              ? { text: "text-func-recovery-green", icon: "checkmarkOutline" as const, label: "on target" }
              : deltaToWeek <= CLOSE_TOLERANCE_KG
                ? { text: "text-func-carbs-orange", icon: "arrowUpOutline" as const, label: "close" }
                : { text: "text-func-danger-red", icon: "arrowUpOutline" as const, label: "over target" };

          return (
            <>
              {/* Hero row — current weight (left) + delta chip (right). */}
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 font-semibold">
                    Your weight
                  </p>
                  <p className="mt-0.5 flex items-baseline gap-1">
                    <span className="display-number font-bold tabular-nums text-foreground text-[22px] leading-none">
                      {currentWeight.toFixed(1)}
                    </span>
                    <span className="text-[12px] text-muted-foreground font-light">kg</span>
                  </p>
                </div>
                <div className={`flex items-center gap-1 ${deltaTone.text} text-right`}>
                  <Icon name={deltaTone.icon} size={12} />
                  <span className="text-[13px] font-semibold tabular-nums">
                    {Math.abs(deltaToWeek).toFixed(1)} kg
                  </span>
                  <span className="text-[11px] font-medium opacity-80">{deltaTone.label}</span>
                </div>
              </div>

              {/* Horizon row — how far the cut still has to go. */}
              <div className="mt-2.5 flex items-center justify-between gap-2 text-[11.5px]">
                <span className="text-muted-foreground">
                  <span className="tabular-nums text-foreground/85 font-semibold">{Math.max(0, deltaToFinal).toFixed(1)} kg</span>
                  {" to pre-dehydration"}
                </span>
                <span className="text-muted-foreground">
                  <span className="tabular-nums text-foreground/85 font-semibold">{weeksLeft}</span>
                  {" "}{weeksLeft === 1 ? "week" : "weeks"} left
                </span>
              </div>
            </>
          );
        })() : focusCheckpoint?.status === "future" ? (
          // Past plan end (fight day passed). Show plan recap instead.
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 font-semibold">
                Plan complete
              </p>
              <p className="mt-0.5 text-[13px] text-foreground/90">
                <span className="display-number font-bold tabular-nums">{hitCount}</span>
                <span className="text-muted-foreground"> of </span>
                <span className="display-number font-bold tabular-nums">{pastCount}</span>
                <span className="text-muted-foreground"> weeks on target</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80 font-semibold">
                Pre-dehydration
              </p>
              <p className="mt-0.5 text-[13px]">
                <span className="display-number font-bold tabular-nums text-foreground">{finalTarget.targetWeight.toFixed(1)}</span>
                <span className="text-muted-foreground font-light"> kg</span>
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </button>
  );
}
