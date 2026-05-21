import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

/**
 * Crystal-glass progress bar — Design System v1.
 *
 * Track: thin neutral-900 surface with a 1px inset highlight so it reads
 *   as a hollow glass tube on the dark page.
 * Fill : Aurora gradient (Spirit Blue → Protein Blue → Dream Cyan) with
 *   a slow shimmer overlay that sweeps left-to-right inside the filled
 *   portion. The shimmer is the "liquid moving in the tube" effect.
 *
 * Callers can still pass `indicatorClassName` to override the fill if
 * they need a per-instance color (e.g. a single danger-red progress).
 */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      /* Glass-tube track — slim by default (h-2), can be overridden via
         className. Inset highlight emulates the "glass lip" the nav uses. */
      "relative h-2 w-full overflow-hidden rounded-full bg-neutral-900",
      "",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        /* Aurora gradient fill. `bg-gradient-aurora` resolves to the
           --gradient-aurora CSS var defined in index.css. */
        "relative h-full w-full flex-1 overflow-hidden bg-gradient-aurora transition-all duration-500 ease-out",
        indicatorClassName,
      )}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    >
      {/* Shimmer overlay — a thin white-translucent diagonal that sweeps
          across the filled portion on a 2.6s loop. Only renders inside
          the Indicator so it's automatically clipped to the fill. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -inset-x-1/2 block animate-[progress-shimmer_2.6s_linear_infinite]"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)",
          width: "60%",
        }}
      />
    </ProgressPrimitive.Indicator>
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
