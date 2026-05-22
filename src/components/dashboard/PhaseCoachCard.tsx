import { useNavigate } from "react-router-dom";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

type Phase = "build" | "peak" | "fightWeek" | null | undefined;

interface PhaseCoachCardProps {
  phase: Phase;
  daysUntilFight: number | null;
  /**
   * Optional one-liner nudge surfaced from the engine ("Sleep dropped 1.1h
   * vs last week"). Rendered as a secondary signal under the main guidance.
   */
  signal?: string | null;
}

const PHASE_META: Record<NonNullable<Phase>, {
  label: string;
  icon: IonIconName;
  accent: string;
  guidance: string;
}> = {
  build: {
    label: "BUILD PHASE",
    icon: "barbellOutline",
    accent: "text-func-protein-blue",
    guidance: "Establish consistency. Hit your weekly training volume and lock in your log streak.",
  },
  peak: {
    label: "PEAK PHASE",
    icon: "flashOutline",
    accent: "text-func-carbs-orange",
    guidance: "Protect sleep — load is at its highest. Deload one session this week and keep recovery dialed.",
  },
  fightWeek: {
    label: "FIGHT WEEK",
    icon: "flameOutline",
    accent: "text-func-danger-red",
    guidance: "Hydration and sodium control are the priority. Taper training, dial macros, sharpen technique.",
  },
};

export function PhaseCoachCard({ phase, daysUntilFight, signal }: PhaseCoachCardProps) {
  const navigate = useNavigate();
  const meta = phase ? PHASE_META[phase] : PHASE_META.build;

  // Subtitle: surface weeks/days remaining if we know them.
  const subtitle = (() => {
    if (daysUntilFight == null || daysUntilFight <= 0) return null;
    if (daysUntilFight <= 7) {
      return `${daysUntilFight} ${daysUntilFight === 1 ? "day" : "days"} to weigh-in`;
    }
    const weeks = Math.round(daysUntilFight / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} to weigh-in`;
  })();

  return (
    <button
      type="button"
      onClick={() => { triggerHapticSelection(); navigate("/fight-camps"); }}
      className="w-full card-surface rounded-xs p-3.5 text-left active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-2">
        <span className={`h-7 w-7 rounded-xs bg-muted/40 flex items-center justify-center shrink-0 ${meta.accent}`}>
          <Icon name={meta.icon} size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${meta.accent}`}>
            {meta.label}
          </p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{subtitle}</p>
          )}
        </div>
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40 shrink-0" />
      </div>

      <p className="mt-2.5 text-[12.5px] leading-snug text-foreground/90">
        {meta.guidance}
      </p>

      {signal && (
        <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground leading-snug">
          <Icon name="alertCircleOutline" size={11} className="inline mr-1 -mt-0.5 text-func-warning-yellow" />
          {signal}
        </p>
      )}
    </button>
  );
}
