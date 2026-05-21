import type { LeaderboardEntry, MyRankInfo } from "./types";

export function MyRankFooter({
  myRank,
  podium,
}: {
  myRank: MyRankInfo;
  podium: LeaderboardEntry[];
}) {
  // Zero-state: active member but no qualifying sessions this week.
  if (myRank.rank === null) {
    return (
      <div className="glass-card sticky bottom-2 z-10 rounded-xs border border-border/50 px-4 py-2 text-sm text-muted-foreground">
        You haven't trained yet this week
      </div>
    );
  }
  if (myRank.rank <= 3) return null;
  const bronze = podium.find((p) => p.rank === 3);
  const deficit = bronze
    ? Math.max(0, bronze.totalMinutes - myRank.totalMinutes)
    : null;
  return (
    <div className="glass-card sticky bottom-2 z-10 rounded-xs border border-border/50 px-4 py-2 text-sm">
      <span className="font-semibold">You're #{myRank.rank}</span>
      <span className="text-muted-foreground"> · </span>
      <span className="tabular-nums">{myRank.totalMinutes} min</span>
      {deficit !== null && deficit > 0 ? (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="tabular-nums">{deficit} min behind bronze</span>
        </>
      ) : null}
    </div>
  );
}
