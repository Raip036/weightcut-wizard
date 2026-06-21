import { useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { celebrateSuccess } from "@/lib/haptics";
import { isNativePlatform } from "@/hooks/useIsNative";

interface AnimatedRingProps {
  /** 0-1 */
  progress: number;
  size: number;
  strokeWidth: number;
  /** [startColor, endColor]: CSS color strings */
  gradientColors: [string, string];
  /** Pulsing glow + haptic when progress >= 1 */
  glowOnComplete?: boolean;
  /** Unique id prefix for SVG defs (avoid collisions when multiple rings on same page) */
  id?: string;
  className?: string;
}

const springConfig = { stiffness: 200, damping: 24, mass: 1 };

export function AnimatedRing({
  progress,
  size,
  strokeWidth,
  gradientColors,
  glowOnComplete = false,
  id = "ring",
  className,
}: AnimatedRingProps) {
  const prefersReducedMotion = useReducedMotion();
  const circleRef = useRef<SVGCircleElement>(null);
  const hasCelebrated = useRef(false);

  const viewBox = size;
  const center = viewBox / 2;
  const radius = (viewBox - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const motionProgress = useMotionValue(prefersReducedMotion ? progress : 0);
  const springProgress = useSpring(motionProgress, springConfig);

  // Write strokeDashoffset directly to DOM
  useEffect(() => {
    const unsubscribe = springProgress.on("change", (latest) => {
      if (circleRef.current) {
        const clamped = Math.min(Math.max(latest, 0), 1);
        circleRef.current.setAttribute(
          "stroke-dashoffset",
          String(circumference - clamped * circumference)
        );
      }
    });
    return unsubscribe;
  }, [springProgress, circumference]);

  // Drive the animation
  useEffect(() => {
    motionProgress.set(progress);
  }, [progress, motionProgress]);

  // Celebration on completion
  useEffect(() => {
    if (glowOnComplete && progress >= 1 && !hasCelebrated.current) {
      hasCelebrated.current = true;
      celebrateSuccess();
    }
  }, [progress, glowOnComplete]);

  const isComplete = glowOnComplete && progress >= 1;
  const gradientId = `${id}-gradient`;
  const glowId = `${id}-glow`;

  return (
    <motion.svg
      className={className}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}
      initial={prefersReducedMotion ? false : { scale: 0.9, opacity: 0 }}
      animate={{
        scale: isComplete ? [1, 1.04, 1] : 1,
        opacity: 1,
      }}
      transition={
        isComplete
          ? { scale: { duration: 0.6, repeat: 2, ease: "easeInOut" } }
          : { type: "spring", stiffness: 300, damping: 28 }
      }
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={gradientColors[0]} />
          <stop offset="100%" stopColor={gradientColors[1]} />
        </linearGradient>
        {!isNativePlatform && (
          <filter id={glowId}>
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation={isComplete ? "4" : "2"}
              floodColor={gradientColors[0]}
              floodOpacity={isComplete ? "0.7" : "0.4"}
            />
          </filter>
        )}
      </defs>

      {/* Background track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={gradientColors[0]}
        strokeWidth={strokeWidth}
        opacity={0.15}
      />

      {/* Animated progress arc */}
      <circle
        ref={circleRef}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference}
        filter={isNativePlatform ? undefined : `url(#${glowId})`}
      />
    </motion.svg>
  );
}
