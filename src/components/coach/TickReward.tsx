import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Shared tick-reward primitives for the coach checklists (Training Missions +
 * Sparring To-Do List) so both features animate identically.
 *
 *  - AnimatedCheckbox: the box springs (scale pop), fills with the discipline
 *    accent, and the checkmark path draws on. Untick reverses cleanly.
 *  - XpFloat: a "+N XP" that rises and fades. The parent bumps `floatKey`
 *    (a counter) once per tick-on to retrigger it.
 *
 * Both honour prefers-reduced-motion (instant state, no spring / float).
 * `token` is a discipline CSS custom-property name, e.g. "--coach-bjj".
 */

export function AnimatedCheckbox({
  done,
  token,
  size = 18,
}: {
  done: boolean;
  token: string;
  size?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="relative rounded-md border flex items-center justify-center flex-shrink-0 mt-[1px]"
      style={{ height: size, width: size }}
      animate={{
        backgroundColor: done ? `hsl(var(${token}))` : "hsla(0,0%,100%,0)",
        borderColor: done ? `hsl(var(${token}))` : "hsl(var(--border))",
        scale: done && !reduced ? [1, 1.3, 1] : 1,
      }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66} className="text-background">
        <motion.path
          d="M5 12.5 L10 17.5 L19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: done ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.28, ease: "easeOut", delay: done ? 0.08 : 0 }}
        />
      </svg>
    </motion.span>
  );
}

export function XpFloat({
  floatKey,
  token,
  amount,
}: {
  floatKey: number;
  token: string;
  amount: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <AnimatePresence>
      {floatKey > 0 && (
        <motion.span
          key={floatKey}
          className="absolute right-3 top-1.5 text-[11px] font-extrabold tabular-nums pointer-events-none"
          style={{ color: `hsl(var(${token}))` }}
          initial={{ opacity: 0, y: 0, scale: 0.8 }}
          animate={{ opacity: [0, 1, 1, 0], y: -22, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          +{amount} XP
        </motion.span>
      )}
    </AnimatePresence>
  );
}
