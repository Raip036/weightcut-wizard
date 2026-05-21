import { memo } from "react";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";

/**
 * Ambient twinkling star field rendered as a fixed background layer behind
 * the entire app. 28 Sparkles icons at very low opacity (5–13%) drift in
 * place on slow, staggered loops so the whole UI sits on what feels like a
 * faint night sky — wizardy/whimsical without being distracting.
 *
 * Design decisions:
 *   • Deterministic positions (seeded by index, not Math.random) so the
 *     stars don't shuffle on every render — that would be visually noisy.
 *   • Three brand colors (white, Wizard Lilac, Dream Cyan) cycled by index
 *     so the field feels brand-tinted rather than monochrome.
 *   • Sizes 8–14px, opacity 5–13%, durations 3.5–7s — values chosen so no
 *     two adjacent stars share a rhythm.
 *   • pointer-events-none, fixed inset-0, low z so the field never
 *     intercepts taps and always sits behind page content.
 *   • Single Sparkles import keeps the bundle small — the icon is already
 *     used elsewhere (orb FAB) so no new dependency cost.
 */

const STAR_COLORS = [
  "text-white",
  "text-brand-wizard-lilac",
  "text-brand-dream-cyan",
] as const;

const STARS = Array.from({ length: 28 }, (_, i) => {
  /* Golden-angle distribution (~137.5°) gives a pleasing, even-but-not-grid
     spread of points across the canvas without obvious clusters or stripes. */
  const seed = i * 137.508;
  const topPct = (seed * 0.673) % 100;
  const leftPct = (seed * 0.821) % 100;
  return {
    id: i,
    top: `${topPct}%`,
    left: `${leftPct}%`,
    /* Sizes 8, 10, 12, 14 cycled */
    size: 8 + (i % 4) * 2,
    /* Opacity tier — 0.05, 0.08, 0.11, 0.13 cycled, biased low so the
       field reads as ambient haze rather than visible dots. */
    opacity: 0.05 + (i % 4) * 0.027,
    /* Duration 3.5–7s, delay 0–4s so twinkles are clearly out of sync. */
    duration: 3.5 + (i % 7) * 0.5,
    delay: (i * 0.41) % 4,
    color: STAR_COLORS[i % STAR_COLORS.length],
  };
});

export const StarField = memo(function StarField() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
    >
      {STARS.map((star) => (
        <motion.span
          key={star.id}
          className={`absolute ${star.color}`}
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
          }}
          /* Twinkle: opacity breathes between `star.opacity` and ~3×
             that. Subtle scale + rotation keeps each star feeling alive
             without crowding the eye. */
          animate={{
            opacity: [star.opacity, star.opacity * 3, star.opacity],
            scale: [0.85, 1.05, 0.85],
            rotate: [0, 12, 0],
          }}
          transition={{
            duration: star.duration,
            delay: star.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Sparkles className="w-full h-full" strokeWidth={1.4} fill="currentColor" />
        </motion.span>
      ))}
    </div>
  );
});
