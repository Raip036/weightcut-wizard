# Onboarding Wizard Mascot — Design

**Date:** 2026-05-19
**Status:** Approved
**Owner:** Pratik

## Summary

Add an animated wizard mascot to `src/pages/Onboarding.tsx` that talks to the user via the same speech-bubble + typewriter pattern used by the in-app tutorial. The mascot is a centered hero on step 1, then shrinks to a top-right corner peek for steps 2–13. On every step transition, an auto-popping bubble delivers a short, witty, educational line; the bubble auto-collapses 3s after typing finishes. The user can tap the bubble to instant-complete the typewriter and tap a small mute icon to silence auto-pop for the remainder of the session.

## Goals

- Make the 13-step onboarding feel guided and less form-y.
- Deliver short educational nudges that justify each question ("why we ask for body fat" etc.).
- Reuse the existing tutorial assets and components — no new image work, no new typewriter engine.

## Non-goals

- No replacement of the existing in-app tutorial system; the mascot's bubble is one-shot per step, no multi-message scripts.
- No audio. No new haptics beyond the existing tutorial pattern.
- No mascot on routes other than `/onboarding`.

## Architecture

Two new files plus one edit. No fork of existing tutorial code — we import `SpeechBubble` and `WizardCharacter` directly.

```
src/components/onboarding/wizard/
  ├── onboardingDialogue.ts          # script: step + branch → { headline, body, pose }
  └── OnboardingWizardMascot.tsx     # orchestrator (hero ↔ corner modes, mute, auto-collapse)

src/pages/Onboarding.tsx              # mount <OnboardingWizardMascot /> + pass step/branch/slamActive
```

### `onboardingDialogue.ts`

Pure data module. Exports:

```ts
export type DialogueLine = {
  headline: string;       // 1–4 words, big
  body: string;           // 1–2 short sentences, typewritten
  pose?: WizardPose;      // "idle" | "wave" | "point" | "celebrate"
};

export function getLine(args: {
  step: number;
  branch: "cutting" | "losing";
  fightSubStep?: number;  // 0..3, only when cutting + step===3
}): DialogueLine;
```

Lookup precedence: `step + branch + fightSubStep` → `step + branch` → generic fallback. Substep keys: `"3:0"`, `"3:1"`, etc.

### `OnboardingWizardMascot.tsx`

```tsx
interface OnboardingWizardMascotProps {
  step: number;                           // 1..13
  branch: "cutting" | "losing";
  fightSubStep: number;                   // 0..3
  hidden?: boolean;                       // true while a Slam overlay is up
}
```

Internal state:
- `mode: "hero" | "corner"` — derived from `step === 1`.
- `bubbleOpen: boolean` — auto-opens on step change, auto-closes 3s after typing completes or on input focus.
- `forceComplete: boolean` — flipped true on bubble tap to skip typewriter.
- `muted: boolean` — persisted in `localStorage["wcw_wizard_muted"]`.
- `revealKey: string` — `${step}:${fightSubStep}` so `SpeechBubble` resets per step.

Effects:
- `useEffect([step, fightSubStep, branch])`: open bubble (unless muted), reset force-complete, reset reveal key.
- `useEffect(typingComplete)`: schedule 3s `setTimeout` to close bubble.
- Global `focusin`/`focusout` listeners on `input, textarea, [contenteditable]` collapse the bubble while a field is focused.

Layout:
- **Hero mode (step 1):** mascot vertically centered between the XP header and the goal-type cards, ~140×140. Bubble below mascot, tail-up variant. Smooth `layoutId` motion shrinks the same node when step advances.
- **Corner mode (step 2–13):** mascot fixed absolutely `top-2 right-3` of the step content frame, 56×56, no sparkles ring, with a `VolumeX`/`Volume2` toggle directly below (12px, muted-foreground color). Bubble grows leftward + downward from the mascot, max-width `min(70vw, 240px)`, with right-anchored tail.

Reduced motion: respect `useReducedMotion()` (`SpeechBubble` + `TypewriterText` already do).

Haptic: light impact on bubble auto-open, Capacitor native only. Reuse existing pattern from `WizardCharacter`.

### `Onboarding.tsx` edit

Mount inside the outer container, render once at the top of the AnimatePresence subtree:

```tsx
<OnboardingWizardMascot
  step={step}
  branch={isFighterFlow ? "cutting" : "losing"}
  fightSubStep={fightSubStep}
  hidden={daysSlamArmed || weightSlamArmed || (formData.current_weight_kg && pendingWeightAdvance)}
/>
```

The mascot uses `position: fixed` (corner mode) and absolute-centered overlay (hero mode), so it doesn't disturb the existing flex layout.

## Voice script (samples)

Full script in `onboardingDialogue.ts`. Voice: wise-but-cheeky coach.

| Step | Cutting | Losing |
|---|---|---|
| 1 | "Welcome to the cut. Round one — making weight, or losing it?" | (same) |
| 2 | "Boxers cut different from grapplers. Tell me your tribe." | "How many weeks do you want? Be realistic, not heroic." |
| 3:0 | "Amateur or pro changes everything. Don't sandbag." | (n/a) |
| 3:1 | "Your fight date is the gravity well. Everything else orbits it." | (n/a) |
| 3:2 | "Pick your weight class. Lighter than you think." | (n/a) |
| 3:3 | "Pre-dehydration target — the weight you walk in at, not what you weigh in at." | (n/a) |
| 4 | "How old are you? Metabolism's a real number, not a vibe." | "What's your current weight? No judgment, just data." |
| 5 | "Height. We use this for your real burn rate." | "What's your goal weight?" |
| 6 | "Step on the scale. Be honest — this is your starting line." | "Estimate body fat. Skip if unsure — we'll calibrate." |
| 7 | "Eyeball your body fat. We'll calibrate as you log." | "Experience level. No judgment." |
| 8 | "Experience matters. Beginners cut different from vets." | "How many sessions a week? All of them count." |
| 9 | "How often do you train? Pads, sparring, gym, runs — all of it." | "What does training include? Tell me the truth." |
| 10 | "What's the work look like? Wrestling burns more than shadowbox, surprising no one." | "Sleep hours. The OG performance enhancer." |
| 11 | "Sleep is when fat actually leaves. Wild, I know." | "Pick your struggle. Naming it is half the fight." |
| 12 | "Pick your demon. Naming it is half the fight." | "Plan aggressiveness. Faster ≠ better." |
| 13 | "Hold the line, fighter. Time to build your plan." | "Lock it in. We'll build your plan." |

Pose mapping: `wave` on step 1; `point` on steps with sliders/inputs (4, 5, 7); `celebrate` on step 13; `idle` everywhere else.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Slam overlays (`DaysToFightSlam`, `WeightLossSlam`) collide visually with the mascot | `hidden` prop driven by the existing slam-armed booleans. |
| Cutting step 3 has 5 sub-steps; one line for the whole step would feel stale | Dialogue keyed on `step + ":" + fightSubStep` with fallback. |
| Bubble overlaps form inputs on iPhone SE when keyboard is up | Global `focusin` listener collapses bubble; `focusout` reopens if user hasn't moved on. |
| Talking too much annoys users | Mute toggle persists in `localStorage`, applies for the rest of the session. |
| Sparkles + character + typewriter heavy on mid-range Android | Reduced-motion path already short-circuits all three. |

## Test plan

- Manual: step through both branches on iPhone SE viewport (320×568), iPhone 14 Pro (393×852), and desktop. No overlap with form fields, no overflow, bubble fits.
- Slam transitions: trigger fight-date slam on cutting step 3:1; verify mascot hides for slam duration, reappears after dismiss.
- Sub-step: cycle fightSubStep 0→3 on cutting step 3; verify bubble re-types per substep.
- Mute: toggle mute, advance steps; bubble should not auto-open; tapping mascot should still open.
- Reduced motion: enable system-level "Reduce Motion"; verify no typewriter, no idle bob, no layout animation.

## Out of scope

- Localizing dialogue (current copy is English-only, matches the rest of the app).
- Tracking which lines a user has seen across sessions.
- A "wizard says" history log.
