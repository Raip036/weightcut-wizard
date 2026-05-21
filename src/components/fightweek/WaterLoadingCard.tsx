import { memo } from "react";
import { Droplets } from "lucide-react";
import { sanitizeAIText } from "@/lib/sanitizeAIText";

export interface WaterLoadingData {
  loadDays: number;
  dailyMl: number[];
  taperMl: number;
  rationale: string;
}

interface WaterLoadingCardProps {
  data: WaterLoadingData;
}

// Cap at 15 L per day — the highest medically reasonable water-loading dose.
// Anything beyond that is almost certainly an LLM formatting error and would
// otherwise render as nonsense like "800008000008.0L".
const MAX_REASONABLE_ML = 15000;

function sanitizeMl(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_REASONABLE_ML);
}

function formatL(ml: number): string {
  const safe = sanitizeMl(ml);
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}L`;
  return `${Math.round(safe)}ml`;
}

export const WaterLoadingCard = memo(function WaterLoadingCard({ data }: WaterLoadingCardProps) {
  const safeDaily = data.dailyMl.map(sanitizeMl);
  const safeTaper = sanitizeMl(data.taperMl);
  const max = Math.max(...safeDaily, safeTaper, 1);
  const loadLabels = safeDaily.map((_, i) => `Day ${-(data.loadDays - i)}`);

  return (
    <div className="card-surface rounded-xs border border-border/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-xs bg-sky-500/15 flex items-center justify-center">
          <Droplets className="h-3.5 w-3.5 text-sky-400" />
        </div>
        <h3 className="text-sm font-semibold">Water Loading</h3>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(48px,1fr))] gap-2">
        {safeDaily.map((ml, i) => {
          const h = Math.max(12, (ml / max) * 60);
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex flex-col justify-end h-[62px] w-full">
                <div className="w-full rounded-t-md bg-gradient-to-t from-sky-500 to-sky-400/70" style={{ height: `${h}px` }} />
              </div>
              <span className="text-[9px] text-muted-foreground tabular-nums">{formatL(ml)}</span>
              <span className="text-[8px] uppercase tracking-wider text-muted-foreground/60">{loadLabels[i]}</span>
            </div>
          );
        })}
        <div className="flex flex-col items-center gap-1">
          <div className="flex flex-col justify-end h-[62px] w-full">
            <div className="w-full rounded-t-md bg-yellow-500/70" style={{ height: `${Math.max(12, (safeTaper / max) * 60)}px` }} />
          </div>
          <span className="text-[9px] text-muted-foreground tabular-nums">{formatL(safeTaper)}</span>
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground/60">Day -1</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex flex-col justify-end h-[62px] w-full">
            <div className="w-full rounded-t-md bg-orange-500/70" style={{ height: "12px" }} />
          </div>
          <span className="text-[9px] text-muted-foreground tabular-nums">Sips</span>
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground/60">Weigh-In</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{sanitizeAIText(data.rationale)}</p>
    </div>
  );
});
