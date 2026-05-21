import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";

/**
 * Per-user opt-in settings for AI coach features on the Training
 * Calendar (currently just `autoSummary`). Pro-gated.
 *
 *   - getMyCoachSettings — current user's settings + Pro tier flag
 *   - setAutoSummary     — flip the toggle (Pro-gated)
 *   - getCoachSettings   — internal: read settings for any user
 *     (used by the session-save trigger in fight_camp.ts)
 *
 * Defaults: autoSummary = false. Toggle requires Pro. Free users see a
 * Pro chip beside the toggle and tapping it opens the paywall.
 */

export const getMyCoachSettings = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ autoSummary: boolean; isPro: boolean }> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return { autoSummary: false, isPro: false };

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const isPro = effectiveTier(profile) === "pro";

    const row = await ctx.db
      .query("user_coach_settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { autoSummary: row?.autoSummary ?? false, isPro };
  },
});

export const setAutoSummary = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }): Promise<{ autoSummary: boolean }> => {
    const userId = await requireUserId(ctx);

    // Pro-gate the WRITE — frontend may also gate the UI, but the
    // server is the source of truth.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (effectiveTier(profile) !== "pro") {
      throw new Error("PRO_FEATURE_REQUIRED:AUTO_SUMMARY");
    }

    const existing = await ctx.db
      .query("user_coach_settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { autoSummary: enabled, updatedAt: now });
    } else {
      await ctx.db.insert("user_coach_settings", {
        userId,
        autoSummary: enabled,
        updatedAt: now,
      });
    }
    return { autoSummary: enabled };
  },
});

/** Internal read used by the calendar save trigger to decide whether to
 *  schedule the auto-summary action. Returns the settings row or null. */
export const getCoachSettings = internalQuery({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    { userId },
  ): Promise<{ autoSummary: boolean } | null> => {
    const row = await ctx.db
      .query("user_coach_settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!row) return null;
    return { autoSummary: row.autoSummary };
  },
});
