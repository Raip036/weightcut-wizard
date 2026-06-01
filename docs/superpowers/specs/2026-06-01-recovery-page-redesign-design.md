# Recovery Page Redesign + Load Model Overhaul — Design

**Date:** 2026-06-01
**Status:** Spec — awaiting user review before implementation plan
**Scope:** Recovery page UI redesign + algorithm simplification + load model accuracy overhaul + 3 new AI Pro surfaces + training calendar session-type expansion
**Surface area:** `src/pages/Recovery.tsx`, `src/components/fightcamp/RecoveryDashboard.tsx`, `src/utils/performanceEngine/**`, `src/pages/TrainingCalendar.tsx`, `convex/actions/recovery/**` (new), `convex/schema.ts` (additive)

---

## 1. Goals

1. **Simplify the page** — current dashboard surfaces 9 readiness factors across 4 expandable cards + a standalone breakdown card + balance metrics. Replace with a single hero + 3 pillars + 4 visible drivers. Same underlying math; half the cognitive load.
2. **Improve training-load accuracy** — current load model is generic. Add EWMA-based ACWR, combat-sport session weights, smarter CNS multiplier, Foster's monotony/strain, fight-camp phase awareness, and contact-load tracking.
3. **Build a Pro funnel on top** — Recovery page stays 100% free. Three new AI surfaces (Camp Compass weekly report, Pre-Session Green Light, Shareable Cards) drive premium conversion without gating core value.
4. **Make session logging more accurate** — expand training calendar session types to combat-specific taxonomy (Sparring, Pads, Live Grappling, etc.) so the new load model has clean inputs.

## 2. Non-goals

- No archetype/identity labels (WARLORD/DIALED) in v1 — numbers and tier verdicts only.
- No HRV/HealthKit ingestion changes in this spec (existing tier system stays).
- No coach-mode dashboards.
- No leaderboard or gym feed integration of readiness scores.
- No notification system rebuild (push alerts ship as opt-in only via existing notification infra).

---

## 3. Algorithm — keep math, change the lens

### 3.1 The 3 pillars (display-derived from existing 9 factors)

Hero readiness stays the existing `computeEnhancedReadiness` weighted composite (Tier 1/2/3). Pillars are display-derived views of the same inputs — no re-weighting of the hero.

```ts
// src/utils/performanceEngine/pillars.ts (new file)

export interface PillarScores {
  recovery: number | null;  // null until Tier ≥ 2
  body:     number | null;  // null in Tier 1
  load:     number | null;  // null until 7+ training days in 28d window
}

export function derivePillars(
  breakdown: EnhancedReadinessBreakdown,
  loadConfidence: LoadConfidence,
): PillarScores {
  const recovery = clamp(0, 100,
    0.55 * breakdown.sleepScore
  + 0.25 * breakdown.recoveryScore
  + 0.12 * (breakdown.hydrationScore ?? 50)
  + 0.08 * (breakdown.priorRecoveryScore ?? 50)
  );

  const body = breakdown.wellnessScore != null
    ? clamp(0, 100,
        0.60 * breakdown.wellnessScore
      + 0.35 * breakdown.sorenessScore
      + 0.05 * (breakdown.stabilityScore ?? 50)
      )
    : null;

  const load = loadConfidence.isReliable
    ? clamp(0, 100,
        breakdown.loadBalanceScore * (0.85 + 0.15 * ((breakdown.deficitImpactScore ?? 100) / 100))
      )
    : null;

  return { recovery, body, load };
}
```

**Why option (b) over averaging pillars:** Averaging 3 pillars silently re-weights the model (wellness drops 30 → 20%, ACWR jumps 15 → 33%). The hero number would disagree with the pillar math under the hood, breaking trust the first time a fighter sees 78 hero with pillars averaging 71. Keep hero math; pillars are summaries.

### 3.2 The 4 visible drivers (was 9)

Driver row, top-to-bottom in the breakdown card:
1. **Sleep** — `sleepScore`
2. **How you feel** — `wellnessScore` (from Hooper Index check-in)
3. **Soreness** — `sorenessScore`
4. **Training load** — `loadBalanceScore` (with confidence gate)

**Hidden (fold into pillar math):** `priorRecoveryScore`, `stabilityScore`, `hydrationScore`, `recoveryScore`, `deficitImpactScore` (surfaced as conditional chip inside Body pillar only when impact <50).

Each driver row shows:
- Label · fighter-tone one-liner · delta arrow (▲/▼/–) vs 7-day average
- No raw numbers by default. Tap row expands to show 0–100 + 7d sparkline.

**Driver copy by score band:**

| Driver | ≥80 | 55–79 | 35–54 | <35 |
|---|---|---|---|---|
| Sleep | "Slept like a champ" | "Solid sleep" | "Sleep was light" | "You slept poorly" |
| How you feel | "Dialled in" | "Feeling decent" | "Bit flat today" | "Body's telling you something" |
| Soreness | "Loose and fresh" | "Mild stiffness" | "Beat up" | "Hammered" |
| Training load | "Streak going" | "Tracking well" | "Hard week" | "Red zone — back off" |

### 3.3 Tier handling (unchanged)

- **Tier 1** (no check-in) — hero shows base 5-factor `computeReadiness`. Body + Recovery pillars render dimmed at 50 with CTA "Log your first check-in." Load pillar hidden until 7+ training days.
- **Tier 2** (check-in, no baseline) — all 3 pillars render. Stability + deficit weights drop from Body/Load; pillar math renormalizes. Footnote: "Baseline building — X days left."
- **Tier 3** (full model) — full pillar math, all drivers visible.

### 3.4 Edge case: fight-week peak

When user has a logged fight date within 14 days, the Load pillar relabels "Hard week" → "Camp peak — expected" and uses neutral coloring instead of amber/red. See §4.5 for the new fight-camp phase logic in the load model.

---

## 4. Training Load Model — accuracy overhaul

### 4.1 EWMA-based ACWR (replaces simple rolling average)

Current model: `acuteLoad = sum(last 7d)`, `chronicLoad = mean(last 28d)`. Replace with exponentially weighted moving average (Williams et al. 2017 — stronger injury predictor).

```ts
// src/utils/performanceEngine/load.ts

// EWMA decay: λ = 2 / (N + 1). N=7 → λ≈0.286 (acute), N=28 → λ≈0.069 (chronic)
const ACUTE_LAMBDA = 2 / (7 + 1);    // 0.2857
const CHRONIC_LAMBDA = 2 / (28 + 1); // 0.0690

export function ewmaLoad(dailyLoads: { date: string; load: number }[], lambda: number): number {
  if (dailyLoads.length === 0) return 0;
  let ewma = dailyLoads[0].load;
  for (let i = 1; i < dailyLoads.length; i++) {
    ewma = lambda * dailyLoads[i].load + (1 - lambda) * ewma;
  }
  return ewma;
}

export function computeEwmaAcwr(dailyLoads: { date: string; load: number }[]): {
  acuteLoad: number;
  chronicLoad: number;
  loadRatio: number;
} {
  const acuteLoad   = ewmaLoad(dailyLoads.slice(-7),  ACUTE_LAMBDA);
  const chronicLoad = ewmaLoad(dailyLoads.slice(-28), CHRONIC_LAMBDA);
  const loadRatio = acuteLoad / (chronicLoad + 1);
  return { acuteLoad, chronicLoad, loadRatio };
}
```

Update `computeLoadMetrics` in `src/utils/performanceEngine/index.ts` to use `computeEwmaAcwr`. Existing `loadConfidence` (14-day reliability gate) and `MIN_ACUTE_LOAD_FOR_SPIKE_WARNING` floors stay.

### 4.2 Combat-sport session-type weights

Add `sportLoadMultiplier` to `sessionLoad` calculation:

```ts
// src/utils/performanceEngine/load.ts

const SPORT_LOAD_MULTIPLIERS: Record<string, number> = {
  // Combat (impact + CNS + contact)
  'Sparring':         1.3,
  'Live Grappling':   1.3,
  'Hard Drilling':    1.15,
  'Pad Work':         1.10,
  'Bag Work':         1.00,
  'Drilling':         0.95,
  // Conditioning
  'Strength':         1.00,
  'Conditioning':     0.90,
  'Run':              0.90,
  'Z2 / Easy':        0.85,
  // Skill
  'Skill / Technical': 0.80,
  'Shadowboxing':     0.70,
  // Recovery
  'Mobility':         0.50,
  'Yoga':             0.50,
  'Recovery':         0.40,
  // Legacy / unknown — neutral
  'Training':         1.00,
  'Other':            1.00,
};

export function sportLoadMultiplier(sessionType: string): number {
  return SPORT_LOAD_MULTIPLIERS[sessionType] ?? 1.0;
}

export function sessionLoad(session: SessionRow): number {
  if (session.session_type === 'Rest' || session.session_type === 'Recovery') return 0;
  return session.rpe
       * session.duration_minutes
       * getIntensityMultiplier(session)
       * sportLoadMultiplier(session.session_type);
}
```

### 4.3 Smarter CNS / proximity multiplier

Replace flat 10% bump with proximity- and intensity-aware logic:

```ts
// src/utils/performanceEngine/load.ts

export function cnsMultiplier(sessions: SessionRow[]): number {
  const training = sessions.filter(s => s.session_type !== 'Rest' && s.session_type !== 'Recovery');
  if (training.length <= 1) return 1.0;

  const anyHighRpe = training.some(s => s.rpe >= 7);
  if (!anyHighRpe && training.length === 2) return 1.05;

  // Use `created_at` timestamps to gauge proximity. Fall back to flat 10% if missing.
  const timestamps = training
    .map(s => s.created_at ? new Date(s.created_at).getTime() : null)
    .filter((t): t is number => t != null)
    .sort();
  if (timestamps.length < 2) return training.length > 1 ? 1.10 : 1.00;

  const maxGapHours = (timestamps[timestamps.length - 1] - timestamps[0]) / 3_600_000;
  if (training.length >= 3) return 1.20;
  if (maxGapHours < 6)  return 1.15;
  if (maxGapHours < 12) return 1.10;
  return 1.05;
}

export function dailyLoad(sessions: SessionRow[]): number {
  const training = sessions.filter(s => s.session_type !== 'Rest' && s.session_type !== 'Recovery');
  if (training.length === 0) return 0;
  const total = training.reduce((sum, s) => sum + sessionLoad(s), 0);
  return total * cnsMultiplier(sessions);
}
```

### 4.4 Foster's Monotony + Weekly Strain

Add two derived overtraining metrics. Surface in Load pillar drill-down. (Foster 1998.)

```ts
// src/utils/performanceEngine/load.ts

export function computeFosterMetrics(dailyLoads: { date: string; load: number }[]): {
  weeklyMonotony: number;
  weeklyStrain: number;
} {
  const last7 = dailyLoads.slice(-7).map(d => d.load);
  if (last7.length === 0) return { weeklyMonotony: 0, weeklyStrain: 0 };

  const weeklyTotal = last7.reduce((s, l) => s + l, 0);
  const mean = weeklyTotal / 7;
  const variance = last7.reduce((s, l) => s + (l - mean) ** 2, 0) / 7;
  const std = Math.sqrt(variance);
  const weeklyMonotony = std > 0.01 ? mean / std : 0;
  const weeklyStrain = weeklyTotal * weeklyMonotony;

  return { weeklyMonotony, weeklyStrain };
}
```

Threshold copy in UI:
- **Monotony** > 2.0 → "Same intensity every day — vary your week"
- **Weekly Strain** > 6000 → "Foster danger zone — deload incoming" (Foster's threshold)

### 4.5 Fight-camp phase awareness

Detect fight-camp context and shift ACWR thresholds accordingly. Uses existing `fight_camps` data (camp metadata already exists in `convex/schema.ts`).

```ts
// src/utils/performanceEngine/calibration.ts

export type CampPhase = 'off-camp' | 'build' | 'peak' | 'taper';

export function determineCampPhase(daysToFight: number | null): CampPhase {
  if (daysToFight == null || daysToFight > 28) return 'off-camp';
  if (daysToFight > 14) return 'build';
  if (daysToFight > 7)  return 'peak';
  return 'taper';
}

export function applyCampPhaseToCalibration(
  calibration: AthleteCalibration,
  phase: CampPhase,
): AthleteCalibration {
  const t = calibration.loadRatioThresholds;
  switch (phase) {
    case 'build':
      return { ...calibration, loadRatioThresholds: { caution: t.caution - 0.05, danger: t.danger - 0.05 } };
    case 'peak':
      // Peak is supposed to spike. Loosen thresholds.
      return { ...calibration, loadRatioThresholds: { caution: t.caution + 0.15, danger: t.danger + 0.10 } };
    case 'taper':
      // Inverse: flag *under*-loading. Surface a 'taper short' warning if ratio < 0.7.
      return { ...calibration, loadRatioThresholds: { caution: t.caution + 0.20, danger: t.danger + 0.20 } };
    default:
      return calibration;
  }
}
```

Wire in `deriveCalibration` — accept optional `daysToFight` parameter, apply phase shift after tier defaults.

Engine consumer changes:
- `computeAdaptiveOvertrainingScore` checks phase. If `phase === 'peak'` and `loadRatio > caution`, factor message becomes "Camp peak — expected" (neutral), not a red alarm.
- If `phase === 'taper'` and `loadRatio < 0.7`, add new factor: "Taper looks too aggressive — keep some intensity."

### 4.6 Contact load tracker

Combat-sports-specific injury risk metric. Counts rounds of contact (sparring + live grappling) over rolling 7 days.

**Schema addition** (`convex/schema.ts`, `fight_camp_calendar` table):
```ts
rounds: v.optional(v.number()), // contact rounds for sparring/live grappling sessions
```

**Engine** (`src/utils/performanceEngine/load.ts`):
```ts
const CONTACT_SESSION_TYPES = new Set(['Sparring', 'Live Grappling']);

export function computeContactLoad(sessions28d: SessionRow[]): {
  contactRoundsLast7d: number;
  contactRiskZone: 'low' | 'moderate' | 'high' | 'critical';
} {
  const today = new Date();
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const contactRoundsLast7d = sessions28d
    .filter(s => s.date >= cutoff && CONTACT_SESSION_TYPES.has(s.session_type))
    .reduce((sum, s) => sum + ((s as any).rounds ?? 0), 0);

  let contactRiskZone: 'low' | 'moderate' | 'high' | 'critical';
  if (contactRoundsLast7d <= 8)  contactRiskZone = 'low';
  else if (contactRoundsLast7d <= 15) contactRiskZone = 'moderate';
  else if (contactRoundsLast7d <= 25) contactRiskZone = 'high';
  else contactRiskZone = 'critical';

  return { contactRoundsLast7d, contactRiskZone };
}
```

Surface in Load pillar drill-down: `"Contact load: 12 rounds this week · Moderate"`. Used independently of ACWR; does not feed the readiness score in v1 (separate injury-risk signal).

### 4.7 Migration: backfill + toast

On first session load after the model update lands:
1. **Backfill** — recompute the full 28d daily-load history under the new model, replace `strainHistory` and any cached `readiness_score` snapshots stored via `storeReadinessScore`.
2. **Toast** — show once per user via `localStorage[recovery-model-v2-acked:<userId>]`:
   > "We improved the training-load model — your scores now reflect sparring impact, weekly variety, and your camp phase. Your last 28 days have been recalculated."
   Auto-dismiss after 8s; tap to dismiss.

---

## 5. Training Calendar — session type expansion

### 5.1 Current state

- `session_type` is a free-form `v.string()` in Convex (`fight_camp_calendar.sessionType`).
- `SESSION_TYPES` constant lives in `src/pages/TrainingCalendar.tsx` (referenced as `SESSION_TYPES[0]` default).
- Existing user data may contain ad-hoc strings ("Training", "Run", "Cardio").

### 5.2 New taxonomy

`src/lib/sessionTypes.ts` (new file) — single source of truth, used by TrainingCalendar + load model + UI.

```ts
export const SESSION_TYPE_CATEGORIES = [
  {
    label: 'Combat',
    types: [
      { id: 'Sparring',        icon: 'flameOutline',   loadMultiplier: 1.30, isContact: true },
      { id: 'Live Grappling',  icon: 'fitnessOutline', loadMultiplier: 1.30, isContact: true },
      { id: 'Hard Drilling',   icon: 'pulseOutline',   loadMultiplier: 1.15 },
      { id: 'Pad Work',        icon: 'handLeftOutline', loadMultiplier: 1.10 },
      { id: 'Bag Work',        icon: 'cubeOutline',    loadMultiplier: 1.00 },
      { id: 'Drilling',        icon: 'repeatOutline',  loadMultiplier: 0.95 },
    ],
  },
  {
    label: 'Conditioning',
    types: [
      { id: 'Strength',        icon: 'barbellOutline', loadMultiplier: 1.00 },
      { id: 'Conditioning',    icon: 'flashOutline',   loadMultiplier: 0.90 },
      { id: 'Run',             icon: 'walkOutline',    loadMultiplier: 0.90 },
      { id: 'Z2 / Easy',       icon: 'leafOutline',    loadMultiplier: 0.85 },
    ],
  },
  {
    label: 'Skill',
    types: [
      { id: 'Skill / Technical', icon: 'bulbOutline',   loadMultiplier: 0.80 },
      { id: 'Shadowboxing',      icon: 'reorderTwoOutline', loadMultiplier: 0.70 },
    ],
  },
  {
    label: 'Recovery',
    types: [
      { id: 'Mobility',  icon: 'leafOutline',  loadMultiplier: 0.50 },
      { id: 'Yoga',      icon: 'leafOutline',  loadMultiplier: 0.50 },
      { id: 'Recovery',  icon: 'heartOutline', loadMultiplier: 0.40 },
      { id: 'Rest',      icon: 'moonOutline',  loadMultiplier: 0.00 },
    ],
  },
] as const;

export type SessionType = typeof SESSION_TYPE_CATEGORIES[number]['types'][number]['id'];
export const ALL_SESSION_TYPES: string[] = SESSION_TYPE_CATEGORIES.flatMap(c => c.types.map(t => t.id));
export const CONTACT_SESSION_TYPES = new Set(
  SESSION_TYPE_CATEGORIES.flatMap(c => c.types.filter((t: any) => t.isContact).map(t => t.id))
);
```

### 5.3 TrainingCalendar UI updates

- **Session-type picker** — replace flat dropdown with grouped picker (4 collapsible sections by category). Sticky most-recently-used at the top (last 3 used by this user, stored in localStorage `recent-session-types:<userId>`).
- **Rounds input** — appears conditionally when selected type is in `CONTACT_SESSION_TYPES`. Number input 1–20, default 5. Persists to new `rounds` column.
- **Legacy mapping** — at load time, normalize known legacy strings:
  - `"Training"` → `"Drilling"` (best-guess; user can re-edit)
  - `"Cardio"` → `"Conditioning"`
  - Unknown strings → leave as-is, treated by load model as neutral 1.0× (already handled by `sportLoadMultiplier` fallback).
- No data migration required — `session_type` stays `v.string()`. New rounds column is `v.optional(v.number())`.

### 5.4 Backwards compatibility

`sportLoadMultiplier` returns 1.0 for any unknown string. Existing sessions render and contribute to load with the neutral multiplier until edited. No data loss, no broken charts.

---

## 6. UI Redesign — RecoveryDashboard

### 6.1 Page layout (top → bottom)

```
Header                Recovery + 🔥 N-day streak chip (right)
Hero card             Timestamp · ? help button (top-right)
                      Big readiness number (72px) + ▲/▼ delta vs 7d avg
                      Tier badge (Green/Amber/Red)
                      Verdict line ("You're locked in — push.")
                      ▸ ACTION line (NEW — bold, the order)
                      ─────
                      Recovery · Body · Load mini-scores + sparklines
                      (tap mini-score → scrolls to pillar, auto-expands)

Gas Tank              Stylized boxing-glove-laceup bar (NEW)
                      Tier-colored fill
                      Brutal one-liner: "Two more hard days drops you to red."
                      Tremor animation at <25% fill

Daily check-in CTA    Conditional: only if not checked in today
                      Compact card, ~20s, 4 taps

Why · 4 drivers       Compressed breakdown card (replaces ReadinessBreakdownCard)
                      Sleep · How you feel · Soreness · Training load rows
                      No raw numbers by default; tap row expands

Pillar accordion      3 cards: Recovery / Body / Load
                      Collapsed by default; one open at a time
                      Expanded shows: sub-score, sparkline, what-this-means,
                      drill-down stats (folded from existing Strain/Sleep/OT/WeeklyLoad cards)

Caloric deficit       Conditional chip INSIDE Body pillar (not standalone)
                      Only if deficitImpactScore < 50

Camp Compass (Pro)    Free: blurred preview + "Unlock Sunday Report"
                      Pro: full report card (text + audio)

Pre-Session Green     Conditional: only within 2h of a calendared session
Light (Pro)           Free: locked teaser
                      Pro: Go/Modify/Bail verdict + specific modification

Coach Chat inline     Persistent chat input bubble (existing gating)
                      "Ask coach: should I spar Wednesday?"

Help sheet            Existing
```

### 6.2 Components to add / modify / delete

| File | Action |
|---|---|
| `src/components/fightcamp/RecoveryDashboard.tsx` | **Heavy rewrite** — new hero, gas tank, pillar accordion, removed StrainChart standalone usage (folded into Load pillar) |
| `src/components/fightcamp/RecoveryPillarAccordion.tsx` | **New** — 3-pillar accordion with drill-down |
| `src/components/fightcamp/GasTankBar.tsx` | **New** — glove-laceup visual + tremor animation |
| `src/components/fightcamp/DriverRow.tsx` | **New** — single driver row (label, copy, delta, expandable sparkline) |
| `src/components/fightcamp/CampCompassCard.tsx` | **New** — Sunday report card with free/pro states |
| `src/components/fightcamp/PreSessionGreenLight.tsx` | **New** — Go/Modify/Bail card |
| `src/components/share/cards/ReadinessFlexCard.tsx` | **New** — share card template (today's readiness) |
| `src/components/share/cards/ComebackCard.tsx` | **New** — auto-fires on +20 jump |
| `src/components/share/cards/FightWeekFormCard.tsx` | **New** — 7d-before-fight peaking proof |
| `src/components/fightcamp/BalanceMetricsCard.tsx` | **Delete** |
| `src/components/fightcamp/ReadinessBreakdownCard.tsx` | **Replace** with compact `DriverRow` stack (logic-only refactor) |
| `src/components/fightcamp/WeeklyLoadPlan.tsx` | **Move** into Load pillar drill-down (no UI change to the component itself) |
| `src/components/fightcamp/StrainChart.tsx` | **Keep**, used inside Load pillar drill-down |

### 6.3 Hero card spec

```
╔══════════════════════════════════╗
║ TODAY'S CALL · 06:42       [?]   ║
║                                  ║
║          ┌──────┐                ║
║          │  72  │ ▲ 4            ║   ← AnimatedNumber, 72px SF Pro bold tabular-nums
║          └──────┘                ║       Delta = today vs 7d avg readiness
║          GREEN                   ║   ← tier label, color-tinted, 11px uppercase
║                                  ║
║   "You're locked in — push."     ║   ← verdict, 18px semibold, tier-toned
║                                  ║
║  ▸ ACTION                        ║   ← NEW, 10px uppercase tracker
║    60-min hard sparring + lift   ║   ← 15px semibold, action-line generation
║                                  ║       (see §6.4)
║  ──────────────────────────────  ║
║  Recovery  Body  Load            ║   ← 10px uppercase labels
║    82      74    68              ║   ← 22px tabular-nums, tap-to-jump
║   ▃▅▇    ▂▄▆   ▇▆▅              ║   ← 7d MiniSparkline, tier-tinted
╚══════════════════════════════════╝
```

Card border-top: 2px tier-colored line (no flooding). Subtle radial highlight at top (10% opacity blurred).

### 6.4 ACTION line generation

Deterministic — no LLM in v1. Lookup table keyed by `(readinessTier, campPhase, daysSinceLastHardSession)`:

```ts
// src/utils/performanceEngine/actionLine.ts (new)

export function generateActionLine({
  readinessScore, campPhase, daysSinceLastHardSession, sessionsLast7d,
}: {
  readinessScore: number;
  campPhase: CampPhase;
  daysSinceLastHardSession: number;
  sessionsLast7d: number;
}): string {
  if (readinessScore < 35) return 'Full rest. Walk + sauna only.';
  if (readinessScore < 55) {
    if (campPhase === 'peak') return 'Light skill only — protect peak.';
    return 'Z2 60 min + mobility. No contact.';
  }
  if (readinessScore < 80) {
    if (daysSinceLastHardSession >= 3) return 'Hard session OK — keep RPE ≤ 8.';
    return 'Moderate session. Cap rounds at 4.';
  }
  if (campPhase === 'taper') return 'Sharp work only — short, fast, clean.';
  return 'Full sparring + strength.';
}
```

### 6.5 Gas Tank component

```tsx
// src/components/fightcamp/GasTankBar.tsx

interface Props {
  fillPct: number;        // 0..1, derived from readiness/100
  tone: 'green' | 'amber' | 'red';
  oneLiner: string;       // "Two more hard days drops you to red."
}
```

Visual:
- Horizontal bar, 16px tall, rounded ends
- Outer: boxing-glove laceup styling (subtle stitched border + 4 lace eyelets per side, SVG)
- Inner fill: tier-colored gradient
- Below: `oneLiner` in 12px muted text

Animations:
- Fill width animates from 0 → `fillPct` over 700ms on mount (cubic-ease)
- At `fillPct < 0.25`: lace eyelets get a 4-frame tremor (rotate 0 → 1° → -1° → 0°) every 6s
- `prefers-reduced-motion` disables tremor

### 6.6 Pillar accordion

One pillar open at a time. Pattern matches existing `ExpandableMetricCard` but standalone component.

```
┌─ RECOVERY ─────────────────── 82 ▲ ┐
│  ▃▅▆▇▇▆▇  last 7 days              │
│                                    │
│  "Solid restorative week."         │   ← what-this-means, score-band copy
│                                    │
│  ─ Drilldown ────────────────────  │
│   Sleep        7h12m   ▲ 0:18      │
│   Sleep score  84      ▲ 6         │
│   Rest days    2 / 7               │
│   Hydration    On track            │
│                                    │
│  [3-night sleep trend chart]       │
└────────────────────────────────────┘
```

Pillar drill-downs (what each accordion expanded panel contains):

- **Recovery** — last night + 3-night avg sleep, sleep score, rest days last 7, hydration status, mini sleep-trend bar chart (SleepSparkline already exists)
- **Body** — Hooper sub-scores (sleep quality, stress, fatigue, soreness rating), 7d soreness trend, hydration chip, caloric-deficit chip (conditional)
- **Load** — EWMA acute vs chronic, ACWR ratio + band, Foster monotony + weekly strain, contact load (rounds + zone), camp phase pill, StrainChart (existing)

### 6.7 Driver row (Why · 4 drivers)

Stack of 4 collapsible rows under hero. Default collapsed showing label + one-liner + delta arrow:

```
●●●  Sleep            Solid sleep        ▲
●●   How you feel     Dialled in         –
●    Soreness         Mild stiffness     ▼
●●●  Training load    Hard week          ▲
```

Tap row to expand: shows 0–100 score + 7d sparkline + 1-sentence "why this is X."

The `●●●` glyphs indicate driver weight in the current model (3 dots = top contributor, 1 = minor) — gives users intuition for which drivers matter most.

### 6.8 Empty state

```
╔══════════════════════════════════╗
║ FIRST READ                       ║
║                                  ║
║          ─ ─                     ║
║       Tap below                  ║
║                                  ║
║  We learn your body in 7 days.   ║
║  Check in daily — get your call. ║
║                                  ║
║  [ START 60-SEC CHECK-IN  → ]    ║
╚══════════════════════════════════╝

3 PILLARS
[Recovery] [Body] [Load]
 unlock     unlock unlock
```

### 6.9 Motion & micro-interactions

- **Hero number count-up** — keep existing `AnimatedNumber`
- **Pillar mini-scores fade-in** — stagger 60ms each
- **Streak confetti** — keep at existing milestones
- **NEW: Breath pulse on big number** — when readiness ≥ 80, 4s scale 1 → 1.015 → 1 loop. Reduced-motion disables.
- **NEW: Warning shimmer** — on day-over-day drop > 15, the tier badge gets a single amber gradient sweep (1.2s, once on mount).
- **NEW: Gas tank tremor** — see §6.5.
- **NEW: Long-press the big number** — opens a tooltip with raw components (`HRV · RHR · Sleep · Strain · Hooper`).
- **NEW: Tap mini-score in hero** → smooth scroll to pillar accordion, auto-expand that pillar.

---

## 7. AI Pro Surfaces (new)

### 7.1 Camp Compass — Sunday weekly report

**Position:** top of Recovery page Sun 8pm → Tue 8pm (48h pin), then collapses to a tappable "Last week's report" link.

**Free user state:**
- Locked card with amber border + lock icon
- Title "Your Sunday Report is ready"
- Blurred preview with 3 redacted header bullets
- CTA "Unlock — $9.99/mo"

**Pro user state:**
- Full report card. Structure:
  - **Verdict** — one sentence ("Mid-camp surge week, paid for it Thursday")
  - **Where you broke down** — single weakest pillar with receipts ("Slept <6h Tue/Wed → readiness dropped 18pt before Thursday sparring")
  - **Next 7 days play** — 3 dated actions ("Skip Tue AM run", "Push lifting to Wed", "In bed by 22:30 Thu")
  - **Camp arc** — if in camp ("Week 3 of 8 — load tracking 12% above last camp at this point")
- 90-second TTS audio brief (deferred — text-only v1; audio is v1.1)
- Tap → opens full sheet view with shareable Camp Report card preview

**Backend** (`convex/actions/recovery/campCompass.ts`):
```ts
export const generateWeeklyReport = action({
  args: { userId: v.id('users'), weekStartIso: v.string() },
  handler: async (ctx, { userId, weekStartIso }) => {
    // Gather: last 7d sessions, sleep, check-ins, baseline, prior 3 reports
    // Call Groq gpt-oss-120b with structured JSON output schema
    // Persist to `recoveryReports` table
    // Trigger push notification (existing notification infra)
  },
});
```

**Schema** (`convex/schema.ts` additive):
```ts
recoveryReports: defineTable({
  userId: v.id('users'),
  weekStartIso: v.string(),
  verdict: v.string(),
  breakdown: v.string(),       // "where you broke down" prose
  nextWeekActions: v.array(v.object({
    dayIso: v.string(),
    action: v.string(),
  })),
  campArc: v.optional(v.string()),
  rawMetrics: v.any(),         // snapshot for debug + future audio gen
  createdAt: v.number(),
}).index('by_user_week', ['userId', 'weekStartIso']),
```

**Cron** (`convex/crons.ts` addition):
```ts
crons.weekly('camp-compass-sunday',
  { dayOfWeek: 'sunday', hourUTC: 20, minuteUTC: 0 },
  internal.recovery.campCompass.runWeeklyForAllProUsers,
);
```

Also: trigger manually after weigh-in or fight completion.

**Model + cost:** `gpt-oss-120b`, ~$0.008/report × 4/mo = $0.03/user/mo.

### 7.2 Pre-Session Green Light

**Surface:** appears as a card directly above the hero (replacing the streak chip slot) when the user has a calendared training session within 2h. Tap → opens sheet.

**Free user state:**
- Locked card: "Pads at 18:00. Open the Green Light?" + lock icon + "Unlock with Pro"
- Sees only their readiness number, no recommendation

**Pro user state:**
- Verdict pill: 🟢 Go / 🟡 Modify / 🔴 Bail
- Specific modification text (e.g., "Cap rounds at 4. No live grappling. Hydrate 500ml now.")
- Generated from: today's wellness, last night's sleep, 7d load, the calendared session's type + duration

**Backend** (`convex/actions/recovery/preSessionBrief.ts`):
```ts
export const generateBrief = action({
  args: {
    userId: v.id('users'),
    plannedSession: v.object({
      sessionType: v.string(),
      durationMinutes: v.number(),
      scheduledAtMs: v.number(),
    }),
  },
  handler: async (ctx, args) => { /* llama-3.1-8b-instant, ~300ms */ },
});
```

Cached for 30 min via `AIPersistence` keyed on `(userId, sessionDateIso)` so re-opens are free.

**Model + cost:** `llama-3.1-8b-instant`, ~$0.0003/use × ~20/mo = $0.006/user/mo.

### 7.3 Shareable Cards (3 new templates)

All extend the existing `src/components/share/cards/` system with `CardShell` + `useRoundCardCapture`.

#### a) `ReadinessFlexCard`
- **Trigger:** user tap "Flex today" button (only visible when readiness ≥ 85)
- **Content:** date + day, big readiness number, 3 pillar mini-bars, optional one-line caption ("Sparring tonight." / "Pads at 7." / custom)
- **Free:** 1/week with watermark
- **Pro:** unlimited, no watermark

#### b) `ComebackCard`
- **Trigger:** auto-toast when current readiness ≥ score 48h ago + 20 (i.e., `delta48h >= 20`)
- **Content:** "COMEBACK" header, old score → new score with arrow, count of protocols completed (rest days + check-ins + sleep targets hit), caption
- **Free:** 1/month
- **Pro:** unlimited

#### c) `FightWeekFormCard`
- **Trigger:** auto-toast 7 days before a logged fight date
- **Content:** "FIGHT WEEK · 6 DAYS OUT" header, 5-day readiness bar chart (Mon–Fri leading in), "PEAKING ON SCHEDULE" / "FORM CURVE BUILDING" status line, opponent handle + fight date if available
- **Free:** generated, share with watermark
- **Pro:** generated, no watermark, plus a "preview opponent's potential reaction" mode (placeholder for future)

### 7.4 Pro gating summary

| Surface | Free | Pro |
|---|---|---|
| Hero + 3 pillars + Gas Tank + drivers | ✅ Full | ✅ Full |
| Daily check-in | ✅ Unlimited | ✅ Unlimited |
| 28-day history + all sparklines | ✅ Full | ✅ Full |
| Recovery Coach Chat (existing) | 1 msg/day | Unlimited |
| **Camp Compass Sunday Report** | Blurred preview only | ✅ Full + audio (v1.1) |
| **Pre-Session Green Light** | Locked teaser | ✅ 2/day |
| **ReadinessFlexCard** | 1/week + watermark | ✅ Unlimited, no watermark |
| **ComebackCard** | 1/month | ✅ Unlimited |
| **FightWeekFormCard** | Watermarked | ✅ No watermark |
| **Body Battery Alerts** (Gas Tank ≤ 25%) | — | ✅ Opt-in push |

Recovery page itself never paywalls. The page is the funnel.

---

## 8. Build order

Frontend-only items ship first. AI features and crons ship as a second wave.

### Phase 1 — Algorithm + page redesign (no new AI)
1. `src/lib/sessionTypes.ts` — new taxonomy single source of truth
2. `src/utils/performanceEngine/load.ts` — EWMA-ACWR, sport weights, CNS multiplier, Foster monotony/strain, contact load
3. `src/utils/performanceEngine/calibration.ts` — camp-phase awareness
4. `src/utils/performanceEngine/pillars.ts` — pillar derivation
5. `src/utils/performanceEngine/actionLine.ts` — action-line generator
6. `convex/schema.ts` — additive: `rounds` column on `fight_camp_calendar`, `recoveryReports` table
7. Unit tests for new load math (extend `performanceEngine.test.ts`)
8. Backfill helper + one-time toast (`recovery-model-v2-acked:<userId>`)
9. `src/pages/TrainingCalendar.tsx` — grouped session-type picker, rounds input
10. `src/components/fightcamp/GasTankBar.tsx`
11. `src/components/fightcamp/DriverRow.tsx`
12. `src/components/fightcamp/RecoveryPillarAccordion.tsx`
13. `src/components/fightcamp/RecoveryDashboard.tsx` — rewrite to assemble new layout
14. Delete `BalanceMetricsCard.tsx`; refactor `ReadinessBreakdownCard.tsx` → driver stack
15. Empty state redesign

### Phase 2 — AI Pro surfaces
16. `convex/actions/recovery/campCompass.ts` + cron
17. `src/components/fightcamp/CampCompassCard.tsx` (free + pro states)
18. `convex/actions/recovery/preSessionBrief.ts`
19. `src/components/fightcamp/PreSessionGreenLight.tsx` + calendar trigger detection
20. `src/components/share/cards/ReadinessFlexCard.tsx`
21. `src/components/share/cards/ComebackCard.tsx`
22. `src/components/share/cards/FightWeekFormCard.tsx`
23. Auto-trigger logic (toast on +20 delta, scheduled toast 7d pre-fight)

### Phase 3 — Push alerts (separate ship)
24. Body Battery Alerts opt-in
25. Convex cron + APN payload integration

---

## 9. Risks & open questions

1. **Backfill cost** — recomputing 28d of history for every existing user is O(users × 28). Probably fine, but should run as a background Convex action with batched updates, not in-line on first page load.
2. **Camp phase trigger** — depends on user having a logged fight date in `fight_camps`. For users without one, all phase-aware logic falls back to "off-camp" thresholds (no behavior change). Acceptable.
3. **`rounds` schema** — adding `v.optional(v.number())` is non-breaking, but the rounds input UX may confuse users who don't think in rounds (e.g., wrestling). Default 5 + tooltip "Number of contact rounds (skip if N/A)."
4. **TTS for Camp Compass audio** — defer to v1.1. Text-only v1 to ship faster.
5. **Free-tier share card watermark** — design needs a watermark that doesn't ruin the card. Discuss with design pass.
6. **Action line lookup table coverage** — 4×4 grid of (readiness tier × camp phase) = 16 entries. Will need a copy review pass before ship.
7. **Existing `WeeklyLoadPlan` component** — currently standalone. Moving it inside Load pillar drill-down is mechanical, but verify no other consumers.
8. **Confidence-gated pillar (Load)** — when hidden, hero pillar row shows 2 of 3. Layout must handle this cleanly (CSS `grid-cols-3` with `null` rendering as a dimmed placeholder labeled "Building…").

---

## 10. Out of scope (explicit non-goals for this spec)

- HRV / RHR ingestion changes (existing HealthKit tier system unchanged)
- Identity / archetype layer (WARLORD/DIALED) — number-driven only
- Gym leaderboard or community feed integration of readiness
- Coach-mode dashboards
- Mat Talk voice journal feature (deferred to separate spec)
- Bruise Cam / Body Map (deferred)
- Sparring Tape Tax (deferred — separate flagship feature spec)
- TTS audio for Camp Compass (v1.1)

---

## 11. Open follow-ups for implementation plan

When this spec is approved, the implementation plan should:
- Define the exact unit-test surface for each new load math function
- Spell out the backfill job's batching strategy and progress reporting
- Map every existing `ExpandableMetricCard` usage to its new home (deletion / fold-in / keep)
- List every legacy `session_type` string we want to detect for normalization at load time
- Specify the exact lock-card copy + paywall handoff for each of the 3 new Pro surfaces
- Define the action-line lookup table in full (all 16 cells)
- Specify the toast text + dismiss flow for the model-v2 migration
