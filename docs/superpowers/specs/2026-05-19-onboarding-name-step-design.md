# Onboarding Name Step — Design

**Date:** 2026-05-19
**Status:** Approved
**Owner:** Pratik

## Summary

Add a new step to the onboarding flow that collects the user's display name. The chosen name is how other gym members identify this user in the gym feed, coach dashboard, and Profile page. The step is inserted as **step 13** (immediately before the declaration / plan-generation step, which shifts to step 14), making it the last form input the user sees before generating their plan. Total steps becomes **14**.

## Goals

- Capture a display name during onboarding instead of leaving it null (currently falls back to "Athlete").
- Persist the name to `profiles.displayName` via the existing `setUserName` Convex mutation.
- Minimal new schema work — reuse the existing `displayName` field.

## Non-goals

- No new `username` / `@handle` field. Display name is the only identifier.
- No uniqueness check. Two users in the same gym can share a name.
- No pre-fill from OAuth name, email, or localStorage. User types fresh.
- No profile picture upload at this step — that's a follow-up.

## Decisions (from brainstorm)

| Question | Choice |
|---|---|
| Field shape | Display name only — reuses existing `displayName` field. |
| Position | Step 13 (right before declaration, which becomes step 14). |
| Pre-fill | None — always blank. |
| Validation | Trim + length 2–30, any characters. Continue disabled when invalid. |

## Implementation

### 1. Server: tighten `convex/profiles.ts` `setUserName`

```ts
// Pre-existing:
export const setUserName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => { ... },
});
```

Add trim + length validation server-side (defense-in-depth — client also validates):

```ts
const trimmed = displayName.trim();
if (trimmed.length < 2 || trimmed.length > 30) {
  throw new Error("Display name must be 2–30 characters.");
}
// ...patch with `trimmed`
```

### 2. Client: `src/pages/Onboarding.tsx`

**State**
- Add `display_name: ""` to the initial `formData`.

**Step renumbering**
The "final step / generate plan" anchor moves from 13 → 14. Update every hardcoded 13 in this file:
- `totalSteps={13}` → `totalSteps={14}` (XPProgressBar)
- `step === 13` final-step gates (`isLastCutting`, `isLastLosing`) → `step === 14`
- Step cap `Math.min(prev + 1, 13)` → `Math.min(prev + 1, 14)`
- Achievement label `if (step === 13)` → `if (step === 14)` ("Camp Sealed")
- Existing JSX block `step === 13` (the declaration IIFE at the bottom) → `step === 14`

**New step 13 JSX block** — single-input StepLayout, inserted right above the (now-renumbered) step 14 declaration block:

```tsx
{step === 13 && (
  <StepLayout
    step={13}
    title="What should we call you?"
    subtitle="Your gym sees this name. Real name, nickname, fight name — your call."
    footer={
      <Button
        onClick={handleNameContinue}
        disabled={!isNameValid(formData.display_name)}
        className="..."
      >
        Continue
      </Button>
    }
  >
    <input
      type="text"
      value={formData.display_name}
      onChange={(e) =>
        setFormData(prev => ({ ...prev, display_name: e.target.value }))
      }
      maxLength={30}
      placeholder="Your name"
      autoFocus
      autoCapitalize="words"
      autoComplete="name"
      enterKeyHint="next"
      className="w-full h-14 rounded-2xl border border-border/50 bg-card px-4 text-[17px] font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
    <p className="mt-2 text-[11px] text-muted-foreground">
      {formData.display_name.trim().length}/30
    </p>
  </StepLayout>
)}
```

**`isNameValid` helper** (file-local):
```ts
function isNameValid(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 30;
}
```

**`handleNameContinue` handler**: trim the value, optimistically update local state, call `setUserName` mutation (the mutation already exists and is wired in `UserContext`'s `setUserName` callback — we can reuse it via `useUser().setUserName(trimmed)`), then advance with `goNext()`. The mutation is fire-and-forget; if it fails the user can edit later in Goals.

### 3. Wizard dialogue: `src/components/onboarding/wizard/onboardingDialogue.ts`

Two changes:
- Rename existing `cutting:13` and `losing:13` keys → `cutting:14` and `losing:14`.
- Add new `cutting:13` and `losing:13` entries for the name step. Voice stays wise-but-cheeky:
  - `cutting:13`: "Your name." / "Your gym needs something to chant at the weigh-in."
  - `losing:13`: "Your name." / "Your gym sees this when you post. Pick something you'll answer to."

Pose: `idle` (no special pose for a text-input step).

### 4. Where the saved name surfaces (read-side, no change required)

Already wired today, no edits needed:
- `src/pages/GymFeed.tsx` line 76 — post bylines
- `src/pages/coach/CoachDashboard.tsx` line 324 — member list
- `src/pages/coach/AthleteDetail.tsx` line 130 — header
- `src/pages/Profile.tsx` lines 171/195/207 — public profile
- `convex/gym_members.ts` line 53 — gym roster query

All of them read `displayName` / `display_name` and fall back to "Athlete". Once onboarding writes a value, the fallback is rarely hit.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Step renumbering misses a spot (any `step === 13` left referring to "final") | Spec lists every site; agent grep-confirms there are no stragglers; build-time typecheck catches React type issues. |
| User backs out after saving name | Save happens optimistically — fine. They can edit in Goals later. |
| Name with leading/trailing whitespace | Server trims; client also trims for length check + on submit. |
| Existing users with `displayName: null` | Out of scope — only affects new signups going through onboarding. Existing users already have ways to set their name in Goals. |
| Wizard mascot dialogue map keys go stale | Updated in lockstep — both `:13` → `:14` rename and new `:13` entries added in the same agent's commit. |

## Test plan

- Step through cutting flow on iPhone SE; confirm step 13 is "What should we call you?", step 14 is declaration / plan generation.
- Same for losing flow.
- Continue disabled when input is empty / whitespace / 1 char / 31+ chars.
- After submit, query Convex `profiles.getMine` → confirm `displayName` is the trimmed value.
- Visit `/community` (gym feed) on a second account → confirm name appears on posts.
- Wizard mascot bubble on step 13 says the new line; step 14 says the renamed final line.

## Out of scope

- @handle / unique identifier
- Username availability check
- Profile photo upload during onboarding (separate step in a future iteration)
- Editing display name from inside the new onboarding step after first save
