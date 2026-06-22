// MasteryCutscene: full-screen takeover congrats shown when a discipline's
// drills AND sparring are fully complete. Reuses the app's reference "Aurora
// Wizard" aesthetic (see ProtocolGeneratingOverlay / CampCompleteCutscene):
// a haloed bobbing 3D wizard over a near-opaque dark backdrop, a deterministic
// index-based confetti burst, an accent-colored eyebrow + XP pill that counts
// up, and a big bold title. Auto-dismisses after ~3.8s and on tap-anywhere.
// Reduced-motion collapses to a calm static state with the final XP shown.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import wizard from "@/assets/wizard_3D.png";

export interface MasteryCutsceneProps {
  open: boolean;
  /** Discipline CSS custom-property token, e.g. "--coach-muay-thai". */
  accentToken: string;
  /** XP awarded; the pill counts up from 0 to this value. */
  xp: number;
  /** Discipline display label, e.g. "Muay Thai". */
  disciplineLabel: string;
  /** Number of techniques drilled + landed. */
  techniqueCount: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3800;

/** Eased count-up to `target` once mounted (instant under reduced-motion). */
function useCountUp(target: number, reduced: boolean | null, ms = 800): number {
  const [n, setN] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setN(target);
      return;
    }
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

export function MasteryCutscene({
  open,
  accentToken,
  xp,
  disciplineLabel,
  techniqueCount,
  onDismiss,
}: MasteryCutsceneProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  const accent = `hsl(var(${accentToken}))`;
  const accentA = (a: number) => `hsl(var(${accentToken}) / ${a})`;

  const xpCount = useCountUp(open ? xp : 0, prefersReduced);

  // Auto-dismiss timer; cleared on close/unmount.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [open, onDismiss]);

  // Deterministic confetti fan-out (index-based, no Math.random in render).
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
          color: ["#3B82F6", "#23C599", "#FAC146", "#F08439", "#9DE7D0"][i % 5],
        };
      }),
    [],
  );

  const techLabel = `${techniqueCount} technique${techniqueCount === 1 ? "" : "s"}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`${disciplineLabel} mastered`}
          onClick={onDismiss}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[120] flex flex-col items-center justify-center overflow-hidden bg-background/95 backdrop-blur-md px-7"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 24px)",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
          }}
        >
          {/* Accent wash rising from the base. */}
          {!prefersReduced && (
            <motion.div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(120% 70% at 50% 100%, ${accentA(0.28)}, transparent 70%)`,
              }}
              animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {/* Confetti burst, skipped entirely under reduced-motion. */}
          {!prefersReduced && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              <div className="relative">
                {pieces.map((p) => (
                  <motion.span
                    key={p.id}
                    className="absolute rounded-[2px]"
                    style={{
                      width: p.size,
                      height: p.size * 1.4,
                      background: p.color,
                    }}
                    initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
                    animate={{
                      x: p.dx,
                      y: p.dy,
                      opacity: [0, 1, 1, 0],
                      rotate: p.rot,
                      scale: 1,
                    }}
                    transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Haloed, bobbing wizard. */}
          <div
            className="relative z-10 flex items-center justify-center"
            style={{ height: 168 }}
          >
            {!prefersReduced && (
              <motion.div
                aria-hidden
                className="absolute"
                style={{
                  width: 196,
                  height: 196,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${accentA(0.5)} 0%, ${accentA(0.15)} 40%, transparent 70%)`,
                  filter: "blur(8px)",
                }}
                animate={{
                  opacity: [0.5, 0.85, 0.5],
                  scale: [0.95, 1.08, 0.95],
                }}
                transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <motion.img
              src={wizard}
              alt=""
              draggable={false}
              style={{
                width: 140,
                height: 140,
                objectFit: "contain",
                position: "relative",
                zIndex: 2,
                filter: `drop-shadow(0 0 22px ${accentA(0.45)})`,
              }}
              initial={prefersReduced ? false : { scale: 0.8, opacity: 0 }}
              animate={
                prefersReduced
                  ? { y: 0, scale: 1, opacity: 1 }
                  : { y: [0, -10, 0], scale: 1, opacity: 1 }
              }
              transition={{
                y: { duration: 3.4, repeat: Infinity, ease: "easeInOut" },
                scale: { type: "spring", damping: 18, stiffness: 240 },
                opacity: { duration: 0.4 },
              }}
            />
          </div>

          {/* Eyebrow + title + subtitle. */}
          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="relative z-10 mt-6 text-[11px] uppercase tracking-[0.24em] font-bold"
            style={{ color: accent }}
          >
            {disciplineLabel} mastered
          </motion.p>
          <motion.h2
            initial={prefersReduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.45 }}
            className="relative z-10 mt-2 text-center text-[28px] font-black tracking-tight text-foreground leading-tight max-w-[20rem]"
          >
            Mastered!
          </motion.h2>
          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.45 }}
            className="relative z-10 mt-3 text-center text-[14px] text-muted-foreground leading-snug max-w-[19rem]"
          >
            {techLabel} drilled and landed in live sparring.
          </motion.p>

          {/* XP pill, counts up. */}
          {xp > 0 && (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.45 }}
              className="relative z-10 mt-5 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-extrabold tabular-nums"
              style={{
                backgroundColor: accentA(0.16),
                color: accent,
                boxShadow: `0 0 0 1.5px ${accentA(0.4)}, 0 0 28px ${accentA(0.3)}`,
              }}
            >
              +{xpCount} XP
            </motion.div>
          )}

          {/* Tap-to-dismiss hint. */}
          <motion.p
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.5 }}
            className="relative z-10 mt-10 text-[11px] text-muted-foreground/60"
          >
            Tap anywhere to continue
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
