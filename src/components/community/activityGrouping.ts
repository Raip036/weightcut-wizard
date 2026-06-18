/**
 * Pure, generic time-bucketing for the community activity feed.
 *
 * Splits a flat list of timestamped items into ordered sections:
 *   - "New":       unread (item.ts > seenAt). Unread items go ONLY here.
 *   - "Today":     already-seen, same calendar day as `now`.
 *   - "This Week": already-seen, within the last 7 days but not today.
 *   - "Earlier":   already-seen, older than 7 days.
 *
 * Deterministic: `now` is injected (no Date.now() inside) so callers and
 * tests fully control the clock. Empty sections are omitted; items inside
 * each section are sorted by `ts` descending.
 */

export interface GroupableItem {
  /** Epoch milliseconds. */
  ts: number;
}

export type ActivitySectionId = "new" | "today" | "week" | "earlier";

export interface ActivitySection<T> {
  id: ActivitySectionId;
  label: string;
  items: T[];
}

const SECTION_LABELS: Record<ActivitySectionId, string> = {
  new: "New",
  today: "Today",
  week: "This Week",
  earlier: "Earlier",
};

/** Fixed render order for the feed. */
const SECTION_ORDER: ActivitySectionId[] = ["new", "today", "week", "earlier"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start-of-day (local time) for the given epoch ms. */
function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket activity items into ordered sections.
 *
 * @param items  Items to group (not mutated).
 * @param seenAt Viewer's frozen lastActivitySeenAt (epoch ms). Items with
 *               `ts > seenAt` are treated as unread.
 * @param now    Current epoch ms, injected for testability.
 */
export function groupActivity<T extends GroupableItem>(
  items: T[],
  seenAt: number,
  now: number,
): ActivitySection<T>[] {
  const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * DAY_MS; // inclusive lower bound for "last 7 days"

  const buckets: Record<ActivitySectionId, T[]> = {
    new: [],
    today: [],
    week: [],
    earlier: [],
  };

  for (const item of items) {
    if (item.ts > seenAt) {
      // Unread items live ONLY in "new", never in a date bucket.
      buckets.new.push(item);
    } else if (item.ts >= todayStart) {
      buckets.today.push(item);
    } else if (item.ts >= weekStart) {
      buckets.week.push(item);
    } else {
      buckets.earlier.push(item);
    }
  }

  const sections: ActivitySection<T>[] = [];
  for (const id of SECTION_ORDER) {
    const bucket = buckets[id];
    if (bucket.length === 0) continue;
    bucket.sort((a, b) => b.ts - a.ts);
    sections.push({ id, label: SECTION_LABELS[id], items: bucket });
  }
  return sections;
}
