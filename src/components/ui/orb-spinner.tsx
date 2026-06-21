import { motion } from "motion/react";
import { isNativePlatform } from "@/hooks/useIsNative";

interface OrbSpinnerProps {
  /** Diameter in px. Default 24. */
  size?: number;
  /** Aria label for screen readers. Default "Loading". */
  label?: string;
  className?: string;
}

/**
 * Brand-flavored loading indicator: a small glowing orb that pulses +
 * rotates slowly. Use everywhere you'd otherwise reach for a generic
 * spinner (Loader2, lucide spinner, shadcn Spinner) so loading states
 * across the app feel consistent and on-brand.
 *
 * Visual recipe:
 *   • Radial-gradient sphere: Wizard Lilac core → Dream Cyan ring →
 *     transparent edge. Same brand pair used by the FloatingWizardChat
 *     orb FAB glow so they read as siblings.
 *   • Soft drop-shadow halo for that "energy" feel.
 *   • Scale pulse (1 → 1.15 → 1) on a 1.6s loop.
 *   • Continuous slow rotation (4s) so the gradient streaks ever so
 *     slightly, adding life without distracting.
 *
 * Accessibility: role="status" + visually-hidden text so assistive
 * technology announces "Loading" while the user sees the orb.
 */
export function OrbSpinner({ size = 24, label = "Loading", className }: OrbSpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <motion.span
        aria-hidden
        className="block rounded-full"
        style={{
          width: size,
          height: size,
          background:
            "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95) 0%, rgba(139,126,234,0.85) 28%, rgba(74,180,237,0.55) 58%, rgba(74,180,237,0) 78%)",
          // The stacked drop-shadow halo re-rasterizes every frame on iOS as the
          // orb scales+rotates. This is the app's standard spinner (many loading
          // states), so drop the filter on native. The gradient sphere reads
          // fine on its own. Web keeps the full glow.
          filter: isNativePlatform
            ? undefined
            : "drop-shadow(0 0 6px rgba(139, 126, 234, 0.65)) drop-shadow(0 0 12px rgba(74, 180, 237, 0.35))",
        }}
        animate={{
          scale: [1, 1.15, 1],
          rotate: 360,
        }}
        transition={{
          scale: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
          rotate: { duration: 4, repeat: Infinity, ease: "linear" },
        }}
      />
      {/* Visually-hidden label for screen readers. */}
      <span className="sr-only">{label}</span>
    </span>
  );
}
