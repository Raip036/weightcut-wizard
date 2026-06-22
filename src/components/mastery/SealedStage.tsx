import { Lock } from "lucide-react";
import { useReducedMotion } from "motion/react";

interface SealedStageProps {
  /**
   * CSS custom-property token string, e.g. "--coach-bjj".
   * Used as hsl(var(<token>) / <alpha>) for accent colouring.
   */
  accentToken: string;
  /**
   * Number of drill items still remaining before sparring unlocks.
   */
  remaining: number;
}

/**
 * Locked panel shown during the drill phase of the Mastery Spine widget.
 * Displays a dashed-border inset panel with a lock icon, "Sparring sealed"
 * title and a subtext describing what the user needs to do.
 *
 * iOS-safe: no blur, no box-shadow, no filter — borders, bg tint, radial-gradient only.
 * Respects prefers-reduced-motion (no animations under reduced motion).
 */
export function SealedStage({ accentToken, remaining }: SealedStageProps) {
  const reducedMotion = useReducedMotion();

  const accentMuted = `hsl(var(${accentToken}) / 0.15)`;

  return (
    <div
      className="mx-3 mb-[14px] mt-1 rounded-[14px] border px-4 py-5 text-center"
      style={{
        borderStyle: "dashed",
        borderColor: "rgba(255,255,255,0.10)",
        background: accentMuted,
      }}
      aria-label="Sparring sealed"
    >
      {/* Radial accent glow behind icon — iOS-safe (radial-gradient, not box-shadow).
          Omitted under reduced-motion to avoid any decorative visual pulse. */}
      <div
        className="relative mx-auto mb-[9px] flex h-[30px] w-[30px] items-center justify-center"
        aria-hidden
      >
        {!reducedMotion && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle at 50% 50%, hsl(var(${accentToken}) / 0.18), transparent 70%)`,
            }}
          />
        )}
        <Lock
          size={20}
          strokeWidth={2}
          className="relative"
          style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}
        />
      </div>

      <p className="text-[13px] font-bold leading-snug text-foreground">
        Sparring sealed
      </p>

      <p
        className="mx-auto mt-1 max-w-[240px] text-[11.5px] leading-[1.4]"
        style={{ color: "hsl(var(--muted-foreground))" }}
      >
        {`Clear all ${remaining} drill${remaining === 1 ? "" : "s"} and your techniques graduate into live sparring.`}
      </p>
    </div>
  );
}
