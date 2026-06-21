import { motion, useReducedMotion } from "motion/react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShimmerCrownBadgeProps {
  /** Tile size in px. The crown scales with it. */
  size?: number;
  className?: string;
}

/**
 * A gradient "crown crest" tile with a periodic gloss shimmer: the shared
 * premium marker used on every Pro upsell entry point (locked buttons, teaser
 * cards). Keeps the crown treatment in one place so it can't drift across the
 * app. Shimmer is suppressed under `prefers-reduced-motion`.
 */
export function ShimmerCrownBadge({ size = 40, className }: ShimmerCrownBadgeProps) {
  const prefersReduced = useReducedMotion();
  const crown = Math.round(size * 0.45);

  return (
    <span
      className={cn(
        "relative overflow-hidden flex items-center justify-center shrink-0",
        size >= 34 ? "rounded-xl" : "rounded-lg",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: "linear-gradient(145deg, hsl(213 94% 70%) 0%, hsl(217 91% 56%) 55%, hsl(221 83% 46%) 100%)",
        boxShadow: "0 0 16px hsl(217 91% 58% / 0.40), inset 0 1px 1px rgba(255,255,255,0.4)",
      }}
    >
      <Crown
        style={{ width: crown, height: crown }}
        className="text-background"
        strokeWidth={2}
        fill="currentColor"
      />
      {!prefersReduced && (
        <motion.span
          aria-hidden
          className="absolute top-0 -left-1/2 h-full w-1/2 bg-white/35"
          style={{ transform: "skewX(-20deg)" }}
          initial={{ x: "-160%" }}
          animate={{ x: "340%" }}
          transition={{ duration: 1.0, ease: "easeOut", repeat: Infinity, repeatDelay: 2.4, delay: 0.8 }}
        />
      )}
    </span>
  );
}
