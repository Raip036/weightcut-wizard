import { memo } from "react";
import { motion } from "motion/react";
import { staggerItem } from "@/lib/motion";
import { BarChart3 } from "lucide-react";
import { formatVolume } from "@/lib/gymCalculations";

interface SessionAnalyticsCardProps {
  sessionsThisWeek: number;
  avgDuration: number;
  totalSessions: number;
  mostTrainedMuscle: string;
  weeklyVolumes: { week: string; volume: number; sessions: number }[];
}

export const SessionAnalyticsCard = memo(function SessionAnalyticsCard({
  sessionsThisWeek, avgDuration, totalSessions,
  mostTrainedMuscle, weeklyVolumes,
}: SessionAnalyticsCardProps) {
  if (totalSessions === 0) return null;

  const maxVol = Math.max(...weeklyVolumes.map(w => w.volume), 1);

  return (
    <motion.div
      variants={staggerItem}
      className="card-surface rounded-xs border border-border/50 p-4 space-y-4 relative overflow-hidden"
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] to-transparent pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Weekly Overview
        </div>

        {/* Volume chart */}
        {weeklyVolumes.length > 1 && (
          <div className="mt-4 mb-1">
            <div className="flex items-end gap-1.5 h-20">
              {weeklyVolumes.map((w, i) => {
                const heightPct = Math.max((w.volume / maxVol) * 100, 6);
                const isLast = i === weeklyVolumes.length - 1;
                return (
                  <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${heightPct}%` }}
                      transition={{ duration: 0.5, delay: i * 0.05, ease: [0.25, 0.1, 0.25, 1] }}
                      className={`w-full rounded-t-md ${
                        isLast
                          ? "bg-gradient-to-t from-primary to-primary/70"
                          : "bg-primary/20"
                      }`}
                      style={{ minHeight: 4 }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {weeklyVolumes.map((w) => (
                <div key={w.week} className="flex-1 text-center text-[8px] text-muted-foreground/60">
                  {new Date(w.week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="p-2.5 rounded-xs bg-muted/30">
            <div className="display-number text-base">{sessionsThisWeek}</div>
            <div className="text-[10px] text-muted-foreground">This week</div>
          </div>
          <div className="p-2.5 rounded-xs bg-muted/30">
            <div className="display-number text-base">{avgDuration}<span className="text-xs text-muted-foreground font-normal">m</span></div>
            <div className="text-[10px] text-muted-foreground">Avg duration</div>
          </div>
          <div className="p-2.5 rounded-xs bg-muted/30">
            <div className="display-number text-base">{totalSessions}</div>
            <div className="text-[10px] text-muted-foreground">Total sessions</div>
          </div>
          <div className="p-2.5 rounded-xs bg-muted/30">
            <div className="display-number text-base capitalize">{mostTrainedMuscle.replace("_", " ")}</div>
            <div className="text-[10px] text-muted-foreground">Top muscle</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
