/**
 * Internal helpers for the weight-protocol pipeline (WP-T5).
 *
 * Three exports — all internal, only the protocol-generation actions and
 * the weight_logs post-write trigger ever call them:
 *
 *   • `gatherInputs`  – single-shot fetch of every slice the
 *                       `generateFightPlan` / `generateRehydrationProtocol`
 *                       actions need (profile, camp, weights/sessions/sleep/
 *                       wellness windows, prior camps). Shape mirrors
 *                       `GatheredInputs` from `convex/_shared/weightProtocolMath.ts`.
 *
 *   • `upsert`        – idempotent (userId, campId, kind) writer for
 *                       `weight_protocols`. Replaces the existing row when
 *                       present so a manual regen / drift-triggered regen
 *                       overwrites instead of accumulating duplicates.
 *
 *   • `maybeRegen`    – drift detector, scheduled 60s after every
 *                       `weight_logs` write. If the most recent log diverges
 *                       from today's plan target by >0.5 kg, enqueues an
 *                       action regen (bypassing the daily cap). Skipped
 *                       once the camp's weigh-in is past.
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md §5.3, §5.4.
 *
 * Pattern reference: `convex/recoveryReports.ts → gatherCampCompassInputs`
 * (same one-shot Promise.all fan-out, same upsert-by-index shape).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────
// 1. gatherInputs — fan-out fetch for protocol generation actions
// ───────────────────────────────────────────────────────────────────────

/**
 * One-shot fetch for the protocol-generation pipeline. Returns a payload
 * compatible with `GatheredInputs` (see `convex/_shared/weightProtocolMath.ts`).
 *
 * Schema notes (where the spec's `camp` shape comes from):
 *   - `fightDate` lives directly on `fight_camps`.
 *   - `weighInDate` / `weighInTime` / `targetWeightKg` are NOT on `fight_camps`
 *     — they live on the matching `fight_week_plans` row (joined via
 *     `fightCampId`). We resolve the plan here and synthesise the `camp`
 *     shape the math module expects.
 *   - If no matching `fight_week_plans` row exists yet, `targetWeightKg`
 *     falls back to the profile's `goalWeightKg`, and `weighInDate` falls
 *     back to `fightDate` (the morning-of weigh-in case).
 *
 * Lookback windows mirror the spec:
 *   - weights: 28 days  (covers trend + ramp)
 *   - sessions / sleep: 7 days  (recent training load + sleep debt signal)
 *   - wellness: 14 days  (Hooper baseline horizon)
 *   - priorCamps: completed only, excluding the current one
 */
export const gatherInputs = internalQuery({
  args: { userId: v.id("users"), campId: v.id("fight_camps") },
  handler: async (ctx, { userId, campId }) => {
    const today = new Date().toISOString().slice(0, 10);
    const t28 = isoDaysAgo(28);
    const t14 = isoDaysAgo(14);
    const t7 = isoDaysAgo(7);

    const [
      profile,
      camp,
      weights28d,
      sessions7d,
      sleep7d,
      wellness14d,
      priorCamps,
      fightWeekPlans,
    ] = await Promise.all([
      ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
      ctx.db.get(campId),
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", t28),
        )
        .collect(),
      ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", t7),
        )
        .collect(),
      ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", t7),
        )
        .collect(),
      ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", t14),
        )
        .collect(),
      // Prior camps: completed only, exclude the current one. No partial
      // index in Convex — we filter post-fetch via .filter().
      ctx.db
        .query("fight_camps")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) =>
          q.and(
            q.eq(q.field("isCompleted"), true),
            q.neq(q.field("_id"), campId),
          ),
        )
        .collect(),
      // Target weight + weigh-in date live on `fight_week_plans` (no
      // `fightCampId` index — pull all rows for this user and pick the
      // one tied to this camp). One-row-per-camp is the dominant shape,
      // so this is bounded.
      ctx.db
        .query("fight_week_plans")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);

    if (!profile || !camp) {
      throw new Error("PROFILE_OR_CAMP_MISSING");
    }

    // Match the fight_week_plans row to this camp; fall back to the row
    // whose fightDate matches the camp's fightDate (covers plans created
    // before the camp linkage existed).
    const matchedPlan =
      fightWeekPlans.find((p) => p.fightCampId === campId) ??
      fightWeekPlans.find((p) => p.fightDate === camp.fightDate) ??
      null;

    return {
      profile: {
        age: profile.age,
        sex: profile.sex,
        heightCm: profile.heightCm,
        currentWeightKg: profile.currentWeightKg,
        tdee: profile.tdee ?? null,
      },
      camp: {
        fightDate: camp.fightDate,
        // `fight_camps` only stores `weighInTiming` (a free-form strategy
        // string like "morning_of" / "day_before"); the actual weigh-in
        // date is derived from the fight_week_plan row when present, else
        // we treat the fight date as the weigh-in date (worst-case
        // morning-of).
        weighInDate: matchedPlan?.fightDate ?? camp.fightDate,
        weighInTime: camp.weighInTiming ?? null,
        targetWeightKg:
          matchedPlan?.targetWeightKg ?? profile.goalWeightKg,
      },
      weights28d: weights28d.map((w) => ({
        date: w.date,
        weightKg: w.weightKg,
      })),
      sessions7d: sessions7d.map((s) => ({
        date: s.date,
        sessionType: s.sessionType,
        rpe: s.rpe,
        durationMinutes: s.durationMinutes,
      })),
      sleep7d: sleep7d.map((s) => ({ date: s.date, hours: s.hours })),
      wellness14d: wellness14d.map((w) => ({
        date: w.date,
        sorenessLevel: w.sorenessLevel,
        fatigueLevel: w.fatigueLevel,
        hooperIndex: w.hooperIndex,
      })),
      priorCamps: priorCamps.map((c) => ({
        startingWeightKg: c.startingWeightKg ?? null,
        endWeightKg: c.endWeightKg ?? null,
        weightViaDehydration: c.weightViaDehydration ?? null,
      })),
      today,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// 2. upsert — idempotent (userId, campId, kind) writer
// ───────────────────────────────────────────────────────────────────────

/**
 * Upsert a protocol row keyed on (userId, campId, kind). Re-runs (manual
 * regen, drift-triggered regen, scheduled regen) overwrite the existing
 * row rather than accumulating duplicates. `payload` is `v.any()` because
 * the precise shape is validated by a Zod schema in the calling action
 * (FightPlan / RehydrationProtocol).
 */
export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    campId: v.id("fight_camps"),
    kind: v.union(v.literal("fight_plan"), v.literal("rehydration")),
    payload: v.any(),
    derivedSnapshot: v.any(),
    approach: v.optional(v.string()),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weight_protocols")
      .withIndex("by_user_camp_kind", (q) =>
        q
          .eq("userId", args.userId)
          .eq("campId", args.campId)
          .eq("kind", args.kind),
      )
      .unique();

    const row = { ...args, createdAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("weight_protocols", row);
  },
});

// ───────────────────────────────────────────────────────────────────────
// 3. maybeRegen — drift detector, called from weight_logs post-write trigger
// ───────────────────────────────────────────────────────────────────────

/**
 * Drift check + regen-scheduler. Called 60s after a `weight_logs` write
 * (debounced by the trigger).
 *
 * Logic (5 steps):
 *   1. Pull the most recent weight log for the user.
 *   2. Pull the current `fight_plan` protocol for (user, camp). No plan → no-op.
 *   3. Find today's expected weight inside the plan payload. Missing → no-op.
 *   4. If |actual − target| ≤ 0.5 kg → no-op (within tolerance).
 *   5. If today is past the camp's weigh-in → no-op (lock window). Else
 *      schedule the regen action (bypasses the daily cap).
 *
 * NOTE: `internal.actions.generateFightPlan.runInternal` does not yet
 * exist (it's defined by WP-T6). To keep this file shippable ahead of
 * T6, we ship the trigger-scheduling step as a `console.log` stub. Once
 * T6 lands, swap the stub for the commented-out `ctx.scheduler.runAfter`
 * call below.
 */
export const maybeRegen = internalMutation({
  args: { userId: v.id("users"), campId: v.id("fight_camps") },
  handler: async (ctx, { userId, campId }) => {
    // 1. Latest weight log (any date — we want the freshest write).
    const latest = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!latest) return;

    // 2. Current fight_plan protocol — drift only matters if one exists.
    const fightPlan = await ctx.db
      .query("weight_protocols")
      .withIndex("by_user_camp_kind", (q) =>
        q
          .eq("userId", userId)
          .eq("campId", campId)
          .eq("kind", "fight_plan"),
      )
      .unique();
    if (!fightPlan) return;

    // 3. Find today's planned target weight.
    const today = new Date().toISOString().slice(0, 10);
    const days =
      (fightPlan.payload as { days?: Array<{ dayIso: string; targetWeightKg?: number | null }> })
        ?.days ?? [];
    const todayDay = days.find((d) => d.dayIso === today);
    if (!todayDay?.targetWeightKg) return;

    // 4. Drift tolerance — only act on > 0.5kg divergence.
    const drift = Math.abs(latest.weightKg - todayDay.targetWeightKg);
    if (drift <= 0.5) return;

    // 5. Lock window — once we're past the camp's weigh-in, no regens.
    const camp = await ctx.db.get(campId);
    if (!camp) return;
    // The weigh-in date is stored on the matching fight_week_plans row;
    // fall back to the camp's fightDate when no plan exists yet.
    const fightWeekPlans = await ctx.db
      .query("fight_week_plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const matchedPlan =
      fightWeekPlans.find((p) => p.fightCampId === campId) ??
      fightWeekPlans.find((p) => p.fightDate === camp.fightDate) ??
      null;
    const weighInIso = matchedPlan?.fightDate ?? camp.fightDate;
    const weighInTs = Date.parse(weighInIso);
    if (Number.isFinite(weighInTs) && Date.now() > weighInTs) return;

    // 6. Schedule the regen action. Bypasses the daily cap because this
    // path is system-initiated (no user button press). `approach` is
    // stored as a free-form string on the row; coerce back to the union
    // and default to `standard` if anything unexpected lands here.
    const storedApproach = fightPlan.approach;
    const approach: "gradual" | "standard" | "aggressive" =
      storedApproach === "gradual" ||
      storedApproach === "standard" ||
      storedApproach === "aggressive"
        ? storedApproach
        : "standard";
    await ctx.scheduler.runAfter(
      0,
      internal.actions.generateFightPlan.runInternal,
      { userId, campId, approach },
    );
  },
});
