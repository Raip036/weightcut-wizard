/**
 * "Corner's empty" state — shown when the polaroid stack has been
 * exhausted (`topIndex >= posts.length`) OR when the gym genuinely has
 * no posts yet.
 *
 * Two variants, same JSX shape:
 *   - `all_caught_up` (default): user has seen everything today
 *   - `no_posts_yet`: the gym feed is genuinely empty
 *
 * Layout: floating wizard mascot, uppercase headline, two muted copy
 * blocks, a prominent rounded CTA, and a micro footer. Mascot does a
 * gentle idle bob; two sparkle decorations float on their own period
 * so the composition feels organic rather than metronomic. Copy and
 * CTA stagger-fade-up after the mascot lands.
 *
 * Reduced motion: all loops + staggers are dropped; elements fade in
 * statically so the state remains accessible without inducing motion.
 *
 * CTA ownership stays with the parent (`PolaroidStack` → `Community`).
 */
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import wizard3D from "@/assets/wizard_3D.png";

type EmptyVariant = "all_caught_up" | "no_posts_yet";

interface EmptyStackStateProps {
  onPostClick: () => void;
  variant?: EmptyVariant;
}

const COPY: Record<EmptyVariant, { headline: string; subtitle: string }> = {
  all_caught_up: {
    headline: "ALL CAUGHT UP",
    subtitle: "You've seen every post from your gym today.",
  },
  no_posts_yet: {
    headline: "FIRST ROUND",
    subtitle: "Be the first to share a session in your gym.",
  },
};

// Staggered entrance — each element is delayed +120ms after the previous,
// starting after the headline lands (0.2s). Mascot floats in first at 0s.
const STAGGER_STEP = 0.12;
const HEADLINE_DELAY = 0.2;
const SUBTITLE_DELAY = HEADLINE_DELAY + STAGGER_STEP;
const SECONDARY_DELAY = SUBTITLE_DELAY + STAGGER_STEP;
const BUTTON_DELAY = SECONDARY_DELAY + STAGGER_STEP;
const FOOTER_DELAY = BUTTON_DELAY + STAGGER_STEP;

export function EmptyStackState({
  onPostClick,
  variant = "all_caught_up",
}: EmptyStackStateProps) {
  const prefersReduced = useReducedMotion();
  const { headline, subtitle } = COPY[variant];

  const fadeUp = (delay: number) =>
    prefersReduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.32, delay: 0 } }
      : {
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: {
            type: "spring" as const,
            stiffness: 220,
            damping: 24,
            mass: 1,
            delay,
          },
        };

  // Headline gets a slightly larger y delta + longer travel for the hero feel.
  const headlineAnim = prefersReduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.32 } }
    : {
        initial: { opacity: 0, y: 40 },
        animate: { opacity: 1, y: 0 },
        transition: {
          type: "spring" as const,
          stiffness: 180,
          damping: 22,
          mass: 1,
          delay: HEADLINE_DELAY,
        },
      };

  const mascotBob = prefersReduced
    ? {}
    : { y: [0, -4, 0] };

  // Sparkles float on independent periods (2.4s + 2.8s) so they don't
  // sync with the mascot's 3s bob — keeps the composition feeling alive.
  const sparkleA = prefersReduced ? {} : { y: [0, -3, 0], opacity: [0.6, 1, 0.6] };
  const sparkleB = prefersReduced ? {} : { y: [0, -5, 0], opacity: [0.5, 0.9, 0.5] };

  return (
    <div
      role="status"
      aria-label={variant === "all_caught_up" ? "All caught up" : "No posts yet"}
      className="relative flex flex-col items-center justify-center px-8 py-24 text-center"
    >
      {/* Mascot + flanking sparkles */}
      <div className="relative mb-6 flex h-[140px] w-[140px] items-center justify-center">
        <motion.span
          aria-hidden="true"
          className="absolute -left-2 top-4 text-xl select-none"
          animate={sparkleA}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          ✨
        </motion.span>
        <motion.img
          src={wizard3D}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-full w-full object-contain pointer-events-none select-none"
          animate={mascotBob}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          style={{ willChange: "transform" }}
        />
        <motion.span
          aria-hidden="true"
          className="absolute -right-2 top-2 text-lg select-none"
          animate={sparkleB}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
        >
          ✨
        </motion.span>
      </div>

      <motion.h2
        {...headlineAnim}
        className="text-[20px] font-bold tracking-[0.08em] uppercase text-foreground"
      >
        {headline}
      </motion.h2>

      <motion.p
        {...fadeUp(SUBTITLE_DELAY)}
        className="mt-3 text-body-sm text-muted-foreground max-w-[28ch]"
      >
        {subtitle}
      </motion.p>

      <motion.p
        {...fadeUp(SECONDARY_DELAY)}
        className="mt-2 text-body-sm text-muted-foreground max-w-[28ch]"
      >
        Share something to keep the round rolling.
      </motion.p>

      <motion.div {...fadeUp(BUTTON_DELAY)} className="mt-8">
        <Button
          type="button"
          onClick={onPostClick}
          className="rounded-full px-6 gap-2"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          <span>Log a session</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </motion.div>

      <motion.p
        {...fadeUp(FOOTER_DELAY)}
        className="mt-6 text-xs text-muted-foreground/70"
      >
        Come back tomorrow for more.
      </motion.p>
    </div>
  );
}
