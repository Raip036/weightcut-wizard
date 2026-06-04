import { Icon, type IonIconName } from "@/components/ui/Icon";

type Phase = "build" | "peak" | "fightWeek";

/**
 * Per-phase chip styling. Mirrors the label/icon/accent vocabulary from
 * `PhaseCoachCard`'s PHASE_META so the cockpit pill and the dashboard card
 * always agree: the accent ramps with camp intensity within the app's mono +
 * blue/amber palette (blue BUILD → amber FIGHT WEEK, no separate orange/red).
 *
 * `text` is the shared accent color (label + icon); `bg`/`border` are the
 * tinted surface derived from the same color family so the pill reads as a
 * subtle, on-theme tint rather than a solid fill.
 */
const PHASE_META: Record<Phase, {
  label: string;
  icon: IonIconName;
  text: string;
  bg: string;
  border: string;
}> = {
  build: {
    label: "BUILD",
    icon: "barbellOutline",
    text: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/30",
  },
  peak: {
    label: "PEAK",
    icon: "flashOutline",
    text: "text-amber-400/90",
    bg: "bg-amber-400/10",
    border: "border-amber-400/25",
  },
  fightWeek: {
    label: "FIGHT WEEK",
    icon: "flameOutline",
    text: "text-amber-400",
    bg: "bg-amber-400/15",
    border: "border-amber-400/35",
  },
};

export function PhasePill({
  phase,
  className,
}: {
  phase: Phase | null;
  className?: string;
}): JSX.Element | null {
  if (phase === null) return null;

  const meta = PHASE_META[phase];

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-xs border px-2 py-0.5",
        "text-[11px] font-bold uppercase tracking-[0.12em] tabular-nums leading-none",
        meta.text,
        meta.bg,
        meta.border,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon name={meta.icon} size={11} className={meta.text} />
      {meta.label}
    </span>
  );
}
