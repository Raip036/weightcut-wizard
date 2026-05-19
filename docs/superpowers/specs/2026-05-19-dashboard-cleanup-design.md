# Dashboard cleanup — reduce numeric clutter without losing functionality

**Status:** Design proposal
**Date:** 2026-05-19
**Surface:** `src/pages/Dashboard.tsx` (FightForm-enabled path; legacy path follows the same edits)

## Problem

The dashboard currently shows ~12 distinct numbers at once on first paint and **four different surfaces that all answer "did I log X?"** This produces three concrete pain points:

1. **Redundancy.** Today's adherence is rendered three separate places (the `FightFormInsightStrip` dot row, the `TodayPanel` 2×2 grid, and partially in the `TrainingWeekWidget`). Weekly progress is rendered twice (`ConsistencyRing` 7-day dots and `TrainingWeekWidget` 7-day bars).
2. **Zero-state shouting.** When nothing is logged yet, every widget renders prominent "0/7", "0%", "0/100" labels. The user is told they've failed five different ways before they've started.
3. **Competing focal points.** Two visually similar rings (`FightFormRing` and `ConsistencyRing`) fight for the eye instead of letting the fight form score be the single hero.

All current functionality must be preserved — fight scoring, sleep, weight, training, wellness, meals, achievements, gym widgets all stay reachable. The goal is **fewer surface numbers, same depth on tap**.

## Goals

- Cut the number of visible numeric values on first paint from ~12 down to ~5.
- Eliminate every duplicate "did I log this today / this week" indicator. Each piece of information renders in exactly one place.
- Replace zero-noise (`0/7`, `0%`, `0/100`) with language during cold-start states.
- Keep the Fight Form Score as the single visual hero. Everything else demotes.
- Preserve every existing user-reachable feature; no widget loses functionality, some lose surface area in favor of sheet-based detail views.

## Non-goals

- No data model or backend changes. All edits are inside `src/components/dashboard/*` and `src/pages/Dashboard.tsx`.
- No redesign of the Fight Form score itself or its sub-scores. The `FightFormScoreSheet` keeps its full breakdown.
- No change to the legacy (FightForm-disabled) layout's section *content* — the same simplification applies there because both code paths re-use the same widgets, but the FightForm path is the canonical surface.
- No new motion / theming work beyond the changes implied below.

## Design

### Three-zone layout

The page is restructured around three semantic zones in this order, replacing the current 11-card stack:

1. **Today** (above the fold) — Fight Form Ring + a single inline "Today" strip beneath it.
2. **This Week** — One row containing the weight chart and training-week widget side-by-side (unchanged from today's grid; this row stays because it carries unique trend data that the score sheet doesn't expose at a glance).
3. **Progress** — Milestone badges row at the bottom.

`TrainingInsightsWidget` slots between zones 2 and 3 only when it has content to render (see "Empty widgets don't render" below).

### Change 1: Remove `ConsistencyRing` from the dashboard

The `ConsistencyRing` widget is removed from `Dashboard.tsx` (both the FightForm path at line ~845 and the legacy path at line ~1041). The component file `src/components/dashboard/ConsistencyRing.tsx` stays in the repo; if not referenced anywhere else after removal, it can be deleted in a follow-up cleanup commit.

**Why:** The `X/7 days` and "this week's day dots" data is already shown by `TrainingWeekWidget`'s 7-day bar chart (for training) and the new unified Today strip (for today). The Consistency ring's only unique value was the rolled-up percentage, which is duplicative of the Fight Form Score's adherence sub-scores already visible in `FightFormScoreSheet`.

### Change 2: Unify Today Panel + InsightStrip dots into one "Today" strip

Today, two components both render today-adherence:

- `FightFormInsightStrip` shows a row of 4–5 small ringed dots (sleep / weight / training / wellness / nutrition) under the ring.
- `TodayPanel` renders a 2×2 grid of larger tap-targets (Weight / Training / Sleep / Check-in) below the stat chips.

These collapse into **one** component, `TodayStrip`, rendered directly under `FightFormRing` (replacing the dot row inside `FightFormInsightStrip`). The 2×2 `TodayPanel` is removed.

`TodayStrip` is a single horizontal row of 5 pill-shaped buttons (Weight · Training · Sleep · Wellness · Meals). Each pill:
- Shows the source icon + label.
- Renders filled (logged today) or outlined (not logged today).
- Is a `Link` to the same destination `TodayPanel`/`InsightStrip` currently routes to.
- Shows a subtle "All set" affordance (the pill bar gets a single primary-tinted underline) when every source is logged.

The headline / educational copy currently inside `FightFormInsightStrip` (the "your top driver is X" sentence and "tap for breakdown" affordance) stays — only the dot row inside it is replaced by `TodayStrip`. The headline keeps tapping through to the score sheet.

The keyboard target sizes and tap surfaces match Today Panel's current accessibility characteristics (44px min).

### Change 3: Language over numbers during cold-start

Three specific zero-state replacements:

- **Fight Form Score:** when `state === "calibrating"`, the ring shows `Calibrating` as its center label (already done) and the educational copy reads `Day N of 7` instead of any "X/100". The numeric score is hidden entirely until calibration completes. *(Current behavior already partially does this via `calibratingDays`; this design just removes any remaining "0/100" leak through into chips or banners during calibration.)*
- **TodayStrip:** when `adherence` is fully empty, the strip header reads `Fresh start — log anything to begin` instead of any percentage. As soon as ≥1 pill fills, the headline reverts to the existing educational copy.
- **`FightFormStatChips` weight chip:** when there is no weight history yet, the chip shows `Log a weight to start tracking` instead of `0 kg → 0 kg · 0%`. The 14-day trend sparkline is hidden in this state.

### Change 4: Demote `FightFormStatChips` to one inline summary line

The current `FightFormStatChips` is a two-chip card row (Weight chip + 14-day Trend chip). It's collapsed to a single inline summary line that lives immediately below the `TodayStrip`:

```
75.2 → 70.0 kg · 48% · 14-day trend ↗
```

- The weight numbers + percent stay as text.
- The 14-day trend sparkline graph is removed from the dashboard surface. It moves into `FightFormScoreSheet` (which already opens on ring tap and already exposes the score history; the sparkline becomes a small chart in that sheet's body).
- The `latestScore` chip in `FightFormStatChips` is removed from the dashboard — the score is right above it in the ring.

### Change 5: Empty widgets don't render

Three widgets get a "render only when there's something to say" guard:

- `TrainingInsightsWidget` — if the underlying insights query returns an empty array, the widget renders nothing (today it renders a skeleton/placeholder card).
- `MilestoneBadges` — when `badges.length === 0` AND `!loading`, render nothing. Today it renders an empty card frame.
- `DashboardWeightChart` — when `chartData.length === 0`, the existing "No data yet · Log Weight" empty card stays (this one is genuinely useful as a CTA, unlike the others).

### Visual hierarchy summary

After the changes, the surface numbers visible at first paint compress to roughly:

1. Days left (header)
2. Fight Form Score (ring) — the hero
3. Weight current → goal (one line below TodayStrip)
4. Weight % complete (same line)
5. Training sessions this week (inside TrainingWeekWidget, unchanged)

Everything else moves to tap-revealed sheets (`FightFormScoreSheet` for the score breakdown, sub-scores, and the moved 14-day trend; `AchievementSheet` for badge detail).

## Component-level edits

| Component | Edit |
|---|---|
| `src/pages/Dashboard.tsx` | Remove `ConsistencyRing` and `TodayPanel` from both render paths. Replace with `TodayStrip` directly under `FightFormRing`. Collapse `FightFormStatChips` to inline summary (or replace with a small inline component). |
| `src/components/dashboard/TodayStrip.tsx` *(new)* | New file. 5-pill horizontal strip; same `Adherence` prop shape used by `TodayPanel` today, plus a `mealsLogged: boolean` derived from existing meal data. |
| `src/components/dashboard/FightFormInsightStrip.tsx` | Remove the internal source-dot row (`SOURCE_ORDER.map(...)` render block). Keep the headline + tap target. |
| `src/components/dashboard/FightFormStatChips.tsx` | Either inline-rewrite to a single line OR delete and replace the call site with inline JSX. Lean toward delete-and-inline since the component would shrink to ~10 lines. |
| `src/components/dashboard/FightFormScoreSheet.tsx` | Add a small 14-day trend sparkline section (moved from `FightFormStatChips`). Uses the existing `ffTrend` data already passed through. |
| `src/components/dashboard/TrainingInsightsWidget.tsx` | Add `if (insights.length === 0) return null;` guard. |
| `src/components/dashboard/MilestoneBadges.tsx` | Add `if (!loading && badges.length === 0) return null;` guard. |
| `src/components/dashboard/TodayPanel.tsx` | Delete after migration. |
| `src/components/dashboard/ConsistencyRing.tsx` | Leave in repo (in case re-introduced); remove imports + usage from `Dashboard.tsx`. |

## Data flow

No new server-side queries. `TodayStrip` consumes the same `adherence` object that `TodayPanel` and `FightFormInsightStrip` already receive from `Dashboard.tsx`. The "meals logged today" boolean derives from the same source that drives the Nutrition tab's daily totals — `Dashboard.tsx` already imports a `useMealsToday` (or equivalent) hook for the nutrition widget; that boolean is forwarded into the strip. If no such hook exists yet, derive it as `nutritionTotals.calories > 0` from data already present on the page.

## States and edge cases

- **Brand-new user (zero logs ever):** TodayStrip headline "Fresh start". All 5 pills outlined. Weight summary "Log a weight to start tracking". Score ring shows "Calibrating · Day 1 of 7". Training/weight widgets show their existing empty states.
- **Mid-calibration:** All pills reflect today's adherence. Headline shows the existing calibration copy. Score ring still shows `Calibrating`.
- **Active camp with data:** Full numeric display. ~5 surface numbers as listed above.
- **Post-fight banner active:** Unchanged — still renders above the ring.
- **No primary gym:** No change in scope here; `GymInvitesBanner` and `NewAnnouncementWidget` behavior is unchanged.

## Migration / rollout

Single PR. No feature flag — the new layout fully replaces the old. The change is reversible by reverting the PR; no data migrations.

## Testing

- **Visual:** Manual QA in iOS Capacitor build and dev server: brand-new account (zero data), mid-calibration (3 days logged), full active camp, post-fight states.
- **Unit:** `TodayStrip` gets a small component test covering filled / outlined / "All set" states. `FightFormInsightStrip` regression — removed dot row must not break existing headline copy tests.
- **Build:** `npm run build` + `npm run lint` must pass before merge.

## Open questions

None at design time. Implementation may surface small layout-spacing decisions (gap sizes, where exactly the inline weight summary sits relative to the strip) — those are choices the implementing engineer can make at edit time without needing this spec to ratify them.
