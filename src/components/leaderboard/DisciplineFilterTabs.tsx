import { motion, useReducedMotion } from "motion/react";
import { ImpactStyle } from "@capacitor/haptics";
import { triggerHaptic } from "@/lib/haptics";

export const DISCIPLINES = [
  "All",
  "BJJ",
  "Boxing",
  "Muay Thai",
  "Wrestling",
  "Sparring",
  "Strength",
  "Run",
] as const;
export type DisciplineFilter = (typeof DISCIPLINES)[number];

export function DisciplineFilterTabs({
  value,
  onChange,
}: {
  value: DisciplineFilter;
  onChange: (next: DisciplineFilter) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div
      role="tablist"
      aria-label="Discipline filter"
      className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1"
    >
      {DISCIPLINES.map((d) => {
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (d !== value) {
                void triggerHaptic(ImpactStyle.Light);
                onChange(d);
              }
            }}
            className={`relative whitespace-nowrap rounded-full px-3 py-1 text-xs ${
              active
                ? "text-primary-foreground"
                : "bg-card/40 text-muted-foreground hover:bg-card/70"
            }`}
          >
            {/* Animated pill underlay slides between active tabs */}
            {active && (
              <motion.span
                layoutId="discipline-tab-underline"
                className="absolute inset-0 -z-[1] rounded-full bg-primary"
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
                aria-hidden
              />
            )}
            <span className="relative">{d}</span>
          </button>
        );
      })}
    </div>
  );
}
