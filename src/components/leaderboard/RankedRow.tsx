import { motion, useReducedMotion } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { LeaderboardEntry } from "./types";

/**
 * Rank-change delta computed client-side by `RankedList` from a localStorage
 * snapshot. `null` means "no snapshot data" (first run); a row in this state
 * renders no chip rather than a misleading "NEW" tag.
 */
export type RankDelta =
  | { kind: "up"; by: number }
  | { kind: "down"; by: number }
  | { kind: "same" }
  | { kind: "new" }
  | null;

function DeltaChip({
  delta,
  prefersReducedMotion,
}: {
  delta: RankDelta;
  prefersReducedMotion: boolean;
}) {
  if (!delta) return null;

  if (delta.kind === "up") {
    return (
      <motion.span
        initial={
          prefersReducedMotion ? false : { scale: 0.85, opacity: 0.6 }
        }
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="inline-flex items-center gap-0.5 rounded-full bg-func-recovery-green/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-func-recovery-green"
        aria-label={`Up ${delta.by} from last snapshot`}
      >
        <span aria-hidden>▲</span>+{delta.by}
      </motion.span>
    );
  }
  if (delta.kind === "down") {
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-func-danger-red/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-func-danger-red"
        aria-label={`Down ${delta.by} from last snapshot`}
      >
        <span aria-hidden>▼</span>-{delta.by}
      </span>
    );
  }
  if (delta.kind === "new") {
    return (
      <span
        className="inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary"
        aria-label="New to the leaderboard"
      >
        New
      </span>
    );
  }
  // same
  return (
    <span
      className="text-[12px] text-muted-foreground/40"
      aria-label="No rank change"
    >
      —
    </span>
  );
}

function RowContent({
  entry,
  delta,
  prefersReducedMotion,
  isViewer,
}: {
  entry: LeaderboardEntry;
  delta: RankDelta;
  prefersReducedMotion: boolean;
  isViewer: boolean;
}) {
  return (
    <>
      <div className="w-6 text-sm text-muted-foreground tabular-nums">
        #{entry.rank}
      </div>
      <Avatar className="h-8 w-8">
        <AvatarImage src={entry.avatarUrl ?? undefined} alt={entry.name} />
        <AvatarFallback>{entry.name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm">{entry.name}</span>
        {isViewer && (
          <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-primary/20 px-1.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            You
          </span>
        )}
      </div>
      <div className="hidden text-xs text-muted-foreground sm:block">
        {entry.topDiscipline}
      </div>
      <div className="flex items-center justify-end" style={{ minWidth: 44 }}>
        <DeltaChip
          delta={delta}
          prefersReducedMotion={prefersReducedMotion}
        />
      </div>
      <div className="w-16 text-right text-sm font-medium tabular-nums">
        {entry.totalMinutes} min
      </div>
    </>
  );
}

export function RankedRow({
  entry,
  onClick,
  delta = null,
  isViewer = false,
  /**
   * Stagger index for mount animation; index >= 6 mounts instantly so the
   * cascade doesn't drag on long lists. Pass `null` to skip stagger entirely.
   */
  staggerIndex = null,
}: {
  entry: LeaderboardEntry;
  onClick?: () => void;
  delta?: RankDelta;
  isViewer?: boolean;
  staggerIndex?: number | null;
}) {
  const prefersReducedMotion = useReducedMotion();

  const motionProps = prefersReducedMotion
    ? {}
    : isViewer
      ? {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0, scale: [1, 1.005, 1] },
          transition: {
            opacity: { duration: 0.28 },
            y: { duration: 0.28 },
            scale: {
              duration: 3.6,
              repeat: Infinity,
              ease: "easeInOut" as const,
            },
          },
        }
      : {
          initial: { opacity: 0, y: 4 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.24,
            delay:
              staggerIndex !== null && staggerIndex < 6
                ? staggerIndex * 0.05
                : 0,
          },
        };

  const baseClasses =
    "relative flex w-full items-center gap-3 px-3 py-2 text-left";
  const viewerClasses = isViewer
    ? "bg-primary/[0.08] border-l-2 border-primary/40"
    : "";

  if (!onClick) {
    return (
      <motion.div
        role="listitem"
        className={`${baseClasses} ${viewerClasses}`}
        {...motionProps}
      >
        <RowContent
          entry={entry}
          delta={delta}
          prefersReducedMotion={!!prefersReducedMotion}
          isViewer={isViewer}
        />
      </motion.div>
    );
  }
  return (
    <motion.button
      type="button"
      onClick={onClick}
      role="listitem"
      className={`${baseClasses} ${viewerClasses} hover:bg-card/50`}
      {...motionProps}
    >
      <RowContent
        entry={entry}
        delta={delta}
        prefersReducedMotion={!!prefersReducedMotion}
        isViewer={isViewer}
      />
    </motion.button>
  );
}
