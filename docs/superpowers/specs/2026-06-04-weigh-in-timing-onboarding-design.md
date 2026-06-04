# Weigh-In Timing & Same-Day Cut Strategy — Design Spec

**Date:** 2026-06-04
**Status:** Approved, ready for implementation (subagent-driven)
**Area:** Onboarding (fighter flow) + cut-plan generation

---

## 1. Problem & Goal

The onboarding fighter flow assumes a **day-before weigh-in** (≈24h+ to rehydrate/refuel) — it sets a "pre-dehydration" fight-week target a few % above goal weight and the AI cut plan is built around an acute water/carb cut.

But many combat athletes — **amateur MMA, BJJ/IBJJF, wrestling, judo, most match formats** — weigh in **the same day**, hours (or minutes) before competing. For them an aggressive water/carb cut is both **dangerous** and **performance-killing**: there is no recovery window to restore plasma volume or glycogen. They should arrive **near their goal weight naturally**, keep carbs, and avoid dehydration.

**Goal:** Ask weigh-in timing at the start of the fighter flow, and for same-day fighters produce a research-backed plan that minimizes dehydration, keeps carbohydrates, and targets a fight-week weight essentially at goal weight. Day-before fighters proceed exactly as today.

---

## 2. Research foundation (ISSN 2025 position stand + ACSM + GSSI)

Full sources in the research briefs; key rules the plan/prompt must encode:

**Shared guardrails (both):** chronic loss ≤0.5–0.9 kg/week; never carbs to zero (keep ≥3–4 g/kg/day during descent); walk-around ≤12–15% above class or recommend longer runway / higher class; never sauna/diuretics/laxatives; already at/under goal → maintenance plan, not a cut.

**Day-before (≥~18–24h window):** allow fight-week target a few % above limit; build phase → managed acute cut (water/sodium/fiber, optional glycogen depletion, acute loss up to ~4–6%, hard ceiling 8%); post-weigh-in ORS 1–1.5 L/h @ 50–90 mmol/L Na + carb refeed 4–12 g/kg.

**Same-day (≤~4h window):** fight-week target **at the class limit or ≤~1–2% above**; **cap acute dehydration ≤2–3%, prefer ~0%**; **no glycogen/carb depletion** (no refuel window); plan = gradual body-comp change done EARLY, final days = maintenance + light, NOT a cut; explicitly tell the athlete: do NOT sauna/sweat/restrict fluids; eat normally + keep carbs to competition; hydrate normally; rationale = even ~2–3% dehydration ≈ ≥10% performance loss carried into the fight. If reaching the limit needs >~5% loss or any meaningful dehydration → advise **moving up a class**.

**Tone for amateurs/hobbyists (same-day skews here):** plain language, safety-first, minimal fight-camp jargon; "compete near your natural weight, pick the division you already fit."

---

## 3. Current state (grounded)

- **`src/pages/Onboarding.tsx`** (~2348 lines). Shared `step` counter (1..16, `TOTAL_STEPS=16`). Cutting vs losing render different content per step number via `isFighterFlow`.
  - Step 1: goal-type split (`cutting` = "I have a fight" / `losing` = "lose weight").
  - Step 2 (cutting): `athlete_types` disciplines (multi). Step 2 (losing): `target_weeks`.
  - Step 3 (cutting): fight-details **sub-step mini-flow** (`fightSubStep` 0–4): 0 competition level, 1 fight date, 2 weight class, 3 **pre-dehydration target**, 4 camp name. Driven by `fightSubStep`/`fightSubDirection`.
  - Later steps: height, current weight (cutting `isWeightStep` = step 6), body fat, experience, training freq, Apple Health connect, reminders, disciplines/sleep, struggle, name, plan_aggressiveness (non-fighter only), final (step 16).
  - Hardcoded step references to audit on any insert: `TOTAL_STEPS`, achievements `useEffect` (steps 4/8/16), `isWeightStep` (cutting `step===6`), `isLastCutting/isLastLosing` (`step===16`), `goNext`/`goBack` step-3 sub-step entry (`next===3` / `next===3` back→`fightSubStep=4`), `daysSlamArmed`/`weightSlamArmed` gates, `setStep(prev => Math.min(prev+1, 16))` clamps.
  - **Fight-week target calc:** `getWaterCutPercent(level)` (hobbyist 3% / amateur 5.5% / pro 8%) → `calculateRecommendedTarget(goalWeight, level)` → `fight_week_target_kg`, auto-updated via `useEffect` when `useAutoTarget`.
  - Submit: `updateGoalsMut(...)` writes profile; `createCampFromOnboardingMut({name, fightDate, startingWeightKg})` (does **not** currently pass `weighInTiming`); `generateCutPlanAction({currentWeight, goalWeight, fightWeekTargetKg, targetDate, age, sex, heightCm, activityLevel})`.
- **`convex/schema.ts`:** `profiles` has `goalWeightKg`, `fightWeekTargetKg?`, `athleteType?` but **no weigh-in field**. `fight_camps.weighInTiming: v.optional(v.string())` exists (line ~372).
- **`convex/fight_camp.ts`:** `createCampFromOnboarding` args already include `weighInTiming: v.optional(v.string())` — just not passed from onboarding.
- **`convex/actions/generateCutPlan.ts`:** args `{currentWeight, goalWeight, fightWeekTargetKg?, targetDate, heightCm, age, sex, activityLevel?}`. `finalTarget = fightWeekTargetKg ?? goalWeight`. Builds deterministic macros + an LLM narrative (no weigh-in awareness today).
- **`profiles.updateGoals` mutation** is the write path for onboarding answers.
- **Existing `weighInTiming` consumers** (must keep working): `src/utils/fightWeekEngine.ts`, `src/components/protocol/WeighInDaySpotlight.tsx`, `src/components/protocol/*`, `src/lib/coachGreeting.ts`, fight-week math, `convex/actions/fightCampCoach.ts`/`coachFightWeek_internal.ts`. They read it as a free-form string — must tolerate the canonical values below.

---

## 4. Design

### 4.1 Canonical value
`weighInTiming: "day_before" | "same_day"`. **Default `"day_before"`** wherever missing (existing users, existing camps, unset) so current behavior is preserved.

### 4.2 Onboarding — new step (cutting flow only)
- Insert a **new top-level step immediately after the goal-type split** (step 1) for the cutting flow: "When do you weigh in?" with two `OptionCard`s (existing component, same wizard styling + `OnboardingWizardMascot` + motion slide transitions as other steps):
  - **Day before weigh-in** — "About a day to recover and rehydrate. Pro MMA, boxing, kickboxing, Muay Thai." → `day_before`
  - **Same day weigh-in** — "You weigh in hours before you compete. BJJ/IBJJF, amateur MMA, wrestling, most matches." → `same_day`
- `formData.weigh_in_timing` (default `""`; required to advance this step for cutting).
- **Renumbering approach (the risk):** make `TOTAL_STEPS` flow-aware (`const totalSteps = isFighterFlow ? 17 : 16`) and **bump every cutting-flow step reference by +1 for steps ≥2** (disciplines→3, fight-details→4, … current-weight `isWeightStep`→7, final→17; achievements re-mapped). The **losing flow keeps 16**. Day-before cutting flow must play **behaviorally identical** to today apart from the one new screen. A dedicated verification step confirms this.
  - *Implementation guidance:* introduce named constants / a small `CUTTING_STEPS`/`LOSING_STEPS` map (e.g. `STEP.WEIGH_IN = 2`, `STEP.DISCIPLINES = 3`, …) to replace magic numbers in the cutting branch, so the insert is safe and future inserts are cheap. This is an allowed targeted cleanup since the magic numbers directly impede this change.

### 4.3 Same-day branch behavior
- **Fight-week target:** when `weigh_in_timing === "same_day"`, bypass `getWaterCutPercent`; set `fight_week_target_kg = round(goalWeight * 1.015, 1)` (≈1.5% natural buffer). When `day_before`, current per-competition-level logic is unchanged.
- **Pre-dehydration target sub-step (step-3 sub-step 3) → education screen for same-day:** instead of the water-cut target picker, render a "Same-day strategy" explainer card (wizard-styled): keep carbs / eat normally, minimize dehydration (no sauna/sweat cuts), arrive near weight naturally, why depleting hurts performance (no recovery window). It shows the auto-set target (≈goal) read-only and a Continue. Day-before keeps the existing picker untouched.
  - The competition-level sub-step (sub-step 0) still applies (used elsewhere); only the target sub-step diverges.

### 4.4 Data propagation
- **`convex/schema.ts`:** add `weighInTiming: v.optional(v.string())` to `profiles`.
- **`profiles.updateGoals`:** accept + persist `weighInTiming`.
- **Onboarding submit:** pass `weighInTiming` to `updateGoalsMut`, to `createCampFromOnboardingMut` (already supports), and to `generateCutPlanAction`.
- **`generateCutPlan` action:** add `weighInTiming: v.optional(v.string())` arg (default `"day_before"`).

### 4.5 `generateCutPlan` prompt — research-branched
Branch the system prompt on `weighInTiming`:
- **`day_before`:** keep the current managed-cut prompt/behavior.
- **`same_day`:** inject the same-day PROMPT GUIDANCE from §2 — gradual early body-comp change; **keep carbs ≥3–4 g/kg, never deplete**; ≤2–3% dehydration cap, prefer 0; final days maintenance not a cut; explicit do-NOT-sauna/sweat/restrict messaging; "arrive near weight naturally"; if gap needs >~5% loss → recommend moving up a class. Deterministic macros must NOT prescribe a steep carb cut for same-day (floor carbs at ≥3 g/kg). The plan's narrative/notes should carry the educational messaging so it's visible to the user.
- Keep the existing structured-output schema + fallback intact.

---

## 5. Edge cases
1. **Already at/under goal weight:** plan = maintenance/performance fuelling, no cut (applies to both timings; especially the happy path for same-day).
2. **Same-day, large gap + short runway:** if reaching goal needs >~5% loss or meaningful dehydration in the time available → plan explicitly recommends moving up a class / changing target rather than cutting.
3. **Unknown/long timeline:** chronic body-comp mode at ≤0.5–1 kg/week; no acute cut prescribed.
4. **Returning users / existing camps / existing profiles** with no `weighInTiming`: treated as `day_before` (no behavior change). The new onboarding step only appears in the cutting flow going forward.
5. **`?startCamp=1` re-run onboarding:** new step participates normally; weighInTiming flows to the new camp.
6. **Value reconciliation:** existing `weighInTiming` readers must handle `"same_day"`/`"day_before"`; audit and adjust any that compare against other literals (e.g. "same-day" vs "same_day").

---

## 6. Files to change
- `src/pages/Onboarding.tsx` — new step + renumbering + same-day target calc + education screen wiring + submit propagation.
- `src/components/onboarding/` — new `WeighInTimingStep` and `SameDayStrategyCard` (or inline screens) matching wizard style.
- `convex/schema.ts` — `profiles.weighInTiming`.
- `convex/profiles.ts` — `updateGoals` accepts `weighInTiming`.
- `convex/actions/generateCutPlan.ts` — `weighInTiming` arg + branched prompt + same-day macro floor.
- (Verify/adjust) existing `weighInTiming` consumers for value compatibility.

---

## 7. Testing / verification
- Day-before cutting flow is behaviorally identical to today (step count, slams, achievements, target calc, generated plan shape) — **manual + Playwright walkthrough**.
- Same-day flow: new step appears right after the fight/lose split; education screen replaces the target picker; fight-week target ≈ goal+1.5%; generated plan keeps carbs, caps dehydration, no sauna, "arrive naturally" messaging.
- Losing flow unchanged (still 16 steps).
- `npx tsc --noEmit` clean; Convex deploys; no new console errors.
- Edge cases above produce sane plans (already-at-goal → maintenance; big-gap same-day → move-up-a-class advice).

---

## 8. Implementation phases (for subagent-driven dev)
1. **Backend data**: `profiles.weighInTiming` (schema + `updateGoals`); `generateCutPlan` arg + branched prompt + same-day macro floor. (Convex; codegen + deploy.)
2. **Onboarding step + renumbering**: insert the weigh-in step after step 1, make `TOTAL_STEPS` flow-aware, bump cutting step references (named constants), wire `formData.weigh_in_timing`. Day-before parity verified.
3. **Same-day branch UI**: education screen swap + fight-week target ≈ goal+1.5%; submit propagation to `updateGoals`/`createCampFromOnboarding`/`generateCutPlan`.
4. **Compat + verify**: reconcile existing `weighInTiming` readers; typecheck; Playwright walkthrough of both flows + edge cases.
