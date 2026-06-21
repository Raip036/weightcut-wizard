/**
 * Orchestrated-stagger primitive for the Community page entrance.
 *
 * Wrap a list in <StaggerContainer> and each row/section in <StaggerItem>
 * so children fade + rise into place ~50ms apart, giving the page a
 * cohesive "settle in" feel instead of popping in all at once.
 *
 * Why this file is intentionally minimal:
 *   - GPU-cheap: only opacity + translateY (transform). No scale, blur, or
 *     box-shadow: those are stripped on the iOS native build (.native-app)
 *     and cause jank, whereas opacity/transform composite cleanly.
 *   - Reduced-motion-aware: when the OS requests reduced motion we render
 *     plain <div>s with zero animation.
 *   - Items inherit "hidden"/"show" from the container via variant
 *     propagation, no per-item initial/animate, so the stagger stays in sync.
 */
import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.32, 0.72, 0, 1] as const;

// Container: staggers its DIRECT children ~50ms apart.
export const staggerContainerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};

// Item: subtle 8px rise + fade, ~220ms, iOS ease.
export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
};

interface StaggerProps {
  children: ReactNode;
  className?: string;
}

export function StaggerContainer({ children, className }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={staggerContainerVariants} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={staggerItemVariants} style={{ willChange: "opacity, transform" }}>
      {children}
    </motion.div>
  );
}
