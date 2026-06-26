import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { planStartIso, isoShift, resolveTotalWeeks } from "@/scoring/planWeek";
import { deltaVerdict } from "./DeltaPill";

interface WeightLog {
  date: string;
  weight_kg: string;
}

interface CutPaceForecastProps {
  weightLogs: WeightLog[];
  currentWeight: number;
  /**
   * Kept for backwards-compatibility with the caller but no longer
   * authoritative, the destination weight now comes from the cut plan
   * (the last non-dehydration week's target weight).
   */
  goalWeight: number;
  targetDate: string | null | undefined;
  /**
   * Authoritative plan source, passed from the parent (which reads
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

// Tolerance bands. ≤ target+HIT counts as a hit; (HIT, CLOSE] is "slightly
// over" (orange); > CLOSE is missed (red). Drives the per-week dot color.
const HIT_TOLERANCE_KG = 0.2;
const CLOSE_TOLERANCE_KG = 0.6;

// Hero pill, 4-tier summary of "how the focused week is going". Independent
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

// Closeness-ring geometry for the weekly gap gauge (radius 42 in a 100x100
// viewBox). The tier label still rides the card's aria-label so status stays
// available to screen readers.
const RING_C = 2 * Math.PI * 42;

export function loadPlan(): PlanData | null {
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

// 'Sun May 31', UTC-anchored so the weekday matches the plan-week boundary.
function fmtWeekDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Per-week segment fill, the colour IS the status, so the row reads as one
// continuous progress meter rather than dots on a line. Hollow fills
// (future / no_data) stay recessive so the completed "weight" of the camp is
// obvious at a glance.
function segmentFill(status: CheckpointStatus): string {
  switch (status) {
    case "hit":     return "bg-emerald-400";
    case "close":   return "bg-emerald-400/85";
    case "missed":  return "bg-orange-400";
    case "current": return "bg-gradient-to-r from-primary to-cyan-400";
    case "no_data": return "bg-muted-foreground/10 border border-dashed border-muted-foreground/45";
    case "future":
    default:        return "bg-muted-foreground/15";
  }
}

// Segmented capsule track, one rounded pill split into per-week segments.
// Replaces the old dots-on-a-line. All segments are equal width; the current
// week is distinguished by its colour fill + crisp inset ring (no glow/
// box-shadow, that janks on the native webview), so "you are here" reads by
// colour rather than by an uneven, longer bar. Each segment stays individually
// tappable and drives the parent's focused-week state.
function WeekTrack({
  checkpoints,
  focusedWeek,
  onSelect,
}: {
  checkpoints: Checkpoint[];
  focusedWeek: number | null;
  onSelect: (week: number) => void;
}) {
  const total = checkpoints.length;
  // Thinner bars as the plan grows so a 12-week camp stays a sleek hairline
  // rather than a chunky ladder.
  const baseH = total <= 6 ? "h-2.5" : total <= 9 ? "h-2" : "h-1.5";

  return (
    <div className="px-1">
      <div className="flex items-start gap-1" role="group" aria-label="Camp week progress">
        {checkpoints.map((c) => {
          const isFocus = focusedWeek === c.week;
          const isCurrent = c.status === "current";
          return (
            <button
              key={c.week}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticSelection();
                onSelect(c.week);
              }}
              // Generous vertical hit area (py-2) around the thin visual bar so
              // taps stay comfortable even when segments are slim.
              className="group relative flex min-w-0 flex-col items-center py-2 active:scale-[0.97] transition-transform"
              style={{ flexGrow: 1, flexBasis: 0 }}
              aria-label={`Week ${c.week} ${c.status}`}
              aria-pressed={isFocus}
            >
              <span
                className={[
                  "w-full rounded-full transition-all duration-300",
                  // Same height as every other bar, the focused week is
                  // marked by its white ring + label, never by enlarging.
                  baseH,
                  segmentFill(c.status),
                  isFocus
                    ? "ring-2 ring-inset ring-white/70"
                    : isCurrent
                      ? "ring-2 ring-inset ring-primary/40"
                      : "",
                ].join(" ")}
              />
              {/* Fixed-height label slot, only the focused week prints "W{n}"
                  so the row never becomes a wall of numbers. */}
              <span className="mt-1.5 h-3 text-[10px] font-semibold tabular-nums leading-none text-foreground">
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
  // Swipe tracking for the hero card, lets the user flick left/right to move
  // between weeks. `suppressClick` stops a horizontal swipe from also firing
  // the card's tap-to-/cut-plan navigation.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const data = useMemo(() => {
    const plan = planProp ?? loadPlan();
    if (!plan) return null;

    // Anchor each week on a real calendar range. Prefer the plan's own
    // targetDate; fall back to the profile's target_date passed via props.
    const fightDateIso = plan.targetDate ?? targetDate;
    if (!fightDateIso) return null;
    const fightDate = new Date(fightDateIso + "T00:00:00");
    if (Number.isNaN(fightDate.getTime())) return null;

    const totalWeeks = resolveTotalWeeks(plan.weeklyPlan, plan.totalWeeks);
    if (totalWeeks <= 0) return null;
    const planStartIsoStr = planStartIso(fightDateIso, totalWeeks);

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
      const weekStartIso = isoShift(planStartIsoStr, (row.week - 1) * 7);
      const weekEndIso = isoShift(planStartIsoStr, row.week * 7 - 1);

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

  const { checkpoints, finalTarget, naturalFocus, currentIdx, totalWeeks } = data;

  // Resolve the focused checkpoint, explicit override first, falling back
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

  // Most-recent log (any date), used for the "(last Tue)" fallback when the
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
  // The last NON-dehydration week is the final cut target, NOT the weigh-in
  // (the weigh-in happens in the fight week, which this forecast excludes).
  // Labelling it "WEIGH-IN" mislabelled e.g. week 7 of an 8-week plan.
  const heroEyebrow = isFinalWeek
    ? `FINAL WEEK · ${fmtWeekDate(focusCheckpoint.weekEndDate)}`
    : `WEEK ${focusCheckpoint.week} · ${fmtWeekDate(focusCheckpoint.weekEndDate)}`;

  // Top-right chip: the days-left countdown is omitted for the current/future
  // week since it's inferable from the week + end-date eyebrow; past weeks keep
  // a "Week N of M" positional chip so the focused week stays oriented.
  const chip = (() => {
    if (isCurrentWeek || isFutureWeek) return null;
    return { icon: "calendarOutline" as const, label: `Week ${focusCheckpoint.week} of ${totalWeeks}` };
  })();

  // No log in the current calendar week → drives the inline CTA below.
  const noLogThisWeek = isCurrentWeek && focusCheckpoint.actualWeight == null;

  // Delta value for the "You:" line. Positive = behind/heavy. The colour
  // now lives in <DeltaPill> (unified ramp), so no local tone needed.
  const delta = displayActual != null ? displayActual - focusCheckpoint.targetWeight : null;

  // Closeness ring inputs. The ring fills toward "on target": being OVER the
  // week target eats into the fill; being under is free until ~1 kg (past that,
  // cutting-too-fast caution kicks in through the verdict colour). The signed
  // delta still drives the colour ramp via deltaVerdict, so ring, number, and
  // verdict word all agree.
  const ringVerdict = delta != null ? deltaVerdict(delta) : null;
  const ringFill =
    delta == null
      ? 0
      : Math.max(
          0.06,
          Math.min(0.98, 1 - (delta > 0 ? delta : Math.max(0, -delta - 1.0)) / 2.5),
        );

  // Dot tap: toggle override. Tapping the natural-focus week clears it.
  const handleDotSelect = (week: number) => {
    setFocusedWeek((prev) => {
      if (prev === week) return null;
      if (currentIdx >= 0 && week === checkpoints[currentIdx].week) return null;
      return week;
    });
  };

  // Card swipe: move focus to the adjacent week. dir +1 = next, -1 = previous.
  const goWeek = (dir: 1 | -1) => {
    const idx = checkpoints.findIndex((c) => c.week === focusCheckpoint.week);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= checkpoints.length) return;
    triggerHapticSelection();
    setFocusedWeek(checkpoints[next].week);
  };

  return (
    <div className="space-y-2">
      {/* Week track, segmented capsule timeline sits above the focus card.
          Kept outside the hero button so taps don't bubble into the /cut-plan
          navigation. */}
      <WeekTrack
        checkpoints={checkpoints}
        focusedWeek={focusCheckpoint.week}
        onSelect={handleDotSelect}
      />
      <button
        type="button"
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          triggerHapticSelection();
          navigate("/cut-plan");
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          // Horizontal flick (and clearly not a vertical scroll) → change week.
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            suppressClick.current = true;
            goWeek(dx < 0 ? 1 : -1); // swipe left → next week, right → previous
          }
        }}
        aria-label={`${TIER_LABEL[tier]}, ${heroEyebrow}, target ${focusCheckpoint.targetWeight.toFixed(1)} kg`}
        className="w-full rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
      >
        {/* Subtle fade-in on focus change, key forces remount → re-plays anim. */}
        <div key={focusCheckpoint.week} className="animate-in fade-in duration-200">
          {/* Header row: week/date eyebrow ↔ days-left/position chip on one
              line. Status stays on the card's left-edge colour accent. */}
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground/85 font-semibold">
              {heroEyebrow}
            </p>
            {chip && (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {chip.label}
              </span>
            )}
          </div>

          {/* Body: closeness ring (how far you are from THIS week's target,
              the card's whole job) on the left, with the target weight + a
              one-word verdict + your current weight on the right. The ring
              centre carries the gap number; its fill + colour carry status. */}
          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-24 w-24 shrink-0">
              <svg
                viewBox="0 0 100 100"
                className={`h-full w-full -rotate-90 ${ringVerdict ? ringVerdict.text : "text-muted-foreground/40"}`}
              >
                <circle cx="50" cy="50" r="43" fill="none" className="stroke-muted-foreground/15" strokeWidth="8" />
                {delta != null && (
                  <circle
                    cx="50"
                    cy="50"
                    r="43"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - ringFill)}
                    className="transition-[stroke-dashoffset] duration-700 ease-out"
                  />
                )}
              </svg>
              {/* Centre label sits inside an inset box (px room from the stroke)
                  so the number + "kg under/over" never touch the ring. */}
              <div className="absolute inset-[14px] flex flex-col items-center justify-center text-center leading-none">
                {delta == null ? (
                  <span className="text-[15px] font-semibold text-muted-foreground">--</span>
                ) : (
                  <>
                    <span className={`display-number font-bold tabular-nums text-[22px] leading-none ${ringVerdict!.text}`}>
                      {Math.abs(delta).toFixed(1)}
                    </span>
                    <span className="mt-1 whitespace-nowrap text-[8px] uppercase tracking-wide text-muted-foreground">
                      kg {delta < 0 ? "under" : "over"}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 font-semibold">
                This week's target
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="display-number font-bold tabular-nums text-foreground text-[40px] leading-none">
                  {focusCheckpoint.targetWeight.toFixed(1)}
                </span>
                <span className="text-[14px] text-muted-foreground font-light">kg</span>
              </p>
            </div>
          </div>

          {/* Contextual note for future / past-with-no-log focus. Current week
              needs none — the ring already says where you stand. */}
          {isFutureWeek ? (
            <p className="mt-3 text-[11.5px] text-muted-foreground">
              Target by {fmtWeekDate(focusCheckpoint.weekEndDate)}
            </p>
          ) : isPastWeek && displayActual == null ? (
            <p className="mt-3 text-[12px] italic text-muted-foreground">
              No log this week
            </p>
          ) : null}

          {/* Inline CTA, only when the user hasn't logged this calendar week. */}
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
