import { Lock, Check } from "lucide-react";
import { useReducedMotion } from "motion/react";

interface StageIndicatorProps {
  /**
   * "drill"  — Stage 1 active, Stage 2 locked
   * "spar"   — Stage 1 cleared (shows checkmark), Stage 2 active
   * "done"   — both stages cleared (Stage 1 shows checkmark, Stage 2 cleared)
   */
  phase: "drill" | "spar" | "done";
  /**
   * CSS custom-property token string, e.g. "--coach-bjj".
   * Used as hsl(var(<token>) / <alpha>) for accent colouring.
   */
  accentToken: string;
}

/**
 * Two-phase header for the unified Mastery Spine widget.
 * Renders: `1 · Drill` / separator / `2 · Spar`
 *
 * - phase="drill"  -> Stage 1 active, Stage 2 locked (lock icon)
 * - phase="spar"   -> Stage 1 cleared (checkmark), Stage 2 active
 * - phase="done"   -> Stage 1 cleared (checkmark), Stage 2 cleared
 *
 * iOS-safe: no blur, no box-shadow, no filter.
 * Respects prefers-reduced-motion (no scale/transform animations).
 */
export function StageIndicator({ phase, accentToken }: StageIndicatorProps) {
  const reducedMotion = useReducedMotion();

  const accentFull = `hsl(var(${accentToken}))`;
  const sepFilled = `hsl(var(${accentToken}) / 0.55)`;
  const sepPartial = `linear-gradient(90deg, hsl(var(${accentToken}) / 0.55), transparent)`;

  const drillCleared = phase !== "drill";
  const sparActive = phase === "spar";
  const sparCleared = phase === "done";

  // Suppress CSS colour transitions when the user prefers reduced motion.
  const transition = reducedMotion ? undefined : "transition-colors";

  return (
    <div className="flex items-center gap-[9px] px-[15px] pb-3">
      {/* Stage 1: Drill */}
      <div
        className={`flex items-center gap-[5px] whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.05em]${transition ? ` ${transition}` : ""}`}
        style={
          drillCleared
            ? { color: "#23C599" }
            : { color: accentFull }
        }
      >
        {drillCleared ? (
          <>
            <Check size={10} strokeWidth={2.5} aria-hidden />
            1 · Drill
          </>
        ) : (
          <>1 · Drill</>
        )}
      </div>

      {/* Separator */}
      <div
        className="h-[2px] flex-1 rounded-[2px]"
        style={{
          background: drillCleared ? sepFilled : sepPartial,
        }}
        aria-hidden
      />

      {/* Stage 2: Spar */}
      <div
        className={`flex items-center gap-[5px] whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.05em]${transition ? ` ${transition}` : ""}`}
        style={
          sparCleared
            ? { color: "#23C599" }
            : sparActive
              ? { color: accentFull }
              : { color: "hsl(var(--muted-foreground) / 0.7)" }
        }
      >
        {sparCleared ? (
          <>
            <Check size={10} strokeWidth={2.5} aria-hidden />
            2 · Spar
          </>
        ) : sparActive ? (
          <>2 · Spar</>
        ) : (
          <>
            2 · Spar
            <Lock size={10} strokeWidth={2.5} aria-hidden />
          </>
        )}
      </div>
    </div>
  );
}
