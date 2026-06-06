import { motion, useReducedMotion } from "motion/react";
import { AnimatedRing } from "@/components/motion/AnimatedRing";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { coverageStats, status, clean } from "@/lib/dietAnalysis";
import type { MicronutrientData, NutrientGap } from "@/types/dietAnalysis";

interface CoverageHeroProps {
  micronutrients: MicronutrientData[];
  /** Already severity-sorted; the first item is the worst gap. */
  topGap?: NutrientGap;
}

export function CoverageHero({ micronutrients, topGap }: CoverageHeroProps) {
  const prefersReduced = useReducedMotion();
  const { coveragePct, onPoint, toImprove } = coverageStats(micronutrients);
  const { color } = status(coveragePct);

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "backOut" }}
      className="rounded-2xl bg-gradient-to-br from-primary/[0.08] to-transparent ring-1 ring-border/40 px-4 py-4"
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        Today's coverage
      </p>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
          <AnimatedRing
            progress={Math.min(coveragePct / 100, 1)}
            size={88}
            strokeWidth={8}
            gradientColors={[color, color]}
            id="coverage-hero"
          />
          <div className="absolute inset-0 flex items-center justify-center" style={{ color }}>
            <AnimatedNumber
              value={coveragePct}
              format={(n) => `${Math.round(n)}%`}
              className="text-[22px] font-extrabold tabular-nums"
            />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground leading-tight">
            <span style={{ color: "rgb(16 185 129)" }}>{onPoint} on point</span>
            <span className="text-muted-foreground/60"> · </span>
            <span style={{ color: "rgb(245 158 11)" }}>{toImprove} to improve</span>
          </p>
          {topGap && (
            <p className="mt-1 text-[12.5px] text-foreground/80 leading-snug">
              <span className="font-semibold">Biggest gap: {topGap.nutrient}</span>{" "}
              {topGap.percentRDA}%
              {topGap.reason ? ` · ${clean(topGap.reason)}` : ""}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
