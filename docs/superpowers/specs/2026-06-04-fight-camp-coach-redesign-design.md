# Fight Camp Coach Redesign — Design Spec

**Date:** 2026-06-04
**Status:** Approved scope, pending implementation plan
**Scope:** Full vision (4 phases), single spec, build in phase order
**Coach home:** Global floating coach (evolve the existing `FloatingWizardChat` surface)

---

## 1. Problem & Goals

The Fight Camp Coach is today a **plain chatbot**: text in, a 150–300 word markdown blob out. It is the only AI feature in the app still returning freeform prose — every other feature (`generateCutPlan`, `fightWeekAnalysis`, rehydration protocol) returns validated structured data. The coach is reactive (only answers what is typed), ignores almost all of the data the app already captures, and gives a fighter no reason to keep paying between camps.

**Goals**

1. **Structured, not paragraphs** — responses render as native UI cards (weight targets, checklists, timelines, charts, action cards), not walls of text.
2. **Dynamic & proactive** — the coach speaks first, references today's real numbers, and adapts to where the fighter is in camp.
3. **Genuinely useful** — a cornerman that orchestrates existing engines (fight plan, rehydration protocol, Fight Form Score, fight-week math, HealthKit) across the full camp lifecycle, with a safety-first guardrail.
4. **Make Pro worth it** — a free taste that converts, a flagship Pro experience, and retention that survives the off-season.

**Non-goals (this spec):** voice cornerman, a `pro_plus` tier, and human-in-the-loop coach review. These are noted as future levers, not built here.

---

## 2. Current State (grounded)

- **Backend action `convex/actions/fightCampCoach.ts`** — Pro-gated (`AI_FIGHT_CAMP_COACH`). Loads upcoming camp (date, name, starting weight, weigh-in timing), last 7 fight-week logs (weight/fluid/carbs/sweat) and an athlete snapshot. Calls `callGroqText` (`openai/gpt-oss-120b`, temp 0.5, max 1500). Returns `{ choices: [{ message: { content } }] }` — freeform markdown. **Not currently wired to any UI.**
- **`src/components/FloatingWizardChat.tsx`** — a draggable FAB (the `Orb`) that blooms into an 85dvh bottom sheet. Header already reads **"FightCamp Coach"**, placeholder "Message Coach". Backed by `useWizardBackground()` → the `wizardChat` action (fast `llama-3.1-8b-instant`, general purpose) and gated on `AI_WIZARD_CHAT`. Renders markdown bubbles, typing dots, starter prompt chips. **This is the surface the user means by "the chatbot."**
- **`src/components/fightcamp/RecoveryCoachChat.tsx`** — a second chat pattern (recovery coach): bubbles, markdown, static chips, voice dictation, localStorage persistence. Reference for the embedded-chat pattern.
- **Structured-output infra already exists:**
  - `convex/_shared/groq.ts` → `callGroqWithRetry<T>(schema)` — JSON-mode call + Zod validate + up to 3 self-healing retries (appends validation errors back into the prompt).
  - `convex/_shared/parseResponse.ts` — strips `<think>` tags, balances braces, sanitizes trailing commas.
  - `convex/actions/generateCutPlan.ts` — **direct precedent**: computes numbers server-side (`_shared/math.ts`), LLM writes only narrative, validated against a Zod schema, bans paragraphs/em-dashes in the prompt.
- **Feature gates** — `src/lib/featureGates.ts` + `convex/_shared/featureGates.ts`. Tiers are `free | pro`; the code is architected so a third tier (`pro_plus`) is a one-place change. **Every AI feature is currently `minTier: "pro"`** — free users get zero AI. Trial infra (`trialEndsAt` in `convex/_shared/tier.ts`) exists but is dormant.
- **Existing engines/data to orchestrate:** `generateFightPlan` (fight-week protocol), `generateRehydrationProtocol` (post-weigh-in refuel), `fightWeekAnalysis` (projection + red flags), `fight_form_scores` (readiness, `phase: build|peak|fightWeek`, sub-scores), Camp Compass weekly cron, `weight_protocols` + `protocol_feel_checks` (green/amber/red feel tiers), HealthKit (`daily_health_summary`: HRV/RHR/sleep/wrist-temp, `health_baselines` z-scores), `fight_camps` (completed-camp fields: `endWeightKg`, `totalWeightCut`, `weightViaDehydration`, `weightViaCarbReduction`, `performanceFeeling`), push infra (`device_tokens`, `pushFanout`).

---

## 3. Architecture Overview

### 3.1 Backend flow (rewritten `fightCampCoach.run`)

```
client → { messages[], context? }
  1. resolve userId; load fightWeekData + athlete snapshot (existing)
  2. compute DETERMINISTIC blocks from real data:
       weight_target, chart (weight/fluid), metric_row
  3. run SAFETY CHECK (deterministic) on logs + HealthKit:
       rate-of-loss, feel-check tiers, RHR/HRV spikes
       → if red, prepend a danger `callout` block (never paywalled)
  4. intent gate:
       casual turn  → llama-3.1-8b-instant, prose-only (fast, cheap)
       planny turn  → gpt-oss-120b, JSON-mode, reasoning_effort:"low", max_tokens ~800
  5. callGroqWithRetry(CoachMessageSchema)
       LLM writes: reply + checklist/callout labels + followups + which cards apply
  6. merge server blocks + LLM blocks (server numbers win)
  7. return { reply, blocks[], followups[] }
  FALLBACK: if Zod exhausts retries → one callGroqText plain call
            → { reply: <markdown>, blocks: [] }
```

Reuses `callGroqWithRetry`, `parseResponse`, `_shared/math.ts`. No new infra in `groq.ts`/`parseResponse.ts`.

### 3.2 Frontend

- **`FloatingWizardChat` becomes the cockpit shell.** Keep the draggable orb + bloom-to-sheet. Re-route its data layer from the general `wizardChat` action to the rewritten coach action (a dedicated coach context/hook, see §6).
- **New `src/components/fightcamp/CoachBlocks.tsx`** — a renderer with `switch(block.type)` and a **no-op `default`** so old iOS/Capacitor builds never crash on a block type they don't know.
- Message model carries optional `blocks` and `followups`. Persisted localStorage sessions tolerate old messages with no `blocks` (field is optional — no migration).
- Action blocks wire to existing optimistic log flows (weight/fluid logging) for "log this" CTAs.

### 3.3 Where it lives (confirmed: global floating coach)

- Primary surface: the floating orb → bottom-sheet cockpit, reachable from anywhere.
- Secondary entry: a proactive **briefing card** (Phase 3) on Dashboard/Camp that, when tapped, opens the floating cockpit (via the existing `tutorial:open-wizard-chat`-style window event or a shared open() from context).

---

## 4. The `CoachMessage` Schema (the wall-of-text killer)

Defined in `convex/_shared/aiSchemas.ts` (Zod), mirrored as a TS type for the client. Discriminated union on `type`. **Every string and array gets a `.max()` cap** — this is the mechanism that structurally prevents paragraphs (same discipline as `CutPlanAiSchema`).

```ts
interface CoachMessage {
  reply: string;            // 1–3 sentences, conversational, ALWAYS present
  blocks: CoachBlock[];     // 0–4 blocks; empty is valid (pure-prose turn)
  followups?: string[];     // 0–3 suggested chips, each ≤ 40 chars
}

type CoachBlock =
  | { type: "weight_target"; current_kg: number; target_kg: number;
      delta_kg: number; days_out: number; on_track: boolean; note?: string }   // note ≤ 80
  | { type: "checklist"; title: string;                                         // ≤ 40
      items: { label: string; done?: boolean; logKey?: LogKey }[] }            // label ≤ 60, 1–6 items
  | { type: "timeline"; title: string;
      steps: { when: string; label: string; value?: string }[] }              // when ≤16, label ≤50, 2–8
  | { type: "metric_row";
      metrics: { label: string; value: string; tone?: "good"|"warn"|"bad" }[] } // label ≤20, value ≤16, 1–4
  | { type: "action"; label: string; description?: string; action: LogAction }
  | { type: "chart"; title: string; kind: "weight_trend"|"fluid";
      series: { x: string; y: number }[]; targetLine?: number }               // series SERVER-supplied only
  | { type: "callout"; tone: "info"|"warn"|"danger"; text: string };           // text ≤ 200

type LogAction =
  | { kind: "log_weight"; suggested_kg?: number }
  | { kind: "log_fluid"; suggested_ml?: number }
  | { kind: "open_plan" }
  | { kind: "open_rehydration" };
type LogKey = "weight" | "fluid" | "carbs" | "sweat";
```

**Rules**
- `weight_target`, `chart`, `metric_row` numbers are **computed server-side** and merged in — never trusted from the LLM (it hallucinates numbers).
- `blocks` may be empty so a casual turn ("can I spar tomorrow?") stays pure prose.
- Invalid individual blocks are **filtered, not fatal** (`z.array(...).catch`/transform-filter) — one bad chart never nukes a good checklist.

---

## 5. Phase Breakdown

### Phase 1 — Structured message foundation
*Ships: cards instead of paragraphs. Nothing else works without it.*

- Add `CoachMessageSchema` + block schemas to `convex/_shared/aiSchemas.ts`; export TS types.
- Rewrite `convex/actions/fightCampCoach.ts`: deterministic blocks + intent gate + `callGroqWithRetry` + merge + markdown fallback. Keep the Pro gate; add a safety carve-out hook (full guardrail lands in P3).
- New `src/components/fightcamp/CoachBlocks.tsx` renderer (forward-compatible `switch`, no-op default). Each block reuses existing visual components/utilities:
  - `weight_target` → `display-number` + drift-color logic (from `PhaseCoachCard`).
  - `chart` → reuse `buildChart()` sparkline from `PhaseCoachCard`.
  - `checklist`/`timeline` → CampCompass day-row list (`divide-y border`).
  - `callout` → tone-colored card; `danger` is visually loudest.
- Extend the coach message model to carry `blocks`/`followups`; render via `CoachBlocks`, fall back to `ReactMarkdown` for `reply`.

**Acceptance:** a fight-week question returns a weight-target card + a checklist + ≤3 sentence reply; no paragraph blobs; malformed model output degrades to plain text without error.

### Phase 2 — Coach cockpit UI
*Ships: the visible "not a chatbot" transformation.*

- **Pinned cockpit header** inside the bottom sheet (above the chat scroll): proactive greeting from today's numbers ("Morning Pratik — 3 days out, 0.4kg ahead of plan"), live weigh-in countdown, phase pill (BUILD/PEAK/FIGHT WEEK from `PHASE_META`), weight-target callout. Built from the same `fightWeekData` the action loads. `aria-live="polite"`.
- **Context-adaptive quick-reply chips** — replace static starters with chips derived from state (days-to-weigh-in, drift). Plus per-turn `followups` from the response (chips refresh after each turn).
- **"Reading your numbers" thinking state** — rotating status line (reuse the `ff-ring-calib-phrase` crossfade) instead of generic dots.
- **Block-stagger entrance** (`dashboard-enter-stagger`, honor `useReducedMotion`); number count-up on callouts (`.score-pulse`).
- **Daily check-in streak** — one-tap check-in card + small streak badge.
- Keep iOS safe-area/keyboard handling already in `FloatingWizardChat` (`--keyboard-inset`, safe-area padding); chips sit directly above the composer (thumb zone); 44px touch targets.

**Acceptance:** opening the coach shows a live, data-grounded header before any typing; chips change with camp state; reduced-motion path verified.

### Phase 3 — Cornerman intelligence
*Ships: genuinely useful, orchestrates existing engines. Safety guidance is free.*

1. **🛡 Safety guardrail (deterministic, free, always).** Watches `protocol_feel_checks.tier`, `daily_health_summary` RHR/HRV, and rate-of-loss in `weight_logs`/`fight_week_logs`. On red markers, injects a `danger` callout that overrides any "make weight" tone (slow down / rehydrate / consider pulling out). **Never paywalled.** Build/verify correctness first.
2. **Daily fight-week cornerman.** Reads today's step from the stored `generateFightPlan` payload (`weight_protocols`) and reconciles against actual `fight_week_logs` ("water-load day 2 — you're 3L short").
3. **Proactive briefing card** on Dashboard/Camp (reuses `DailyVerdict`/`CampCompassCard` patterns): phase, weight-to-go, today's one priority, any red flag, "talk to coach" → opens the floating cockpit. (Most fighters won't open a chat — value must be pushed into a card.)
4. **Cross-camp memory.** Coach references completed-camp fields ("last camp you rebounded 3.8kg in 24h and felt strong"). **Requires a small post-fight debrief capture flow** to reliably populate `performanceFeeling`/rebound on `fight_camps` (fields exist, capture is inconsistent).

**Acceptance:** a simulated unsafe trajectory produces a free danger callout; the daily cornerman correctly diffs plan vs logs; the briefing card renders the current read without opening chat.

### Phase 4 — Pro / monetization layer
*Ships: free taste that converts + retention that survives the off-season.*

- **Free Daily Cornerman Nudge** — one read-only proactive insight/day from real numbers. Tapping "ask why / what now?" → contextual paywall. (Fixes today's zero-AI free wall.)
- **Contextual paywall** — replace the generic feature-list `PaywallOverlay` with an interstitial pre-filled with the user's actual situation at the "aha" moment.
- **Persisted conversation memory (Pro)** — coach remembers across the camp (server-stored conversation), not just last 16 messages.
- **Fight-week trial** — activate dormant `trialEndsAt` as a "free until your fight date" pass (RC config + flow).
- **Off-season "Camp Architect" mode (Pro)** — between fights: walk-around weight, when to start the next cut, base-building check-ins. Kills post-fight churn.
- **Multi-camp history & trends (Pro)** — longitudinal "cut, fight over fight" view.

**Free vs Pro coach split**

| Capability | Free | Pro |
|---|---|---|
| Daily proactive nudge (read-only, 1/day, real numbers) | ✅ | ✅ |
| Interactive multi-turn chat | ❌ → paywall | ✅ unlimited |
| Persisted conversation memory | ❌ | ✅ |
| Personalized fight-week protocol | preview / blurred Day 1 | ✅ full, live-adjusting |
| Multi-camp history & trends | ❌ | ✅ |
| Off-season Camp Architect | ❌ | ✅ |
| Check-in streak + countdown | streak on nudge | ✅ + push |
| **Dangerous-cut safety warnings** | ✅ **always free** | ✅ |
| Voice cornerman / human review | — | future Coach+ (deferred) |

**Acceptance:** a free user gets a daily nudge and hits a contextual (not generic) paywall on interaction; Pro conversation persists across sessions; trial activates and expires correctly.

---

## 6. Data Model & Integration Notes

- **Conversation persistence (P4):** new table (e.g. `coach_conversations`) keyed by user/camp; client still sends recent messages, server appends + summarizes older turns to keep prompt tokens flat. Until P4, persistence stays in localStorage (current pattern).
- **Post-fight debrief (P3):** small capture flow to populate `fight_camps.performanceFeeling`, actual rebound kg, "what I'd change."
- **Coach data layer:** introduce a dedicated coach context/hook (parallel to `useWizardBackground`) so `FloatingWizardChat` routes to the rewritten `fightCampCoach.run` with `blocks` support, rather than the general `wizardChat` action. Decide whether to retire/merge the general wizard chat or keep both — **open question (§8).**
- **Intent gate** uses the per-feature model tiering already documented: `llama-3.1-8b-instant` (fast/casual) vs `openai/gpt-oss-120b` (structured/planny).

---

## 7. Cross-Cutting Concerns

- **Safety:** deterministic guardrail; warnings never paywalled; firm override tone on red markers. Medically dangerous cuts get a "see a professional" message, free.
- **Determinism:** all numbers (targets, chart series, paces) computed server-side; LLM never emits metric numbers.
- **Error handling:** Zod self-healing retries → markdown fallback; per-block filtering; forward-compatible renderer default.
- **Performance (no streaming — synchronous):** intent gate keeps casual turns sub-second; `max_tokens` right-sized (~800 structured / ~400 prose); `reasoning_effort:"low"`; optimistic skeleton cards during the call to mask latency; lean message history.
- **Accessibility/iOS:** `aria-live` greeting, real `role="checkbox"` on checklist items, chart `aria-label` summaries, 44px targets, safe-area + keyboard insets (existing utilities).

---

## 8. Open Questions / Risks

1. **Wizard chat vs Fight Camp Coach:** the floating orb is currently the general `wizardChat`. Do we (a) repoint it entirely to the coach, (b) keep general chat and add coach as a mode, or (c) merge into one coach that also handles general questions? *Recommendation: (c) one coach, intent-routed — simplest mental model — but confirm.*
2. **Free nudge generation cost:** one AI nudge/day/user across the base — confirm budget; consider a cheap model + caching (the app already has `AIPersistence`).
3. **Push notification scope (P3/P4):** proactive nudges need a cron fan-out (pattern exists: Camp Compass). Confirm appetite for notifications.
4. **Trial mechanics:** "free until fight date" vs fixed 7-day — needs RevenueCat product/config decision.
5. **Post-fight debrief UX:** where/when to prompt without being annoying.

---

## 9. Success Criteria

- Coach responses render as structured cards; no paragraph blobs in normal use.
- Coach opens with a live, data-grounded read before any input.
- A dangerous trajectory always produces a free safety warning.
- Free users experience the coach (nudge) and hit a contextual paywall; Pro conversation persists and survives the off-season via Camp Architect + history.
- All numeric content is accurate (server-computed), and the feature degrades gracefully on model failure and on older app builds.
