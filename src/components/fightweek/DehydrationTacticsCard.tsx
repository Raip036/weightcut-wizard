import { memo } from "react";
import { Flame, Droplet, Activity, Shirt } from "lucide-react";
import { sanitizeAIText } from "@/lib/sanitizeAIText";

export type DehydrationMethod = "dry_sauna" | "hot_bath" | "active_sweat" | "sauna_suit";

export interface DehydrationTactic {
  method: DehydrationMethod;
  session: string;
  expectedLossKg: number;
  daysOut: number;
  safetyNote: string;
}

const METHOD_META: Record<DehydrationMethod, { label: string; color: string; bg: string; icon: typeof Flame }> = {
  dry_sauna: { label: "Dry Sauna", color: "text-func-carbs-orange", bg: "bg-func-carbs-orange/15", icon: Flame },
  hot_bath: { label: "Hot Bath", color: "text-func-danger-red", bg: "bg-func-danger-red/15", icon: Droplet },
  active_sweat: { label: "Active Sweat", color: "text-func-warning-yellow", bg: "bg-func-warning-yellow/15", icon: Activity },
  sauna_suit: { label: "Sauna Suit", color: "text-func-fats-purple", bg: "bg-func-fats-purple/15", icon: Shirt },
};

interface DehydrationTacticsCardProps {
  tactics: DehydrationTactic[];
}

export const DehydrationTacticsCard = memo(function DehydrationTacticsCard({ tactics }: DehydrationTacticsCardProps) {
  if (!tactics?.length) return null;

  return (
    <div className="card-surface rounded-xs border border-border/50 p-4 space-y-3">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Dehydration Tactics</h3>

      <div className="space-y-2">
        {tactics.map((t, i) => {
          const meta = METHOD_META[t.method] ?? METHOD_META.dry_sauna;
          const Icon = meta.icon;
          return (
            <div key={i} className="rounded-xs bg-muted/30 border border-border/30 p-3">
              <div className="flex items-start gap-2.5">
                <div className={`h-8 w-8 rounded-xs flex items-center justify-center shrink-0 ${meta.bg}`}>
                  <Icon className={`h-4 w-4 ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[13px] font-semibold ${meta.color}`}>{meta.label}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {t.daysOut === 0 ? "Weigh-In Day" : `Day -${t.daysOut}`}
                    </span>
                  </div>
                  <p className="text-[12px] text-foreground/90 mt-0.5 leading-snug">{sanitizeAIText(t.session)}</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-[14px] font-bold tabular-nums">{t.expectedLossKg.toFixed(2)}</span>
                    <span className="text-[10px] text-muted-foreground">kg expected</span>
                  </div>
                  {t.safetyNote && (
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{sanitizeAIText(t.safetyNote)}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
