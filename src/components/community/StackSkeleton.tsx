/**
 * Cold-launch skeleton for the polaroid stack.
 *
 * Three stacked grey rectangles match the visible layers of the real
 * stack (`stackPosition` 0/1/2 in `PolaroidCard`) so the user perceives
 * "the deck is here, it's loading" rather than "blank page". The
 * skeletons inherit the same offset/scale/rotation values the real
 * cards use, keeping the transition into populated content invisible
 * to the eye.
 *
 * We render statically (no spring animation) because the shimmer is
 * provided by `<Skeleton />` itself. Adding card-level entry motion
 * would compound visually noisy.
 */
import { Skeleton } from "@/components/ui/skeleton";

const POSITIONS = [
  { z: 30, scale: 1, rotate: -2, y: 0, opacity: 1 },
  { z: 20, scale: 0.96, rotate: 1, y: 10, opacity: 0.7 },
  { z: 10, scale: 0.92, rotate: -1, y: 20, opacity: 0.4 },
] as const;

export function StackSkeleton() {
  return (
    <div className="relative mx-auto" style={{ width: 312, height: 396 }}>
      {POSITIONS.map((p, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={{
            zIndex: p.z,
            transform: `translateY(${p.y}px) scale(${p.scale}) rotate(${p.rotate}deg)`,
            opacity: p.opacity,
          }}
        >
          {/* Polaroid frame approximation: white card with image + caption strip. */}
          <div className="bg-white rounded-sm p-4 pb-10">
            <Skeleton className="aspect-square w-full rounded-none bg-neutral-200" />
            <div className="mt-3 h-4 w-2/3 mx-auto">
              <Skeleton className="h-full w-full bg-neutral-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
