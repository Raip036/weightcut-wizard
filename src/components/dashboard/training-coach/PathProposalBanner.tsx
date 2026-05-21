import type { Doc, Id } from "@/../convex/_generated/dataModel";

type Props = {
  proposal: Pick<Doc<"training_path_proposals">, "_id" | "technique" | "sport">;
  onAccept: (id: Id<"training_path_proposals">) => void;
  onSnooze: (id: Id<"training_path_proposals">) => void;
};

export function PathProposalBanner({ proposal, onAccept, onSnooze }: Props) {
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3 flex items-center gap-3">
      <span className="text-[18px]" aria-hidden>🧙</span>
      <p className="flex-1 text-[12px] leading-snug">
        Spin up a path for{" "}
        <span className="font-semibold">{proposal.technique}</span>?
      </p>
      <button
        type="button"
        onClick={() => onAccept(proposal._id)}
        className="rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onSnooze(proposal._id)}
        className="text-[12px] text-muted-foreground"
      >
        Not yet
      </button>
    </div>
  );
}
