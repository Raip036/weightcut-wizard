import { Icon } from "@/components/ui/Icon";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "@/lib/motion";
import { AnimatedNumber } from "@/components/motion";

interface StreakBadgeProps {
  streak: number;
  isActive: boolean;
}

export function StreakBadge({ streak, isActive }: StreakBadgeProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className="inline-flex flex-col items-center"
      initial={prefersReducedMotion ? false : { scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springs.bouncy}
    >
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
          isActive
            ? "bg-energy/10 border-energy/20"
            : "bg-energy/5 border-energy/10"
        }`}
      >
        <motion.div
          animate={
            isActive && !prefersReducedMotion
              ? { rotate: [-3, 3, -2, 2, 0], scale: [1, 1.1, 1] }
              : undefined
          }
          transition={
            isActive
              ? { duration: 0.8, ease: "easeInOut" }
              : undefined
          }
        >
          <Icon
            name="flameOutline"
            size={16}
            className={isActive ? "text-energy" : "text-muted-foreground"}
          />
        </motion.div>
        <span className="text-sm font-bold display-number">
          <AnimatedNumber value={streak} />
        </span>
      </div>
      {!isActive && streak > 0 && (
        <span className="text-[10px] text-muted-foreground mt-0.5">
          Log today!
        </span>
      )}
    </motion.div>
  );
}
