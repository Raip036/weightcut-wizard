import { useEffect, useMemo, useState } from "react";
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
  /**
   * Optional discipline CSS custom-property token (e.g. "--coach-bjj"). When
   * provided, the badge / eyebrow / XP pill carry the discipline colour with a
   * glow ring instead of the default recovery-green. Falls back to green.
   */
  accentToken?: string;
  /** Optional XP total to splash with a count-up. Omit to hide the XP pill. */
  xp?: number;
}

/** Eased count-up to `target` once mounted (instant under reduced-motion). */
function useCountUp(target: number, reduced: boolean | null, ms = 700): number {
  const [n, setN] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setN(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return n;
}

/**
 * Full-screen takeover celebration shown when the user finishes a checklist
 * (a training mission's items, the sparring to-do list, …). Deterministic
 * motion-based confetti fan-out; honours reduced-motion. Auto-dismissal is
 * driven by the parent so it can settle back into the following state.
 */
export function CompleteCelebration({
  prefersReduced,
  eyebrow,
  title,
  subtitle,
  icon = "trophyOutline",
  accentToken,
  xp,
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

  const xpCount = useCountUp(xp ?? 0, prefersReduced);
  const accent = accentToken ? `hsl(var(${accentToken}))` : null;

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
        {accent ? (
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: `hsl(var(${accentToken}) / 0.16)`, boxShadow: `0 0 0 2px hsl(var(${accentToken}) / 0.4), 0 0 40px hsl(var(${accentToken}) / 0.35)` }}
          >
            <span style={{ color: accent }}>
              <Icon name={icon} size={30} />
            </span>
          </div>
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-func-recovery-green/15 ring-2 ring-func-recovery-green/40">
            <Icon name={icon} size={30} className="text-func-recovery-green" />
          </div>
        )}
        <p
          className={accent ? "text-[11px] font-bold uppercase tracking-[0.22em]" : "text-[11px] font-bold uppercase tracking-[0.22em] text-func-recovery-green"}
          style={accent ? { color: accent } : undefined}
        >
          {eyebrow}
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
          {subtitle}
        </p>
        {xp != null && xp > 0 && (
          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-extrabold tabular-nums"
            style={{
              backgroundColor: accent ? `hsl(var(${accentToken}) / 0.16)` : "hsl(var(--func-recovery-green) / 0.16)",
              color: accent ?? "hsl(var(--func-recovery-green))",
            }}
          >
            <Icon name="flashOutline" size={15} /> +{xpCount} XP
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
