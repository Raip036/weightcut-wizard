import { describe, it, expect } from "vitest";
import { groupActivity, type GroupableItem } from "../activityGrouping";

// Fixed clock: 2026-06-15 12:00:00 local time.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Viewer last saw the feed an hour ago — anything newer is "unread".
const SEEN_AT = NOW - HOUR;

type Item = GroupableItem & { id: string };

const item = (id: string, ts: number): Item => ({ id, ts });

const sectionById = (sections: ReturnType<typeof groupActivity<Item>>, id: string) =>
  sections.find((s) => s.id === id);

describe("groupActivity", () => {
  it("places items with ts > seenAt in 'new' and excludes them from date buckets", () => {
    const unread = item("unread", NOW - 30 * 60 * 1000); // 30 min ago, after seenAt
    const sections = groupActivity([unread], SEEN_AT, NOW);

    const newSection = sectionById(sections, "new");
    expect(newSection?.label).toBe("New");
    expect(newSection?.items.map((i) => i.id)).toEqual(["unread"]);

    // It must not also appear in the "today" bucket.
    expect(sectionById(sections, "today")).toBeUndefined();
  });

  it("places a seen item from earlier today in 'today'", () => {
    // Seen (ts <= seenAt) but same calendar day as NOW.
    const earlierToday = item("earlierToday", new Date(2026, 5, 15, 8, 0, 0).getTime());
    const sections = groupActivity([earlierToday], SEEN_AT, NOW);

    const today = sectionById(sections, "today");
    expect(today?.label).toBe("Today");
    expect(today?.items.map((i) => i.id)).toEqual(["earlierToday"]);
    expect(sectionById(sections, "new")).toBeUndefined();
  });

  it("places a 3-day-old seen item in 'week'", () => {
    const threeDaysAgo = item("threeDaysAgo", NOW - 3 * DAY);
    const sections = groupActivity([threeDaysAgo], SEEN_AT, NOW);

    const week = sectionById(sections, "week");
    expect(week?.label).toBe("This Week");
    expect(week?.items.map((i) => i.id)).toEqual(["threeDaysAgo"]);
  });

  it("places a 20-day-old seen item in 'earlier'", () => {
    const twentyDaysAgo = item("twentyDaysAgo", NOW - 20 * DAY);
    const sections = groupActivity([twentyDaysAgo], SEEN_AT, NOW);

    const earlier = sectionById(sections, "earlier");
    expect(earlier?.label).toBe("Earlier");
    expect(earlier?.items.map((i) => i.id)).toEqual(["twentyDaysAgo"]);
  });

  it("omits empty sections", () => {
    // Only a "week" item — no new/today/earlier.
    const sections = groupActivity([item("w", NOW - 3 * DAY)], SEEN_AT, NOW);
    expect(sections.map((s) => s.id)).toEqual(["week"]);
  });

  it("returns sections in order new -> today -> week -> earlier", () => {
    const items = [
      item("earlier", NOW - 20 * DAY),
      item("week", NOW - 3 * DAY),
      item("today", new Date(2026, 5, 15, 8, 0, 0).getTime()),
      item("new", NOW - 30 * 60 * 1000),
    ];
    const sections = groupActivity(items, SEEN_AT, NOW);
    expect(sections.map((s) => s.id)).toEqual(["new", "today", "week", "earlier"]);
  });

  it("sorts items within a section by ts descending", () => {
    const older = item("older", NOW - 5 * DAY);
    const newer = item("newer", NOW - 2 * DAY);
    // Pass in ascending order to prove the util re-sorts.
    const sections = groupActivity([older, newer], SEEN_AT, NOW);
    const week = sectionById(sections, "week");
    expect(week?.items.map((i) => i.id)).toEqual(["newer", "older"]);
  });

  it("is deterministic and does not mutate the input array", () => {
    const input = [item("a", NOW - 2 * DAY), item("b", NOW - 3 * DAY)];
    const snapshot = input.map((i) => i.id);
    groupActivity(input, SEEN_AT, NOW);
    expect(input.map((i) => i.id)).toEqual(snapshot);
  });
});
