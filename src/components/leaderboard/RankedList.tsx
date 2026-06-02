import { useEffect, useMemo, useRef } from "react";
import { RankedRow, type RankDelta } from "./RankedRow";
import type { LeaderboardEntry } from "./types";

type Snapshot = {
  savedAt: number;
  ranks: Array<{ userId: string; rank: number }>;
};

const SNAPSHOT_TTL_MS = 30 * 60 * 1000; // 30 minutes between writes

function storageKey(scope: string) {
  return `leaderboard-snapshot:${scope}`;
}

function readSnapshot(scope: string): Snapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (
      !parsed ||
      typeof parsed.savedAt !== "number" ||
      !Array.isArray(parsed.ranks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(scope: string, snapshot: Snapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(scope),
      JSON.stringify(snapshot),
    );
  } catch {
    // Quota or private-mode failures are non-fatal; deltas just won't update.
  }
}

/**
 * Compute per-user rank deltas from a previously saved snapshot.
 *
 * Returns `null` for every entry when there's no prior snapshot — we'd rather
 * show no chip than misleadingly mark the entire field "NEW" on first load.
 */
function computeDeltas(
  ranks: LeaderboardEntry[],
  snapshot: Snapshot | null,
): Map<string, RankDelta> {
  const map = new Map<string, RankDelta>();
  if (!snapshot) {
    for (const r of ranks) map.set(r.userId, null);
    return map;
  }
  const prevByUser = new Map<string, number>();
  for (const s of snapshot.ranks) prevByUser.set(s.userId, s.rank);
  for (const r of ranks) {
    const prev = prevByUser.get(r.userId);
    if (prev === undefined) {
      map.set(r.userId, { kind: "new" });
      continue;
    }
    const diff = prev - r.rank;
    if (diff > 0) map.set(r.userId, { kind: "up", by: diff });
    else if (diff < 0) map.set(r.userId, { kind: "down", by: -diff });
    else map.set(r.userId, { kind: "same" });
  }
  return map;
}

export function RankedList({
  ranks,
  onRowClick,
  /**
   * Stable per-leaderboard scope for the snapshot key (e.g.
   * `${gymId}:${disciplineFilter}`). When undefined the list still renders
   * but deltas stay null — useful for tests / storybook contexts.
   */
  snapshotScope,
  /** Current viewer's userId — rows matching this get the highlight + pulse. */
  viewerUserId,
}: {
  ranks: LeaderboardEntry[];
  onRowClick?: (userId: string) => void;
  snapshotScope?: string;
  viewerUserId?: string | null;
}) {
  const snapshotRef = useRef<Snapshot | null>(null);
  // Read the snapshot ONCE per scope change. Deltas are then computed against
  // this captured value so subsequent re-renders don't churn the chips.
  useEffect(() => {
    if (!snapshotScope) {
      snapshotRef.current = null;
      return;
    }
    snapshotRef.current = readSnapshot(snapshotScope);
  }, [snapshotScope]);

  const deltas = useMemo(
    () => computeDeltas(ranks, snapshotRef.current),
    // snapshotRef.current is read once after the effect above; we re-compute
    // when the rank set changes so a re-fetch with new ranks updates chips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranks, snapshotScope],
  );

  // Debounced snapshot write: only persist if 30+ minutes elapsed since the
  // last savedAt. Keeps the window-of-comparison meaningfully fresh without
  // overwriting on every server tick.
  useEffect(() => {
    if (!snapshotScope || ranks.length === 0) return;
    const prev = snapshotRef.current;
    const now = Date.now();
    if (prev && now - prev.savedAt < SNAPSHOT_TTL_MS) return;
    writeSnapshot(snapshotScope, {
      savedAt: now,
      ranks: ranks.map((r) => ({ userId: r.userId, rank: r.rank })),
    });
  }, [ranks, snapshotScope]);

  if (ranks.length === 0) return null;

  return (
    <div
      role="list"
      className="glass-card rounded-2xl border border-border/50 divide-y divide-border/20 overflow-hidden"
    >
      {ranks.map((entry, idx) => (
        <RankedRow
          key={entry.userId}
          entry={entry}
          onClick={onRowClick ? () => onRowClick(entry.userId) : undefined}
          delta={deltas.get(entry.userId) ?? null}
          isViewer={!!viewerUserId && entry.userId === viewerUserId}
          staggerIndex={idx}
        />
      ))}
    </div>
  );
}
