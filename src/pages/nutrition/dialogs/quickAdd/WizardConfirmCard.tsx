import { motion, useReducedMotion } from "motion/react";
import wizard3D from "@/assets/thoughtful_wizard.png";

interface WizardConfirmCardProps {
  /** AI-detected meal name; renders as the hero label. */
  detectedName: string;
  /** Optional rough kcal headline. */
  kcal?: number | null;
  /** Optional rough protein headline (grams). */
  proteinG?: number | null;
  onConfirm: () => void;
  onReject: () => void;
}

/**
 * Transient "looks right?" moment between scan-complete and the macros
 * editor. The thoughtful wizard fades in, bobs gently, and asks the user
 * to confirm the detection before we commit to the macros UI.
 *
 * Reduced-motion: wizard renders static, no entry scale, no bob.
 */
export function WizardConfirmCard({
  detectedName,
  kcal,
  proteinG,
  onConfirm,
  onReject,
}: WizardConfirmCardProps) {
  const prefersReduced = useReducedMotion();

  const subline = (() => {
    const bits: string[] = [];
    if (typeof kcal === "number" && Number.isFinite(kcal)) {
      bits.push(`~${Math.round(kcal)} kcal`);
    }
    if (typeof proteinG === "number" && Number.isFinite(proteinG) && proteinG > 0) {
      bits.push(`${Math.round(proteinG)}g protein`);
    }
    return bits.join(" · ");
  })();

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
      className="rounded-2xl border border-border/40 bg-card/60 p-5 flex flex-col items-center text-center"
    >
      <motion.img
        src={wizard3D}
        alt=""
        draggable={false}
        initial={prefersReduced ? false : { opacity: 0, scale: 0.9 }}
        animate={
          prefersReduced
            ? { opacity: 1, scale: 1 }
            : { opacity: 1, scale: 1, y: [0, -3, 0] }
        }
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 0.3 },
                scale: { duration: 0.3 },
                y: { duration: 2.8, ease: "easeInOut", repeat: Infinity },
              }
        }
        className="h-20 w-20 object-contain select-none pointer-events-none"
      />
      <p className="mt-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
        I think this is…
      </p>
      <p className="mt-1.5 text-[18px] font-bold tracking-tight text-foreground leading-tight">
        {detectedName || "your meal"}
      </p>
      {subline && (
        <p className="mt-1 text-[12px] text-muted-foreground/80 tabular-nums">{subline}</p>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2 w-full">
        <button
          type="button"
          onClick={onReject}
          className="h-11 rounded-2xl bg-muted/40 border border-border/40 text-[14px] font-semibold text-foreground/80 active:scale-[0.98] active:bg-muted/60 transition-all"
        >
          Not quite
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="h-11 rounded-2xl bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform"
        >
          Looks right
        </button>
      </div>
    </motion.div>
  );
}
