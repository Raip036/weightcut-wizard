import { PodiumPlace } from "./PodiumPlace";
import type { LeaderboardEntry, MedalTier } from "./types";

const TIER_ORDER: MedalTier[] = ["gold", "silver", "bronze"];

export function PodiumHero({ podium }: { podium: LeaderboardEntry[] }) {
  if (podium.length === 0) return null;
  // Group entries by rank so ties share a tier.
  const byRank = new Map<number, LeaderboardEntry[]>();
  for (const entry of podium) {
    const list = byRank.get(entry.rank) ?? [];
    list.push(entry);
    byRank.set(entry.rank, list);
  }
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b).slice(0, 3);
  return (
    <div className="glass-card rounded-xs border border-border/50 p-4">
      {sortedRanks.map((rank, tierIdx) => {
        const tier = TIER_ORDER[tierIdx] ?? "bronze";
        const entries = byRank.get(rank)!;
        return (
          <div key={rank} className="divide-y divide-border/20">
            {entries.map((entry) => (
              <PodiumPlace key={entry.userId} entry={entry} tier={tier} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
