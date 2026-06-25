/**
 * Profile queries + mutations.
 *
 * `profiles` is a 1:1 extension of the Convex Auth `users` table, keyed by
 * `userId: v.id("users")`. Auth runtime sees `userId` first (via
 * `requireUserId`), then looks up the matching profile row.
 *
 * Surface mirrors the Supabase calls in `UserContext.tsx`,
 * `useWeightData.ts`, etc., but values are returned in snake_case to match
 * the existing `ProfileData` interface — saves a refactor across ~80
 * call-sites that read `profile.current_weight_kg` and the like.
 */
import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
} from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { Doc } from "./_generated/dataModel";

// ───────────────────────────────────────────────────────────────────────
// Shape helper — convert the Convex row (camelCase) into the snake_case
// payload the React app currently consumes. Keeping a single mapper means
// any new profile column lands in one place.
//
// `avatarUrl` is resolved from `avatarStorageId` (Convex File Storage) by
// the caller and threaded in as a parameter so this helper stays sync.
// ───────────────────────────────────────────────────────────────────────
function toClientShape(
  row: Doc<"profiles"> | null,
  avatarUrl: string | null = null,
) {
  if (!row) return null;
  return {
    id: row.userId, // legacy callers use `profile.id` as the userId
    user_id: row.userId,
    age: row.age,
    sex: row.sex,
    height_cm: row.heightCm,
    current_weight_kg: row.currentWeightKg,
    goal_weight_kg: row.goalWeightKg,
    target_date: row.targetDate,
    activity_level: row.activityLevel,
    goal_type: row.goalType,
    role: row.role,
    bmr: row.bmr,
    tdee: row.tdee,
    body_fat_pct: row.bodyFatPct,
    fight_week_target_kg: row.fightWeekTargetKg,
    normal_daily_carbs_g: row.normalDailyCarbsG,
    ai_recommended_calories: row.aiRecommendedCalories,
    ai_recommended_protein_g: row.aiRecommendedProteinG,
    ai_recommended_carbs_g: row.aiRecommendedCarbsG,
    ai_recommended_fats_g: row.aiRecommendedFatsG,
    ai_recommendations_updated_at: row.aiRecommendationsUpdatedAt,
    manual_nutrition_override: row.manualNutritionOverride,
    cut_plan_json: row.cutPlanJson,
    athlete_type: row.athleteType,
    weigh_in_timing: row.weighInTiming,
    avatar_url: avatarUrl,
    display_name: row.displayName,
    experience_level: row.experienceLevel,
    food_budget: row.foodBudget,
    plan_aggressiveness: row.planAggressiveness,
    primary_struggle: row.primaryStruggle,
    sleep_hours: row.sleepHours,
    training_frequency: row.trainingFrequency,
    training_types: row.trainingTypes,
    subscription_tier: row.subscriptionTier,
    subscription_expires_at: row.subscriptionExpiresAt
      ? new Date(row.subscriptionExpiresAt).toISOString()
      : null,
    subscription_updated_at: row.subscriptionUpdatedAt,
    revenuecat_customer_id: row.revenuecatCustomerId,
    welcome_pro_shown_at: row.welcomeProShownAt,
    pro_ended_pending_at: row.proEndedPendingAt,
    pro_ended_shown_at: row.proEndedShownAt,
    onboarding_tutorial_shown_at: row.onboardingTutorialShownAt,
    onboarding_paywall_shown_at: row.onboardingPaywallShownAt,
    updated_at: row.updatedAt,
    is_premium:
      row.subscriptionTier !== "free" &&
      row.subscriptionTier !== undefined &&
      (!row.subscriptionExpiresAt || row.subscriptionExpiresAt > Date.now()),
  };
}

async function findByUser(ctx: any, userId: any) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
}

// ───────────────────────────────────────────────────────────────────────
// QUERIES
// ───────────────────────────────────────────────────────────────────────

/** Authoritative "who am I" — used by UserContext on every mount. */
export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    const avatarUrl = row?.avatarStorageId
      ? await ctx.storage.getUrl(row.avatarStorageId)
      : null;
    return toClientShape(row, avatarUrl);
  },
});

/**
 * One-time "Welcome to Pro" cutscene gate (compare-and-set).
 *
 * Sets `welcomeProShownAt` to now ONLY if it's currently unset, and reports
 * whether THIS call was the one that set it. The client plays the cutscene
 * only when `firstTime` is true, so it fires exactly once per genuine upgrade
 * — never on restore, a returning device, or a reinstall (those already carry
 * the timestamp), and the server is the authoritative "have we celebrated?"
 * across devices. The RC EXPIRATION webhook clears it so a real re-subscribe
 * after a lapse re-arms exactly once.
 */
export const markWelcomeProShown = mutation({
  args: {},
  handler: async (ctx): Promise<{ firstTime: boolean }> => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    if (!row) return { firstTime: false };
    if (row.welcomeProShownAt != null) return { firstTime: false };
    await ctx.db.patch(row._id, { welcomeProShownAt: Date.now() });
    return { firstTime: true };
  },
});

/**
 * One-time "Pro ended" cutscene gate (compare-and-set) — the inverse of
 * `markWelcomeProShown`.
 *
 * Fires keyed to `proEndedPendingAt` (the timestamp of the lapse the RC
 * EXPIRATION webhook armed). Stamps `proEndedShownAt` to now ONLY when there is
 * a pending lapse the cutscene hasn't been shown for yet, and reports whether
 * THIS call was the one that set it. The client plays the farewell cutscene
 * only when `firstTime` is true, so it fires exactly once per genuine lapse —
 * a later lapse (new `proEndedPendingAt` > the prior `proEndedShownAt`) re-arms
 * and re-fires exactly once. Stamping on show (not dismiss) means a force-quit
 * mid-cutscene won't replay it, and Convex serializable isolation makes the
 * compare-and-set safe across concurrent devices.
 */
export const markProEndedShown = mutation({
  args: {},
  handler: async (ctx): Promise<{ firstTime: boolean }> => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    if (!row) return { firstTime: false };
    const pending = row.proEndedPendingAt;
    if (pending == null) return { firstTime: false };
    if (row.proEndedShownAt != null && row.proEndedShownAt >= pending) {
      return { firstTime: false };
    }
    await ctx.db.patch(row._id, { proEndedShownAt: Date.now() });
    return { firstTime: true };
  },
});

/**
 * One-time new-user tutorial gate (compare-and-set).
 *
 * Stamps `onboardingTutorialShownAt` to now ONLY if currently unset, and reports
 * whether THIS call was the one that set it. The tutorial auto-runs only when
 * `firstTime` is true, so it fires exactly once per account — server-authoritative
 * so it can't be wrongly suppressed for a new account on a device that already
 * ran the tutorial for a previous account, nor re-fire across devices/reinstalls.
 */
export const markOnboardingTutorialShown = mutation({
  args: {},
  handler: async (ctx): Promise<{ firstTime: boolean }> => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    if (!row) return { firstTime: false };
    if (row.onboardingTutorialShownAt != null) return { firstTime: false };
    await ctx.db.patch(row._id, { onboardingTutorialShownAt: Date.now() });
    return { firstTime: true };
  },
});

/**
 * One-time post-onboarding soft-paywall gate (compare-and-set).
 *
 * Stamps `onboardingPaywallShownAt` to now ONLY if currently unset, and reports
 * whether THIS call was the one that set it. The soft paywall (shown when a free
 * user closes /cut-plan after reviewing their free starter plan) fires exactly
 * once per account — server-authoritative so it never re-shows across devices or
 * reinstalls. Stamping on show (not on purchase) means a dismiss still spends the
 * one shot, so we never nag.
 */
export const markOnboardingPaywallShown = mutation({
  args: {},
  handler: async (ctx): Promise<{ firstTime: boolean }> => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    if (!row) return { firstTime: false };
    if (row.onboardingPaywallShownAt != null) return { firstTime: false };
    await ctx.db.patch(row._id, { onboardingPaywallShownAt: Date.now() });
    return { firstTime: true };
  },
});

/**
 * Returns the calling user's auth-table fields (email, _creationTime).
 * Useful for the Settings dialog which needs to display the email + the
 * account-created date.
 */
export const getMyAuthUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      id: userId,
      email: (user as any).email ?? null,
      name: (user as any).name ?? null,
      createdAt: user._creationTime,
    };
  },
});

/**
 * Standalone query for just the avatar URL. Useful for narrow consumers
 * (e.g. compact avatars) that don't need the full profile payload. Returns
 * null if no avatar uploaded.
 */
export const getAvatarUrl = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    if (!row?.avatarStorageId) return null;
    return await ctx.storage.getUrl(row.avatarStorageId);
  },
});

/**
 * Public-ish profile view for the Corner tab.
 *
 * Visibility rules (intentional — keeps profile existence private):
 *  - Self → always visible.
 *  - Same-gym viewer (both active in at least one shared gym) → visible.
 *  - Anyone else → returns `null`. We don't 403 because the Corner UI may
 *    deep-link a profile from a share card; a hard error would leak the
 *    "this user exists" signal we don't want to broadcast.
 *
 * Stats are computed conservatively from existing tables (no new denorm):
 *  - `sessionsLogged` → `fight_camp_calendar` rows for the user. Capped at
 *    500 via `.take(500)` so a chatty user with thousands of historical
 *    sessions can't blow up the per-query read budget. The cap is exposed
 *    to the client as-is (501+ users will display "500+").
 *  - `campsCompleted` → `fight_camps` rows with `isCompleted === true`.
 *  - `kgCutTotal` → sum of (startingWeightKg − endWeightKg) across
 *    completed camps. Camps missing either field contribute 0 — never NaN.
 *
 * Gym block is the viewer-facing identity for "where does this person
 * train". Pulled from the user's active `gym_members` row via the
 * `by_user_status` index (one indexed point-lookup); if the user has no
 * active membership the `gymId` / `gymName` come back as `null` and
 * `sameGym` is `false`.
 */
export const getByUserId = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId: targetUserId }) => {
    const viewerId = await requireUserId(ctx);
    const isSelf = viewerId === targetUserId;

    // Resolve target's active gym (the user's "home" gym for v1 — multi-gym
    // plumbing exists but the Corner UI shows a single primary gym).
    const targetMembership = await ctx.db
      .query("gym_members")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", targetUserId).eq("status", "active"),
      )
      .first();

    // Same-gym check via the viewer's active memberships. We collect all of
    // the viewer's active rows (typically 1, never more than a handful) and
    // probe each against the target via the `by_gym_user` index.
    let sameGym = false;
    if (!isSelf) {
      const viewerGyms = await ctx.db
        .query("gym_members")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", viewerId).eq("status", "active"),
        )
        .collect();
      for (const vg of viewerGyms) {
        const peer = await ctx.db
          .query("gym_members")
          .withIndex("by_gym_user", (q) =>
            q.eq("gymId", vg.gymId).eq("userId", targetUserId),
          )
          .unique();
        if (peer && peer.status === "active") {
          sameGym = true;
          break;
        }
      }
      // Hide existence from non-peers — privacy-preserving null.
      if (!sameGym) {
        return null;
      }
    }

    const profile = await findByUser(ctx, targetUserId);
    if (!profile) return null;

    // Resolve gym name (single doc read; cheap). Falls back to null when
    // the user is not currently in any active gym.
    const gym = targetMembership ? await ctx.db.get(targetMembership.gymId) : null;
    const avatarUrl = profile.avatarStorageId
      ? await ctx.storage.getUrl(profile.avatarStorageId)
      : null;

    // ── Stats ────────────────────────────────────────────────────────────
    // `take(500)` is the hard ceiling — bounds the worst-case read cost at
    // 500 docs for a power-user. The number is reported back as-is, the
    // client decides whether to render "500+" or the raw count.
    const sessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", targetUserId))
      .take(500);
    const sessionsLogged = sessions.length;

    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId))
      .collect();
    let campsCompleted = 0;
    let kgCutTotal = 0;
    for (const c of camps) {
      if (c.isCompleted === true) {
        campsCompleted += 1;
        const start = typeof c.startingWeightKg === "number" ? c.startingWeightKg : null;
        const end = typeof c.endWeightKg === "number" ? c.endWeightKg : null;
        // Only count camps with BOTH endpoints — partial data would inflate
        // / deflate the total in either direction. Defaults to 0 contribution.
        if (start !== null && end !== null) {
          const delta = start - end;
          // Guard against negative deltas (rare data-entry typos where end
          // > start) so the public stat never reads as "−2.3 kg cut".
          if (delta > 0) kgCutTotal += delta;
        }
      }
    }
    // Round to 1 decimal so the UI doesn't have to deal with float crud.
    kgCutTotal = Math.round(kgCutTotal * 10) / 10;

    return {
      userId: targetUserId,
      displayName: profile.displayName ?? "Athlete",
      avatarUrl,
      role: profile.role,
      gymId: targetMembership?.gymId ?? null,
      gymName: gym?.name ?? null,
      sameGym: isSelf ? true : sameGym,
      stats: {
        sessionsLogged,
        kgCutTotal,
        campsCompleted,
      },
    };
  },
});

/** Cut plan (potentially large JSONB) — separated so callers that don't
 *  need it can avoid pulling it on every profile read. */
export const getCutPlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await findByUser(ctx, userId);
    return row?.cutPlanJson ?? null;
  },
});

// ───────────────────────────────────────────────────────────────────────
// MUTATIONS
// ───────────────────────────────────────────────────────────────────────

/** Idempotent: invoked from auth.createOrUpdateUser callback. If a row
 *  already exists this is a no-op; otherwise creates a placeholder with
 *  zero defaults that the onboarding flow overwrites. */
export const ensureExists = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (existing) return existing._id;
    return await ctx.db.insert("profiles", {
      userId,
      age: 0,
      sex: "",
      heightCm: 0,
      currentWeightKg: 0,
      goalWeightKg: 0,
      targetDate: "",
      activityLevel: "",
      goalType: "",
      role: "fighter",
      subscriptionTier: "free",
    });
  },
});

export const updateCurrentWeight = mutation({
  args: { weightKg: v.number() },
  handler: async (ctx, { weightKg }) => {
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");
    await ctx.db.patch(existing._id, {
      currentWeightKg: weightKg,
      updatedAt: Date.now(),
    });
  },
});

export const setUserName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => {
    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 30) {
      throw new Error("Display name must be 2–30 characters.");
    }
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");
    await ctx.db.patch(existing._id, {
      displayName: trimmed,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Step 1 of the avatar-upload flow: ask Convex for a one-time POST URL that
 * the client streams the image bytes to. The returned URL is signed and
 * short-lived — once consumed the client receives a `storageId` to pass to
 * `setAvatar` below.
 *
 * Auth-gated so anonymous callers can't burn through upload-URL quota.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2 of the avatar-upload flow: persist the freshly uploaded
 * `storageId` on the profile row. Deletes any previous avatar storage
 * BEFORE patching the new id so a race-condition that aborts mid-write
 * doesn't orphan the old file forever. Pass `storageId: null` to clear.
 */
export const setAvatar = mutation({
  args: {
    storageId: v.union(v.id("_storage"), v.null()),
  },
  handler: async (ctx, { storageId }) => {
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");

    // Best-effort cleanup of the previous storage object. If it's already
    // gone (deleted out-of-band, double-write race) the call throws — we
    // swallow it because the patch below is the source of truth.
    if (existing.avatarStorageId && existing.avatarStorageId !== storageId) {
      try {
        await ctx.storage.delete(existing.avatarStorageId);
      } catch {
        /* prior file already missing — ignore */
      }
    }

    await ctx.db.patch(existing._id, {
      avatarStorageId: storageId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setRole = mutation({
  args: {
    role: v.union(v.literal("fighter"), v.literal("coach")),
  },
  handler: async (ctx, { role }) => {
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");
    await ctx.db.patch(existing._id, { role, updatedAt: Date.now() });
  },
});

/** Onboarding / Goals page — broad patch supporting any of the goal-related
 *  fields. Each is optional; only the ones provided are written. */
export const updateGoals = mutation({
  args: {
    age: v.optional(v.number()),
    sex: v.optional(v.string()),
    heightCm: v.optional(v.number()),
    currentWeightKg: v.optional(v.number()),
    goalWeightKg: v.optional(v.number()),
    fightWeekTargetKg: v.optional(v.number()),
    targetDate: v.optional(v.string()),
    activityLevel: v.optional(v.string()),
    goalType: v.optional(v.string()),
    trainingFrequency: v.optional(v.number()),
    trainingTypes: v.optional(v.array(v.string())),
    athleteType: v.optional(v.string()),
    // "day_before" | "same_day" — drives the cut-strategy branch in
    // generateCutPlan. Optional; existing callers are unaffected.
    weighInTiming: v.optional(v.string()),
    experienceLevel: v.optional(v.string()),
    planAggressiveness: v.optional(v.string()),
    primaryStruggle: v.optional(v.string()),
    sleepHours: v.optional(v.string()),
    foodBudget: v.optional(v.string()),
    bmr: v.optional(v.number()),
    tdee: v.optional(v.number()),
    bodyFatPct: v.optional(v.number()),
    aiRecommendedCalories: v.optional(v.number()),
    aiRecommendedProteinG: v.optional(v.number()),
    aiRecommendedCarbsG: v.optional(v.number()),
    aiRecommendedFatsG: v.optional(v.number()),
    aiRecommendationsUpdatedAt: v.optional(v.number()),
    manualNutritionOverride: v.optional(v.boolean()),
    normalDailyCarbsG: v.optional(v.number()),
    cutPlanJson: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");
    // Strip undefined keys so `ctx.db.patch` doesn't overwrite with undefined.
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(args)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(existing._id, patch as any);
  },
});

// ───────────────────────────────────────────────────────────────────────
// (Gem deduction / ad-reward / spend / daily-free-gem mutations removed.
// AI access is now controlled solely by tier via
// `convex/_shared/featureGates.ts`. See the gems-and-ads removal refactor.)
// ───────────────────────────────────────────────────────────────────────

/**
 * Reset all tracking data for the current user — keeps `profiles` row + fight
 * camps + auth, but wipes meals, weight/hydration/sleep logs, fight week data,
 * chat history, plans, etc.
 */
export const resetTrackingData = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const drop = async (table: string, indexName: string) => {
      const rows = await ctx.db
        .query(table as any)
        .withIndex(indexName as any, (q: any) => q.eq("userId", userId))
        .collect();
      await Promise.all(rows.map((r: any) => ctx.db.delete(r._id)));
    };
    // meals → meal_items cascade.
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect();
    for (const m of meals) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      await Promise.all(items.map((i) => ctx.db.delete(i._id)));
      await ctx.db.delete(m._id);
    }
    await drop("hydration_logs", "by_user_date");
    await drop("weight_logs", "by_user_date");
    await drop("chat_messages", "by_user");
    await drop("user_dietary_preferences", "by_user");
    await drop("meal_plans", "by_user");
    await drop("fight_week_plans", "by_user");
    await drop("fight_week_logs", "by_user_date");
  },
});

/** Apple IAP / RevenueCat client-side activation. Called by an authenticated
 *  user immediately after a successful purchase to flip their tier locally
 *  while the RevenueCat webhook catches up. Idempotent.
 *
 *  Out-of-order guard: if the server already knows about a *later* renewal
 *  (existing.subscriptionExpiresAt > incoming) and the existing tier is not
 *  "free", we keep the server's expiry — the client RevenueCat snapshot is
 *  stale and we don't want to downgrade a user with a fresher renewal on
 *  file. The tier from the client is still honoured (it never flips you
 *  to "free"; the webhook does that). */
/**
 * INTERNAL — only callable from `convex/actions/activatePremium.ts` AFTER
 * the action has verified the user's entitlement against the RevenueCat
 * REST API, or from the RC webhook handler. There is no client-trusted
 * tier/expiry surface anymore.
 *
 * The previous PUBLIC `activatePremium` mutation accepted client-supplied
 * `tier` + `expiresAt` and was a forgeable write path. It has been
 * removed. Any client code path that needs to flip premium must go
 * through `api.actions.activatePremium.run` (no args; verifies with RC
 * server-side every time).
 */
export const activatePremiumVerified = internalMutation({
  args: {
    userId: v.id("users"),
    tier: v.union(
      v.literal("premium_lifetime"),
      v.literal("premium_annual"),
      v.literal("premium_monthly"),
    ),
    /** Epoch ms expiry, or `undefined` for lifetime. */
    expiresAtMs: v.optional(v.number()),
  },
  handler: async (ctx, { userId, tier, expiresAtMs }) => {
    const existing = await findByUser(ctx, userId);
    if (!existing) throw new Error("Profile not found");

    // Lifetime guard — RC says they paid for lifetime; a later RC reply
    // changing them to monthly/annual must not silently downgrade.
    if (existing.subscriptionTier === "premium_lifetime" && tier !== "premium_lifetime") {
      console.info("[activatePremiumVerified] refusing to downgrade lifetime user", {
        userId,
        incomingTier: tier,
      });
      await ctx.db.patch(existing._id, {
        subscriptionUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return {
        tier: existing.subscriptionTier,
        expiresAt: existing.subscriptionExpiresAt
          ? new Date(existing.subscriptionExpiresAt).toISOString()
          : null,
        skipped: "lifetime-preserved" as const,
      };
    }

    // Out-of-order guard — if we already hold a LATER expiry on file for a
    // paid tier, RC's response is a stale snapshot and we keep the server
    // value rather than shortening the user's premium window.
    let effectiveTier: string = tier;
    let effectiveExpiresAtMs = expiresAtMs;
    if (
      existing.subscriptionExpiresAt &&
      expiresAtMs &&
      expiresAtMs < existing.subscriptionExpiresAt &&
      existing.subscriptionTier &&
      existing.subscriptionTier !== "free"
    ) {
      console.info("[activatePremiumVerified] ignoring stale RC snapshot", {
        userId,
        incomingTier: tier,
        incomingExpiresAtMs: expiresAtMs,
        existingTier: existing.subscriptionTier,
        existingExpiresAtMs: existing.subscriptionExpiresAt,
      });
      effectiveTier = existing.subscriptionTier;
      effectiveExpiresAtMs = existing.subscriptionExpiresAt;
    }

    // Bounded-expiry guard (F1). A non-lifetime tier MUST resolve to a
    // finite, future expiry. If we'd otherwise persist a non-lifetime tier
    // with a null/undefined/expired expiry, fall back to "free" + clear the
    // expiry rather than minting "Pro forever, free". Lifetime is exempt.
    const isLifetime = effectiveTier === "premium_lifetime";
    const now = Date.now();
    const hasFiniteFutureExpiry =
      typeof effectiveExpiresAtMs === "number" && effectiveExpiresAtMs > now;
    if (!isLifetime && !hasFiniteFutureExpiry) {
      console.warn(
        "[activatePremiumVerified] non-lifetime tier without finite future expiry — refusing to grant Pro, downgrading to free",
        {
          userId,
          tier: effectiveTier,
          expiresAtMs: effectiveExpiresAtMs,
        },
      );
      await ctx.db.patch(existing._id, {
        subscriptionTier: "free",
        subscriptionExpiresAt: undefined,
        subscriptionUpdatedAt: now,
        updatedAt: now,
      });
      return { tier: "free", expiresAt: null };
    }

    const patch: Partial<Doc<"profiles">> = {
      subscriptionTier: effectiveTier,
      subscriptionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
      // Granting a paid tier clears the "Pro ended" cutscene flags so the
      // reconcile cron re-granting a missed-renewal user can't trigger a false
      // "ended" fire. We never ARM pending here — only the genuine RC
      // EXPIRATION lapse does that.
      proEndedPendingAt: undefined,
      proEndedShownAt: undefined,
      ...(effectiveExpiresAtMs !== undefined
        ? { subscriptionExpiresAt: effectiveExpiresAtMs }
        : {}),
    };
    await ctx.db.patch(existing._id, patch);
    return {
      tier: effectiveTier,
      expiresAt:
        effectiveExpiresAtMs !== undefined
          ? new Date(effectiveExpiresAtMs).toISOString()
          : null,
    };
  },
});

/** Internal variant used by the RevenueCat webhook (no auth context — the
 *  webhook is verified by its shared-secret header). Looks up the profile
 *  by `userId` (RevenueCat is configured with our Convex users._id as the
 *  `app_user_id`).
 *
 *  Hardening rules:
 *   - Idempotent: replaying the same event (`eventId`) is a no-op — we record
 *     every processed event in `revenuecat_webhook_events` and skip on a
 *     repeat (F3).
 *   - Event-timestamp ordering: an event strictly OLDER than the newest
 *     event we've already processed for this user is ignored, so a replayed
 *     CANCELLATION can't clobber a newer RENEWAL (F3). EXPIRATION is exempt —
 *     it stays authoritative and always clears.
 *   - Out-of-order expiry guard: a stale webhook carrying an `expirationAtMs`
 *     older than what we already have on file MUST NOT downgrade the user.
 *     Applies to RENEWAL / UNCANCELLATION / PRODUCT_CHANGE / CANCELLATION.
 *     EXPIRATION is allowed to clear regardless — that's the canonical
 *     "subscription is over" signal.
 *   - Bounded-expiry guard (F1): never persist a non-lifetime tier without a
 *     finite future expiry. A write that would do so falls back to "free".
 *   - Never set `subscriptionExpiresAt` to `undefined` unless we mean to
 *     wipe it (only EXPIRATION wipes it).
 *   - CANCELLATION / PRODUCT_CHANGE keep the tier untouched and, if no fresh
 *     expiry arrives, keep the existing stored expiry rather than leaving the
 *     tier unbounded (F5). BILLING_ISSUE is a grace period — touch nothing.
 *   - Unknown event types are logged via `console.info` and treated as a
 *     no-op so we can spot new RevenueCat events without breaking.
 *
 *  `eventId` / `eventTimestampMs` are OPTIONAL so existing callers/tests that
 *  predate the ledger still typecheck; `http.ts` always supplies them. */
export const updateSubscriptionFromRevenueCat = internalMutation({
  args: {
    appUserId: v.string(),
    eventType: v.string(),
    productId: v.optional(v.string()),
    expirationAtMs: v.optional(v.number()),
    /** RevenueCat unique event id — dedupe key for idempotent replay. */
    eventId: v.optional(v.string()),
    /** RevenueCat `event_timestamp_ms` — used for per-user ordering. */
    eventTimestampMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { appUserId, eventType, productId, expirationAtMs, eventId, eventTimestampMs },
  ) => {
    // ── Idempotency (F3) ─────────────────────────────────────────────────
    // If we've already recorded this exact event id, replaying it is a
    // no-op. This runs BEFORE the profile lookup so a replay against a
    // since-deleted user is still cheaply absorbed.
    if (eventId) {
      const seen = await ctx.db
        .query("revenuecat_webhook_events")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique();
      if (seen) {
        return { ok: true, skipped: "duplicate" as const };
      }
    }

    // RevenueCat's app_user_id is the Convex `users._id` we configured at
    // login. Look up the profile by that user id.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", appUserId as any))
      .unique();
    if (!profile) return { ok: false, reason: "profile-not-found" as const };

    // ── Ordering (F3) ────────────────────────────────────────────────────
    // Ignore events strictly older than the newest event we've already
    // processed for this user — prevents a replayed/late CANCELLATION from
    // clobbering a newer RENEWAL. EXPIRATION stays authoritative (it must be
    // able to clear regardless of ordering), matching the existing
    // stale-expiry exemption below.
    if (typeof eventTimestampMs === "number" && eventType !== "EXPIRATION") {
      const priorEvents = await ctx.db
        .query("revenuecat_webhook_events")
        .withIndex("by_user", (q) => q.eq("appUserId", appUserId))
        .collect();
      let newestProcessedMs = -Infinity;
      for (const ev of priorEvents) {
        if (typeof ev.eventTimestampMs === "number" && ev.eventTimestampMs > newestProcessedMs) {
          newestProcessedMs = ev.eventTimestampMs;
        }
      }
      if (newestProcessedMs > eventTimestampMs) {
        console.info("[revenuecat-webhook] ignoring out-of-order event", {
          appUserId,
          eventType,
          eventTimestampMs,
          newestProcessedMs,
        });
        await recordWebhookEvent(ctx, {
          eventId,
          eventType,
          appUserId,
          eventTimestampMs,
          outcome: "out-of-order",
        });
        return { ok: true, skipped: "out-of-order" as const };
      }
    }

    const tierFromProduct = (pid?: string): string => {
      if (!pid) {
        // Fall back to current tier so we don't accidentally flip to a
        // wrong product. If the user was already free we promote to
        // monthly as a sensible default.
        return profile.subscriptionTier && profile.subscriptionTier !== "free"
          ? profile.subscriptionTier
          : "premium_monthly";
      }
      if (pid.includes("lifetime")) return "premium_lifetime";
      if (pid.includes("yearly") || pid.includes("annual")) {
        return "premium_annual";
      }
      if (pid.includes("monthly")) return "premium_monthly";
      return "premium_monthly";
    };

    // Out-of-order guard. RevenueCat doesn't guarantee delivery order, so a
    // late RENEWAL/CANCELLATION/etc. with an older expiry than the one we
    // already hold should be ignored for the expiry field. EXPIRATION is
    // explicitly exempt — that event means the sub is over and we always
    // honour it.
    const isStaleExpiry =
      !!profile.subscriptionExpiresAt &&
      typeof expirationAtMs === "number" &&
      expirationAtMs < profile.subscriptionExpiresAt &&
      eventType !== "EXPIRATION";

    if (isStaleExpiry) {
      console.info(
        "[revenuecat-webhook] ignoring stale event",
        {
          appUserId,
          eventType,
          incomingExpiresAtMs: expirationAtMs,
          existingExpiresAtMs: profile.subscriptionExpiresAt,
        },
      );
      // Still bump `subscriptionUpdatedAt` so we have a record we saw the
      // event, but DO NOT touch tier or expiresAt.
      await ctx.db.patch(profile._id, {
        revenuecatCustomerId: appUserId,
        subscriptionUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await recordWebhookEvent(ctx, {
        eventId,
        eventType,
        appUserId,
        eventTimestampMs,
        outcome: "stale-expiry",
      });
      return { ok: true, skipped: "stale-expiry" as const };
    }

    const patch: Record<string, unknown> = {
      revenuecatCustomerId: appUserId,
      subscriptionUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    };

    let outcome = "applied";
    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION":
        patch.subscriptionTier = tierFromProduct(productId);
        // Only write expiry when RevenueCat actually supplied one. Don't
        // wipe an existing expiry with undefined on a malformed event.
        if (typeof expirationAtMs === "number") {
          patch.subscriptionExpiresAt = expirationAtMs;
        }
        // Becoming (or again) Pro — clear the "Pro ended" cutscene flags so a
        // future lapse re-arms exactly once.
        patch.proEndedPendingAt = undefined;
        patch.proEndedShownAt = undefined;
        break;
      case "PRODUCT_CHANGE":
        // Monthly ↔ annual etc. Update the tier, but never leave it
        // unbounded (F5): if no fresh expiry arrives, keep the existing
        // stored expiry rather than nulling it. The bounded-expiry guard
        // below still demotes to free if there is no finite future expiry
        // at all.
        patch.subscriptionTier = tierFromProduct(productId);
        if (typeof expirationAtMs === "number") {
          patch.subscriptionExpiresAt = expirationAtMs;
        } else {
          console.warn(
            "[revenuecat-webhook] PRODUCT_CHANGE without expiry — keeping existing stored expiry",
            { appUserId, existingExpiresAtMs: profile.subscriptionExpiresAt },
          );
          // No expiry write → existing `subscriptionExpiresAt` is preserved.
        }
        break;
      case "EXPIRATION":
        patch.subscriptionTier = "free";
        patch.subscriptionExpiresAt = undefined;
        // Re-arm the one-time Pro welcome so a genuine re-subscribe after this
        // lapse celebrates again (a new purchase, not a restore).
        patch.welcomeProShownAt = undefined;
        // Arm the one-time "Pro ended" cutscene — but ONLY when the profile was
        // previously non-free, so a double EXPIRATION on an already-free profile
        // doesn't re-arm a lapse the user never had access for.
        if (profile.subscriptionTier && profile.subscriptionTier !== "free") {
          patch.proEndedPendingAt = eventTimestampMs ?? Date.now();
        }
        break;
      case "CANCELLATION":
        // User cancelled but keeps access until expiry — DO NOT change
        // tier. Only update the expiry if we got a fresh value; otherwise
        // keep the existing stored expiry (F5), never leaving it unbounded.
        if (typeof expirationAtMs === "number") {
          patch.subscriptionExpiresAt = expirationAtMs;
        } else {
          console.warn(
            "[revenuecat-webhook] CANCELLATION without expiry — keeping existing stored expiry",
            { appUserId, existingExpiresAtMs: profile.subscriptionExpiresAt },
          );
          // No expiry write → existing `subscriptionExpiresAt` is preserved.
        }
        break;
      case "BILLING_ISSUE":
        // Grace period — leave tier and expiry untouched.
        break;
      default:
        // Unknown event — log so we can spot RevenueCat additions early,
        // but don't mutate subscription state.
        console.info(
          "[revenuecat-webhook] unknown event type",
          { appUserId, eventType, productId },
        );
        outcome = "unknown-event";
        break;
    }

    // Bounded-expiry guard (F1). Compute the tier/expiry this write would
    // result in (the patch value if present, else what's already stored) and
    // refuse to leave a non-lifetime tier without a finite future expiry.
    const resultingTier =
      (patch.subscriptionTier as string | undefined) ?? profile.subscriptionTier;
    const resultingExpiry = Object.prototype.hasOwnProperty.call(
      patch,
      "subscriptionExpiresAt",
    )
      ? (patch.subscriptionExpiresAt as number | undefined)
      : profile.subscriptionExpiresAt;
    const isNonFree =
      typeof resultingTier === "string" &&
      resultingTier.length > 0 &&
      resultingTier !== "free";
    const isLifetime = resultingTier === "premium_lifetime";
    const now = Date.now();
    const hasFiniteFutureExpiry =
      typeof resultingExpiry === "number" && resultingExpiry > now;
    if (isNonFree && !isLifetime && !hasFiniteFutureExpiry) {
      console.warn(
        "[revenuecat-webhook] non-lifetime tier without finite future expiry — downgrading to free",
        { appUserId, eventType, resultingTier, resultingExpiry },
      );
      patch.subscriptionTier = "free";
      patch.subscriptionExpiresAt = undefined;
    }

    await ctx.db.patch(profile._id, patch as any);
    await recordWebhookEvent(ctx, {
      eventId,
      eventType,
      appUserId,
      eventTimestampMs,
      outcome,
    });
    return { ok: true };
  },
});

/**
 * Append a row to the RevenueCat webhook event ledger (F3). A no-op when no
 * `eventId` is supplied (legacy callers / tests that don't pass one) so
 * idempotency/ordering features degrade gracefully. Best-effort: a ledger
 * write failure must not roll back an already-applied subscription patch in
 * the same mutation, but since both run in the same transaction we simply
 * insert and let Convex handle atomicity.
 */
async function recordWebhookEvent(
  ctx: any,
  args: {
    eventId?: string;
    eventType: string;
    appUserId: string;
    eventTimestampMs?: number;
    outcome: string;
  },
): Promise<void> {
  if (!args.eventId) return;
  await ctx.db.insert("revenuecat_webhook_events", {
    eventId: args.eventId,
    eventType: args.eventType,
    appUserId: args.appUserId,
    eventTimestampMs: args.eventTimestampMs,
    receivedAt: Date.now(),
    outcome: args.outcome,
  });
}
