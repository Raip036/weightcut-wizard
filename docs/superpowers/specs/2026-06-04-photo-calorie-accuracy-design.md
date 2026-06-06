# Photo Calorie Accuracy — Smart Progressive Capture

**Date:** 2026-06-04
**Status:** Approved design, pending implementation plan
**Author:** Brainstorm session (Pratik + Claude)

## Problem

The AI meal-photo feature identifies foods well (strong vision model, cooking-method
detection, hidden-calorie surfacing). The weak link — as in every photo-calorie app — is
**portion / volume estimation**: turning a flat 2D image into grams. A single top-down photo
discards depth, so the model cannot distinguish a shallow bowl from a deep one, or a thin
steak from a thick one. This produces "right foods, wrong amounts" calorie errors.

## Goal

Improve portion accuracy **without** making every meal a chore. Keep the one-tap single-photo
path as the default; add accuracy only where it pays off.

## Non-Goals

- Not changing food identification logic (already strong).
- Not forcing multi-photo capture on every meal.
- Not adding a separate portion AI call (portion edits are pure math via the existing Atwater
  cascade).
- Not changing the Pro-gating (feature stays Pro-only).
- Not introducing SSE/streaming (analysis stays synchronous, per project convention).

## Approach: #2 Smart Progressive Capture

Three cohesive parts. Designed to be shipped in order (C first).

### Part C — Portion review + confidence flags (highest leverage, ship first)

The human-in-the-loop fix. In the existing macro/confirm step (`MacrosEditor` /
`AiIngredientList`):

- For each detected item, show its estimated portion with a **quick multiplier stepper**:
  `½× · 1× · 1½× · 2×`. Selecting a multiplier **rescales that item's macros**
  proportionally and updates meal totals using the **existing Atwater cascade** in
  `MacrosEditor`. No extra AI call — instant, offline-capable.
- **Low-confidence items get a subtle flag** (e.g. a small amber dot / "double-check"
  hint) so the user's attention goes to the items most likely wrong.
- Default multiplier is `1×` (the AI's estimate). User adjustment is optional.

Requires `confidence` to be available per item on the final result (see Part B).

### Part B — Backend: image array + carry confidence (`convex/actions/analyzeMeal.ts`)

- Accept an **array of images** (1–3) for the same meal. Keep the existing single-image
  argument working for back-compat (normalize to an array internally).
- Per-image validation unchanged: each ≤ 4 MB, HEIC rejected with the existing friendly error.
- Vision-stage prompt updated to handle multiple views of the **same meal**:
  > "You may receive multiple photos of the same meal from different angles. Use them
  > together to judge portion volume/depth and to catch items hidden in one view. Do not
  > double-count items that appear in more than one photo."
- **Carry per-item `confidence` through to the final result.** The vision stage already
  emits `confidence` (high/medium/low); the macro stage must copy it verbatim into each
  final item (the same way it already copies bounding boxes). Add `confidence` to the macro
  stage's output schema and prompt instruction.

### Part A — Capture UI: optional multi-angle (ship with B)

- Single photo stays the one-tap default.
- On the caption/preview step (`CaptionStep`), add an **"+ Add angle"** affordance allowing
  up to **3 photos total** of the same meal (e.g. top-down + side).
- Show small thumbnails for each captured angle with **retake / remove** controls.
- Caption behaviour unchanged.

### Confidence-gated nudge (connects the parts)

In the review step: if the result contains a **low-confidence item** AND **fewer than 3
photos** were used, show a small banner —
*"Hard to size the [item] — add a side angle?"* — that captures another photo and
**re-runs analysis with all images together**. This is the only path that triggers a
second AI call; it fires only when it would actually help.

## Data Flow

```
Capture (1 photo default, optionally +angles, ≤3)  [Part A]
   ↓  imagesBase64[]  + optional caption
analyzeMeal action  [Part B]
   ├─ vision stage: all images → items{name, portion, bbox, confidence}
   └─ macro stage: items → macros, confidence copied verbatim
   ↓  nutritionData.items[] now include confidence
Review step  [Part C]
   ├─ per-item multiplier stepper → rescales macros locally (Atwater), updates totals
   ├─ low-confidence items flagged
   └─ if low-confidence && photos < 3 → "add a side angle?" nudge → re-run analyzeMeal
   ↓
Save (existing path)
```

## Affected Files (indicative)

| Area | File |
|------|------|
| Backend action | `convex/actions/analyzeMeal.ts` (image array, vision prompt, carry `confidence`, macro schema) |
| Capture UI | `src/pages/nutrition/dialogs/quickAdd/CaptionStep.tsx` (add-angle, thumbnails) |
| Capture hook | `src/hooks/nutrition/useAIMealAnalysis.ts` (manage image array, re-run on added angle) |
| Review UI | `src/pages/nutrition/dialogs/quickAdd/MacrosEditor.tsx` + `AiIngredientList` (multiplier stepper, confidence flag, nudge banner) |
| Types | `src/pages/nutrition/types.ts` (item `confidence`, multi-image payload) |

## Decisions

- **Max photos:** 3.
- **Portion control:** multiplier stepper (½× · 1× · 1½× · 2×), not ± grams.
- **Portion edits:** local math (Atwater cascade), no AI call.
- **Scope:** single spec; implement **Part C first**, then **Parts A + B** (+ nudge, which
  depends on both).

## Risks / Open Questions

- **Token cost / latency** for multi-image vision calls — mitigated by multi-angle being
  optional and confidence-gated (most meals stay single-photo).
- **Confidence reliability** — if the model's `confidence` is noisy, the flags/nudge may
  fire poorly; validate against real meals and tune the threshold (e.g. only flag `low`).
- **Double-counting** across angles — relies on the prompt instruction; verify on real
  multi-angle meals.
- **Multiplier granularity** — ½/1/1½/2 may be too coarse for some items; revisit if user
  testing shows it.
