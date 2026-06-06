import { useMemo } from "react";
import { motion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";

interface CompleteCelebrationProps {
  /** Honour reduced-motion: skip the confetti burst and use gentle fades. */
  prefersReduced: boolean | null;
  /** Small uppercase eyebrow shown above the title. */
  eyebrow: string;
  /** Large headline. */
  title: string;
  /** Supporting line under the title. */
  subtitle: string;
  /** Ion icon rendered inside the badge ring. Defaults to a trophy. */
  icon?: IonIconName;
}

/**
 * Full-screen takeover celebration shown once when the user finishes the LAST
 * item in a checklist (training missions, sparring to-do list, …). Uses the
 * repo's deterministic motion-based confetti fan-out and honours reduced-motion.
 * Auto-dismissal is driven by the parent so it can smoothly settle back into
 * whatever empty/idle state should follow.
 */
export function CompleteCelebration({
  prefersReduced,
  eyebrow,
  title,
  subtitle,
  icon = "trophyOutline",
}: CompleteCelebrationProps) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const angle = (i / 30) * Math.PI * 2;
        const dist = 120 + (i % 6) * 34;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 40,
          rot: (i * 61) % 360,
          size: 6 + (i % 3) * 3,
          color: ["#23C599", "#3B82F6", "#FAC146", "#F08439", "#9DE7D0"][i % 5],
        };
      }),
    [],
  );

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center px-8 bg-background/85 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      role="status"
      aria-live="polite"
    >
      {/* Confetti burst — skipped entirely under reduced-motion. */}
      {!prefersReduced && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div className="relative">
            {pieces.map((p) => (
              <motion.span
                key={p.id}
                className="absolute rounded-[2px]"
                style={{ width: p.size, height: p.size * 1.4, background: p.color }}
                initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
                animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot, scale: 1 }}
                transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </div>
        </div>
      )}

      <motion.div
        className="relative text-center"
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -8 }}
        transition={
          prefersReduced
            ? { duration: 0.2 }
            : { type: "spring", stiffness: 360, damping: 22, mass: 0.7 }
        }
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-func-recovery-green/15 ring-2 ring-func-recovery-green/40">
          <Icon name={icon} size={30} className="text-func-recovery-green" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-func-recovery-green">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
          {subtitle}
        </p>
      </motion.div>
    </motion.div>
  );
}
