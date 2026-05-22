import { motion, useReducedMotion } from "motion/react";
import orbImage from "@/assets/orb.png";

export type OrbState = "idle" | "listening" | "thinking";

interface OrbProps {
  size: number;
  state?: OrbState;
  /** Optional className applied to the outer wrapper (e.g. for absolute positioning). */
  className?: string;
  /** Optional muted / disabled look (e.g. when feature is locked). */
  muted?: boolean;
}

/**
 * Animated orb mascot used both as the floating FAB and as the in-chat
 * assistant avatar. States:
 *  - idle      → gentle 4s breathing + soft pulsing halo
 *  - listening → halo brightens, breathing slows to 2.5s
 *  - thinking  → breathing pauses, 4 orbiting particles + faint conic shimmer
 *
 * Respects `prefers-reduced-motion` — renders a static orb with no animation.
 */
export function Orb({ size, state = "idle", className, muted = false }: OrbProps) {
  const prefersReduced = useReducedMotion();

  // Halo intensity scales with state. Listening pops the brand colour.
  const haloOpacity =
    state === "listening" ? 0.55 : state === "thinking" ? 0.45 : 0.28;
  const breathDuration = state === "listening" ? 2.5 : 4;

  // Particle layout — 4 small dots at varied angles/radii rotating at different speeds.
  // Radius is expressed as a fraction of the orb size so it scales nicely.
  const particles = [
    { angle: 0, radius: 0.62, dot: 4, dur: 1.4 },
    { angle: 110, radius: 0.7, dot: 3, dur: 1.9 },
    { angle: 215, radius: 0.58, dot: 5, dur: 1.2 },
    { angle: 320, radius: 0.66, dot: 3, dur: 1.7 },
  ];

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      {/* Radial halo behind the orb — opacity transitions between states. */}
      <motion.div
        style={{
          position: "absolute",
          inset: -size * 0.35,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, hsl(var(--primary) / 0.85) 0%, hsl(var(--primary) / 0.25) 35%, transparent 70%)",
          filter: `blur(${Math.max(6, size * 0.18)}px)`,
        }}
        animate={
          prefersReduced
            ? { opacity: haloOpacity * 0.6 }
            : {
                opacity: [haloOpacity * 0.7, haloOpacity, haloOpacity * 0.7],
                scale: [0.95, 1.05, 0.95],
              }
        }
        transition={
          prefersReduced
            ? { duration: 0.4 }
            : {
                duration: breathDuration,
                repeat: Infinity,
                ease: "easeInOut",
              }
        }
      />

      {/* Conic shimmer ring — only visible while thinking. */}
      {state === "thinking" && !prefersReduced && (
        <motion.div
          style={{
            position: "absolute",
            inset: -size * 0.08,
            borderRadius: "50%",
            background:
              "conic-gradient(from 0deg, transparent 0deg, hsl(var(--primary) / 0.55) 80deg, transparent 160deg, transparent 360deg)",
            WebkitMask:
              "radial-gradient(circle, transparent 58%, #000 60%, #000 72%, transparent 74%)",
            mask: "radial-gradient(circle, transparent 58%, #000 60%, #000 72%, transparent 74%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* The orb image — breathes on idle/listening, holds steady on thinking. */}
      <motion.img
        src={orbImage}
        alt=""
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          position: "relative",
          zIndex: 1,
          userSelect: "none",
          filter: muted
            ? "grayscale(0.7) brightness(0.7)"
            : "drop-shadow(0 0 10px hsl(var(--primary) / 0.45))",
        }}
        animate={
          prefersReduced || state === "thinking"
            ? { scale: 1, opacity: 1 }
            : {
                scale: [1, 1.04, 1],
                opacity: [0.95, 1, 0.95],
              }
        }
        transition={
          prefersReduced || state === "thinking"
            ? { duration: 0.2 }
            : {
                duration: breathDuration,
                repeat: Infinity,
                ease: "easeInOut",
              }
        }
      />

      {/* Orbiting particles — thinking state only. */}
      {state === "thinking" && !prefersReduced && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          {particles.map((p, i) => (
            <motion.span
              key={i}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: 0,
                height: 0,
                transformOrigin: "center",
              }}
              animate={{
                rotate: [p.angle, p.angle + 360],
              }}
              transition={{
                duration: p.dur,
                repeat: Infinity,
                ease: "linear",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: p.dot,
                  height: p.dot,
                  marginLeft: -p.dot / 2,
                  marginTop: -p.dot / 2,
                  borderRadius: "50%",
                  background: "hsl(var(--primary))",
                  boxShadow: "0 0 6px hsl(var(--primary) / 0.9)",
                  transform: `translateY(-${size * p.radius * 0.5}px)`,
                }}
              />
            </motion.span>
          ))}
        </div>
      )}
    </div>
  );
}
