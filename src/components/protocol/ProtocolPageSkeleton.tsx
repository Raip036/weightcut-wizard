// WP-T19 — ProtocolPageSkeleton
// Loading state for the Weight Protocol page. Mirrors the real page's
// vertical section order so the transition from skeleton → real content
// is a swap rather than a re-layout. No motion — shimmer only.
//
// Section order (matches WeightProtocol.tsx):
//   1. Header (title + sub-line)
//   2. Today's action hero (tall card with tier stripe at top)
//   3. Inputs chip row (4 short pills)
//   4. Cut approach selector (3-segment toggle)
//   5. 3-4 day cards (smaller cards)
//   6. Weight-loss breakdown chart (4 bar rows)
//   7. ORS recipe card
//   8. Rehydration hour rows (5-6)
import { Skeleton } from "@/components/ui/skeleton-loader";

export function ProtocolPageSkeleton(): JSX.Element {
  return (
    <div className="space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
      {/* 1. Header */}
      <div className="pt-1 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* 2. Today's action hero */}
      <div className="card-surface rounded-2xl border border-border/50 overflow-hidden">
        {/* Tier stripe */}
        <Skeleton className="h-0.5 w-full rounded-none" />
        <div className="p-5 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="flex flex-wrap gap-2 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Inputs chip row (4 short pills) */}
      <div className="flex flex-wrap gap-2 pt-1">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      {/* 4. Cut approach selector (3-segment) */}
      <div className="card-surface rounded-2xl border border-border/50 p-1 flex gap-1">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 flex-1 rounded-xl" />
        ))}
      </div>

      {/* 5. Day cards (3-4 smaller cards) */}
      <div className="space-y-2 pt-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="card-surface rounded-2xl border border-border/50 p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ))}
      </div>

      {/* 6. Weight-loss breakdown chart (4 bar rows) */}
      <div className="card-surface rounded-2xl border border-border/50 p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="space-y-2.5 pt-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* 7. ORS recipe card */}
      <div className="card-surface rounded-2xl border border-border/50 p-5 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-full" />
        <div className="space-y-2 pt-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* 8. Rehydration hour rows (5-6) */}
      <div className="card-surface rounded-2xl border border-border/50 p-4 space-y-2">
        <Skeleton className="h-5 w-44 mb-2" />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between py-2 border-t border-border/30 first:border-t-0"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-12" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
