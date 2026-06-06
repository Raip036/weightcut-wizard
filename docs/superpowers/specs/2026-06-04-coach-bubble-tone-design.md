# Coach Speech-Bubble Tone — Suggestions, Not Commands

**Date:** 2026-06-04
**Status:** Approved, ready for implementation
**Area:** Coach speech bubble copy (`coachBriefing` + `coachGreeting`)

## Goal
Rephrase the AI coach's speech-bubble lines from direct commands into **suggestions / hints / guidance** — respectful of an experienced athlete's autonomy while still steering beginners. Tiered for safety: coaching nudges fully softened; the genuine over-fast-cut warning kept a notch firmer (gentle voice, no barked order, but clearly "past the safe pace").

## Scope
The bubble text = `redFlag || priorityAction || greeting`. Source files:
- `convex/coachBriefing.ts` — `derivePriorityAction()` and `deriveRedFlag()`.
- `src/lib/coachGreeting.ts` — `buildStatusClause()` + the no-camp fallback line.

Note: `coachBriefing` also feeds the **daily nudge** (`coachNudge`) and the **CoachProGate** contextual hook — softening here improves those consistently (desired). The in-chat LLM replies are out of scope.

## Constraints
- `priorityAction` is `.slice(0, 80)` — keep rewrites ≤ 80 chars. `redFlag` ≤ 100.
- **No em dashes** (bubble strips them; use commas/periods).
- Preserve all numeric interpolations (`${kcal}`, `${round1(delta)}`, `${pct}`, `${sinceDays}`, `${out}`, `${lead}`, `kg1(...)`) — numbers are bolded in the bubble and must remain.
- Tone: suggestion/permissive ("might be worth", "could", "your call", "whenever suits"), occasional gentle question; no "must/need to/have to"; warm + concise. Pure status reads (greeting "on weight", "weigh-in today") left unchanged.

## Recommended strings (implementer maps to the ACTUAL branches in each file)

### `derivePriorityAction` (map to whichever branches exist)
- weigh-in day (days ≤ 0): `Weigh-in today. One last check, then it's rehydrate time`
- last sweat (days === 1, if present): `Last sweat-out tonight if needed. Sip only, go easy on meals`
- water-load (days === 2): `Water-load day. Could start with 1L now, then keep it steady`
- start water-load (days === 3): `Good day to start water-loading. ~6-8L, ease off the salt`
- fight-week generic: `Want to log your weight? Then water-loading can begin`
- stale-log / coaching-blind: `A quick weigh-in helps me keep you on plan, whenever suits`
- modest over: `Trimming ~${kcal} kcal today would keep you on the glide path`
- large over: `${round1(delta)}kg over. Worth tightening the plan a bit, your call`
- on-plan: `Right on plan. Hold the line, a weight + meals log keeps it tight`
- fallback: (reuse the stale-log string)

### `deriveRedFlag` (TIERED)
- over-fast cut (CAUTION, firmer): `Heads up: ~${pct}%/wk is past the safe pace. Worth easing off and rehydrating`
- stale weigh-in (NUDGE, soft): `It's been ${sinceDays} days since a weigh-in. A quick log keeps your plan honest`

### `coachGreeting.buildStatusClause` (+ no-camp)
- over, on pace: `${out}, ${kg1(deltaKg)}kg to go and right on pace`
- over, behind: `${out}, ${kg1(deltaKg)}kg to go, a touch to claw back`
- ahead / on weight / weigh-in-today / camp-live: UNCHANGED (already non-commanding)
- no-camp fallback: `${lead}, no fight booked yet. Want to plan your next camp?` (also removes the existing hyphen)

## Verification
- `npx tsc --noEmit` clean; Convex deploys.
- All lines ≤ caps, no em dashes, numbers intact.
- Spot-check the bubble renders the softened over-plan + safety lines.
