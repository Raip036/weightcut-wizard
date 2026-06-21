import { motion, useReducedMotion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";

/**
 * The five-chapter journey map for the Weight Protocol "story" flow
 * (Flow C, weigh-in pivot). Renders a compact progress spine so the athlete
 * always sees where they are in the cut → scale → rehydrate → walkout arc.
 *
 * `active` is the current chapter index (0-4), derived by the page from the
 * real `phase` + generation state, NOT a manual stepper.
 */

type Chapter = { label: string; icon: IonIconName; accent: string };

const CHAPTERS: Chapter[] = [
  { label: "Plan", icon: "sparklesOutline", accent: "217 91% 58%" },
  { label: "Cut", icon: "trendingDownOutline", accent: "217 91% 58%" },
  { label: "Scale", icon: "scaleOutline", accent: "35 92% 58%" },
  { label: "Rehydrate", icon: "waterOutline", accent: "190 90% 55%" },
  { label: "Walkout", icon: "trophyOutline", accent: "152 64% 47%" },
];

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

export function ProtocolJourneySpine({ active }: { active: number }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center justify-between px-1" role="list" aria-label="Protocol journey">
      {CHAPTERS.map((c, i) => {
        const done = i < active;
        const isActive = i === active;
        const on = done || isActive;
        const iconColor = on
          ? isActive
            ? "#0a0a0a"
            : hsl(c.accent)
          : "hsl(var(--muted-foreground))";
        return (
          <div
            key={c.label}
            role="listitem"
            className="flex items-center"
            style={{ flex: i < CHAPTERS.length - 1 ? 1 : "0 0 auto" }}
          >
            <div className="flex flex-col items-center gap-1">
              <motion.span
                className="flex h-7 w-7 items-center justify-center rounded-full border"
                initial={false}
                animate={{
                  backgroundColor: on ? hsl(c.accent, isActive ? 1 : 0.16) : "transparent",
                  borderColor: on ? hsl(c.accent, isActive ? 1 : 0.4) : "hsl(var(--border))",
                  scale: isActive && !reduced ? 1.08 : 1,
                }}
                transition={{ duration: 0.3 }}
              >
                <span style={{ color: iconColor, display: "inline-flex" }}>
                  <Icon name={done ? "checkmarkOutline" : c.icon} size={14} />
                </span>
              </motion.span>
              <span
                className="text-[8px] font-semibold uppercase tracking-wide"
                style={{ color: on ? hsl(c.accent) : "hsl(var(--muted-foreground))" }}
              >
                {c.label}
              </span>
            </div>
            {i < CHAPTERS.length - 1 && (
              <div
                className="flex-1 h-px mx-1 mb-3"
                style={{ background: done ? hsl(CHAPTERS[i + 1].accent, 0.5) : "hsl(var(--border))" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
