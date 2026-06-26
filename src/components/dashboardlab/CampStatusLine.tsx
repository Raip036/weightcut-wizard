// MOCKUP - dashboard redesign lab. Delete after sign-off.
import { Activity, ChevronRight, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

type Status = "on_track" | "slightly_off" | "behind";

interface CampStatusLineProps {
  status?: Status;
  message?: string;
  daysToFight?: number;
}

const STATUS_MAP: Record<Status, { token: string; label: string; icon: LucideIcon }> = {
  on_track: { token: "--success", label: "On track", icon: TrendingUp },
  slightly_off: { token: "--warning", label: "Slightly off", icon: Activity },
  behind: { token: "--warning", label: "Behind pace", icon: TrendingDown },
};

export default function CampStatusLine({
  status = "on_track",
  message = "1.2 kg ahead of pace",
  daysToFight = 18,
}: CampStatusLineProps) {
  const { token, label, icon: Icon } = STATUS_MAP[status];
  const color = `hsl(var(${token}))`;

  return (
    <div className="card-press flex items-center gap-3 rounded-[22px] bg-card border border-white/[0.04] px-4 py-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `hsl(var(${token}) / 0.14)` }}
      >
        <Icon className="h-5 w-5" style={{ color }} strokeWidth={2.4} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color }}>
            {label}
          </span>
          <span className="truncate text-sm text-foreground/90">{message}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Fight in <span className="display-number font-semibold">{daysToFight}</span> days
        </p>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </div>
  );
}
