// WP: ProtocolCompleteCutscene
// The "you made weight & refueled" finale. Plays once the athlete is in the
// pre-fight window with a generated rehydration plan: the cut is behind them.
// Reuses the Welcome-to-Pro visual language (aurora + drifting motes + a
// haloed, bobbing wizard) as a celebratory hero, then staggers in the
// headline and a small recap of the camp's headline numbers. All ambient
// motion is gated behind `useReducedMotion`.
import { motion, useReducedMotion } from "motion/react";
import wizardImg from "@/assets/wizard_3D.png";

export interface ProtocolCompleteStat {
  label: string;
  value: string;
  tone?: "default" | "health" | "hydration";
}

interface ProtocolCompleteCutsceneProps {
  stats: ProtocolCompleteStat[];
}

// Fixed mote positions so they don't re-randomise per render.
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "12%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "30%", size: 3, dur: 9.0, delay: 1.4 },
  { left: "48%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "66%", size: 3, dur: 9.3, delay: 2.0 },
  { left: "82%", size: 4, dur: 7.8, delay: 1.0 },
  { left: "93%", size: 3, dur: 8.6, delay: 0.4 },
];

function statToneClass(tone: ProtocolCompleteStat["tone"]): string {
  if (tone === "health") return "text-health";
  if (tone === "hydration") return "text-hydration";
  return "text-foreground";
}

export function ProtocolCompleteCutscene({
  stats,
}: ProtocolCompleteCutsceneProps) {
  const prefersReduced = useReducedMotion();

  const reveal = (delay: number, fromY = 12) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: "easeOut" as const },
        };

  return (
    <motion.section
      aria-label="Protocol complete"
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-background px-6 py-9 text-center"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
    >
      {/* Aurora wash. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
        }}
        animate={prefersReduced ? undefined : { scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? undefined
            : { duration: 8, ease: "easeInOut", repeat: Infinity }
        }
      />

      {/* Drifting motes. */}
      {!prefersReduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -340] }}
              transition={{
                duration: m.dur,
                delay: m.delay,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center">
        {/* Haloed, bobbing wizard. */}
        <div className="relative flex items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(var(--primary) / 0.14) 42%, transparent 70%)",
            }}
            animate={
              prefersReduced
                ? { opacity: 0.6 }
                : { opacity: [0.4, 0.72, 0.4], scale: [0.95, 1.06, 0.95] }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
          <motion.img
            src={wizardImg}
            alt=""
            draggable={false}
            className="relative h-[104px] w-[104px] object-contain select-none pointer-events-none"
            initial={prefersReduced ? false : { opacity: 0, y: 12, scale: 0.92 }}
            animate={
              prefersReduced
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 1, y: [0, -8, 0], scale: 1 }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.6, ease: "easeOut" },
                    scale: { type: "spring", stiffness: 220, damping: 18 },
                    y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.6 },
                  }
            }
          />
        </div>

        <motion.p
          {...reveal(0.5)}
          className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
        >
          You made weight &amp; refueled
        </motion.p>
        <motion.h2
          {...reveal(0.6)}
          className="mt-1.5 text-[28px] font-extrabold leading-tight tracking-tight text-foreground"
        >
          Fight{" "}
          <span
            style={{
              background: "linear-gradient(90deg, hsl(213 94% 72%), hsl(217 91% 52%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            night
          </span>
        </motion.h2>

        {stats.length > 0 && (
          <div className="mt-5 w-full max-w-[280px] rounded-2xl border border-border/40 bg-card/40 px-4">
            {stats.map((s, i) => (
              <motion.div
                {...reveal(0.72 + i * 0.12, 8)}
                key={s.label}
                className="flex items-center justify-between py-3 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border/40"
              >
                <span className="text-[12.5px] text-muted-foreground">
                  {s.label}
                </span>
                <span
                  className={`text-[15px] font-extrabold tabular-nums ${statToneClass(
                    s.tone,
                  )}`}
                >
                  {s.value}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
