// WP-T10 — InputsUsedChips
// Labeled-stat grid that surfaces the personalization signals the
// protocol was tuned to. Read-only; no interaction, no haptics. Lives
// under the page header so the user understands why today's plan looks
// the way it does.
//
// Earlier iteration was a horizontal chip row; the labels were too
// terse to interpret at a glance. This shape renders each signal as a
// labeled stat cell (10px uppercase tracker label over a 15px tabular
// value) inside a 2-column grid for fast scanning.
import { motion, useReducedMotion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";

export type InputStatTone = "neutral" | "accent" | "warn";

export interface InputStat {
  label: string;
  value: string;
  tone?: InputStatTone;
  iconName?: IonIconName;
}

export interface InputsUsedChipsProps {
  stats: InputStat[];
  className?: string;
}

function cellToneClasses(tone: InputStatTone | undefined): string {
  if (tone === "accent") return "border-primary/30 bg-primary/[0.04]";
  if (tone === "warn")
    return "border-func-warning-yellow/30 bg-func-warning-yellow/[0.04]";
  return "border-border/20 bg-muted/10";
}

function iconToneClasses(tone: InputStatTone | undefined): string {
  if (tone === "accent") return "text-primary";
  if (tone === "warn") return "text-func-warning-yellow";
  return "text-muted-foreground";
}

// Stagger delay per cell; capped at 8 cells so very long lists don't
// produce a slow cascade. Reduced motion users skip the stagger entirely.
const STAGGER_MS = 40;
const STAGGER_MAX_CELLS = 8;

export function InputsUsedChips({ stats, className = "" }: InputsUsedChipsProps) {
  const prefersReduced = useReducedMotion();
  if (!stats.length) return null;

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: 0.05 }}
      className={className}
      aria-label="Personalization signals used to tune this protocol"
    >
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
        Tuned to you
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        {stats.map((stat, i) => {
          const delaySec = prefersReduced
            ? 0
            : (Math.min(i, STAGGER_MAX_CELLS - 1) * STAGGER_MS) / 1000;
          return (
            <motion.div
              key={`${stat.label}-${i}`}
              initial={prefersReduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: prefersReduced ? 0 : 0.2,
                ease: "easeOut",
                delay: delaySec,
              }}
              className={`rounded-xl border p-3 ${cellToneClasses(stat.tone)}`}
            >
              <div className="flex items-center gap-1.5">
                {stat.iconName && (
                  <Icon
                    name={stat.iconName}
                    size={12}
                    className={iconToneClasses(stat.tone)}
                  />
                )}
                <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
                  {stat.label}
                </p>
              </div>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-foreground leading-tight">
                {stat.value}
              </p>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}
