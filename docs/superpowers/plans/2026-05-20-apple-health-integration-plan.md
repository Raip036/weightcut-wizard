# Apple Health Integration — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-20-apple-health-integration-design.md` (read first)
**Strategy:** 4 parallel sub-agents with strict file-ownership boundaries, followed by a wiring pass.

---

## Agent boundaries (no overlapping writes)

### Agent A — "plugin"
Owns the native edge.

**Writes:**
- `package.json` (add `@perfood/capacitor-healthkit` — verify Cap 8 compatibility; fallback `cordova-plugin-health` if needed)
- `ios/App/App/Info.plist` (add `NSHealthShareUsageDescription`)
- `ios/App/Podfile` (no manual edits; `npx cap sync` regenerates)
- `capacitor.config.ts` (no edits expected; document if needed)
- `src/services/healthKit.ts` (NEW) — typed wrapper exposing:
  - `isAvailable(): Promise<boolean>`
  - `requestPermissions(metrics: HealthMetric[]): Promise<PermissionResult>`
  - `checkAuthorization(metrics: HealthMetric[]): Promise<AuthorizationStatus[]>`
  - `readSamples(metric, since, until): Promise<RawSample[]>`
  - `syncSinceLastSync(lastSyncAt): Promise<RawSample[]>` (orchestrates all metric reads)
  - `enableBackgroundDelivery(): Promise<void>`
  - `openHealthSettings(): Promise<void>` (deep-link for revoked permissions)
- `src/services/healthKit.types.ts` (NEW) — shared types (`HealthMetric`, `RawSample`, `Tier`).

**Reads (does not write):**
- Convex `health.insertSamples` mutation signature from spec §5.1 — Agent A calls it via the generated client.

**Hand-off contract:**
- `RawSample` shape must be: `{ externalId, metric, value, unit, startedAt, endedAt, device }` — matches Agent B's `health_samples` row.

---

### Agent B — "backend"
Owns Convex schema + ingestion + rollup + baselines.

**Writes:**
- `convex/schema.ts` (additions per spec §5.1, §5.2 — append-only, do NOT modify existing table defs)
- `convex/health.ts` (NEW):
  - `insertSamples` mutation (batch, idempotent on `externalId`)
  - `listDailySummary` query (last N days for current user)
  - `getTier` query (returns `profile.healthDataTier` + per-metric availability)
  - `setHealthKitConnected` mutation (called from client after successful permission)
  - `recordPromptShown` mutation (for onboarding skip tracking)
  - Internal: `rollupDaily` action (debounced after insert + cron 04:00 local)
  - Internal: `computeBaselines` action (cron 04:30 local)
  - Internal: `reclassifyTier` helper
- `convex/crons.ts` (additions for daily roll-up + baseline cron — append cron entries)
- `convex/deleteAccountMutations.ts` (add wipes for `health_samples`, `daily_health_summary`, `health_baselines`)

**Reads (does not write):**
- `convex/_shared/...` if helpers exist there.
- Spec §10 for edge cases (idempotency, dedup, source priority).

**Hand-off contract:**
- Generated API path: `api.health.insertSamples`, `api.health.listDailySummary`, `api.health.getTier`, `api.health.setHealthKitConnected`, `api.health.recordPromptShown`.

---

### Agent C — "engine"
Owns the Fight Form Score extension.

**Writes:**
- `src/scoring/types.ts` (extend with `HealthSignal` + `HealthSignals` interfaces per spec §7.1)
- `src/scoring/config/` (add `healthWeights` block to `CURRENT_CONFIG`)
- `src/scoring/subScores/recovery.ts` (modify to consume HealthSignals; redistribute weights when null; export `confidence`)
- `src/scoring/compose.ts` (thread `healthSignals` from input to recovery sub-score; expose `recoveryConfidence` on the result)
- `convex/fightFormScore_internal.ts` (extend `fetchScoringInputs` to read from `daily_health_summary` and `health_baselines`; build `HealthSignals` object)

**Reads (does not write):**
- Existing `src/scoring/subScores/*` to understand the established pattern.
- Spec §5.1, §5.2, §7.

**Hand-off contract:**
- `computeFightFormScore` continues to accept the existing input shape with an optional `healthSignals` field — null/missing means "no HealthKit data" and the existing self-report path is used.
- New `result.subScores.recovery.confidence: number` (0..1) must be present in returned scores.

---

### Agent D — "ui"
Owns all new visible surfaces.

**Writes:**
- `src/components/health/ConnectAppleHealthSheet.tsx` (NEW) — the explainer + permission trigger. Calls `healthKit.requestPermissions` and `api.health.setHealthKitConnected`.
- `src/components/health/HealthSettingsCard.tsx` (NEW) — settings entry showing connection state, granted metrics, last sync, disconnect instructions, "Open Health app" deep-link.
- `src/components/health/HealthTilesPanel.tsx` (NEW) — Recovery page tiles (HRV vs baseline, RHR vs baseline, sleep, wrist temp).
- `src/components/health/MorningCheckInPrompt.tsx` (NEW) — banner for Tier 0/1 that opens existing `WellnessCheckIn.tsx`.
- `src/components/onboarding/wizard/ConnectHealthStep.tsx` (NEW) — wizard step wrapping the explainer sheet.
- `src/pages/Profile.tsx` (modify) — slot in `HealthSettingsCard`. Insert in the existing card list; do NOT restructure the page.
- `src/pages/Recovery.tsx` (modify) — render `HealthTilesPanel` when tier !== "tier_0" else `MorningCheckInPrompt`. Wrap with existing skeleton/loading patterns.
- `src/pages/Onboarding.tsx` (modify) — insert `<ConnectHealthStep />` between training-frequency and the existing post-training step. Use the existing wizard step pattern; do NOT refactor the wizard.

**Reads (does not write):**
- `src/services/healthKit.ts` interface (Agent A) — call signatures only.
- `api.health.*` (Agent B) — query / mutation names only.
- `src/components/fightcamp/WellnessCheckIn.tsx` for re-use.

**Hand-off contract:**
- All new components are self-contained — UI agent owns its own loading / empty / error states.

---

## Sequence

1. **Phase 1 (parallel)** — dispatch Agents A, B, C, D in **one message** using background-mode Agent calls. Each gets the spec path and the boundary list above.
2. **Phase 2 (sequential — me)** — once all 4 return, do the wiring pass: resolve any conflicting changes, run `npx convex codegen`, run `npm run build`, run `npm run lint`. Report.
3. **Phase 3 (deferred — user)** — user reviews diffs and commits. User runs `npx cap sync ios` and tests on device.

## Acceptance criteria

- `npm run build` passes.
- `npm run lint` has no new errors.
- Type-checker resolves — every Convex API path is present in `_generated/api.d.ts`.
- iOS Info.plist has the usage description string.
- Onboarding wizard shows new step (verified by reading code path, not running).
- Recovery page renders `HealthTilesPanel` when mock tier="tier_2", `MorningCheckInPrompt` when tier="tier_0".
- All 14 edge cases in spec §10 have a code path or a TODO comment with rationale.

## What we explicitly skip

- `npx cap sync` (user runs this on their dev machine when ready).
- Pod install / Xcode build.
- Pushing to git / opening a PR (user controls commits).
- Live HealthKit testing on device (simulator can't generate HRV/sleep).
