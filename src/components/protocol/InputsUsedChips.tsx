// WP-T10 — InputsUsedChips
// Horizontal scrollable chip row that surfaces the personalization
// signals the protocol was tuned to. Read-only; no interaction, no
// haptics. Lives under the page header so the user understands why
// today's plan looks the way it does.
//
// Visual conventions match the rest of the protocol surface — 10px
// uppercase tracker section label, 11px chip text, rounded-full
// bordered chips. `scrollbar-hide` is a project utility defined in
// src/index.css.
import { motion, useReducedMotion } from "motion/react";

export type InputChipTone = "neutral" | "accent";

export interface InputChip {
  label: string;
  tone?: InputChipTone;
}

export interface InputsUsedChipsProps {
  chips: InputChip[];
  className?: string;
}

function toneClasses(tone: InputChipTone | undefined): string {
  if (tone === "accent") return "border-primary/30 text-primary";
  return "border-border/40 text-muted-foreground";
}

export function InputsUsedChips({ chips, className = "" }: InputsUsedChipsProps) {
  const prefersReduced = useReducedMotion();
  if (!chips.length) return null;

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
      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {chips.map((chip, i) => (
          <span
            key={`${chip.label}-${i}`}
            className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${toneClasses(chip.tone)}`}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </motion.section>
  );
}
