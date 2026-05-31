/**
 * Internal mutations supporting `convex/actions/deleteAccount.ts`. Split out
 * here because the action file uses the Node runtime and Convex requires
 * mutations to run on the default V8 runtime.
 *
 * Each step is scoped to a logical bounded context so any one step's write
 * count stays under Convex's per-mutation limits.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function deleteByUserIndex(
  ctx: any,
  table: string,
  userId: Id<"users">,
  indexName = "by_user",
) {
  const rows = await ctx.db
    .query(table)
    .withIndex(indexName, (q: any) => q.eq("userId", userId))
    .collect();
  await Promise.all(rows.map((r: any) => ctx.db.delete(r._id)));
}

export const cascadeMeals = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // meals (parent) → meal_items (child via mealId).
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
    await deleteByUserIndex(ctx, "meal_plans", userId);
    await deleteByUserIndex(ctx, "user_dietary_preferences", userId);
  },
});

export const cascadeTraining = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // gym_sessions (parent) → gym_sets (child via sessionId).
    const sessions = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) {
      const sets = await ctx.db
        .query("gym_sets")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      await Promise.all(sets.map((set) => ctx.db.delete(set._id)));
      await ctx.db.delete(s._id);
    }

    // fight_camp_calendar entries can hold a media storage object — drop it
    // before deleting the row so storage doesn't leak.
    const calendar = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect();
    for (const c of calendar) {
      if (c.mediaStorageId) {
        try {
          await ctx.storage.delete(c.mediaStorageId);
        } catch {
          /* already gone */
        }
      }
    }

    // session_media — multi-attachment photos/videos on logged sessions.
    // Each row owns a Convex Storage object; delete those FIRST so storage
    // can't leak if the row delete fails. Indexed by user so this is cheap.
    const mediaRows = await ctx.db
      .query("session_media")
      .withIndex("by_user_captured", (q) => q.eq("userId", userId))
      .collect();
    for (const m of mediaRows) {
      if (m.storageId) {
        try {
          await ctx.storage.delete(m.storageId);
        } catch {
          /* already gone */
        }
      }
      await ctx.db.delete(m._id);
    }

    // exercise_prs — by user.
    const prs = await ctx.db
      .query("exercise_prs")
      .withIndex("by_user_exercise", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(prs.map((p) => ctx.db.delete(p._id)));

    // exercises — only user-custom rows have userId set; library rows have
    // null userId and stay.
    const customExercises = await ctx.db
      .query("exercises")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(customExercises.map((e) => ctx.db.delete(e._id)));

    await deleteByUserIndex(ctx, "saved_routines", userId);
    await deleteByUserIndex(ctx, "fight_camps", userId);
    await deleteByUserIndex(ctx, "fight_camp_calendar", userId, "by_user_date");
    await deleteByUserIndex(ctx, "fight_week_logs", userId, "by_user_date");
    await deleteByUserIndex(ctx, "fight_week_plans", userId);
    await deleteByUserIndex(ctx, "training_summaries", userId, "by_user_week");

    // Skill tree user-scoped rows.
    const progress = await ctx.db
      .query("user_technique_progress")
      .withIndex("by_user_technique", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(progress.map((p) => ctx.db.delete(p._id)));
    await deleteByUserIndex(
      ctx,
      "training_technique_logs",
      userId,
      "by_user_date",
    );
  },
});

export const cascadeWellness = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await deleteByUserIndex(ctx, "weight_logs", userId, "by_user_date");
    await deleteByUserIndex(ctx, "hydration_logs", userId, "by_user_date");
    await deleteByUserIndex(ctx, "sleep_logs", userId, "by_user_date");
    await deleteByUserIndex(
      ctx,
      "daily_wellness_checkins",
      userId,
      "by_user_date",
    );
    await deleteByUserIndex(ctx, "personal_baselines", userId, "by_user_date");
    await deleteByUserIndex(ctx, "user_insights", userId, "by_user_type");
    // Fight-form scores were missing from the original cascade — they
    // are written daily by the scoring cron, so a long-time user can
    // accumulate hundreds of rows that would otherwise dangle forever.
    await deleteByUserIndex(ctx, "fight_form_scores", userId, "by_user_date");

    // ─── Apple HealthKit tables (spec §9) ─────────────────────────────
    // `health_samples` can be the largest per-user table (~14 rows/day
    // for an active user across multiple weeks), so it's first to clear.
    // Indexed by `by_user_metric_started` — we don't need the metric
    // partition for a full wipe; a scan via that index still scopes to
    // this user only.
    const samples = await ctx.db
      .query("health_samples")
      .withIndex("by_user_metric_started", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(samples.map((s) => ctx.db.delete(s._id)));

    await deleteByUserIndex(
      ctx,
      "daily_health_summary",
      userId,
      "by_user_date",
    );
    await deleteByUserIndex(
      ctx,
      "health_baselines",
      userId,
      "by_user_metric",
    );
  },
});

export const cascadeMisc = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await deleteByUserIndex(ctx, "chat_messages", userId);
    await deleteByUserIndex(ctx, "device_tokens", userId);
    await deleteByUserIndex(ctx, "announcement_dismissals", userId);

    const polls = await ctx.db
      .query("announcement_poll_votes")
      .filter((q) => q.eq(q.field("voterUserId"), userId))
      .collect();
    await Promise.all(polls.map((p) => ctx.db.delete(p._id)));

    // Announcement targets — when this user was an explicit recipient of
    // an announcement in another coach's gym. Indexed by user.
    const announcementTargets = await ctx.db
      .query("gym_announcement_targets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(announcementTargets.map((t) => ctx.db.delete(t._id)));

    // Gym memberships (membership rows, not gyms they own — see next step).
    const memberships = await ctx.db
      .query("gym_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(memberships.map((m) => ctx.db.delete(m._id)));

    // Announcements posted BY this user in gyms they do NOT own (e.g. a
    // coach-role member of someone else's gym). Indexed by sender so the
    // lookup is cheap regardless of how many gyms the announcement set
    // spans. Each announcement's child rows (targets, poll_options,
    // poll_votes, dismissals) get cleaned up alongside.
    const sentAnnouncements = await ctx.db
      .query("gym_announcements")
      .withIndex("by_sender", (q) => q.eq("senderUserId", userId))
      .collect();
    for (const a of sentAnnouncements) {
      const targets = await ctx.db
        .query("gym_announcement_targets")
        .withIndex("by_announcement", (q) => q.eq("announcementId", a._id))
        .collect();
      await Promise.all(targets.map((t) => ctx.db.delete(t._id)));
      const options = await ctx.db
        .query("announcement_poll_options")
        .withIndex("by_announcement", (q) => q.eq("announcementId", a._id))
        .collect();
      await Promise.all(options.map((o) => ctx.db.delete(o._id)));
      const votes = await ctx.db
        .query("announcement_poll_votes")
        .withIndex("by_announcement", (q) => q.eq("announcementId", a._id))
        .collect();
      await Promise.all(votes.map((v) => ctx.db.delete(v._id)));
      const dismissals = await ctx.db
        .query("announcement_dismissals")
        .withIndex("by_announcement_user", (q) =>
          q.eq("announcementId", a._id),
        )
        .collect();
      await Promise.all(dismissals.map((d) => ctx.db.delete(d._id)));
      await ctx.db.delete(a._id);
    }

    // Rate-limit + ai_decisions audit rows.
    const rates = await ctx.db
      .query("rate_limits")
      .withIndex("by_user_function", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(rates.map((r) => ctx.db.delete(r._id)));

    const decisions = await ctx.db
      .query("ai_decisions")
      .withIndex("by_user_feature_recent", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(decisions.map((d) => ctx.db.delete(d._id)));
  },
});

export const cascadeGymOwnership = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const ownedGyms = await ctx.db
      .query("gyms")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    for (const gym of ownedGyms) {
      // Best-effort logo cleanup — orphaned storage objects are silently
      // ignored if already deleted.
      if (gym.logoStorageId) {
        try {
          await ctx.storage.delete(gym.logoStorageId);
        } catch {
          /* already gone */
        }
      }
      const members = await ctx.db
        .query("gym_members")
        .withIndex("by_gym", (q) => q.eq("gymId", gym._id))
        .collect();
      await Promise.all(members.map((m) => ctx.db.delete(m._id)));

      const announcements = await ctx.db
        .query("gym_announcements")
        .withIndex("by_gym_created", (q) => q.eq("gymId", gym._id))
        .collect();
      for (const a of announcements) {
        const targets = await ctx.db
          .query("gym_announcement_targets")
          .withIndex("by_announcement", (q) =>
            q.eq("announcementId", a._id),
          )
          .collect();
        await Promise.all(targets.map((t) => ctx.db.delete(t._id)));

        const options = await ctx.db
          .query("announcement_poll_options")
          .withIndex("by_announcement", (q) =>
            q.eq("announcementId", a._id),
          )
          .collect();
        await Promise.all(options.map((o) => ctx.db.delete(o._id)));

        const votes = await ctx.db
          .query("announcement_poll_votes")
          .withIndex("by_announcement", (q) =>
            q.eq("announcementId", a._id),
          )
          .collect();
        await Promise.all(votes.map((vote) => ctx.db.delete(vote._id)));

        const dismissals = await ctx.db
          .query("announcement_dismissals")
          .withIndex("by_announcement_user", (q) =>
            q.eq("announcementId", a._id),
          )
          .collect();
        await Promise.all(dismissals.map((d) => ctx.db.delete(d._id)));

        await ctx.db.delete(a._id);
      }

      await ctx.db.delete(gym._id);
    }
  },
});

export const cascadeProfile = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      // Delete any avatar storage before removing the row.
      if (profile.avatarStorageId) {
        try {
          await ctx.storage.delete(profile.avatarStorageId);
        } catch {
          /* already gone */
        }
      }
      await ctx.db.delete(profile._id);
    }

    // ── Convex Auth cleanup ────────────────────────────────────────────
    // The original cascade only touched `authAccounts` + `authSessions`,
    // leaving `authRefreshTokens`, `authVerifiers`, and
    // `authVerificationCodes` dangling. Convex doesn't enforce FKs so
    // those orphans never blocked the delete, but they did pile up
    // forever and could cause the app's auth provider to misbehave for
    // a re-registered email address. We now walk the auth-table graph
    // properly: sessions → refresh tokens + verifiers, then accounts →
    // verification codes, then the user row itself.
    //
    // Indexes used here are the canonical ones declared by
    // `@convex-dev/auth` in `authTables` (see node_modules → server/
    // implementation/types.js): `userId` on authSessions / authAccounts,
    // `sessionId` on authRefreshTokens / authVerifiers, `accountId`
    // on authVerificationCodes.

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      await Promise.all(refreshTokens.map((r) => ctx.db.delete(r._id)));
      const verifiers = await ctx.db
        .query("authVerifiers")
        .filter((q) => q.eq(q.field("sessionId"), s._id))
        .collect();
      await Promise.all(verifiers.map((v) => ctx.db.delete(v._id)));
      await ctx.db.delete(s._id);
    }

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const a of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", a._id))
        .collect();
      await Promise.all(codes.map((c) => ctx.db.delete(c._id)));
      await ctx.db.delete(a._id);
    }

    await ctx.db.delete(userId);
  },
});
