import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

type Props = {
  stepId: Id<"training_path_steps">;
  onDone: () => void;
};

export function FeedbackStrip({ stepId, onDone }: Props) {
  const submit = useMutation(api.training_paths.submitStepFeedback);
  const handle = async (feedback: "nailed" | "off") => {
    await submit({ stepId, feedback });
    onDone();
  };
  return (
    <div className="rounded-xl card-surface px-3 py-2 flex items-center gap-2">
      <span className="text-[12px] text-muted-foreground flex-1">
        How'd it go?
      </span>
      <button
        type="button"
        onClick={() => handle("nailed")}
        className="rounded-lg bg-emerald-500/20 text-emerald-300 px-2.5 py-1 text-[12px] font-semibold"
      >
        👍 nailed
      </button>
      <button
        type="button"
        onClick={() => handle("off")}
        className="rounded-lg bg-rose-500/20 text-rose-300 px-2.5 py-1 text-[12px] font-semibold"
      >
        👎 still off
      </button>
    </div>
  );
}
