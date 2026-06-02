import { motion, useReducedMotion } from "motion/react";
import wizard3D from "@/assets/thoughtful_wizard.png";

interface WizardConfirmCardProps {
  /** AI-detected meal name; renders as the hero label. */
  detectedName: string;
  /** Optional rough kcal headline. */
  kcal?: number | null;
  /** Optional rough protein headline (grams). */
  proteinG?: number | null;
  /** Optional carbs headline (grams). */
  carbsG?: number | null;
  /** Optional fat headline (grams). */
  fatG?: number | null;
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
  carbsG,
  fatG,
  onConfirm,
  onReject,
}: WizardConfirmCardProps) {
  const prefersReduced = useReducedMotion();

  const num = (n?: number | null) =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  const hasMacros = typeof kcal === "number" && Number.isFinite(kcal);
  // Four headline boxes. Calories stays foreground-white as the hero; the
  // three macros take their canonical func-token colours (protein blue,
  // carbs orange, fat purple) to match the dashboard rings.
  const macros: Array<{
    label: string;
    value: number;
    unit: string;
    color?: string;
  }> = [
    { label: "Cals", value: num(kcal), unit: "" },
    { label: "Protein", value: num(proteinG), unit: "g", color: "rgb(var(--func-protein-blue))" },
    { label: "Carbs", value: num(carbsG), unit: "g", color: "rgb(var(--func-carbs-orange))" },
    { label: "Fat", value: num(fatG), unit: "g", color: "rgb(var(--func-fats-purple))" },
  ];

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
      {hasMacros && (
        <div className="mt-3.5 grid grid-cols-4 gap-1.5 w-full">
          {macros.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-border/40 bg-card/50 px-1 py-2 flex flex-col items-center justify-center"
            >
              <span
                className="text-[18px] font-extrabold tabular-nums leading-none"
                style={m.color ? { color: m.color } : undefined}
              >
                {m.value}
                {m.unit && (
                  <span className="text-[11px] font-bold align-baseline">
                    {m.unit}
                  </span>
                )}
              </span>
              <span className="mt-1 text-[9px] uppercase tracking-wide font-semibold text-muted-foreground/70">
                {m.label}
              </span>
            </div>
          ))}
        </div>
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
