import { Droplets, Leaf, Zap, Waves } from "lucide-react";

interface WeightCutBreakdownCardProps {
  glycogenLoss: number;
  fibreLoss: number;
  sodiumLoss: number;
  waterLoadingLoss: number;
  dehydrationNeeded: number;
  dietTotal: number;
  totalToCut: number;
}

const COMPONENTS = [
  { key: "glycogen", label: "Glycogen + Water", color: "#3b82f6", icon: Zap },
  /* Design System v1 FUNCTIONAL palette where it maps cleanly:
     Recovery Green for fibre/gut, Hydration Cyan for sodium and
     dehydration (both water-related), Fats Purple for water-loading
     to keep visual distinction from the cyan stack. */
  { key: "fibre", label: "Fibre / Gut", color: "#23C599", icon: Leaf },
  { key: "sodium", label: "Sodium / Water", color: "#12CAE6", icon: Waves },
  { key: "waterLoading", label: "Water Loading", color: "#7B31EA", icon: Droplets },
  { key: "dehydration", label: "Dehydration", color: "#12CAE6", icon: Droplets },
] as const;

export function WeightCutBreakdownCard({
  glycogenLoss,
  fibreLoss,
  sodiumLoss,
  waterLoadingLoss,
  dehydrationNeeded,
  dietTotal,
  totalToCut,
}: WeightCutBreakdownCardProps) {
  const values: Record<string, number> = {
    glycogen: glycogenLoss,
    fibre: fibreLoss,
    sodium: sodiumLoss,
    waterLoading: waterLoadingLoss,
    dehydration: dehydrationNeeded,
  };

  const activeComponents = COMPONENTS.filter(c => values[c.key] > 0);

  return (
    <div className="card-surface rounded-xs border border-border/50 p-5 space-y-4">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Weight Cut Breakdown
      </h3>

      {/* Stacked horizontal bar */}
      <div className="space-y-2">
        <div className="flex h-6 rounded-full overflow-hidden bg-muted/30">
          {activeComponents.map(comp => {
            const pct = (values[comp.key] / totalToCut) * 100;
            if (pct < 1) return null;
            return (
              <div
                key={comp.key}
                className="h-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: comp.color,
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Diet: {dietTotal.toFixed(1)}kg</span>
          {dehydrationNeeded > 0 && <span>Dehydration: {dehydrationNeeded.toFixed(1)}kg</span>}
        </div>
      </div>

      {/* 2×2 (or 2×3) grid of metric tiles */}
      <div className="grid grid-cols-2 gap-3">
        {activeComponents.map(comp => {
          const Icon = comp.icon;
          return (
            <div
              key={comp.key}
              className="bg-muted/50 p-3 rounded-xs border border-border/50"
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: comp.color }}
                />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {comp.label}
                </span>
              </div>
              <span className="text-lg font-bold block">
                {values[comp.key].toFixed(1)}
                <span className="text-sm text-muted-foreground font-normal ml-0.5">kg</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
