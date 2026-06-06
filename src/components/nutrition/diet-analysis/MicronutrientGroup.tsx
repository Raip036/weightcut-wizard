import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { NutrientRing } from "./NutrientRing";
import type { MicronutrientData } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

export function MicronutrientGroup({
  title,
  micros,
}: {
  title: string;
  micros: MicronutrientData[];
}) {
  if (micros.length === 0) return null;
  return (
    <div>
      <p className={`${SECTION_LABEL} mb-2`}>{title}</p>
      <motion.div
        variants={staggerContainer(40)}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-4 gap-2 justify-items-center"
      >
        {micros.map((n) => (
          <motion.div key={n.name} variants={staggerItem}>
            <NutrientRing name={n.name} percentRDA={n.percentRDA} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
