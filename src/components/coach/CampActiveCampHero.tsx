import { memo } from "react";
import { Icon } from "@/components/ui/Icon";

interface CampProgressInfo {
  daysLeft: number;
  elapsed: number;
  totalDays: number;
  pct: number;
  fightLabel: string;
}

interface PhaseInfo {
  label: string;
  bg: string;
  text: string;
  border: string;
}

interface CampActiveCampHeroProps {
  campName: string;
  campProgress: CampProgressInfo;
  phase: PhaseInfo;
  onTap: () => void;
}

export const CampActiveCampHero = memo(function CampActiveCampHero({
  campName,
  campProgress,
  phase,
  onTap,
}: CampActiveCampHeroProps) {
  return (
    <div className="relative">
      {/* Aurora ambient glow: was `blur-3xl` on a radial-gradient div, which
          on iOS WebView caused 60-120ms-per-frame filter compositing. Now uses
          `.aurora-glow-native` (defined in index.css): same radial-gradient
          shape, no filter:blur. Visually equivalent at this scale. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -inset-y-4 rounded-[2rem] aurora-glow-native"
      />
      <button
        type="button"
        onClick={onTap}
        className="relative w-full text-left rounded-2xl border border-primary/20 bg-primary/10 p-4 card-press overflow-hidden"
      >
        {/* Faint inner gradient wash to lift the hero off the page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent"
        />

        <div className="relative">
          {/* Top row: name + phase chip on the left, days-left on the right */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name="flagOutline" size={12} className="text-primary shrink-0" />
                <p className="text-micro uppercase tracking-wider text-primary/80 font-semibold">
                  Active Camp
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[22px] font-bold tracking-tight leading-tight truncate min-w-0">
                  {campName}
                </p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] border ${phase.bg} ${phase.text} ${phase.border}`}
                >
                  {phase.label}
                </span>
              </div>
            </div>
            <div className="text-center shrink-0 bg-primary/10 rounded-xl px-3.5 py-2">
              <p className="text-[28px] font-bold tabular-nums tracking-tight text-foreground leading-none">
                {campProgress.daysLeft}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 font-semibold mt-1">
                days left
              </p>
            </div>
          </div>

          {/* Progress bar with smoother gradient fill */}
          <div className="space-y-2">
            <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                style={{ width: `${campProgress.pct * 100}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/80 font-semibold tabular-nums">
                Day {campProgress.elapsed} of {campProgress.totalDays}
              </p>
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/80 font-semibold">
                Fight: <span className="text-foreground/90 font-bold normal-case">{campProgress.fightLabel}</span>
              </p>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
});
