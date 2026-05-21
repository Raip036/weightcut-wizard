# Camp page redesign — XP, levels, and progress rings

**Status:** Approved 2026-05-21 (Apple Fitness aesthetic, XP + level, accordion polish, ring on left).

## Goal

Make `/camp` feel like a fighter's clean control panel: low friction, glance-readable progression per discipline, light gamification that rewards work without infantilising the user.

## Concept

Each discipline (BJJ / Muay Thai / etc.) has an independent XP score and level. XP accrues from:
- Logging a session in that discipline (+10 XP)
- Ticking a mission item (+20 XP)
- Completing a mission — last-item tick (+100 XP bonus)

Level math is progressive — `level = floor(sqrt(totalXp / 50))`:
| Level | XP required |
|-------|-------------|
| 1 | 50 |
| 2 | 200 |
| 3 | 450 |
| 4 | 800 |
| 5 | 1,250 |
| 10 | 5,000 |

Each MissionCard's left edge becomes a circular progress ring showing % to next level, with the level number rendered inside.

## Data model (additions)

```ts
user_discipline_xp: defineTable({
  userId: v.id("users"),
  sport: v.string(),
  totalXp: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_sport", ["userId", "sport"])
  .index("by_user", ["userId"]);
```

## Backend API (Agent A's surface)

`convex/user_discipline_xp.ts`:

- `query api.user_discipline_xp.getAllForUser` → returns `Array<{ sport: string, totalXp: number, level: number, currentLevelXp: number, nextLevelXp: number, progress: number /* 0..1 */ }>`. Sorted by `totalXp` desc.
- `query api.user_discipline_xp.getForSport({ sport })` → same shape, single object, or `null` if no row yet.
- `internalMutation internal.user_discipline_xp.awardXp({ userId, sport, amount, reason })` → returns `{ leveledUp: boolean, prevLevel: number, newLevel: number, totalXp: number, awarded: number }`. Upserts the row, returns the level delta so the caller can fire a "Level up!" toast/dialog event.

Shared helper `convex/lib/xp.ts`:
```ts
export function levelFromXp(totalXp: number) {
  const level = Math.max(1, Math.floor(Math.sqrt(totalXp / 50)));
  const currentLevelXp = 50 * level * level;
  const nextLevelXp = 50 * (level + 1) * (level + 1);
  const progress = (totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp);
  return { level, currentLevelXp, nextLevelXp, progress: Math.max(0, Math.min(1, progress)) };
}
```

Same helper exposed for the frontend at `src/lib/xp.ts` (identical signature, no Convex deps).

### Award wiring

- In `convex/training_missions.markItemCompleted`: when ticking (not unticking), award +20 XP for that mission's `sport`. If the mission becomes complete on this tick, award an additional +100 XP. Both via `internal.user_discipline_xp.awardXp`.
- In `convex/fight_camp.ts createCalendarEntry`: after inserting a non-empty-notes calendar row, award +10 XP for `args.sessionType` via the same internal mutation. (Don't award on update — only on initial creation.)
- Return the `awardXp` result from `markItemCompleted` so the UI can show the XP gain inline.

## UI (Agent B's surface)

### Shared atom — `src/components/coach/LevelRing.tsx`

A self-contained SVG ring + level number. Props:
```ts
{ token: string;     // e.g. "--coach-bjj"
  level: number;     // displayed inside
  progress: number;  // 0..1
  size?: number;     // default 44
  strokeWidth?: number; // default 3 }
```

Implementation — `<svg>` with two `<circle>` elements (track + foreground stroke), the foreground using `stroke-dasharray` for the arc fill. Foreground colour pulls from the discipline token. The level number sits inside as a centred `<text>` element with `font-bold tabular-nums`.

### MissionCard header — rewrite

Layout (collapsed and expanded both use this header):
```
[ ring 44 ] [ discipline name + level chip ]   [ XP 240 / 450 ]   [ chevron ]
```
- Remove the left accent stripe (replaced by the ring).
- `discipline name` stays a pill but smaller (`h-5 px-2 text-[10px]`) so the level chip fits beside it.
- Level chip: `Lv 3` in a chip with discipline colour text.
- XP text: `240 / 450` in tabular-nums, muted; right-aligned before the chevron.
- Header height ~ 72px (more breathing room than current 56px) to host the ring.

### MissionCard expanded body

- Drop the duplicated header progress bar; the ring already conveys progression.
- Add a thin "Mission progress" bar (3/5 items) above the checklist, distinct from the level XP ring.
- Bump vertical rhythm — `space-y-3` instead of `space-y-2`.

### MissionStack changes

- Add a "Your week" summary tile above the active-camp banner on `/camp`. Renders the user's top-2 disciplines by XP this week, each with a small inline progress arc. Empty state hidden if no XP yet.
- (Actually: the summary tile lives in `Camp.tsx` rather than `MissionStack.tsx` since it's outside the missions block.)

### Camp.tsx polish

- Outer container `space-y-4 px-5 pt-3 pb-28` — already there.
- Add an XP summary card at the top, between the page header and the active-camp banner. Pulls `api.user_discipline_xp.getAllForUser`, renders top 2 in two small columns; falls back to a single "Start logging to earn XP" line if empty.

### MissionCompleteDialog upgrade

- Add an "+120 XP earned" splash chip (sum of all XP gained from this tick — passed in via props from MissionCard).
- If the tick caused a level-up, replace the dialog headline with "Level up! Lv {newLevel}" + same trophy, and bump the haptic from `celebrateSuccess` (already firing) — the dialog opens once per completion event, so no extra trigger needed.

### Training Calendar — remove the Generate button

Already removed in this session. The auto-summary toggle is the single entry point; the "Refresh now" link covers manual re-trigger when toggle is ON.

## Out of scope (v1)

- Per-discipline rank badges (white / blue / purple belt) — XP level number is enough for now.
- Streak system.
- Sharable level-up cards.
- XP decay / time penalties.

## Testing

Playwright pass after both agents return: capture `/camp` mobile (390×844) and tablet (768×1024) — confirm ring, level chip, XP text fit without wrapping. Click an item to capture the +20 XP splash on MissionCompleteDialog.
