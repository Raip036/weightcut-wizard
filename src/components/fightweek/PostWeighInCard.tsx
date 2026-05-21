import { memo } from "react";
import { Droplets, Wheat, Waves, Coffee } from "lucide-react";
import { sanitizeAIText } from "@/lib/sanitizeAIText";

export interface PostWeighInData {
  targetRegainKg: number;
  fluidPlan: string;
  carbPlan: string;
  sodiumPlan: string;
  caffeineNote: string | null;
}

interface PostWeighInCardProps {
  data: PostWeighInData;
}

function Row({ icon: Icon, label, text, color, bg }: { icon: typeof Droplets; label: string; text: string; color: string; bg: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`h-7 w-7 rounded-xs flex items-center justify-center shrink-0 ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
        <p className="text-[13px] text-foreground/90 leading-relaxed mt-0.5">{sanitizeAIText(text)}</p>
      </div>
    </div>
  );
}

export const PostWeighInCard = memo(function PostWeighInCard({ data }: PostWeighInCardProps) {
  return (
    <div className="card-surface rounded-xs border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Post Weigh-In Recovery</h3>
        <div className="text-right">
          <div className="text-base font-bold tabular-nums text-emerald-400">+{data.targetRegainKg.toFixed(1)}kg</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">regain target</div>
        </div>
      </div>

      <div className="space-y-3">
        <Row icon={Droplets} label="Fluid" text={data.fluidPlan} color="text-sky-400" bg="bg-sky-500/15" />
        <Row icon={Wheat} label="Carbs" text={data.carbPlan} color="text-amber-400" bg="bg-amber-500/15" />
        <Row icon={Waves} label="Sodium" text={data.sodiumPlan} color="text-cyan-400" bg="bg-cyan-500/15" />
        {data.caffeineNote && (
          <Row icon={Coffee} label="Caffeine" text={data.caffeineNote} color="text-orange-400" bg="bg-orange-500/15" />
        )}
      </div>
    </div>
  );
});
