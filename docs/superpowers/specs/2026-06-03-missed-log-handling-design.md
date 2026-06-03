# Missed-Log Handling — Design Spec

**Date:** 2026-06-03
**Status:** Approved (design) — pending spec review
**Scope:** Package C (full) + local notifications
**Goals:** Drive the daily logging habit (gently, soft-gate) and make missed/unlogged days transparent, without cratering the fight score ring when a user simply forgets.

---

## Problem

The fight score ring composites six sub-scores (`trainingLoad`, `sleep`, `weightCut`, `wellness`, `nutrition`, `recovery`), each 0–100, in `src/scoring/compose.ts`. Missing data is **excluded, not penalized**: a pillar with no data gets `weight: 0` and drops out, and the remaining pillars renormalize. The score is daily, EMA-smoothed over 3 days, recomputed on every log and via a daily cron.

This forgiving design has three failure modes:

1. **Staleness** — excluding missing data lets the ring show a confident number built on 2 stale logs.
2. **Gaming** — a user having a bad week can stop logging and the ring won't drop (missing ≠ bad). Worse, danger ceilings (`weight_cut_dangerous`, `sleep_debt`, `training_spike`) lift automatically when the bad logs age out of the 7-day window, so "stop logging" literally removes the safety cap.
3. **Trust** — when the ring moves (or doesn't), the user can't tell a missed-log from a real slip.

A foundational data gap underlies all of this: a planned rest day and a forgotten log are currently indistinguishable (both = no row). Until they can be told apart, no nudge or score adjustment can be honest.

---

## Architecture overview

Seven components, sequenced smallest-blast-radius first:

1. Data model changes (rest/skip status, per-pillar recency, score-history extension, confidence fields)
2. Scoring engine changes (confidence factor, staleness decay, label-capping, ceiling latching, backfill behavior)
3. Ring transparency UI
4. Rolling 7-day completeness meter
5. Catch-up sheet
6. Rest/skip markers
7. Local notifications

Each is described below with its files, interfaces, and dependencies.

---

## 1. Data model changes

All additive — no destructive migration.

### 1.1 Rest/skip status
- **Training** (`fight_camp_calendar`): add `status: 'logged' | 'rest' | 'skipped'` (default `'logged'`). A rest/skip writes a real row keyed `(userId, date)`, so the day is *resolved*, not *missing*.
- **Other pillars** (sleep / weight / nutrition / wellness): a lightweight `marked_skips` table `(userId, date, pillar)` rather than adding a status column to each table. A row means "user intentionally skipped/rested this pillar on this date."

### 1.2 Per-pillar recency
- In `convex/fightFormScore_internal.ts` `fetchScoringInputs`, compute `lastDataDate: string | null` per pillar from the existing 28-day windows.
- Thread into `ScoringInputs` (`src/scoring/types.ts`). **Keyed off log date, not insert time** — a late backfill counts at the day it is *for*, so staleness resets correctly.

### 1.3 Score-history extension (for ceiling latching)
- `priorRawScores` currently stores numbers only. Extend the per-day record in `fight_form_scores` to also persist `{ appliedCeiling: string | null, ceilingFiredAt: string | null }`.
- This lets a fired safety cap latch across recomputes (see §2.4).

### 1.4 Confidence fields on output
- Add to `FightFormScore` (additive, optional — mirror how `inputSources?` was added so existing snapshots don't break):
  - `dataConfidence: number` (0–1)
  - per-pillar `completeness: number` on each `SubScore` (or in `SubScore.meta`)
  - `dataAgeDays: number` (max gap across *contributing* pillars)
  - `activePillars: number`, `totalPillars: number`

---

## 2. Scoring engine changes

Files: `src/scoring/compose.ts`, `src/scoring/ceilings.ts`, `src/scoring/config/v1.ts`, `src/scoring/types.ts`.

### 2.1 Confidence, not penalty
- Per pillar: `completeness = loggedDaysInWindow / expectedDaysInWindow` (expected is window-aware: 7 for sleep/wellness, plan-driven for training load, etc.).
- Roll up to `dataConfidence` = weighted mean of present pillars' completeness, weighted by the same phase weights used in the `present` block (`compose.ts` ~line 288).
- **The displayed number is unchanged by this** — confidence drives UI only.

### 2.2 Staleness decay past grace
- Per-pillar grace window (config in `v1.ts`): `sleep: 2d`, `weight: 4d`, `wellness: 7d`, `nutrition: 3d`, `trainingLoad: rest-day-aware` (don't count `restDays` toward staleness).
- Let `staleDays = inputs.date − lastDataDate`. After grace `g`:
  `adjusted = value · (1 − d) + 50 · d`, where `d = clamp((staleDays − g) / horizon, 0, dMax)`, `dMax ≈ 0.7`.
- Eases toward neutral ("we don't know"), never erases. Keyed off `lastDataDate` so cron and on-log recompute agree. Existing 3-day EMA further softens the slide.
- **Anti-gaming nuance:** for pillars where "missing" should read pessimistically (e.g. a pillar that was already trending down before going silent), anchor decay toward `min(value, 50)` rather than flat 50, so abandoning a declining pillar doesn't rescue it. Start with flat-50 + label-cap (§2.3); add the asymmetric anchor only if telemetry shows the neutral-anchor escape being gamed.

### 2.3 Label-capping on thin data
- When `dataConfidence` is below a configured threshold, cap the *label* (not the number) at `"sharpening"` — never display `"sharp"` on thin/stale data.
- Add `state: "stale"` to the existing `state` enum; reuse the `pickLabel` path.

### 2.4 Ceiling latching (anti-gaming)
- A fired safety ceiling (`weight_cut_dangerous`, `sleep_debt`, `training_spike`) latches for a cooldown and **only lifts when new logs affirmatively show recovery** — not when the bad logs silently age out of the 7-day window.
- Uses the `ceilingFiredAt`/`appliedCeiling` history from §1.3.
- **Backfill caveat:** a late-revealed bad day for a safety pillar (weight cut especially) may re-trigger a latched ceiling — that's desired for safety.

### 2.5 Backfill behavior
- Logging a past day **auto-corrects today's score** (windows recompute on log — already true) and resets that pillar's `staleDays` to 0 on the next recompute. "Catch up and your ring firms back up" works for free.
- **Do not** rewrite historical EMA values: changing day T's `rawScore` would cascade-recompute every day since and confusingly mutate last week's displayed score. History stays "what we knew then." Document this explicitly.

---

## 3. Ring transparency UI

Files: `FightFormRing.tsx`, `FightFormScoreSheet.tsx`, `FightFormDeltaBanner.tsx`, `src/index.css`.

- **Confidence track underlay** — behind the colored score arc, split the full track into a solid segment proportional to active pillar weight and a dashed/faded segment for the missing remainder (`strokeDasharray`, reusing the peak-phase dashed treatment). Encodes "built on N of 5 signals" into the geometry; no added text.
- **Staleness desaturation** — when `dataAgeDays >= 2` (or `activePillars < 3`): reduce the number's opacity, slow the halo pulse (~+40% duration), blend the arc ~30% toward slate (existing fallback RGB 148,163,184), drop particle count to the `off_pace` band. Add a hairline `as of {n} days ago` subtext. Reads as "resting," not alarm.
- **"Held" delta state** (`FightFormDeltaBanner.tsx`) — a third neutral state when the score didn't change because a pillar was excluded: `Holding at 72 · weight not logged since Tue`, with a neutral pause glyph instead of a green/red caret. Distinguishes real plateau from frozen-on-stale.
- **Sheet confidence band** — above "What's driving your score": *"Based on 3 of 5 signals — wellness and weight aren't logged, so they're not counting toward today's number. Your score isn't penalized, it's just based on less."* Computed from `subScores[].weight`.
- **Stale-pillar placeholder copy** — upgrade the existing dashed "Log to unlock" cards to distinguish `Last logged 4 days ago — not counting` from `Never logged this camp`, using `lastDataDate`.
- **Wake-up micro-animation** — when a previously-stale pillar is logged, re-saturate its color with a brief pulse (reuse `score-bloom` / `ff-ring-unlock-bloom` keyframes), making "I logged → ring came back to life" causally legible.

---

## 4. Rolling 7-day completeness meter

New dashboard component (e.g. `src/components/dashboard/CompletenessMeter.tsx`), placed above/near `TodayStrip`.

- 7-segment meter, one notch per day of the trailing 7. Notch states: green (fully logged) / gold (partially logged) / hollow (unresolved gap) / dash (rest or skipped, from §6). Label: `6 of last 7 days logged`.
- No streak, no reset-to-zero — one miss drops 7/7 → 6/7, not to zero.
- **Tapping a hollow notch deep-links into that day's backfill** (the catch-up flow, §5).
- Fed by a Convex query aggregating the last 7 `(userId, date)` log states across the 5 TodayStrip pillars (weight, training, sleep, wellness, meals).

---

## 5. Catch-up sheet

New component (e.g. `src/components/dashboard/CatchUpSheet.tsx`), triggered from the dashboard mount.

- **Trigger:** first app-open each morning (`lastOpenDate < today`) *and* yesterday has 1+ gap. Shows **only the missing pills**.
- **One-tap smart-prefill backfill per pill:**
  - Sleep — "~7h? confirm" from the user's 7-day median.
  - Weight — last entry, with an explicit edit pencil (never silently guessed — a wrong body-weight is worse than a gap in a cut app).
  - Low-stakes (hydration/wellness) — "same as yesterday" / rolling median, with an undo toast.
  - Meals / specific entries — deep-link to the existing page (`/nutrition`, `/weight`) with the date input pre-set and a slim "You're logging Mon Jun 2" banner. Reuses verified past-date upsert.
- **Dismissal:** swipe-down or "Not now". Persisted per-day in localStorage (`catchup_dismissed_YYYY-MM-DD`), mirroring the existing confetti day-gate. Never blocks the dashboard.

---

## 6. Rest/skip markers

Files: `src/components/dashboard/TodayStrip.tsx`, the catch-up sheet (§5).

- **Proactive:** a small "Rest day" toggle on the TodayStrip training pill — declare a planned rest *before* it becomes a gap. Fills the pill with a moon/zzz treatment and counts toward the day's completion. Writes `status: 'rest'` (§1.1).
- **Retroactive:** in the catch-up sheet, each missing pill gets a `···` → "Mark as rest / skipped", writing a `marked_skips` row (§1.1) so a true rest day stops being nagged and is recorded as intentional.
- **Scoring semantics** (feeds §2): a marked rest day on *training* legitimately lowers acute load (real recovery); a marked skip on a pillar where the value is unknown (e.g. "didn't sleep-track") just suppresses that pillar's weight without penalty and does **not** accrue staleness. Encode this per-pillar mapping — skips do not all mean the same thing.
- **Bound abuse:** marking excessive rest days still affects the chronic baseline naturally; optionally cap user-marked rest at N/week before it stops protecting load.

---

## 7. Local notifications

Files: new `src/lib/reminderScheduler.ts` (Capacitor `LocalNotifications`), `convex/reminders` config, onboarding flow (current `feature/onboarding-ui-improvements` branch).

- **Adaptive timing** — learn the median local time the user logs each type over ~14 days; fire ~30 min *before* that window (a nudge, not "you're late"). Cold-start defaults: combined morning weight+sleep ~7:30, training ~19:00, wellness mid-morning. Meals folded into the morning catch-up, not pinged per-meal. Schedule rebuilt nightly from logging-time history.
- **Hard 2/day cap + suppression** — never remind for a log already done today; if the app was opened today, downgrade/suppress the evening ping. Re-evaluate on app foreground. This is the primary anti-fatigue lever.
- **Onboarding pre-permission prompt** — a soft explainer screen *before* the iOS system permission prompt, with a "set my reminder times" step. A cold denied permission kills the entire reminder layer, so this gates all of §7. Sequence onboarding before heavy reminder logic.

---

## Sequencing

Smallest blast radius first:

1. §1 data model
2. §2.1 confidence + §2.3 label-cap (no score-behavior change)
3. §6 rest/skip markers
4. §4 completeness meter
5. §5 catch-up sheet
6. §3 ring transparency
7. §2.2 staleness decay + §2.4 ceiling latching
8. §7 notifications (gated on the onboarding pre-permission prompt)

---

## Key files reference

| Area | Files |
|------|-------|
| Schema / data | `convex/schema.ts`, `convex/fightFormScore_internal.ts`, new `marked_skips` table |
| Scoring engine | `src/scoring/compose.ts`, `src/scoring/ceilings.ts`, `src/scoring/config/v1.ts`, `src/scoring/types.ts` |
| Ring UI | `FightFormRing.tsx`, `FightFormScoreSheet.tsx`, `FightFormDeltaBanner.tsx`, `src/index.css` |
| Dashboard | `src/components/dashboard/TodayStrip.tsx`, new `CompletenessMeter.tsx`, new `CatchUpSheet.tsx` |
| Logging pages (backfill deep-links) | `src/pages/Sleep.tsx`, `src/pages/WeightTracker.tsx`, `src/pages/nutrition/NutritionPage.tsx`, `src/pages/TrainingCalendar.tsx` |
| Notifications | new `src/lib/reminderScheduler.ts`, `convex/reminders`, onboarding flow |

---

## Out of scope (YAGNI)

- Rewriting historical EMA on backfill (§2.5) — explicitly excluded.
- Social/community logging signals — interesting but deferred; risks shame if mishandled.
- The asymmetric pessimistic decay anchor (§2.2) — defer until telemetry justifies it; flat-50 + label-cap ship first.
- A 6th notification channel for hydration — folded into nutrition/wellness.
