import { Link } from "react-router-dom";

type Props = { onSetGoal: () => void };

export function EmptyState({ onSetGoal }: Props) {
  return (
    <div className="rounded-2xl border border-border/50 card-surface p-5 flex flex-col items-center text-center gap-3">
      <p className="text-[14px] font-semibold">No paths yet.</p>
      <p className="text-[12px] text-muted-foreground">
        Log a session to auto-extract techniques, or set a goal.
      </p>
      <div className="flex gap-2 w-full mt-1">
        <Link
          to="/training-calendar"
          className="flex-1 rounded-2xl border border-border/50 px-3 py-2 text-[12px] font-semibold text-center"
        >
          Log a session
        </Link>
        <button
          type="button"
          onClick={onSetGoal}
          className="flex-1 rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-[12px] font-semibold"
        >
          Set a goal
        </button>
      </div>
    </div>
  );
}
