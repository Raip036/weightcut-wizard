import { useEffect, useRef } from "react";
import { useMotionValue, useSpring, useReducedMotion } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  /** Format function: receives the current number, returns display string.
   *  Default: rounds to integer */
  format?: (n: number) => string;
  className?: string;
  /** Delay before animation starts (ms) */
  delay?: number;
}

const springConfig = { stiffness: 200, damping: 28, mass: 1 };

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toString(),
  className,
  delay = 0,
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(prefersReducedMotion ? value : 0);
  const springValue = useSpring(motionValue, springConfig);

  // Write to DOM directly, no React re-renders per frame
  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = format(latest);
      }
    });
    return unsubscribe;
  }, [springValue, format]);

  // Drive the animation when `value` changes
  useEffect(() => {
    if (prefersReducedMotion) {
      motionValue.set(value);
      return;
    }
    if (delay > 0) {
      const t = setTimeout(() => motionValue.set(value), delay);
      return () => clearTimeout(t);
    }
    motionValue.set(value);
  }, [value, delay, motionValue, prefersReducedMotion]);

  return (
    <span ref={ref} className={className}>
      {format(prefersReducedMotion ? value : 0)}
    </span>
  );
}
