import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import Sparkline from "@/components/charts/Sparkline";

interface SleepCardProps {
  userId: string | null | undefined;
}

/**
 * Dashboard "Sleep" metric card. Mirrors the WEIGHT card layout exactly —
 * eyebrow + chevron top row, big value, sparkline, footer with the 7-night
 * average and last-night delta. Taps through to the Sleep page.
 */
export function SleepCard({ userId }: SleepCardProps) {
  const navigate = useNavigate();
  const rows = useQuery(
    api.sleep_logs.listForUser,
    userId ? { limit: 14 } : "skip",
  );

  // Rows come back newest-first; reverse to oldest→newest for the sparkline.
  const asc = rows ? [...rows].reverse() : [];
  const recent = asc.slice(-7);
  const hours = recent.map((r) => r.hours);
  const latest = rows && rows.length > 0 ? rows[0] : null;
  const prev = rows && rows.length > 1 ? rows[1] : null;
  const avg7 =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.hours, 0) / recent.length
      : null;
  const delta = latest && prev ? latest.hours - prev.hours : null;
  const hasData = hours.length >= 2;

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/sleep");
      }}
      className="card-surface card-glow rounded-2xl p-3 aspect-square flex flex-col text-left card-press min-w-0 w-full overflow-hidden"
    >
      <div className="flex items-start justify-between w-full">
        <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
          SLEEP
        </span>
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40" />
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display font-bold text-[40px] leading-none text-foreground tabular-nums">
          {latest ? latest.hours.toFixed(1) : "—"}
        </span>
        <span className="text-note font-light text-muted-foreground">h</span>
      </div>

      <div className="flex-1 min-h-0 mt-2">
        {hasData ? (
          <Sparkline data={hours} className="h-full w-full" />
        ) : (
          <div className="flex flex-col items-center justify-end h-full text-center pb-0.5">
            <Icon name="moonOutline" size={20} className="text-muted-foreground/40 mb-1" />
            <p className="text-note text-muted-foreground">No data yet</p>
          </div>
        )}
      </div>

      {/* Footer — 7-night avg left, last-night delta right. */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-micro text-muted-foreground tabular-nums">
          {avg7 != null ? `avg ${avg7.toFixed(1)}h` : ""}
        </span>
        <div className="flex items-center gap-1.5">
          {delta != null && Math.abs(delta) >= 0.05 && (() => {
            const isUp = delta > 0; // more sleep is better
            return (
              <div className={`flex items-center gap-0.5 text-micro font-medium tabular-nums ${isUp ? "text-func-recovery-green" : "text-func-danger-red"}`}>
                <Icon
                  name="trendingDownOutline"
                  size={12}
                  className={isUp ? "rotate-180" : ""}
                />
                <span>{Math.abs(delta).toFixed(1)}h</span>
              </div>
            );
          })()}
        </div>
      </div>
    </button>
  );
}
