import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

interface SnapPhotoHeroProps {
  onTap: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * AI-first hero tile. Full-width, tall (min 132px), subtle dark-to-primary
 * radial wash so it announces itself as the headline path. The camera icon
 * sits centered and pulses gently under the primary tint; tap fires the
 * existing photo-capture flow.
 */
export function SnapPhotoHero({ onTap, disabled }: SnapPhotoHeroProps) {
  const prefersReduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={async () => {
        triggerHapticSelection();
        await onTap();
      }}
      disabled={disabled}
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05, duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="relative w-full min-h-[132px] rounded-2xl border border-primary/20 p-6 flex flex-col items-center justify-center gap-2 overflow-hidden active:scale-[0.985] transition-transform disabled:opacity-40"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--primary) / 0.08) 0%, hsl(var(--background)) 55%, hsl(var(--primary) / 0.03) 100%)",
      }}
      aria-label="Snap a photo"
    >
      {/* Soft radial glow behind the icon — adds depth without flooding. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 h-32 w-40 rounded-full opacity-30 blur-2xl"
        style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.7) 0%, transparent 70%)" }}
      />
      <motion.span
        aria-hidden
        animate={prefersReduced ? undefined : { scale: [1, 1.08, 1] }}
        transition={prefersReduced ? undefined : { duration: 2.6, ease: "easeInOut", repeat: Infinity }}
        className="relative inline-flex text-primary"
      >
        <Icon name="cameraOutline" size={32} />
      </motion.span>
      <div className="relative text-center">
        <p className="text-[16px] font-bold tracking-tight text-foreground leading-tight">
          Snap a photo
        </p>
        <p className="text-[12px] text-muted-foreground/75 leading-snug mt-1">
          Our AI reads the plate
        </p>
      </div>
    </motion.button>
  );
}
