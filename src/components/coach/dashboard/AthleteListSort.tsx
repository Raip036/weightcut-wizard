/**
 * AthleteListSort — segmented control sitting between the section title and
 * the athlete list. Drives the local sort state in CoachDashboard.
 *
 * Apple-Fitness flavour: muted bar, single-line pill row, no dropdown
 * (every option is one tap away). Selected option gets a solid background
 * pill so the active state reads at a glance.
 */
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

export type AthleteSort =
  | "rank"
  | "readiness"
  | "fight"
  | "active"
  | "trained";

interface Option {
  value: AthleteSort;
  label: string;
}

const OPTIONS: ReadonlyArray<Option> = [
  { value: "rank", label: "Rank" },
  { value: "readiness", label: "Readiness" },
  { value: "fight", label: "Days to fight" },
  { value: "active", label: "Last active" },
  { value: "trained", label: "Most trained" },
];

interface Props {
  value: AthleteSort;
  onChange: (next: AthleteSort) => void;
}

export function AthleteListSort({ value, onChange }: Props) {
  return (
    // Wrapper holds the scrollable bar + a right-edge fade gradient that
    // signals "there's more — swipe horizontally". The wrapper itself is
    // `relative` so the fade sits on top without pushing layout.
    <div className="relative">
      <div
        role="radiogroup"
        aria-label="Sort athletes"
        className="flex items-center gap-1 p-1 rounded-2xl border border-border/40 bg-card/40 overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                if (active) return;
                triggerHaptic(ImpactStyle.Light);
                onChange(opt.value);
              }}
              className={`shrink-0 whitespace-nowrap px-3 h-8 rounded-xl text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground active:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        {/* Trailing spacer so the last pill can fully clear the fade
            gradient when scrolled to the end. */}
        <span aria-hidden className="shrink-0 w-6" />
      </div>
      {/* Right-edge fade — visual hint that the row is horizontally
          scrollable. Pure cosmetic, ignores pointer events. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-2xl bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}
