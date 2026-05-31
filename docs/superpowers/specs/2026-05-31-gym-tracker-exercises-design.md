# Gym Tracker: persistent custom exercises, "weighted" type, history-based recents

Date: 2026-05-31
Status: Approved — implementation in progress

## Problem

Three related gym-tracker issues:
1. **Custom exercises "disappear"** — a user-created exercise is gone from the picker entirely after a new workout.
2. **No "weighted" tracking** — weighted pull-ups/dips/chin-ups can't be logged as bodyweight + added load.
3. **Recents are session-fragile** — "Recent" only reflects the current workout's localStorage id list, which breaks because ids are unstable.

## Root-cause findings (verified)

- Custom exercises **are** written to Convex via `api.exercises.createCustom`, and **nothing deletes them** (`removeExerciseFromSession` only deletes sets; `deleteCustomExercise` is unwired).
- **No built-in library is seeded in Convex.** The library lives only in `src/data/exerciseDatabase.ts` (`EXERCISE_DATABASE`) with synthetic `local-N` ids. Convex holds only the user's custom rows.
- `createCustom` has **no name dedupe** → repeated creation / re-materialization of the same name inserts **new rows each time**, so duplicates accumulate and an exercise's id is **unstable across workouts**. Unstable ids break the id-keyed recents list and make exercises seem to vanish.
- `useExerciseLibrary.addCustomExercise` **silently no-ops when `userId` is momentarily null** (`if (!userId) return null`).

## Design

### Part 1 — Reliable persistence + stable identity
- `convex/exercises.ts › createCustom`: make **idempotent** — look up an existing row by `(userId, lowercased name)`; return its id if found, else insert. One name → one stable row.
- `useGymSets.addExerciseToSession`: when materializing a `local-N` built-in, go through the idempotent create so the same exercise always resolves to the same Convex id across workouts.
- `useExerciseLibrary.addCustomExercise`: guard the null-`userId` case with a clear error toast instead of a silent no-op.

### Part 2 — "Weighted" exercise type
- New single-source union `src/lib/exerciseTypes.ts`: `TrackingType = "standard" | "bodyweight" | "weighted"` (+ labels/helpers).
- `exercises` table: add `trackingType: v.optional(v.string())` (absent ⇒ `standard`; legacy `isBodyweight: true` ⇒ `bodyweight`).
- `createCustom` accepts optional `trackingType`; `toClient` returns `tracking_type`.
- **Logging:** weighted enters **TOTAL** weight (bodyweight + added) × reps; displayed `95kg × 8`. Set shape unchanged (`weightKg` + `reps`).
- **Volume = added weight only.** `volumeWeight = max(0, total − latestBodyweightKg)`; if no bodyweight on file, fall back to counting the **total** (confirmed with user). Implemented in `gymCalculations` with an opts param carrying `trackingType` + `bodyweightKg`, applied per-exercise at all call sites.
- UI: `CreateExerciseDialog` gains a tracking-type segmented picker (Standard / Bodyweight / Weighted). `SetRow` enables/labels the weight field per type. `ExerciseBlock` formats the set summary per type.

### Part 3 — Recents from logged history
- New `convex/exercises.ts › listRecent` query: read the user's `gym_sets` newest-first (new `by_user` index on `gym_sets`), dedupe by `exerciseId`, resolve + return the top ~20 exercises.
- `ExercisePickerSheet` "Recent" tab reads this query instead of the localStorage id list. Stable ids (Part 1) make the dedupe reliable; recents now survive reinstalls and span all past workouts.

## Touch points
`src/lib/exerciseTypes.ts` (new) · `convex/schema.ts` · `convex/exercises.ts` · `src/hooks/gym/useExerciseLibrary.ts` · `src/hooks/gym/useGymSets.ts` · `src/components/gym/CreateExerciseDialog.tsx` · `src/components/gym/SetRow.tsx` · `src/components/gym/ExerciseBlock.tsx` · `src/components/gym/ExercisePickerSheet.tsx` · `src/lib/gymCalculations.ts` · `src/pages/gym/types.ts` · `src/pages/GymTracker.tsx`

## Testing / verification
- Create custom → appears in picker next session; re-add a built-in twice → exactly one Convex row (no dup).
- Weighted exercise logs total × reps, displays `Xkg × n`, contributes added-only volume (with bodyweight fallback).
- `listRecent` returns deduped newest-first across sessions; picker "Recent" tab reflects past workouts.
- `tsc --noEmit` + `eslint` clean on touched files.

## Notes
- Backward compatible: no migration required (new fields optional; absent ⇒ standard).
- Per user preference, spec/code are **not** auto-committed.
