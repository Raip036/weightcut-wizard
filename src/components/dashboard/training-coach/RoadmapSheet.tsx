import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { Check, Loader2, RefreshCw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathId: Id<"training_paths"> | null;
};

export function RoadmapSheet({ open, onOpenChange, pathId }: Props) {
  const data = useQuery(
    api.training_paths.getPathWithSteps,
    pathId ? { pathId } : "skip",
  );
  const pauseMut = useMutation(api.training_paths.pausePath);
  const archiveMut = useMutation(api.training_paths.archivePath);
  if (!pathId) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.path.goal ?? "Path"}</SheetTitle>
        </SheetHeader>
        {!data && (
          <Loader2 className="animate-spin h-5 w-5 mt-4" aria-label="Loading" />
        )}
        {data && (
          <ol className="mt-4 space-y-3">
            {data.steps.map((s) => {
              const color =
                s.state === "completed"
                  ? "bg-emerald-500 border-emerald-500"
                  : s.state === "current"
                    ? "bg-primary border-primary animate-pulse"
                    : s.state === "remedial"
                      ? "bg-amber-400 border-amber-400"
                      : "bg-muted border-border";
              return (
                <li key={s._id} className="flex gap-3">
                  <span
                    className={`mt-0.5 h-6 w-6 rounded-full border-2 flex items-center justify-center ${color}`}
                    aria-hidden
                  >
                    {s.state === "completed" && (
                      <Check
                        className="h-3.5 w-3.5 text-background"
                        strokeWidth={3}
                      />
                    )}
                    {s.state === "remedial" && (
                      <RefreshCw
                        className="h-3 w-3 text-background"
                        strokeWidth={3}
                      />
                    )}
                  </span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold">{s.prescription}</p>
                    {s.state === "remedial" && (
                      <p className="text-[11px] text-amber-300 mt-0.5">
                        Refining
                      </p>
                    )}
                    {s.completedAt && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Completed{" "}
                        {new Date(s.completedAt).toLocaleDateString()}
                        {s.completedFeedback &&
                          ` · ${s.completedFeedback === "nailed" ? "👍" : "👎"}`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data && data.path.status === "active" && (
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void pauseMut({ pathId });
                onOpenChange(false);
              }}
              className="flex-1 rounded-2xl border border-amber-500/40 text-amber-300 px-3 py-2 text-[12px] font-semibold"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => {
                void archiveMut({ pathId });
                onOpenChange(false);
              }}
              className="flex-1 rounded-2xl border border-rose-500/40 text-rose-300 px-3 py-2 text-[12px] font-semibold"
            >
              Archive
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
