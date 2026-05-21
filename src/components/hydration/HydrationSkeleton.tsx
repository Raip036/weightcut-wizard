import { Skeleton } from "@/components/ui/skeleton";

/**
 * Body skeleton shown while the rehydration protocol is generating.
 * Mirrors layout of the rendered protocol: summary, totals grid, hourly timeline.
 */
export function HydrationSkeleton() {
  return (
    <div className="space-y-2.5" aria-label="Generating rehydration protocol">
      <Skeleton className="h-12 rounded-xs" />
      <div className="rounded-xs bg-card border border-border p-3 space-y-2">
        <Skeleton className="h-3 w-32 mx-auto" />
        <div className="grid grid-cols-3 gap-1.5">
          <Skeleton className="h-14 rounded-xs" />
          <Skeleton className="h-14 rounded-xs" />
          <Skeleton className="h-14 rounded-xs" />
          <Skeleton className="h-14 rounded-xs" />
          <Skeleton className="h-14 rounded-xs" />
          <Skeleton className="h-14 rounded-xs" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-14 rounded-xs" />
        <Skeleton className="h-14 rounded-xs" />
        <Skeleton className="h-14 rounded-xs" />
        <Skeleton className="h-14 rounded-xs" />
      </div>
    </div>
  );
}
