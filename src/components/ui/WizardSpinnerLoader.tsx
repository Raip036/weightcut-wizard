import { motion, useReducedMotion } from "motion/react";
import wizard3d from "@/assets/wizard_3D.png";

interface WizardSpinnerLoaderProps {
  /** Optional caption under the mascot. Defaults to a brand-y loading line. */
  label?: string;
}

/**
 * Full-screen premium loading state: the no-background wizard mascot floating
 * inside a smooth rotating gradient ring, over a soft blue aurora glow. Used as
 * the Suspense fallback for the welcome cutscene so the load state matches the
 * screen that follows (instead of flashing the dashboard skeleton).
 *
 * iOS-perf safe: transform/opacity animations only, no filter blur. Honors
 * prefers-reduced-motion by rendering everything static.
 */
export default function WizardSpinnerLoader({ label = "Summoning your wizard" }: WizardSpinnerLoaderProps) {
  const reduce = useReducedMotion();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      {/* Soft blue aurora glow (radial gradient, no blur filter) */}
      <div
        aria-hidden
        className="pointer-events-none absolute h-72 w-72 rounded-full"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--primary) / 0.28), hsl(var(--primary) / 0.05) 55%, transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-7">
        <div className="relative flex h-[128px] w-[128px] items-center justify-center">
          {/* Smooth rotating gradient ring (the spinner) */}
          <motion.svg
            aria-hidden
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            style={{ transformOrigin: "50% 50%" }}
            animate={reduce ? undefined : { rotate: 360 }}
            transition={reduce ? undefined : { duration: 1.15, ease: "linear", repeat: Infinity }}
          >
            <defs>
              <linearGradient id="wizardSpinnerArc" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(217 91% 58%)" stopOpacity="0" />
                <stop offset="100%" stopColor="hsl(217 91% 58%)" stopOpacity="1" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="46" fill="none" stroke="hsl(var(--primary) / 0.12)" strokeWidth="3.5" />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="url(#wizardSpinnerArc)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="80 289"
            />
          </motion.svg>

          {/* Floating mascot */}
          <motion.img
            src={wizard3d}
            alt="WeightCut Wizard"
            className="relative z-10 h-[80px] w-[80px] object-contain"
            style={{ filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.45))" }}
            animate={reduce ? undefined : { y: [0, -6, 0] }}
            transition={reduce ? undefined : { duration: 2.4, ease: "easeInOut", repeat: Infinity }}
          />
        </div>

        {label && (
          <motion.p
            className="text-[15px] font-semibold tracking-tight text-foreground/90"
            animate={reduce ? undefined : { opacity: [0.55, 1, 0.55] }}
            transition={reduce ? undefined : { duration: 1.8, ease: "easeInOut", repeat: Infinity }}
          >
            {label}
          </motion.p>
        )}
      </div>
    </div>
  );
}
