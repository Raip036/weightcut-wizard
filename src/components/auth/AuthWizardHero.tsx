import { useReducedMotion, motion } from "motion/react";
import wizard3d from "@/assets/wizard_3D.png";

interface Props {
  title: string;
  subtitle: string;
}

/**
 * Shared animated hero for fighter and coach auth sheets.
 * Renders the no-background wizard mascot with a gentle float animation,
 * a soft pulsing blue aurora halo (radial-gradient, no filter:blur),
 * and a breathing ground shadow.
 *
 * iOS perf: animations use transform/opacity only (GPU compositing).
 * Accessibility: respects prefers-reduced-motion via useReducedMotion.
 */
export default function AuthWizardHero({ title, subtitle }: Props) {
  const prefersReducedMotion = useReducedMotion();
  const shouldAnimate = !prefersReducedMotion;

  return (
    <div className="flex flex-col items-center text-center mb-8">
      {/* Mascot container — fixed height so layout doesn't shift during float */}
      <div className="relative flex items-center justify-center w-44 h-44 mb-2">
        {/* Pulsing blue aurora halo: radial-gradient circle, no filter:blur needed */}
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 55%, hsl(217 91% 58% / 0.30) 0%, hsl(217 91% 58% / 0.12) 45%, transparent 70%)",
          }}
          animate={
            shouldAnimate
              ? { opacity: [0.5, 1, 0.5], scale: [0.88, 1.08, 0.88] }
              : { opacity: 0.7, scale: 1 }
          }
          transition={
            shouldAnimate
              ? { duration: 4, ease: "easeInOut", repeat: Infinity }
              : {}
          }
        />

        {/* Floating wizard mascot */}
        <motion.img
          src={wizard3d}
          alt="WeightCut Wizard"
          className="relative z-10 w-32 h-32 object-contain"
          animate={
            shouldAnimate
              ? { y: [0, -10, 0], scale: [1, 1.025, 1], rotate: [0, 0.5, 0, -0.5, 0] }
              : {}
          }
          transition={
            shouldAnimate
              ? { duration: 4.5, ease: "easeInOut", repeat: Infinity }
              : {}
          }
        />

        {/* Breathing ground shadow */}
        <motion.div
          aria-hidden
          className="absolute bottom-2 left-1/2 -translate-x-1/2 w-16 h-2 rounded-full"
          style={{
            background: "radial-gradient(ellipse, rgba(0,0,0,0.22) 0%, transparent 75%)",
          }}
          animate={
            shouldAnimate
              ? { opacity: [0.3, 0.55, 0.3], scaleX: [0.75, 1.05, 0.75] }
              : { opacity: 0.35, scaleX: 0.9 }
          }
          transition={
            shouldAnimate
              ? { duration: 4.5, ease: "easeInOut", repeat: Infinity }
              : {}
          }
        />
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
