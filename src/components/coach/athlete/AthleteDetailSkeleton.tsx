/**
 * AthleteDetailSkeleton — loading state that mirrors the v2 page
 * layout (hero, 2x2 chart grid, sessions list). Uses the existing
 * shimmer-skeleton utility so it matches the rest of the app.
 */
import { Skeleton } from "@/components/ui/skeleton";

function ChartCardSkeleton() {
  return (
    <div className="glass-card p-3.5 min-h-[120px] flex flex-col gap-2">
      <Skeleton className="h-3 w-16 rounded-full" />
      <Skeleton className="h-6 w-20" />
      <div className="flex-1">
        <Skeleton className="h-8 w-full mt-1" />
      </div>
      <Skeleton className="h-2.5 w-24 rounded-full" />
    </div>
  );
}

export function AthleteDetailSkeleton() {
  return (
    <div
      className="animate-page-in space-y-3 px-5 pb-3 sm:px-5 sm:pb-5 md:px-6 md:pb-6 w-full max-w-2xl mx-auto"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
      }}
    >
      {/* Back row */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* Hero */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <Skeleton className="h-[88px] w-[88px] rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>

      {/* 2x2 chart grid */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>

      {/* Sessions */}
      <div className="glass-card p-4 space-y-3">
        <Skeleton className="h-3 w-24" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
