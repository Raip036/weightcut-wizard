/**
 * AthleteSessionsList — recent training rows for the coach's athlete page.
 * Read-only for v1; each row shows session type, duration, RPE and a
 * relative timestamp. Tap-to-expand is intentionally deferred — the
 * coach gets what they need at a glance.
 *
 * Empty state lives inside the same card so the layout doesn't shift
 * when an athlete starts logging.
 */
import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { getSessionColor } from "@/lib/sessionColors";

export interface SessionRow {
  date: string; // ISO YYYY-MM-DD
  /** PRIMARY discipline (martial art / "S&C" / "Rest"). Drives the edge colour + title. */
  session_type: string;
  /** OPTIONAL activity descriptor (Sparring, Strength, …); null when absent. */
  session_tag?: string | null;
  rpe: number;
  soreness_level: number | null;
  duration_minutes: number;
}

interface Props {
  sessions: SessionRow[] | null;
  /** 0-based index used to stagger the whole block in after the charts. */
  index?: number;
  className?: string;
}

function relativeLabel(isoDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(isoDate);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function rpeTextColor(rpe: number): string {
  if (rpe >= 9) return "text-func-danger-red";
  if (rpe >= 7) return "text-func-warning-yellow";
  return "text-func-recovery-green";
}

export const AthleteSessionsList = memo(function AthleteSessionsList({
  sessions,
  index = 0,
  className = "",
}: Props) {
  const reduced = useReducedMotion();
  const rows = useMemo(() => sessions ?? [], [sessions]);

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.06 }}
      className={`glass-card overflow-hidden ${className}`}
      aria-label="Recent training sessions"
    >
      <div className="px-4 pt-3.5 pb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Recent sessions
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[12px] text-muted-foreground">
            No sessions logged yet
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            New entries from the athlete will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {rows.map((s, i) => (
            <li
              key={`${s.date}-${i}`}
              className="flex items-center gap-3 px-4 py-2.5 min-h-[48px] border-l-[3px]"
              style={{ borderLeftColor: getSessionColor(s.session_type) }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium capitalize leading-tight flex items-center gap-1.5 flex-wrap">
                  <span className="min-w-0">{s.session_type}</span>
                  {s.session_tag && (
                    <span className="shrink-0 normal-case text-[9px] font-medium tracking-wide px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
                      {s.session_tag}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  {relativeLabel(s.date)}
                  {" · "}
                  {s.duration_minutes} min
                  {s.soreness_level != null && ` · sore ${s.soreness_level}/10`}
                </p>
              </div>
              <span
                className={`shrink-0 text-right text-[12px] font-semibold tabular-nums ${rpeTextColor(
                  Math.round(s.rpe),
                )}`}
                aria-label={`RPE ${Math.round(s.rpe)}`}
              >
                RPE {Math.round(s.rpe)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
});
