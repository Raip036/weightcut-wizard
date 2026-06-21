// WP-T10: InputsUsedChips
// Labeled-stat grid that surfaces the personalization signals the
// protocol was tuned to. Read-only; no interaction, no haptics. Lives
// under the page header so the user understands why today's plan looks
// the way it does.
//
// Earlier iteration was a horizontal chip row; the labels were too
// terse to interpret at a glance. This shape renders each signal as a
// labeled stat cell (10px uppercase tracker label over a 15px tabular
// value).
//
// Layout: the FIRST stat is promoted to a full-width hero card (larger
// display value, optional tinted badge). The REMAINING stats sit in a
// 2-column grid; if that remainder is odd, the trailing card spans both
// columns so there is never a lone half-row cell.
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";

export type InputStatTone = "neutral" | "accent" | "warn";

// Badge tone is a small superset of the cell tones (adds "danger") so a
// hero can flag e.g. an "EXTREME" cut in red while keeping the card's own
// tone separate.
export type InputBadgeTone = "accent" | "warn" | "danger" | "neutral";

export interface InputStatBadge {
  text: string;
  tone?: InputBadgeTone;
}

export interface InputStat {
  label: string;
  /** String, or structured JSX for richer values (e.g. a styled start→target). */
  value: ReactNode;
  tone?: InputStatTone;
  iconName?: IonIconName;
  // Optional pill rendered on the hero card only. Fully backward-compatible:
  // items without a badge render exactly as before.
  badge?: InputStatBadge;
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

// Hero gets a subtly more prominent surface than the grid cells.
function heroToneClasses(tone: InputStatTone | undefined): string {
  if (tone === "accent") return "border-primary/40 bg-primary/[0.07]";
  if (tone === "warn")
    return "border-func-warning-yellow/40 bg-func-warning-yellow/[0.07]";
  return "border-border/30 bg-muted/20";
}

function iconToneClasses(tone: InputStatTone | undefined): string {
  if (tone === "accent") return "text-primary";
  if (tone === "warn") return "text-func-warning-yellow";
  return "text-muted-foreground";
}

function badgeToneClasses(tone: InputBadgeTone | undefined): string {
  if (tone === "danger")
    return "border-func-danger-red/40 bg-func-danger-red/10 text-func-danger-red";
  if (tone === "warn")
    return "border-func-warning-yellow/40 bg-func-warning-yellow/10 text-func-warning-yellow";
  if (tone === "neutral")
    return "border-border/40 bg-muted/20 text-muted-foreground";
  return "border-primary/40 bg-primary/10 text-primary";
}

// Stagger delay per cell; capped so very long lists don't produce a slow
// cascade. Reduced motion users skip the stagger entirely. The hero
// animates in first (index 0), then the grid cards continue the cascade.
const STAGGER_MS = 40;
const STAGGER_MAX_CELLS = 8;

export function InputsUsedChips({ stats, className = "" }: InputsUsedChipsProps) {
  const prefersReduced = useReducedMotion();
  if (!stats.length) return null;

  const [hero, ...rest] = stats;

  const delayFor = (index: number) =>
    prefersReduced
      ? 0
      : (Math.min(index, STAGGER_MAX_CELLS - 1) * STAGGER_MS) / 1000;

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

      {/* Hero: full-width, larger value, optional badge */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: prefersReduced ? 0 : 0.2,
          ease: "easeOut",
          delay: delayFor(0),
        }}
        className={`mt-2 rounded-xl border p-3.5 ${heroToneClasses(hero.tone)}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {hero.iconName && (
              <Icon
                name={hero.iconName}
                size={13}
                className={iconToneClasses(hero.tone)}
              />
            )}
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
              {hero.label}
            </p>
          </div>
          {hero.badge && (
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] font-bold ${badgeToneClasses(
                hero.badge.tone,
              )}`}
            >
              {hero.badge.text}
            </span>
          )}
        </div>
        <p className="display-number mt-1.5 text-[22px] font-bold tabular-nums text-foreground leading-tight">
          {hero.value}
        </p>
      </motion.div>

      {/* Remaining stats: 2-col grid; odd trailing card spans full width */}
      {rest.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          {rest.map((stat, i) => {
            const isLast = i === rest.length - 1;
            const spanFull = isLast && rest.length % 2 === 1;
            return (
              <motion.div
                key={`${stat.label}-${i}`}
                initial={prefersReduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: prefersReduced ? 0 : 0.2,
                  ease: "easeOut",
                  // +1 keeps the hero at index 0 first in the cascade.
                  delay: delayFor(i + 1),
                }}
                className={`rounded-xl border p-3 ${cellToneClasses(stat.tone)} ${
                  spanFull ? "col-span-2" : ""
                }`}
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
      )}
    </motion.section>
  );
}
