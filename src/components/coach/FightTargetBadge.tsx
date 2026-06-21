import { memo, useMemo } from "react";
import { Calendar } from "lucide-react";

interface Props {
  targetDate: string | null;
  fightWeekTargetKg: number | null;
  goalWeightKg: number | null;
  currentWeightKg: number | null;
  goalType: string | null;
  /** "row" = compact inline (dashboard), "card" = full card (athlete detail) */
  variant?: "row" | "card";
  className?: string;
}

interface Computed {
  daysUntil: number | null;
  target: number | null;
  delta: number | null;
  weeklyPaceRequired: number | null;
  status: "safe" | "watch" | "danger" | "neutral";
  label: string;
}

function compute(p: Omit<Props, "variant" | "className">): Computed {
  const target = p.fightWeekTargetKg ?? p.goalWeightKg ?? null;
  const days = p.targetDate
    ? Math.ceil((new Date(p.targetDate).getTime() - Date.now()) / 86_400_000)
    : null;
  const delta =
    p.currentWeightKg != null && target != null
      ? +(p.currentWeightKg - target).toFixed(1)
      : null;
  const weeklyPace =
    delta != null && days != null && days > 0
      ? +(delta / Math.max(0.143, days / 7)).toFixed(2) // 1d ≈ 0.143wk
      : null;

  let status: Computed["status"] = "neutral";
  if (days != null) {
    if (days < 0) status = "neutral"; // past target
    else if (delta != null) {
      if (delta <= 0.2) status = "safe";
      else if (weeklyPace != null && weeklyPace > 1.5) status = "danger";
      else if (weeklyPace != null && weeklyPace > 1.0) status = "watch";
      else status = "safe";
    }
  }

  let label = "";
  if (days == null) label = "No fight date";
  else if (days < 0) label = "Past target";
  else if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days < 7) label = `${days}d`;
  else label = `${days}d`;

  return { daysUntil: days, target, delta, weeklyPaceRequired: weeklyPace, status, label };
}

const statusStyles: Record<Computed["status"], { dot: string; text: string }> = {
  safe: { dot: "bg-func-recovery-green/80", text: "text-func-recovery-green" },
  watch: { dot: "bg-func-warning-yellow/80", text: "text-func-warning-yellow" },
  danger: { dot: "bg-func-danger-red/80", text: "text-func-danger-red" },
  neutral: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

/**
 * Compact badge showing fight date + target weight + on-track status.
 * Pure rendering: all derivation is synchronous client-side. No icons
 * beyond a single Calendar glyph in card variant.
 */
export const FightTargetBadge = memo(function FightTargetBadge({
  targetDate,
  fightWeekTargetKg,
  goalWeightKg,
  currentWeightKg,
  goalType,
  variant = "row",
  className = "",
}: Props) {
  const c = useMemo(
    () => compute({ targetDate, fightWeekTargetKg, goalWeightKg, currentWeightKg, goalType }),
    [targetDate, fightWeekTargetKg, goalWeightKg, currentWeightKg, goalType]
  );

  if (!targetDate || c.target == null) return null;
  const isFighter = goalType === "cutting";
  const sStyle = statusStyles[c.status];

  if (variant === "row") {
    return (
      <div className={`flex flex-col items-end text-right tabular-nums ${className}`}>
        <span className="text-[11px] font-semibold leading-tight">
          {c.label}
        </span>
        <span className="text-[10px] text-muted-foreground leading-tight">
          {c.target.toFixed(1)}kg{isFighter ? " · fight" : ""}
        </span>
      </div>
    );
  }

  // card variant, used on AthleteDetail
  return (
    <div className={`card-surface rounded-xs border border-border p-3 ${className}`}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          {isFighter ? "Fight target" : "Goal"}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${sStyle.dot}`} aria-hidden />
          <span className={`text-[11px] font-medium capitalize ${sStyle.text}`}>
            {c.status === "neutral" ? (c.daysUntil != null && c.daysUntil < 0 ? "past" : "-") : c.status}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[18px] font-semibold tabular-nums leading-none">
            {c.target.toFixed(1)} kg
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {c.delta != null ? (
              <>
                {c.delta > 0 ? "+" : ""}
                {c.delta.toFixed(1)} kg to go
              </>
            ) : (
              "no current weight"
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[14px] font-semibold tabular-nums leading-none flex items-center justify-end gap-1">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            {c.label}
          </p>
          {c.weeklyPaceRequired != null && c.daysUntil != null && c.daysUntil > 0 && (
            <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {c.weeklyPaceRequired.toFixed(2)} kg/wk needed
            </p>
          )}
        </div>
      </div>
      {targetDate && (
        <p className="text-[10px] text-muted-foreground/60 mt-2 tabular-nums">
          {new Date(targetDate).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      )}
    </div>
  );
});
