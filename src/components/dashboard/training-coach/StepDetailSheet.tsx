import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { Link } from "react-router-dom";

type Step = {
  _id: Id<"training_path_steps">;
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Step | null;
  pathId: Id<"training_paths"> | null;
};

export function StepDetailSheet({ open, onOpenChange, step, pathId }: Props) {
  const pauseMut = useMutation(api.training_paths.pausePath);
  if (!step) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[18px] leading-tight">
            {step.prescription}
          </SheetTitle>
        </SheetHeader>
        <p className="text-[14px] italic text-foreground/80 mt-2">
          🧙 “{step.wizardLine}”
        </p>
        <section className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            Why
          </h3>
          <p className="text-[13px] leading-relaxed">{step.details.why}</p>
        </section>
        <section className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
            How
          </h3>
          <ol className="space-y-1 list-decimal list-inside text-[13px]">
            {step.details.how.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </section>
        {step.details.pitfalls.length > 0 && (
          <section className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wider text-amber-300 mb-1">
              Watch out for
            </h3>
            <ul className="space-y-1 list-disc list-inside text-[13px] text-amber-100/90">
              {step.details.pitfalls.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-6 flex gap-2">
          <Link
            to="/training-calendar"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-2xl border border-border/50 px-3 py-2 text-[12px] font-semibold text-center"
          >
            Open in calendar
          </Link>
          {pathId && (
            <button
              type="button"
              onClick={() => {
                void pauseMut({ pathId });
                onOpenChange(false);
              }}
              className="rounded-2xl border border-amber-500/40 text-amber-300 px-3 py-2 text-[12px] font-semibold"
            >
              Pause path
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
