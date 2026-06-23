import { type ReactNode, useState } from "react";
import { motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Trash2 } from "lucide-react";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * Swipe-left-to-delete row wrapper (iOS-style).
 *
 * Wraps a card/list row: dragging it left reveals a red "Delete" action behind
 * it, and releasing past a threshold fires `onDelete` (the caller decides what
 * that means — here it opens a confirm dialog). The row always snaps back to
 * its resting position, so this never leaves a persistent open state to manage.
 *
 * `dragDirectionLock` keeps vertical page scrolling intact (only a clearly
 * horizontal gesture engages the drag). When `enabled` is false the wrapper is
 * a transparent passthrough, so callers can disable it in selection/compare
 * modes where a tap already has a meaning.
 */
const THRESHOLD = 72; // px of left-drag needed to arm + fire the delete
const MAX_PULL = 96; // how far the card can actually slide

export function SwipeToDelete({
  children,
  onDelete,
  enabled = true,
  className,
}: {
  children: ReactNode;
  onDelete: () => void;
  enabled?: boolean;
  className?: string;
}) {
  const x = useMotionValue(0);
  const [armed, setArmed] = useState(false);

  // The red action panel fades + the icon grows as the card is pulled left.
  const panelOpacity = useTransform(x, [-THRESHOLD, -12, 0], [1, 0.35, 0]);
  const iconScale = useTransform(x, [-MAX_PULL, -THRESHOLD, -24], [1.18, 1, 0.85]);

  if (!enabled) return <>{children}</>;

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className ?? ""}`}>
      {/* Delete action revealed behind the card on left-swipe. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-end bg-destructive pr-6 text-destructive-foreground"
        style={{ opacity: panelOpacity }}
      >
        <motion.div
          style={{ scale: iconScale }}
          className="flex flex-col items-center gap-0.5"
        >
          <Trash2 className="h-5 w-5" />
          <span className="text-[11px] font-bold uppercase tracking-wide">Delete</span>
        </motion.div>
      </motion.div>

      {/* Foreground card. Slides left over the action, snaps back on release. */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -MAX_PULL, right: 0 }}
        dragElastic={{ left: 0.08, right: 0 }}
        dragSnapToOrigin
        style={{ x }}
        onDrag={(_, info: PanInfo) => {
          const past = info.offset.x < -THRESHOLD;
          if (past !== armed) {
            setArmed(past);
            if (past) triggerHapticSelection();
          }
        }}
        onDragEnd={(_, info: PanInfo) => {
          if (info.offset.x < -THRESHOLD) onDelete();
          setArmed(false);
        }}
        className="relative z-10"
      >
        {children}
      </motion.div>
    </div>
  );
}
