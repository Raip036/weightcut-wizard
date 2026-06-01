import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Convex schema — ported from Supabase Postgres (Phase 1 of migration).
 *
 * Conventions:
 *  - Table names stay snake_case to match Postgres (less remapping during migration)
 *  - Column names converted to camelCase (Convex idiom)
 *  - `created_at` → dropped; use Convex's auto `_creationTime` (epoch ms)
 *  - `updated_at` → kept as `updatedAt: v.number()` because it has app-level semantics
 *  - `id` uuid PK → dropped; Convex auto-generates `_id` (Id<"tableName">)
 *  - `date` columns → kept as ISO strings (YYYY-MM-DD) for easier indexing
 *  - `timestamptz` columns → `v.number()` (epoch ms)
 *  - `profiles.userId` references the Convex Auth `users` table
 */
export default defineSchema({
  // ────────────────────────────────────────────────────────────────────
  // CONVEX AUTH TABLES (users, authSessions, authAccounts, etc.)
  // The `users` table here is the authoritative auth identity; `profiles`
  // (below) is a 1:1 application extension keyed by `userId: v.id("users")`.
  // ────────────────────────────────────────────────────────────────────
  ...authTables,

  // ────────────────────────────────────────────────────────────────────
  // AUTH / PROFILE
  // ────────────────────────────────────────────────────────────────────

  profiles: defineTable({
    userId: v.id("users"),
    // Onboarding / physiology
    age: v.number(),
    sex: v.string(),
    heightCm: v.number(),
    currentWeightKg: v.number(),
    goalWeightKg: v.number(),
    targetDate: v.string(), // ISO YYYY-MM-DD
    activityLevel: v.string(),
    goalType: v.string(),
    // CHECK ('fighter','coach'); kept as union for safety
    role: v.union(v.literal("fighter"), v.literal("coach")),

    // Derived / nutrition targets
    bmr: v.optional(v.number()),
    tdee: v.optional(v.number()),
    bodyFatPct: v.optional(v.number()),
    fightWeekTargetKg: v.optional(v.number()),
    normalDailyCarbsG: v.optional(v.number()),

    // AI recommendations (last-applied snapshot)
    aiRecommendedCalories: v.optional(v.number()),
    aiRecommendedProteinG: v.optional(v.number()),
    aiRecommendedCarbsG: v.optional(v.number()),
    aiRecommendedFatsG: v.optional(v.number()),
    aiRecommendationsUpdatedAt: v.optional(v.number()),
    manualNutritionOverride: v.optional(v.boolean()),

    // Plan storage — JSONB whose shape varies by feature
    cutPlanJson: v.optional(v.any()),

    // Onboarding v2 profile fields
    athleteType: v.optional(v.string()),
    // Convex Storage ID for the avatar image. Resolved to a long-lived URL
    // server-side via ctx.storage.getUrl() before sending to the client.
    avatarStorageId: v.optional(v.id("_storage")),
    displayName: v.optional(v.string()),
    experienceLevel: v.optional(v.string()),
    foodBudget: v.optional(v.string()),
    planAggressiveness: v.optional(v.string()),
    primaryStruggle: v.optional(v.string()),
    sleepHours: v.optional(v.string()),
    trainingFrequency: v.optional(v.number()),
    trainingTypes: v.optional(v.array(v.string())),

    // Subscription
    //
    // Gem/ad columns (`gems`, `lastFreeGemDate`, `adsWatchedToday`,
    // `adsWatchedDate`) were removed as part of the gems-and-ads removal
    // refactor. Convex tolerates extra fields on existing rows; no
    // backfill is required. New rows simply don't write them.
    subscriptionTier: v.string(),
    subscriptionExpiresAt: v.optional(v.number()),
    subscriptionUpdatedAt: v.optional(v.number()),
    revenuecatCustomerId: v.optional(v.string()),
    // Trial fields — populated only when the trial flow ships. Kept
    // optional so existing rows pass validation without a migration.
    trialStartedAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),
    // Legacy gem/ad columns — the gem system was ripped out, but
    // existing prod rows still carry these fields. Keep them as
    // `v.optional` so schema validation passes during the deploy
    // transition. Nothing writes them anymore. A future migration can
    // null them out and a follow-up release can drop the columns.
    gems: v.optional(v.number()),
    lastFreeGemDate: v.optional(v.string()),
    adsWatchedToday: v.optional(v.number()),
    adsWatchedDate: v.optional(v.string()),
    // Legacy field — used to drive a cross-deployment premium fallback that
    // was rolled back. Left as `v.optional` so existing rows with this field
    // still validate against the schema. Nothing currently writes to it.
    emailLower: v.optional(v.string()),

    // Drives the gym-feed engagement badge on the bottom nav. We compare
    // this to the `_creationTime` of likes/comments on the user's own
    // posts to compute "how many unseen interactions". One write per
    // feed-open is far cheaper than per-event seen-flag flipping.
    lastSeenEngagementAt: v.optional(v.number()),

    // Drives the activity-feed unread badge (bell icon). Updated when the
    // user opens the activity sheet. Items with `_creationTime` newer than
    // this are counted as unread in `feedActivity.unreadActivityCount`.
    lastActivitySeenAt: v.optional(v.number()),

    // ─── Apple HealthKit integration (spec §5.2) ───────────────────────
    // Epoch ms the user first granted HealthKit read permission (set by
    // `setHealthKitConnected`). `null` / missing = never connected.
    healthKitConnectedAt: v.optional(v.number()),
    // Epoch ms we last *showed* the Connect-Health onboarding/settings
    // sheet. Used to avoid re-prompting in the same onboarding flow when
    // the user explicitly tapped "Skip for now".
    healthKitPromptedAt: v.optional(v.number()),
    // Epoch ms the user disconnected (from our side — iOS won't let us
    // revoke the OS-level permission programmatically). Set by
    // `markDisconnected`; cleared on the next successful reconnect.
    healthKitDisabledAt: v.optional(v.number()),
    // Quality tier of the user's HealthKit signal. "tier_0" = no usable
    // data → fall back to self-report; "tier_1" = phone-only / partial;
    // "tier_2" = watch-connected with ≥ 7 days HRV in the last 14d.
    // Recomputed by `internal.health.computeBaselines`.
    healthDataTier: v.optional(v.string()),
    // Epoch ms of the most recent `insertSamples` call. Used by the
    // client to compute the next `syncSinceLastSync` window. Independent
    // of `healthKitConnectedAt` so a long pause doesn't downgrade the
    // connection state.
    healthLastSyncAt: v.optional(v.number()),
    // The set of HealthKit metric keys the user actually granted (iOS
    // supports per-metric grants). Drives the per-metric availability
    // chips in `HealthSettingsCard`. Empty array = nothing granted.
    healthGrantedMetrics: v.optional(v.array(v.string())),

    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_role", ["role"])
    // Lets the RevenueCat webhook fall back to the customer-id when
    // `app_user_id` doesn't resolve to a Convex `users._id` (e.g. RC
    // anonymous → authed alias during onboarding).
    .index("by_revenuecat_customer", ["revenuecatCustomerId"]),

  /**
   * RevenueCat webhook event ledger. Used purely for idempotency — we drop
   * any inbound event whose `eventId` we've already processed so the same
   * `INITIAL_PURCHASE` replay can't double-grant premium. The row records
   * the outcome so support can audit a missed/duplicate event without
   * trawling Convex logs.
   */
  revenuecat_webhook_events: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    appUserId: v.string(),
    receivedAt: v.number(),
    outcome: v.string(), // "applied" | "stale-expiry" | "profile-not-found" | "unknown-event" | "duplicate"
  }).index("by_event", ["eventId"]),

  // ────────────────────────────────────────────────────────────────────
  // DAILY LOGS
  // ────────────────────────────────────────────────────────────────────

  weight_logs: defineTable({
    userId: v.id("users"),
    date: v.string(),
    weightKg: v.number(),
  }).index("by_user_date", ["userId", "date"]),

  hydration_logs: defineTable({
    userId: v.id("users"),
    date: v.string(),
    amountMl: v.number(),
    sodiumMg: v.optional(v.number()),
    sweatLossPercent: v.optional(v.number()),
    trainingWeightPre: v.optional(v.number()),
    trainingWeightPost: v.optional(v.number()),
    notes: v.optional(v.string()),
  }).index("by_user_date", ["userId", "date"]),

  sleep_logs: defineTable({
    userId: v.id("users"),
    date: v.string(),
    hours: v.number(),
  }).index("by_user_date", ["userId", "date"]),

  // ────────────────────────────────────────────────────────────────────
  // NUTRITION V2
  // ────────────────────────────────────────────────────────────────────

  foods: defineTable({
    name: v.string(),
    brand: v.optional(v.string()),
    barcode: v.optional(v.string()),
    source: v.string(), // 'usda' | 'off' | 'user' | 'ai' — kept as string (free-form in DB)
    sourceRef: v.optional(v.string()),
    verified: v.boolean(),
    createdBy: v.optional(v.id("users")),
    defaultServingG: v.optional(v.number()),
    caloriesPer100g: v.number(),
    proteinPer100g: v.number(),
    carbsPer100g: v.number(),
    fatsPer100g: v.number(),
  })
    .index("by_barcode", ["barcode"])
    .index("by_source_ref", ["source", "sourceRef"])
    // Replaces the Postgres pg_trgm index on foods.name
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["source", "verified"],
    }),

  meals: defineTable({
    userId: v.id("users"),
    date: v.string(),
    mealType: v.string(),
    mealName: v.string(),
    isAiGenerated: v.boolean(),
    notes: v.optional(v.string()),
    // Optional Convex Storage ID for the photo taken via the AI meal scanner.
    // When present, `listWithTotals` resolves it to a URL (`photo_url`) so the
    // MealCard renders the photo where the macro donut normally lives.
    photoStorageId: v.optional(v.id("_storage")),
  })
    .index("by_user_date", ["userId", "date"])
    // by_user_created — _creationTime is appended automatically to every index
    .index("by_user_created", ["userId"]),

  meal_items: defineTable({
    mealId: v.id("meals"),
    foodId: v.optional(v.id("foods")),
    name: v.string(),
    position: v.number(),
    grams: v.number(),
    calories: v.number(),
    proteinG: v.number(),
    carbsG: v.number(),
    fatsG: v.number(),
  }).index("by_meal", ["mealId"]),

  /**
   * Idempotency receipts for `createMealWithItems`. The client generates a
   * `crypto.randomUUID()` per save attempt and ships it as `idempotencyKey`.
   * On the server, the mutation checks (userId, key) — if a receipt newer
   * than 24 h exists and its underlying meal is still alive, the duplicate
   * call short-circuits and returns the existing mealId instead of
   * inserting again. Protects against double-fire on flaky networks (two
   * taps before the in-flight lock propagates, or a retried POST under the
   * hood). Older receipts stay in the table; the `by_user_key` index keeps
   * lookups cheap regardless of size.
   */
  meal_idempotency_keys: defineTable({
    userId: v.id("users"),
    key: v.string(),
    mealId: v.id("meals"),
  }).index("by_user_key", ["userId", "key"]),

  meal_plans: defineTable({
    userId: v.id("users"),
    planName: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    dailyCalorieTarget: v.number(),
    dietaryPreferences: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  user_dietary_preferences: defineTable({
    userId: v.id("users"),
    dietaryRestrictions: v.optional(v.array(v.string())),
    favoriteCuisines: v.optional(v.array(v.string())),
    dislikedFoods: v.optional(v.array(v.string())),
    mealPreferences: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // ────────────────────────────────────────────────────────────────────
  // TRAINING & GYM
  // ────────────────────────────────────────────────────────────────────

  exercises: defineTable({
    // userId null = global library exercise; user-id set = custom user exercise
    userId: v.optional(v.id("users")),
    name: v.string(),
    category: v.string(),
    muscleGroup: v.string(),
    equipment: v.optional(v.string()),
    isCustom: v.boolean(),
    isBodyweight: v.boolean(),
    // Tracking type: "standard" | "bodyweight" | "weighted". Optional for
    // back-compat — absent rows resolve via isBodyweight on the client.
    trackingType: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  gym_sessions: defineTable({
    userId: v.id("users"),
    date: v.string(),
    sessionType: v.string(),
    status: v.string(),
    durationMinutes: v.optional(v.number()),
    perceivedFatigue: v.optional(v.number()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user_date", ["userId", "date"]),

  gym_sets: defineTable({
    sessionId: v.id("gym_sessions"),
    exerciseId: v.id("exercises"),
    userId: v.id("users"),
    exerciseOrder: v.number(),
    setOrder: v.number(),
    reps: v.number(),
    weightKg: v.optional(v.number()),
    assistedWeightKg: v.optional(v.number()),
    rpe: v.optional(v.number()),
    isWarmup: v.boolean(),
    isBodyweight: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_exercise_user", ["exerciseId", "userId"])
    // Newest-first per user — drives history-based "recent exercises".
    .index("by_user", ["userId"]),

  exercise_prs: defineTable({
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    bestSetId: v.optional(v.id("gym_sets")),
    maxWeightKg: v.optional(v.number()),
    maxReps: v.optional(v.number()),
    maxVolume: v.optional(v.number()),
    estimated1rm: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user_exercise", ["userId", "exerciseId"]),

  saved_routines: defineTable({
    userId: v.id("users"),
    name: v.string(),
    goal: v.string(),
    sport: v.optional(v.string()),
    trainingDaysPerWeek: v.optional(v.number()),
    isAiGenerated: v.boolean(),
    sortOrder: v.number(),
    // JSONB shape varies (different exercise structures per routine type)
    exercises: v.any(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Fight-camp planning
  fight_camps: defineTable({
    userId: v.id("users"),
    name: v.string(),
    fightDate: v.string(),
    eventName: v.optional(v.string()),
    profilePicUrl: v.optional(v.string()),
    weighInTiming: v.optional(v.string()),
    startingWeightKg: v.optional(v.number()),
    endWeightKg: v.optional(v.number()),
    totalWeightCut: v.optional(v.number()),
    weightViaDehydration: v.optional(v.number()),
    weightViaCarbReduction: v.optional(v.number()),
    rehydrationNotes: v.optional(v.string()),
    performanceFeeling: v.optional(v.string()),
    isCompleted: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  fight_form_scores: defineTable({
    userId: v.id("users"),
    date: v.string(),
    campId: v.optional(v.id("fight_camps")),
    rawScore: v.number(),
    displayedScore: v.number(),
    label: v.union(v.literal("sharp"), v.literal("sharpening"), v.literal("off_pace"), v.literal("at_risk")),
    state: v.union(v.literal("ok"), v.literal("calibrating"), v.literal("no_camp"), v.literal("paused")),
    phase: v.optional(v.union(v.literal("build"), v.literal("peak"), v.literal("fightWeek"))),
    subScores: v.object({
      trainingLoad:        v.object({ value: v.number(), weight: v.number(), reason: v.string() }),
      sleep:               v.object({ value: v.number(), weight: v.number(), reason: v.string() }),
      weightCut:           v.object({ value: v.number(), weight: v.number(), reason: v.string(), meta: v.optional(v.record(v.string(), v.union(v.number(), v.string()))) }),
      wellness:            v.object({ value: v.number(), weight: v.number(), reason: v.string() }),
      nutritionAdherence:  v.object({ value: v.number(), weight: v.number(), reason: v.string() }),
      // Optional so historical rows written before the recovery sub-score
      // was added still pass schema validation on read. New writes from
      // the calculator always include it (currently weight 0 — not yet
      // factored into the displayed score).
      recovery:            v.optional(v.object({ value: v.number(), weight: v.number(), reason: v.string() })),
    }),
    appliedCeiling: v.optional(v.object({ ruleId: v.string(), cap: v.number() })),
    campAge: v.optional(v.object({ weeksAhead: v.number() })),
    topDriver: v.string(),
    topLimiter: v.string(),
    algorithmVersion: v.string(),
    computedAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_camp", ["userId", "campId"])
    .index("by_user_date_version", ["userId", "date", "algorithmVersion"]),

  // Coalescing layer for fight-form recomputes. Every relevant mutation
  // upserts a row here keyed by (userId, date) with the wall-clock time at
  // which a recompute SHOULD fire. The scheduled `recomputeForUserDate`
  // checks this row when it runs: if a later schedule has pushed
  // `scheduledAt` further into the future, the current execution no-ops
  // and the later schedule will be the one that actually computes.
  fight_form_recompute_pending: defineTable({
    userId: v.id("users"),
    date: v.string(),
    scheduledAt: v.number(),
  }).index("by_user_date", ["userId", "date"]),

  fight_camp_calendar: defineTable({
    userId: v.id("users"),
    date: v.string(),
    sessionType: v.string(),
    intensity: v.string(),
    intensityLevel: v.optional(v.number()),
    durationMinutes: v.number(),
    rpe: v.number(),
    bodyweight: v.optional(v.number()),
    fatigueLevel: v.optional(v.number()),
    sorenessLevel: v.optional(v.number()),
    sleepHours: v.optional(v.number()),
    sleepQuality: v.optional(v.string()),
    mobilityDone: v.optional(v.boolean()),
    // Contact rounds logged for sparring / live grappling sessions —
    // used by the recovery engine to track contact load. Optional so
    // existing rows and non-contact sessions still validate.
    rounds: v.optional(v.number()),
    // Legacy single-media attachment. Kept so existing rows still render.
    // New uploads go into the `session_media` table (multi-attachment).
    mediaStorageId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    // Denormalised primary-gym id stamped at insert time so the gym
    // leaderboard query can range-scan by_gym_date directly. Optional
    // because historical rows are backfilled lazily (see migrations.ts).
    gymId: v.optional(v.id("gyms")),
    // Provenance of the row — which entry surface created it. Optional so
    // historical rows pre-dating this field still validate. Set by the
    // photo-first round-card flow (`"round_card"`), the QuickLogDialog
    // (`"quicklog"`), and the manual full-editor (`"manual"`).
    source: v.optional(v.union(
      v.literal("quicklog"),
      v.literal("round_card"),
      v.literal("manual"),
    )),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_gym_date", ["gymId", "date"]),

  // Multi-attachment media for a logged training session. Each row is one
  // photo or video. Indexed by session for the detail drawer + by user
  // ordered for the chronological library page.
  session_media: defineTable({
    // Optional for dev seeded posts where the session foreign key isn't
    // anchored to a real `fight_camp_calendar` row. Real uploads still
    // always carry a valid session id.
    sessionId: v.optional(v.id("fight_camp_calendar")),
    userId: v.id("users"),
    // Optional for dev seeded posts that point at external `mockUrl`s
    // instead of Convex File Storage. Production uploads always set this.
    storageId: v.optional(v.id("_storage")),
    // Dev/seed-only: external image URL used when `storageId` is absent.
    // Real uploads leave this undefined and resolve `storageId` via
    // ctx.storage.getUrl() instead.
    mockUrl: v.optional(v.string()),
    // "photo" | "video" — derived from the upload's MIME type so the
    // library and lightbox can pick the right element without sniffing.
    kind: v.union(v.literal("photo"), v.literal("video")),
    // Caller-supplied capture date (YYYY-MM-DD). Falls back to the
    // session's date when omitted. Used to group library tiles even when
    // a clip is uploaded weeks after the session it belongs to.
    capturedAt: v.string(),
    // Optional per-clip caption — short user note ("guillotine entry",
    // "left-hook timing"). Surfaces in the lightbox + library tile.
    caption: v.optional(v.string()),
    // Denormalised at insert time so the gym-feed query is a single
    // index scan on `by_gym_created` rather than a per-post join through
    // `gym_members`. Set from the session's `gymId` (which is itself
    // denormalised on `fight_camp_calendar`) or from the uploader's
    // primary active membership. NULL = "personal-only post, not in any
    // gym feed". A daily cron nulls this on rows > 90 days so they drop
    // out of the feed but stay in the personal library.
    gymId: v.optional(v.id("gyms")),
    // Future-proofing for a per-post privacy toggle. Defaults to "gym"
    // (visible to whole-gym feed) for v1. "private" rows are kept out of
    // the feed query even when `gymId` is set.
    visibility: v.optional(v.union(v.literal("gym"), v.literal("private"))),
    // Cached engagement counters. Stored on the post row so the feed
    // query returns them in O(1) without scanning the likes/comments
    // tables — critical when a post hits 500+ likes. Atomically patched
    // by `toggleLike` / `addComment` / `deleteComment` mutations.
    // `?? 0` at read time so existing rows that pre-date this field
    // validate without a migration.
    likeCount: v.optional(v.number()),
    commentCount: v.optional(v.number()),
    // Counter map for reactions, e.g. { fire: 12, muscle: 4 }. Keys are
    // ASCII slugs (NOT emoji) — Convex rejects emoji characters as
    // record/object keys. The client maps slug → emoji for display.
    // Stored on the post row so the feed query returns counts in O(1)
    // without scanning the `feed_reactions` table. Atomically patched
    // by the `toggleReaction` mutation. Optional + defaulted to {} at
    // read time so existing rows that pre-date this field validate
    // without a migration.
    reactionCounts: v.optional(v.record(v.string(), v.number())),
    // 256px JPEG thumb used by the profile grid + polaroid stack so the
    // feed doesn't blow image bandwidth fetching full-resolution.
    // Backfilled by a one-shot internal action on rows missing it.
    thumbStorageId: v.optional(v.id("_storage")),
    // Tiny base64 LQIP (~2KB, 24×24 blurred) inlined into the feed
    // payload so the first paint is instant before the real image
    // resolves. No round-trip needed.
    thumbDataUrl: v.optional(v.string()),
    // Captured at upload time so layout can reserve the right aspect
    // ratio in the grid (currently always 1:1 square, but post videos
    // may differ in v2).
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // Soft-delete: filtered out of every read. Populated by the post
    // owner OR a gym admin via the moderation flow. Hard-delete still
    // available via the existing cron path.
    deletedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_user_captured", ["userId", "capturedAt"])
    // Drives the gym social feed: descending paginate by `_creationTime`
    // within a single `gymId` is exactly the page-1 read shape.
    .index("by_gym_created", ["gymId"])
    // Profile grid hot path — descending paginate of one user's posts.
    // `_creationTime` auto-appended; no separate timestamp field needed.
    .index("by_user_created", ["userId"]),

  /**
   * Per-(post, user) like membership row. Indexed for O(1) "did I like
   * this post?" + O(1) like/un-like toggle. `postOwnerId` is denormalised
   * so the engagement-badge query can scan all events on the calling
   * user's posts via `by_owner_created` without a join.
   */
  feed_likes: defineTable({
    postId: v.id("session_media"),
    postOwnerId: v.id("users"),
    userId: v.id("users"),
  })
    .index("by_post_user", ["postId", "userId"])
    .index("by_owner_created", ["postOwnerId"])
    .index("by_user", ["userId"]),

  /**
   * Per-(post, user, key) reaction row. Mirrors `feed_likes` shape but
   * allows multiple reaction "verbs". Compound `by_post_user_key` index
   * makes the toggle path an O(1) point-lookup; `by_post_key` is kept
   * for future per-reaction listings (e.g. "who fire'd this post?").
   *
   * `key` is an ASCII slug (`heart` / `fire` / `muscle` / `praise` / `clap`)
   * — Convex rejects emoji characters as object/record keys, so we store
   * the slug on the wire and the client maps slug → emoji for display.
   */
  feed_reactions: defineTable({
    postId: v.id("session_media"),
    userId: v.id("users"),
    key: v.string(), // ASCII slug: "heart" | "fire" | "muscle" | "praise" | "clap"
    createdAt: v.number(),
  })
    .index("by_post_key", ["postId", "key"])
    .index("by_post_user_key", ["postId", "userId", "key"])
    .index("by_user", ["userId"]),

  /**
   * Flat comments on a feed post. Chronological per-post via `by_post`
   * (cursor-paginated, ASC). `postOwnerId` denormalised for the badge.
   * 500-char body cap enforced server-side in the mutation.
   */
  feed_comments: defineTable({
    postId: v.id("session_media"),
    postOwnerId: v.id("users"),
    userId: v.id("users"),
    body: v.string(),
    // Soft-delete hook for moderation v2. Unused in v1 — delete is hard.
    deletedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_owner_created", ["postOwnerId"])
    .index("by_user", ["userId"]),

  /**
   * One-time-view tracking for the polaroid feed. A row is inserted when a
   * non-author viewer swipes a post away. `listFeed` filters out rows whose
   * `_id` appears in the viewer's viewed set so the post never resurfaces.
   * The author's own posts are exempt — no row is ever written for the
   * poster themselves. Idempotent insert in `markPostViewed`.
   */
  feed_views: defineTable({
    postId: v.id("session_media"),
    userId: v.id("users"),
    viewedAt: v.number(),
  })
    .index("by_user_post", ["userId", "postId"])
    .index("by_user", ["userId"]),

  /**
   * Moderation reports on a feed post. Gym admins triage via the
   * `by_gym_status` index. Three user reports auto-soft-delete the post
   * (see feedSocial.reportPost) — the gym admin can then unhide or
   * confirm the takedown.
   */
  post_reports: defineTable({
    postId: v.id("session_media"),
    gymId: v.id("gyms"),
    reporterUserId: v.id("users"),
    reason: v.union(
      v.literal("spam"),
      v.literal("inappropriate"),
      v.literal("harassment"),
      v.literal("other"),
    ),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
  })
    .index("by_gym_status", ["gymId", "status"])
    .index("by_post", ["postId"])
    .index("by_post_reporter", ["postId", "reporterUserId"]),

  fight_week_logs: defineTable({
    userId: v.id("users"),
    logDate: v.string(),
    weightKg: v.optional(v.number()),
    fluidIntakeMl: v.optional(v.number()),
    carbsG: v.optional(v.number()),
    sweatSessionMin: v.optional(v.number()),
    supplements: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  }).index("by_user_date", ["userId", "logDate"]),

  fight_week_plans: defineTable({
    userId: v.id("users"),
    fightCampId: v.optional(v.id("fight_camps")),
    fightDate: v.string(),
    startingWeightKg: v.number(),
    targetWeightKg: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  training_summaries: defineTable({
    userId: v.id("users"),
    weekStart: v.string(),
    sessionIds: v.array(v.string()), // free-text fingerprint over external IDs; not v.id() refs
    notesFingerprint: v.string(),
    summaryData: v.any(),
    extractedTechniques: v.optional(v.array(v.string())),
    updatedAt: v.optional(v.number()),
  }).index("by_user_week", ["userId", "weekStart"]),

  training_paths: defineTable({
    userId: v.id("users"),
    sport: v.string(),
    goal: v.string(),
    goalType: v.union(
      v.literal("note"),
      v.literal("goal"),
      v.literal("coach"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("queued"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("archived"),
    ),
    sourceTechniqueId: v.optional(v.id("techniques")),
    sourceCoachId: v.optional(v.id("users")),
    notesContext: v.optional(v.string()),
    createdAt: v.number(),
    lastAdvancedAt: v.number(),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_user_sport", ["userId", "sport"]),

  training_path_steps: defineTable({
    pathId: v.id("training_paths"),
    position: v.number(),
    state: v.union(
      v.literal("upcoming"),
      v.literal("current"),
      v.literal("completed"),
      v.literal("remedial"),
    ),
    prescription: v.string(),
    wizardLine: v.string(),
    details: v.object({
      why: v.string(),
      how: v.array(v.string()),
      pitfalls: v.array(v.string()),
    }),
    targetTechniqueId: v.optional(v.id("techniques")),
    targetSport: v.string(),
    expectedSessions: v.number(),
    completedAt: v.optional(v.number()),
    completedFeedback: v.optional(v.union(
      v.literal("nailed"),
      v.literal("off"),
    )),
  }).index("by_path_position", ["pathId", "position"]),

  training_path_feedback: defineTable({
    pathId: v.id("training_paths"),
    stepId: v.id("training_path_steps"),
    userId: v.id("users"),
    feedback: v.union(v.literal("nailed"), v.literal("off")),
    at: v.number(),
  }).index("by_path_at", ["pathId", "at"]),

  training_path_proposals: defineTable({
    userId: v.id("users"),
    technique: v.string(),
    techniqueNormalized: v.string(),
    sport: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("snoozed"),
      v.literal("declined"),
    ),
    snoozedUntil: v.optional(v.number()),
    declineCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_user_normalized", ["userId", "techniqueNormalized"]),

  // ────────────────────────────────────────────────────────────────────
  // TRAINING MISSIONS (replaces the old training_paths feature)
  //
  // One active mission per (userId, sport). When the user logs a session
  // with notes, the Training Coach reads those notes and produces a
  // linear 3-8 step checklist for their next sessions. When the last
  // item is ticked off, a new mission auto-generates iff there are new
  // notes since the prior mission was created.
  //
  // The old `training_paths` / `training_path_steps` / `training_path_
  // proposals` / `training_path_feedback` tables remain in the schema for
  // now — they will be removed by a separate cleanup step once the new
  // feature has shipped and back-compat is no longer needed.
  // ────────────────────────────────────────────────────────────────────

  training_missions: defineTable({
    userId: v.id("users"),
    // Matches `fight_camp_calendar.sessionType` (free-form string in DB).
    sport: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("archived"),
    ),
    // <= 50 chars, e.g. "Sharpen guard retention".
    title: v.string(),
    // 1-2 sentences citing what in the notes drove this.
    rationale: v.string(),
    // The `fight_camp_calendar` rows whose notes seeded this mission.
    sourceSessionIds: v.array(v.id("fight_camp_calendar")),
    // unix ms; the next generation only considers notes >= this cursor.
    notesWindowStart: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    // Updated whenever an item is ticked. Drives the active-mission
    // ordering in the widget.
    lastActivityAt: v.number(),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_user_sport_status", ["userId", "sport", "status"]),

  training_mission_items: defineTable({
    missionId: v.id("training_missions"),
    // 0..N strict order. The widget sorts by this.
    position: v.number(),
    // <= 120 chars, second-person, actionable.
    text: v.string(),
    technique: v.optional(v.string()),
    drillType: v.optional(v.union(
      v.literal("solo"),
      v.literal("partner"),
      v.literal("live"),
      v.literal("shadow"),
    )),
    durationMin: v.optional(v.number()),
    completed: v.boolean(),
    completedAt: v.optional(v.number()),
  }).index("by_mission_position", ["missionId", "position"]),

  // Per-user opt-in toggles for AI coach features driven from the
  // Training Calendar. Currently just an auto-summary switch; future
  // toggles (auto-RPE, auto-tag, etc.) can be added inline as optional
  // fields without a schema bump.
  user_coach_settings: defineTable({
    userId: v.id("users"),
    autoSummary: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Per-user, per-discipline XP totals. Level is derived (not stored) via
  // the `levelFromXp` helper in `convex/lib/xp.ts` so the formula can be
  // tuned later without a migration. XP is awarded by internal mutations
  // when the user logs sessions, ticks mission items, or completes
  // missions (see ADR-camp-xp-redesign).
  user_discipline_xp: defineTable({
    userId: v.id("users"),
    sport: v.string(),
    totalXp: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_sport", ["userId", "sport"])
    .index("by_user", ["userId"]),

  // Weekly retention flashcards distilled from session notes.
  // Spaced-repetition state lives inline (Leitner doubling) so the schema
  // stays simple. `cardKey` dedups identical fronts across regenerations
  // so re-running a week's summary doesn't reset learned cards. See
  // `docs/superpowers/specs/2026-05-21-training-summary-flashcards.md`.
  training_summary_cards: defineTable({
    userId: v.id("users"),
    sport: v.string(),
    weekStart: v.string(),
    cardKey: v.string(),
    front: v.string(),
    back: v.string(),
    cue: v.optional(v.string()),
    sourceSessionDate: v.optional(v.string()),
    intervalDays: v.number(),
    dueAt: v.number(),
    reviews: v.number(),
    lapses: v.number(),
    lastReviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_due", ["userId", "dueAt"])
    .index("by_user_card_key", ["userId", "cardKey"])
    .index("by_user_week", ["userId", "weekStart"]),

  // ────────────────────────────────────────────────────────────────────
  // SKILL TREE
  // ────────────────────────────────────────────────────────────────────

  techniques: defineTable({
    name: v.string(),
    nameNormalized: v.string(),
    sport: v.string(),
    category: v.optional(v.string()),
    position: v.optional(v.string()),
  }).index("by_normalized", ["nameNormalized", "sport"]),

  technique_edges: defineTable({
    fromTechniqueId: v.id("techniques"),
    toTechniqueId: v.id("techniques"),
    relationType: v.string(),
  })
    .index("by_from", ["fromTechniqueId"])
    .index("by_to", ["toTechniqueId"]),

  user_technique_progress: defineTable({
    userId: v.id("users"),
    techniqueId: v.id("techniques"),
    level: v.string(),
    timesLogged: v.number(),
    firstLoggedAt: v.optional(v.number()),
    lastLoggedAt: v.optional(v.number()),
  }).index("by_user_technique", ["userId", "techniqueId"]),

  training_technique_logs: defineTable({
    userId: v.id("users"),
    techniqueId: v.id("techniques"),
    sessionId: v.optional(v.id("fight_camp_calendar")),
    date: v.string(),
    notes: v.optional(v.string()),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_technique", ["techniqueId"]),

  // ────────────────────────────────────────────────────────────────────
  // WELLNESS / BASELINES / INSIGHTS
  // ────────────────────────────────────────────────────────────────────

  daily_wellness_checkins: defineTable({
    userId: v.id("users"),
    date: v.string(),
    sleepQuality: v.number(),
    fatigueLevel: v.number(),
    sorenessLevel: v.number(),
    stressLevel: v.number(),
    sleepHours: v.optional(v.number()),
    energyLevel: v.optional(v.number()),
    motivationLevel: v.optional(v.number()),
    appetiteLevel: v.optional(v.number()),
    hydrationFeeling: v.optional(v.number()),
    hooperIndex: v.optional(v.number()),
    readinessScore: v.optional(v.number()),
  }).index("by_user_date", ["userId", "date"]),

  personal_baselines: defineTable({
    userId: v.id("users"),
    baselineDate: v.string(),
    // 14d / 60d rolling stats (all nullable)
    fatigueMean14d: v.optional(v.number()),
    fatigueStd14d: v.optional(v.number()),
    fatigueMean60d: v.optional(v.number()),
    fatigueStd60d: v.optional(v.number()),
    sorenessMean14d: v.optional(v.number()),
    sorenessStd14d: v.optional(v.number()),
    sorenessMean60d: v.optional(v.number()),
    sorenessStd60d: v.optional(v.number()),
    stressMean14d: v.optional(v.number()),
    stressStd14d: v.optional(v.number()),
    stressMean60d: v.optional(v.number()),
    stressStd60d: v.optional(v.number()),
    hooperMean14d: v.optional(v.number()),
    hooperStd14d: v.optional(v.number()),
    hooperCv14d: v.optional(v.number()),
    hooperMean60d: v.optional(v.number()),
    hooperStd60d: v.optional(v.number()),
    sleepHoursMean14d: v.optional(v.number()),
    sleepHoursStd14d: v.optional(v.number()),
    sleepHoursMean60d: v.optional(v.number()),
    sleepHoursStd60d: v.optional(v.number()),
    dailyLoadMean14d: v.optional(v.number()),
    dailyLoadStd14d: v.optional(v.number()),
    dailyLoadMean60d: v.optional(v.number()),
    dailyLoadStd60d: v.optional(v.number()),
    avgDeficit7d: v.optional(v.number()),
    avgDeficit14d: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_user_date", ["userId", "baselineDate"]),

  user_insights: defineTable({
    userId: v.id("users"),
    insightType: v.string(),
    // JSONB shape varies by insight type (correlation, trend, etc.)
    insightData: v.any(),
    confidenceScore: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_user_type", ["userId", "insightType"]),

  /**
   * Weekly recovery report — AI-generated digest of the user's recovery
   * state across the prior week (or cycle). One row per (userId,
   * weekStartIso). `by_user_week` supports the upsert/lookup hot path;
   * `by_user_created` powers the recent-reports list on the recovery page.
   *
   * `rawMetrics` is intentionally `v.any()` — it's a debug snapshot of the
   * inputs that produced the report (shape varies per generation) and is
   * also used as the source for future audio-summary generation.
   */
  recoveryReports: defineTable({
    userId: v.id("users"),
    weekStartIso: v.string(),         // YYYY-MM-DD of the Monday this report covers (or the cycle start)
    verdict: v.string(),               // single-sentence summary
    breakdown: v.string(),             // "where you broke down" prose
    nextWeekActions: v.array(v.object({
      dayIso: v.string(),
      action: v.string(),
    })),
    campArc: v.optional(v.string()),  // present only if user is in a fight camp
    rawMetrics: v.any(),               // snapshot of inputs for debug + future audio gen
    createdAt: v.number(),
  })
    .index("by_user_week", ["userId", "weekStartIso"])
    .index("by_user_created", ["userId", "createdAt"]),

  /**
   * AI-generated weight-cut protocols per fight camp. Two kinds today:
   *  - "fight_plan"   : full pre-fight-week cut plan (FightPlan shape)
   *  - "rehydration"  : post-weigh-in rehydration protocol (RehydrationProtocol shape)
   *
   * `payload` is intentionally `v.any()` — the precise shape is enforced by
   * a Zod schema at write time (see action handler). Storing as `any` lets
   * us evolve the payload shape without a schema migration.
   *
   * `derivedSnapshot` captures the `DerivedInputs` used to generate the
   * protocol (weight, days-to-fight, recent fluid/sodium, etc.) so we can
   * audit later and detect drift between current state and generation-time
   * state on the rehydration page.
   *
   * Indexed by (userId, campId, kind) for the latest-protocol upsert hot
   * path, and by (userId, createdAt) for any "recent protocols" listing.
   * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md §4.1.
   */
  weight_protocols: defineTable({
    userId: v.id("users"),
    campId: v.id("fight_camps"),
    kind: v.union(v.literal("fight_plan"), v.literal("rehydration")),
    payload: v.any(),               // FightPlan | RehydrationProtocol — validated by Zod at write time
    derivedSnapshot: v.any(),       // DerivedInputs at gen time (audit + drift detect)
    approach: v.optional(v.string()), // 'gradual' | 'standard' | 'aggressive' (fight_plan only)
    model: v.string(),              // 'anthropic/claude-opus-4-7' | 'openai/gpt-oss-120b'
    createdAt: v.number(),
  })
    .index("by_user_camp_kind", ["userId", "campId", "kind"])
    .index("by_user_created", ["userId", "createdAt"]),

  /**
   * Per-(user, camp, metric) feel-check ledger for the rehydration page
   * checklist. The user ticks off subjective markers (urine colour,
   * weigh-back, energy, headache, no cramps) as they rehydrate; each tick
   * inserts a row. `value` is optional — populated when the user logs an
   * actual measurement alongside the tick (e.g. "76.2" kg weigh-back).
   *
   * Indexed by (userId, campId) for the page-load fetch and by
   * (userId, campId, metric) for per-metric "have I done this one yet?"
   * lookups in the checklist UI.
   * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md §4.3.
   */
  protocol_feel_checks: defineTable({
    userId: v.id("users"),
    campId: v.id("fight_camps"),
    metric: v.union(
      v.literal("urine_colour"),
      v.literal("weigh_back_kg"),
      v.literal("energy_1to10"),
      v.literal("headache"),
      v.literal("no_cramps"),
    ),
    checkedAt: v.number(),
    // Optional value if the user logged a measurement alongside the check
    value: v.optional(v.string()),  // e.g. "pale straw" / "76.2" / "yes"
  })
    .index("by_user_camp", ["userId", "campId"])
    .index("by_user_camp_metric", ["userId", "campId", "metric"]),

  // ────────────────────────────────────────────────────────────────────
  // COACH MODE
  // ────────────────────────────────────────────────────────────────────

  gyms: defineTable({
    name: v.string(),
    ownerUserId: v.id("users"),
    inviteCode: v.string(),
    location: v.optional(v.string()),
    // Convex Storage ID for the gym logo image. URL is resolved server-side.
    logoStorageId: v.optional(v.id("_storage")),
    // Coach-onboarding extras. Optional so legacy gym rows stay valid.
    // `disciplines` is a free-form list of styles taught (BJJ, MMA, Boxing,
    // Muay Thai, Wrestling, etc); `fighterCount` is the rough roster size
    // captured at onboarding (a coarse self-reported number, not a live
    // member count).
    disciplines: v.optional(v.array(v.string())),
    fighterCount: v.optional(v.number()),
    about: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_invite_code", ["inviteCode"]),

  gym_members: defineTable({
    gymId: v.id("gyms"),
    userId: v.id("users"),
    memberRole: v.union(v.literal("coach"), v.literal("athlete")),
    status: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("removed"),
    ),
    shareData: v.boolean(),
    joinedAt: v.number(),
    // Coach-only toggle: when true, the gym's social feed surfaces on the
    // coach's dashboard widget. Per-gym (not per-coach) because a coach
    // who runs multiple gyms may want the feed for some but not others.
    // Default is undefined / false — coaches opt in from gym settings.
    feedVisibleOnDashboard: v.optional(v.boolean()),
  })
    .index("by_gym", ["gymId"])
    .index("by_user", ["userId"])
    .index("by_gym_user", ["gymId", "userId"])
    // "Resolve viewer → active gym" in one read. Hot path for the
    // Corner tab and every gym-feed gate on the bottom nav.
    .index("by_user_status", ["userId", "status"]),

  /**
   * Pending gym invites — a coach proposes adding an athlete (or vice-versa)
   * and the target user must explicitly accept. Replaces the prior
   * `addMember` flow that silently inserted an active membership without
   * the target's consent (a privacy/data-sharing regression).
   *
   * Lifecycle: row inserted in `pending` state, target user accepts → row
   * deleted + `gym_members` row created with `shareData: false` (opt-in
   * later via `updateMyMembership`). Decline → row deleted, no membership.
   */
  gym_invites: defineTable({
    gymId: v.id("gyms"),
    userId: v.id("users"),         // target athlete/coach being invited
    invitedByUserId: v.id("users"),
    memberRole: v.union(v.literal("coach"), v.literal("athlete")),
    status: v.union(v.literal("pending"), v.literal("declined")),
    createdAt: v.number(),
  })
    .index("by_gym", ["gymId"])
    .index("by_user", ["userId"])
    .index("by_gym_user", ["gymId", "userId"]),

  gym_announcements: defineTable({
    gymId: v.id("gyms"),
    senderUserId: v.id("users"),
    body: v.optional(v.string()), // optional after rich-announcements migration
    isBroadcast: v.boolean(),
    // CHECK ('text','image','poll','fight_offer')
    kind: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("poll"),
      v.literal("fight_offer"),
    ),
    imageUrl: v.optional(v.string()),
    // Attached media uploaded to Convex File Storage. Supersedes `imageUrl`
    // for net-new posts (it stays for back-compat with any rows created
    // before the upload flow existed). `mediaKind` lets the feed render
    // <img> vs <video> without sniffing the URL.
    mediaStorageId: v.optional(v.id("_storage")),
    mediaKind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    expiresAt: v.optional(v.number()),
  })
    // by_gym_created — _creationTime is appended automatically to every index
    .index("by_gym_created", ["gymId"])
    .index("by_sender", ["senderUserId"]),

  /**
   * Fight offers — coach posts a fight opportunity, fighters express interest.
   * 1:1 with a `gym_announcements` row (kind: "fight_offer") which owns the
   * common feed metadata (sender, body pitch, target audience, media).
   * gymId is denormalised so coach-side queries don't need to dereference
   * the announcement to filter by gym.
   */
  fight_offers: defineTable({
    announcementId: v.id("gym_announcements"),
    gymId: v.id("gyms"),
    fightDate: v.number(),        // epoch ms
    weightClassKg: v.number(),
    eventName: v.optional(v.string()),
    opponentName: v.optional(v.string()),
    location: v.optional(v.string()),
    purseText: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("filled"),
      v.literal("withdrawn"),
    ),
    selectedFighterUserId: v.optional(v.id("users")),
    fightCampId: v.optional(v.id("fight_camps")),
    filledAt: v.optional(v.number()),
  })
    .index("by_announcement", ["announcementId"])
    .index("by_gym_status", ["gymId", "status"]),

  /**
   * One row per fighter who tapped a signal on a fight offer. Upsert on
   * (offerId, userId) so changing your mind is just overwriting the row;
   * we never accumulate signal history. Kept post-fill for audit/coach view.
   */
  fight_offer_interests: defineTable({
    offerId: v.id("fight_offers"),
    userId: v.id("users"),
    signal: v.union(
      v.literal("yes"),
      v.literal("maybe"),
      v.literal("pass"),
    ),
    createdAt: v.number(),
  })
    .index("by_offer", ["offerId"])
    .index("by_offer_user", ["offerId", "userId"]),

  gym_announcement_targets: defineTable({
    announcementId: v.id("gym_announcements"),
    userId: v.id("users"),
  })
    .index("by_announcement", ["announcementId"])
    .index("by_user", ["userId"])
    .index("by_announcement_user", ["announcementId", "userId"]),

  announcement_poll_options: defineTable({
    announcementId: v.id("gym_announcements"),
    optionText: v.string(),
    position: v.number(),
  }).index("by_announcement", ["announcementId"]),

  announcement_poll_votes: defineTable({
    announcementId: v.id("gym_announcements"),
    optionId: v.id("announcement_poll_options"),
    voterUserId: v.id("users"),
  })
    .index("by_announcement", ["announcementId"])
    .index("by_option", ["optionId"])
    .index("by_announcement_voter", ["announcementId", "voterUserId"]),

  announcement_dismissals: defineTable({
    announcementId: v.id("gym_announcements"),
    userId: v.id("users"),
    dismissedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_announcement_user", ["announcementId", "userId"]),

  // ────────────────────────────────────────────────────────────────────
  // SUPPORTING
  // ────────────────────────────────────────────────────────────────────

  device_tokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.union(
      v.literal("ios"),
      v.literal("android"),
      v.literal("web"),
    ),
    appVersion: v.optional(v.string()),
    lastSeenAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  chat_messages: defineTable({
    userId: v.id("users"),
    role: v.string(),
    content: v.string(),
  }).index("by_user", ["userId"]),

  rate_limits: defineTable({
    userId: v.id("users"),
    functionName: v.string(),
    requestCount: v.number(),
    windowStart: v.number(),
  }).index("by_user_function", ["userId", "functionName"]),

  ai_decisions: defineTable({
    userId: v.id("users"),
    feature: v.string(),
    // JSONB columns kept as v.any() because shape varies per AI feature
    inputSnapshot: v.any(),
    outputJson: v.any(),
    predictionFacts: v.optional(v.any()),
    actualOutcome: v.optional(v.any()),
    model: v.optional(v.string()),
    outcomeLoggedAt: v.optional(v.number()),
    errorPct: v.optional(v.number()),
    userAccepted: v.optional(v.boolean()),
    userRating: v.optional(v.number()),
  })
    .index("by_user_feature_recent", ["userId", "feature"])
    .index("by_user_outcome_pending", ["userId", "outcomeLoggedAt"]),

  // ────────────────────────────────────────────────────────────────────
  // APPLE HEALTHKIT INTEGRATION (spec §5.1)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Raw HealthKit samples, immutable. One row per HealthKit sample we read.
   * Idempotency: `externalId` is the HealthKit sample UUID — `insertSamples`
   * skips inserts whose `externalId` already exists. Daily roll-up
   * (`daily_health_summary`) is the read path for the score engine; this
   * table is the source of truth for re-rollups and audit.
   *
   * Index notes:
   *  - `by_user_metric_started` — primary range scan for roll-up: "all
   *    samples for user U, metric M, in [start, end)".
   *  - `by_external_id` — idempotency check on insert; must be unique by
   *    construction (HealthKit UUIDs are globally unique).
   */
  health_samples: defineTable({
    userId: v.id("users"),
    metric: v.string(),
    value: v.number(),
    unit: v.string(),
    startedAt: v.number(),
    endedAt: v.number(),
    source: v.string(),
    device: v.optional(v.string()),
    externalId: v.optional(v.string()),
  })
    .index("by_user_metric_started", ["userId", "metric", "startedAt"])
    .index("by_external_id", ["externalId"]),

  /**
   * One row per (user, date). Derived from `health_samples` by
   * `internal.health.rollupDaily`. All metric fields optional so the row
   * still validates when a user has partial data (e.g. iPhone-only users
   * have steps but no HRV).
   *
   * `sourcesPresent` records which devices contributed to that day's
   * samples (e.g. ["Apple Watch", "Whoop"]). The roll-up applies the
   * source-priority rule from spec §10.6 before averaging.
   */
  daily_health_summary: defineTable({
    userId: v.id("users"),
    date: v.string(),
    hrvAvgMs: v.optional(v.number()),
    restingHrBpm: v.optional(v.number()),
    sleepMinutes: v.optional(v.number()),
    sleepDeepMinutes: v.optional(v.number()),
    sleepRemMinutes: v.optional(v.number()),
    sleepEfficiencyPct: v.optional(v.number()),
    workoutMinutes: v.optional(v.number()),
    activeEnergyKcal: v.optional(v.number()),
    stepCount: v.optional(v.number()),
    vo2Max: v.optional(v.number()),
    respiratoryRateAvg: v.optional(v.number()),
    wristTempDeltaC: v.optional(v.number()),
    bodyMassKg: v.optional(v.number()),
    sourcesPresent: v.array(v.string()),
    computedAt: v.number(),
  }).index("by_user_date", ["userId", "date"]),

  /**
   * Per-(user, metric) rolling baselines used by the recovery sub-score to
   * compute `deviationZ = (value - mean) / stddev`. Refreshed nightly by
   * `internal.health.computeBaselines` and after every `rollupDaily` of
   * the previous day. `sampleCount` is the number of distinct days that
   * contributed to the 14-day window — drives the `confidence` value the
   * score engine surfaces in the UI.
   */
  health_baselines: defineTable({
    userId: v.id("users"),
    metric: v.string(),
    rolling14dMean: v.number(),
    rolling14dStdDev: v.number(),
    rolling7dMean: v.optional(v.number()),
    sampleCount: v.number(),
    updatedAt: v.number(),
  }).index("by_user_metric", ["userId", "metric"]),
});

/*
 * ─────────────────────────────────────────────────────────────────────
 * MIGRATION NOTES
 * ─────────────────────────────────────────────────────────────────────
 *
 * DROPPED TABLES (intentionally not migrated):
 *  - coach_realtime_events       : Fan-out table no longer needed; Convex
 *                                  query reactivity replaces it (clients
 *                                  subscribe directly to gym_announcements
 *                                  and dependent tables).
 *  - meals_with_totals           : Postgres VIEW, not a table. Totals are
 *                                  now computed in Convex queries by
 *                                  joining meals + meal_items.
 *  - nutrition_logs              : Postgres compat VIEW over the legacy
 *                                  nutrition_logs_v1 archive. Not migrated
 *                                  — clients use the meals + meal_items
 *                                  shape directly.
 *  - nutrition_logs_v1           : Archive table from old single-row-per-
 *                                  meal model. Not migrated; will be
 *                                  back-filled into meals/meal_items in
 *                                  the data-migration phase.
 *  - users (built-in)            : Provided by Convex Auth automatically;
 *                                  referenced via v.id("users").
 *
 * DROPPED COLUMNS:
 *  - <table>.created_at          : Replaced by Convex's built-in
 *                                  _creationTime on every row.
 *  - profiles.id                 : Was the auth user UUID. Replaced by
 *                                  profiles.userId: v.id("users") which
 *                                  references the Convex Auth users table.
 *  - All `Relationships:` array  : Encoded structurally via v.id("…") FK
 *    metadata from types.ts        types.
 *
 * INDEX NOTES:
 *  - foods.name pg_trgm GIN      → Replaced by Convex .searchIndex
 *                                  ("search_name") with filterFields for
 *                                  source + verified.
 *  - weight_logs partial index   → Convex doesn't support partial indexes;
 *    (user_id, date DESC)          a plain by_user_date index covers the
 *                                  same queries.
 *
 * OPEN QUESTIONS:
 *  1. The `foods.source` column has no CHECK constraint in any migration
 *     I could find, so it's modelled as a free-form v.string(). Confirm
 *     whether you want a tighter v.union of ('usda'|'off'|'user'|'ai').
 *  2. `gym_sessions.status` is also free-form text (CHECK constraint
 *     wasn't in the migration I reviewed). Likely 'active'|'completed'|
 *     'cancelled' — verify before tightening.
 *  3. `saved_routines.exercises` JSONB shape: there are at least 2
 *     variants in app code (manual vs AI). Left as v.any() for now;
 *     consider a discriminated union once the variants are documented.
 *  4. `training_summaries.sessionIds` is text[] of UUIDs in Postgres but
 *     these are old gym_session/fight_camp_calendar UUIDs that won't map
 *     1:1 to new Convex Ids. Modelled as v.array(v.string()) — will need
 *     a translation table during data backfill.
 *  5. `ai_decisions.userId` originally referenced public.profiles(id)
 *     (NOT auth.users). After the migration, profiles uses _id not user
 *     ids, so this is remapped to v.id("users") for consistency with
 *     every other userId column.
 *  6. The original `by_user_outcome_pending` index was a partial index
 *     (WHERE outcome_logged_at IS NULL). Convex has no partial-index
 *     support; the full index will work but is slightly larger. Filter
 *     `.eq("outcomeLoggedAt", undefined)` in queries to mimic the
 *     pending-only scan.
 */
