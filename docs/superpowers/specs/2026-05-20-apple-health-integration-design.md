# Apple Health Integration — Design Spec

**Date:** 2026-05-20
**Owner:** Pratik
**Status:** Approved (user confirmed all four key decisions)

---

## 1. Goal

Read measured health signals (HRV, sleep, resting heart rate, workouts, body composition, wrist temperature, VO2Max) from Apple HealthKit and feed them into the existing **Fight Form Score** so recovery, readiness, and fight-camp coaching reflect *real* physiological state rather than self-reported guesses. Users without a watch / no HealthKit data must keep full functionality via the existing self-report `daily_wellness_checkins` flow.

## 2. Non-goals

- Android (Health Connect) — deferred to a follow-up; the abstraction below makes it a drop-in source later.
- Direct Whoop / Oura / Garmin API integrations — users sync those to Apple Health in their own apps; we read from HealthKit only.
- Writing data back to HealthKit. Read-only.
- Real-time HRV/HR streaming during a workout. Daily roll-up only for v1.

## 3. User-facing flow

### 3.1 First-time connection

Two entry points (user choice — picked "Onboarding + Settings"):

1. **Onboarding** — New step inserted into the existing wizard (`src/components/onboarding/wizard/`) directly after the training-frequency step. Card title: *"Connect Apple Health"*. Body explains what we read, why it matters, and that it's optional. Buttons: **Connect** (triggers HealthKit permission sheet) / **Skip for now**. Skipping marks `profile.healthKitPromptedAt` so we don't re-nag in the same onboarding.

2. **Settings** — New `HealthSettingsCard` rendered inside `src/pages/Profile.tsx` showing: connection state, last sync time, tier badge ("Watch connected" / "Phone only" / "Not connected"), per-metric availability list, **Disconnect** button (revokes locally; iOS doesn't let us programmatically revoke HealthKit, so we instruct the user to manage it from Settings → Health → Data Access).

### 3.2 Permission explanation screen

Before triggering the HealthKit permission sheet we show a full-screen explainer (`ConnectAppleHealthSheet`) listing every metric we'd like to read with a one-line "why" each:

| Metric | Why |
|--------|-----|
| Heart rate variability (HRV) | Best single signal for nervous-system recovery |
| Resting heart rate | Detects elevated baseline from poor recovery or illness |
| Sleep stages | Real sleep duration & quality, not bedtime estimates |
| Active workouts | Confirms training load vs. what you logged |
| Steps & active energy | Daily activity baseline |
| VO2 Max | Aerobic fitness trajectory across the camp |
| Wrist temperature | Early sickness / overtraining flag |
| Respiratory rate | Secondary recovery signal |
| Body mass | Reads weight from connected smart scales automatically |

Footer text: *"You can change these any time in iOS Settings → Health → Data Access → FightCamp."*

### 3.3 No-data / Tier 0 users

If `daily_health_summary` has fewer than 3 days of HRV in the last 14 days, the user is classified Tier 0 (or Tier 1 if some metrics exist but no HRV). The **MorningCheckInSheet** (re-uses existing `WellnessCheckIn.tsx`) becomes the daily input: sleep hours, soreness 1–10, energy 1–10, mood, stress. It's surfaced from:

- A small banner on the Recovery page ("Complete your morning check-in to update your recovery score").
- A push notification at the user's chosen morning time (later — uses existing `device_tokens` infra).

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  iOS (Capacitor)                                               │
│  ┌─────────────────────────┐    ┌────────────────────────┐     │
│  │ @perfood/capacitor-     │    │ src/services/          │     │
│  │ healthkit               │───▶│ healthKit.ts           │     │
│  │ (native plugin)         │    │ (typed wrapper +       │     │
│  └─────────────────────────┘    │  permission + tier     │     │
│                                 │  detection)            │     │
│                                 └───────────┬────────────┘     │
│                                             │ samples (JS)     │
└─────────────────────────────────────────────┼──────────────────┘
                                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Convex                                                        │
│  ┌─────────────────────────┐    ┌────────────────────────┐     │
│  │ health_samples          │◀───│ health.insertSamples   │     │
│  │ (raw, immutable)        │    │ mutation               │     │
│  └────────────┬────────────┘    └────────────────────────┘     │
│               │                                                │
│               ▼                                                │
│  ┌─────────────────────────┐    ┌────────────────────────┐     │
│  │ daily_health_summary    │◀───│ health.rollupDaily     │     │
│  │ (one row per user/day)  │    │ internalAction         │     │
│  └────────────┬────────────┘    │ (scheduled +           │     │
│               │                 │  triggered on insert)  │     │
│               │                 └────────────────────────┘     │
│               │                                                │
│               ▼                                                │
│  ┌─────────────────────────┐    ┌────────────────────────┐     │
│  │ health_baselines        │◀───│ health.computeBaselines│     │
│  │ (per-user 14d rolling)  │    │ internalAction         │     │
│  └────────────┬────────────┘    └────────────────────────┘     │
│               │                                                │
│               ▼                                                │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ fightFormScore_internal.fetchScoringInputs          │       │
│  │   ↓ now also includes healthSignals                 │       │
│  │ src/scoring/compose.ts                              │       │
│  │   ↓ dynamic-weight redistribution if signals null   │       │
│  │ fight_form_scores                                   │       │
│  └─────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────┘
```

## 5. Data model

### 5.1 New tables (additions to `convex/schema.ts`)

```ts
health_samples: defineTable({
  userId: v.id("users"),
  metric: v.string(),         // "hrv_sdnn" | "resting_hr" | "sleep_total"
                              // | "sleep_deep" | "sleep_rem" | "sleep_core"
                              // | "workout_minutes" | "active_energy_kcal"
                              // | "steps" | "vo2_max" | "respiratory_rate"
                              // | "wrist_temp_delta" | "body_mass_kg"
  value: v.number(),
  unit: v.string(),           // canonical unit per metric
  startedAt: v.number(),      // epoch ms
  endedAt: v.number(),        // epoch ms (== startedAt for instantaneous)
  source: v.string(),         // "healthkit"
  device: v.optional(v.string()),  // "Apple Watch", "iPhone", "Whoop", etc.
  externalId: v.optional(v.string()), // HealthKit sample UUID — idempotency
})
  .index("by_user_metric_started", ["userId", "metric", "startedAt"])
  .index("by_external_id", ["externalId"]),

daily_health_summary: defineTable({
  userId: v.id("users"),
  date: v.string(),           // YYYY-MM-DD (user-local)
  // Recovery signals
  hrvAvgMs: v.optional(v.number()),
  restingHrBpm: v.optional(v.number()),
  // Sleep
  sleepMinutes: v.optional(v.number()),
  sleepDeepMinutes: v.optional(v.number()),
  sleepRemMinutes: v.optional(v.number()),
  sleepEfficiencyPct: v.optional(v.number()),
  // Load
  workoutMinutes: v.optional(v.number()),
  activeEnergyKcal: v.optional(v.number()),
  stepCount: v.optional(v.number()),
  // Health flags
  vo2Max: v.optional(v.number()),
  respiratoryRateAvg: v.optional(v.number()),
  wristTempDeltaC: v.optional(v.number()),
  bodyMassKg: v.optional(v.number()),
  // Provenance
  sourcesPresent: v.array(v.string()),  // ["Apple Watch", "iPhone", ...]
  computedAt: v.number(),
})
  .index("by_user_date", ["userId", "date"]),

health_baselines: defineTable({
  userId: v.id("users"),
  metric: v.string(),
  rolling14dMean: v.number(),
  rolling14dStdDev: v.number(),
  rolling7dMean: v.optional(v.number()),
  sampleCount: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_metric", ["userId", "metric"]),
```

### 5.2 `profiles` additions

```ts
healthKitConnectedAt: v.optional(v.number()),
healthKitPromptedAt: v.optional(v.number()),
healthKitDisabledAt: v.optional(v.number()),
healthDataTier: v.optional(v.string()),  // "tier_0" | "tier_1" | "tier_2"
healthLastSyncAt: v.optional(v.number()),
healthGrantedMetrics: v.optional(v.array(v.string())),
```

## 6. Sync strategy

- **On app foreground** (and after first connection): `healthKit.syncSinceLastSync()` fetches samples since `profile.healthLastSyncAt - 1h` (overlap to catch late-arriving watch data), de-duplicates by `externalId`, batches into `health.insertSamples` (chunks of 200).
- **Background delivery**: enable via the plugin's `backgroundDelivery` so iOS wakes the app briefly when new samples land. Same `syncSinceLastSync` path.
- **Daily roll-up**: `health.rollupDaily` runs after every insert batch (debounced to 30s) and again at 04:00 local time via the existing `crons.ts` schedule.
- **Baseline refresh**: `computeBaselines` runs at 04:30 daily and after roll-up of the previous day. 14-day rolling mean + stddev per metric.
- **Tier reclassification**: at the end of `computeBaselines`, set `profile.healthDataTier` based on sample counts in the last 14 days:
  - Tier 2: ≥ 7 days of HRV samples
  - Tier 1: HRV missing but ≥ 7 days of sleep OR workouts from HealthKit
  - Tier 0: < that threshold (or HealthKit disconnected)

## 7. Score engine integration

### 7.1 New input shape (additions to `src/scoring/types.ts`)

```ts
export interface HealthSignal {
  value: number | null;
  baseline: number | null;
  deviationZ: number | null;   // (value - mean) / stddev, clipped to [-3, 3]
  confidence: number;          // 0..1, drops if sample count < threshold
}

export interface HealthSignals {
  hrv: HealthSignal;
  restingHr: HealthSignal;
  sleepMinutes: HealthSignal;
  sleepEfficiency: HealthSignal;
  wristTempDelta: HealthSignal;   // already a deviation; baseline = 0
  vo2Max: HealthSignal;
}
```

### 7.2 Recovery subScore changes (`src/scoring/subScores/`)

The existing recovery sub-score takes wellness check-in + sleep_logs + training load. New version:

```
score = clamp(0..100, sum(weight_i * componentScore_i) / sum(weight_i))

components (each contributes if present):
  - HRV deviation     w = 0.40, score = 50 + 15 * (-deviationZ)  // negative z = HRV up = good
  - Sleep duration    w = 0.20, score = bell curve around 7.5h target
  - Sleep quality     w = 0.10, score = (deep + rem) / total * 200, clipped
  - Resting HR dev    w = 0.10, score = 50 + 15 * (-deviationZ)
  - Wrist temp dev    w = 0.05, score = 100 - 25 * |deltaC|
  - Self-report soreness    w = 0.10, score = (10 - soreness) * 10
  - Self-report energy      w = 0.05, score = energy * 10
```

**Dynamic redistribution**: if a component is null, its weight goes to 0 and the surviving weights renormalise. `confidence` is the sum-of-present-weights divided by total possible weight — exposed in the API so the UI can render a confidence chip.

### 7.3 Cold-start unchanged

The existing `calibrationProgress`/`coldStart.minDaysOfDataIn7d` gate stays. HealthKit samples count toward `daysWithAnyLog` so connected users unlock the score faster.

## 8. UI components

### 8.1 New components

- `src/components/health/ConnectAppleHealthSheet.tsx` — full-screen explainer + permission trigger. Used by onboarding step **and** settings.
- `src/components/health/HealthSettingsCard.tsx` — settings entry. Connection state + per-metric grants + last sync + disconnect instructions.
- `src/components/health/HealthTilesPanel.tsx` — Recovery page. Shows HRV vs baseline, RHR vs baseline, sleep duration + quality, wrist temp delta. Each tile shows current value, sparkline, and "+X% from baseline".
- `src/components/onboarding/wizard/ConnectHealthStep.tsx` — onboarding step that wraps `ConnectAppleHealthSheet` for the wizard flow.

### 8.2 Modified components

- `src/pages/Profile.tsx` — slot in `HealthSettingsCard`.
- `src/pages/Recovery.tsx` — render `HealthTilesPanel` when `tier !== "tier_0"`, otherwise prompt for morning check-in via existing `WellnessCheckIn.tsx`.
- `src/components/fightcamp/RecoveryDashboard.tsx` — accept `healthSignals` prop and surface confidence.
- `src/pages/Onboarding.tsx` — insert `<ConnectHealthStep />` between existing steps.

## 9. Permissions & privacy

- iOS `NSHealthShareUsageDescription` in `ios/App/App/Info.plist`: *"FightCamp uses your Apple Health data — HRV, resting heart rate, sleep, workouts, body weight, and recovery signals — to compute a personalised Fight Form score, surface recovery insights, and tailor your camp coaching. Data stays linked to your account and is never sold."*
- No `NSHealthUpdateUsageDescription` (we never write back).
- The Convex side stores raw samples and rollups under `userId`. Standard Convex auth scoping applies (every query is `requireUserId`).
- Disconnect flow does NOT delete `health_samples` rows — historic data stays so prior recovery scores remain reproducible. Re-connecting picks up from the latest sample timestamp.
- "Delete my data" path (existing `deleteAccountMutations.ts`) must also wipe `health_samples`, `daily_health_summary`, `health_baselines`. Spec note for Agent B.

## 10. Edge cases (each must be handled, not deferred)

1. **Permission denied on first ask.** Surface the permission row in Settings as "Denied". Show iOS deep-link instructions (`x-apple-health://`) since iOS won't show the system sheet a second time.
2. **Partial permission grant.** iOS lets users grant per-metric. Store granted set on `profile.healthGrantedMetrics`. Score engine handles missing metrics already (dynamic weights).
3. **No watch, iPhone only.** Steps + some sleep + sometimes RHR available; HRV missing. Drops user to Tier 1. UI shows "Connect a watch for HRV" upsell card on Recovery.
4. **Watch connected, no data yet.** First sync returns empty. UI shows "Syncing — your first scores will land tomorrow morning" rather than a broken empty state.
5. **Very late samples (Whoop sync 3 days later).** `syncSinceLastSync` overlap window catches this. Roll-up is idempotent on `(userId, date)` so re-running is safe.
6. **Duplicate samples from multiple sources** (Apple Watch + Whoop both writing HRV). Roll-up takes the highest-confidence source first (Apple Watch > Whoop > Oura > generic) and averages only within that source.
7. **User revokes permission later.** Background delivery fails silently; next foreground sync detects empty returns for 3+ days and downgrades tier. UI shows reconnect card.
8. **Wrist temperature on non-supporting devices** (Series 7 or earlier). Metric simply absent — handled by null-tolerant pipeline.
9. **Time-zone drift.** Use the user's current device TZ for date bucketing (HealthKit returns UTC ms). Stored `date` is the local YYYY-MM-DD. Edge: travelling user crossing midnight — accept a minor double-bucket; daily roll-up reconciles.
10. **Web build (non-Capacitor).** `healthKit.isAvailable()` returns false; settings card shows "Only available in the iOS app". Onboarding step renders a "Open in iOS app" placeholder.
11. **App update with revoked permissions.** On launch, `healthKit.checkAuthorization()` runs; if previously granted scopes now denied, tier recalculates and a banner offers re-grant.
12. **Sample volume blowup.** Heart-rate samples can be 10k+/day. We only ingest *daily summaries* of HR (RHR + average), not every sample. HRV is summarised to daily average. This caps row volume at ~14 rows/user/day across all metrics.
13. **Convex insert rate limits.** Batch inserts in chunks of 200, with `Promise.all` capped at 3 concurrent.
14. **Self-report and HealthKit both present.** Score engine prefers HealthKit (`hrv` from samples, `sleepMinutes` from samples). Self-report `soreness`/`energy` *augment* rather than replace.

## 11. Out of scope for v1 (tracked for follow-up)

- Android Health Connect — abstraction in `src/services/healthKit.ts` exposes generic `readSamples(metric, since)`; an Android sibling `healthConnect.ts` slots in later.
- Workout-level analytics (per-session HR zones). Daily roll-up only for v1.
- Apple Health background app refresh in BGProcessingTask form — using `enableBackgroundDelivery` from the plugin for v1.
- Aggregator (Terra/Rook) integration — only if we add Android coverage that needs Whoop/Garmin data not in Health Connect.

## 12. Open questions resolved

| Question | Decision |
|----------|----------|
| Entry point | Onboarding step **+** Settings card |
| Metric scope | Full set (10 metrics) |
| Tier 0 fallback | Self-report check-in (reuse `WellnessCheckIn.tsx`) |
| Implementation scope | Design + plan + full code via parallel agents |
| Plugin choice | `@perfood/capacitor-healthkit` — supports Cap 6+ and maintained. Fallback: write a thin native plugin if it doesn't compile against Cap 8. |
