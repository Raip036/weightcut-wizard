import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("shimmer-skeleton rounded-md", className)}
      {...props}
    />
  );
}

// Specific skeleton components for common UI patterns

export function MealCardSkeleton() {
  return (
    <div className="mb-1 rounded-xs px-3 py-2 flex items-center justify-between">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-10" />
    </div>
  );
}

export function ProfileCardSkeleton() {
  return (
    <div className="p-6 border rounded-xs space-y-4">
      <div className="flex items-center space-x-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
    </div>
  );
}

export function MacroProgressSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-2 w-full" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="text-center space-y-2">
            <Skeleton className="h-3 w-12 mx-auto" />
            <Skeleton className="h-4 w-8 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 border rounded-xs space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-4" />
            </div>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      
      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <MacroProgressSkeleton />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-28" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <MealCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NutritionPageSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-5 md:p-6 max-w-7xl mx-auto">
      {/* Wisdom card */}
      <Skeleton className="h-16 w-full rounded-xs" />

      {/* Pie chart area */}
      <div className="flex flex-col items-center space-y-3 py-2">
        <Skeleton className="h-40 w-40 rounded-full" />
        <div className="flex gap-6">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
        </div>
      </div>

      {/* Date navigator */}
      <div className="flex items-center justify-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Meal sections */}
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="card-surface overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
            {/* Meal card placeholders */}
            <div className="px-2 space-y-1">
              {[1, 2].map((j) => (
                <Skeleton key={j} className="h-14 w-full rounded-xs" />
              ))}
            </div>
            {/* Add button */}
            <div className="border-t border-border/10 flex justify-center py-2.5">
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeightTrackerSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      {/* Log input card */}
      <div className="p-4 border rounded-xs space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      {/* Chart card */}
      <div className="p-4 border rounded-xs space-y-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-48 w-full" />
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <ProfileCardSkeleton />
        <MacroProgressSkeleton />
      </div>
    </div>
  );
}

export function HydrationSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-5 md:p-6 max-w-7xl mx-auto pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-48 mt-1" />
      </div>

      {/* Disclaimer banner */}
      <Skeleton className="h-14 w-full rounded-xs" />

      {/* Safety banner */}
      <Skeleton className="h-10 w-full rounded-xs" />

      {/* Input form card */}
      <div className="rounded-xs border border-white/[0.06] p-6 space-y-6 bg-white/[0.02]">
        {/* Profile strip */}
        <div className="flex justify-center">
          <Skeleton className="h-4 w-40" />
        </div>

        {/* Weight ring */}
        <div className="flex flex-col items-center space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-36 w-36 rounded-full" />
        </div>

        {/* 2-col grid (weigh-in / fight) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card-surface rounded-xs p-4 flex flex-col items-center space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="card-surface rounded-xs p-4 flex flex-col items-center space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>

        {/* Generate button */}
        <Skeleton className="h-11 w-full rounded-xs" />
      </div>
    </div>
  );
}

export function GoalsSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-5 md:p-6 max-w-7xl mx-auto pb-20 md:pb-6">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-48 mt-1" />
      </div>

      <div className="space-y-6">
        {/* Personal Details */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-28 ml-1" />
          <div className="card-surface rounded-xs border border-border/50 overflow-hidden divide-y divide-border/50">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 sm:p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Targets */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 ml-1" />
          <div className="card-surface rounded-xs border border-border/50 overflow-hidden divide-y divide-border/50">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 sm:p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 ml-1" />
          <div className="card-surface rounded-xs border border-border/50 overflow-hidden divide-y divide-border/50">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 sm:p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="pt-4 pb-8">
          <Skeleton className="h-12 w-full rounded-xs" />
        </div>
      </div>
    </div>
  );
}

export { Skeleton };

