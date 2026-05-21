import { RankedRow } from "./RankedRow";
import type { LeaderboardEntry } from "./types";

export function RankedList({
  ranks,
  onRowClick,
}: {
  ranks: LeaderboardEntry[];
  onRowClick?: (userId: string) => void;
}) {
  if (ranks.length === 0) return null;
  return (
    <div
      role="list"
      className="glass-card rounded-xs border border-border/50 divide-y divide-border/20"
    >
      {ranks.map((entry) => (
        <RankedRow
          key={entry.userId}
          entry={entry}
          onClick={onRowClick ? () => onRowClick(entry.userId) : undefined}
        />
      ))}
    </div>
  );
}
