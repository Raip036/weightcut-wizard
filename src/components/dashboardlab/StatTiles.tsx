// MOCKUP - dashboard redesign lab. Delete after sign-off.
import { Flame, Droplets, type LucideIcon } from "lucide-react";

interface TileProps {
  token: string;
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  sub: string;
  progress?: number;
}

function Tile({ token, icon: Icon, label, value, unit, sub, progress }: TileProps) {
  const color = `hsl(var(--${token}))`;
  return (
    <div
      className="card-press rounded-[22px] border p-4"
      style={{
        backgroundColor: `hsl(var(--${token}) / 0.08)`,
        borderColor: `hsl(var(--${token}) / 0.18)`,
      }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: `hsl(var(--${token}) / 0.16)` }}
      >
        <Icon className="h-5 w-5" style={{ color }} strokeWidth={2.2} />
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display display-number text-3xl font-bold tracking-tight">
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-muted-foreground">{unit}</span>
        ) : null}
      </div>

      <div className="section-header mt-1">{label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>

      {progress !== undefined ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(1, Math.max(0, progress)) * 100}%`,
              backgroundColor: color,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export interface StatTilesProps {
  className?: string;
}

export default function StatTiles({ className = "" }: StatTilesProps) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`.trim()}>
      <Tile
        token="energy"
        icon={Flame}
        label="CALORIES"
        value="1,840"
        unit="kcal"
        sub="of 2,100 today"
        progress={0.66}
      />
      <Tile
        token="hydration"
        icon={Droplets}
        label="HYDRATION"
        value="2.1"
        unit="L"
        sub="of 3.0 L today"
        progress={0.7}
      />
    </div>
  );
}
