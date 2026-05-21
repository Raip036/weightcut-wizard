import type { Doc, Id } from "@/../convex/_generated/dataModel";

export type PathChip = Pick<Doc<"training_paths">, "_id" | "goal"> & {
  totalSteps: number;
  completedSteps: number;
};

type Props = {
  paths: PathChip[];
  queuedPaths?: Array<Pick<Doc<"training_paths">, "goal">>;
  onTapPath: (pathId: Id<"training_paths">) => void;
};

export function PathsCarousel({ paths, queuedPaths, onTapPath }: Props) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        Active paths
      </p>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {paths.slice(0, 3).map((p) => (
          <button
            key={p._id}
            type="button"
            onClick={() => onTapPath(p._id)}
            className="shrink-0 rounded-xl border border-border/50 px-3 py-2 text-left min-w-[150px] active:bg-muted/40"
            aria-label={`Open path: ${p.goal}`}
          >
            <p className="text-[12px] font-semibold truncate">{p.goal}</p>
            <div className="mt-1.5 flex items-center gap-1">
              {Array.from({ length: Math.max(1, p.totalSteps) }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < p.completedSteps ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </button>
        ))}
      </div>
      {queuedPaths && queuedPaths.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          ▶ Up next: {queuedPaths[0].goal}
        </p>
      )}
    </div>
  );
}
