import { memo } from "react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Calendar, Dumbbell } from "lucide-react";
import { formatVolume } from "@/lib/gymCalculations";
import type { SessionWithSets } from "@/pages/gym/types";

// Apple Health-style colored edge per discipline. Keeps the history
// scannable: blue = strength, violet = hypertrophy, yellow = explosive
// session, etc. Anything unrecognized falls back to primary.
function sessionEdgeColor(type: string | null | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "strength":      return "bg-blue-400";
    case "hypertrophy":   return "bg-func-fats-purple";
    case "powerlifting":  return "bg-func-warning-yellow";
    case "explosiveness": return "bg-func-warning-yellow";
    case "conditioning":  return "bg-func-carbs-orange";
    case "circuit":       return "bg-func-danger-red";
    case "endurance":     return "bg-func-recovery-green";
    case "mobility":      return "bg-func-hydration-cyan";
    default:              return "bg-primary";
  }
}

interface SessionHistoryListProps {
  sessions: SessionWithSets[];
  loading: boolean;
  onSessionTap: (session: SessionWithSets) => void;
}

export const SessionHistoryList = memo(function SessionHistoryList({ sessions, loading, onSessionTap }: SessionHistoryListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="card-surface rounded-xs border border-border/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="h-5 w-20 rounded-full shimmer-skeleton" />
              <div className="h-4 w-16 rounded shimmer-skeleton" />
            </div>
            <div className="flex gap-4">
              <div className="h-3.5 w-12 rounded shimmer-skeleton" />
              <div className="h-3.5 w-20 rounded shimmer-skeleton" />
              <div className="h-3.5 w-16 rounded shimmer-skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="card-surface rounded-xs border border-border/50 p-8 text-center">
        <div className="h-12 w-12 rounded-xs bg-muted/50 flex items-center justify-center mx-auto mb-3">
          <Dumbbell className="h-6 w-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No workouts yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Start your first workout to see history here</p>
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer(50)}
      initial="hidden"
      animate="visible"
      className="space-y-3"
    >
      {sessions.map(session => {
        const edge = sessionEdgeColor(session.session_type);
        return (
          <motion.button
            key={session.id}
            variants={staggerItem}
            onClick={() => onSessionTap(session)}
            className="group relative w-full text-left card-surface rounded-xs border border-border/50 pl-4 pr-3 py-3 active:scale-[0.98] transition-transform overflow-hidden"
          >
            {/* Apple Health-style colored edge bar */}
            <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${edge}`} />

            {/* Top row: discipline + date */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
                {session.session_type}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <Calendar className="h-3 w-3" />
                {new Date(session.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </div>
            </div>

            {/* Big-stat row: minutes / exercises / volume */}
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                  {session.duration_minutes ?? "—"}
                </p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">min</p>
              </div>
              <div className="text-center border-x border-border/30">
                <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                  {session.exerciseCount}
                </p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">exer</p>
              </div>
              <div className="text-center">
                <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                  {session.totalVolume > 0 ? formatVolume(session.totalVolume) : "—"}
                </p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">kg vol</p>
              </div>
            </div>

            {/* Exercise chips */}
            {session.exerciseGroups.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {session.exerciseGroups.slice(0, 4).map(g => (
                  <span key={g.exercise.id} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border/20">
                    {g.exercise.name}
                  </span>
                ))}
                {session.exerciseGroups.length > 4 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border/20">
                    +{session.exerciseGroups.length - 4} more
                  </span>
                )}
              </div>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
});
