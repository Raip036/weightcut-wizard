/**
 * Camp-completion prompt: decides whether to show the full-screen "your camp
 * is complete / start your next one" overlay when the user next opens the app,
 * and records that it was shown so it fires the right number of times.
 *
 * Two trigger kinds (wrapup takes priority over next_camp):
 *
 *   • "wrapup"     — the user has a camp whose fightDate has PASSED, is not yet
 *                    completed, and we haven't shown the takeover for it. Fires
 *                    EXACTLY ONCE per camp (CAS on `completionOverlayShownAt`).
 *                    Capped to camps within the last RECENT_WINDOW_DAYS so we
 *                    never resurrect an ancient camp on first deploy.
 *
 *   • "next_camp"  — a fighter who has NO upcoming non-completed camp. This is a
 *                    standing state, so we nudge once then respect a 7-day
 *                    cooldown (`profiles.nextCampNudgeShownAt`).
 *
 * The persistent `PostFightDebrief` card is intentionally left untouched — it
 * stays as the gentle ongoing reminder for anyone who skips the takeover.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUserId } from "./lib/auth";

/** Only surface the forceful wrap-up takeover for camps this recent (days). */
const RECENT_WINDOW_DAYS = 21;
/** Re-nudge a camp-less fighter at most this often (ms). */
const NEXT_CAMP_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const CAMP_SCAN_LIMIT = 50;

function isoNDaysAgo(now: number, days: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const getCampCompletionPrompt = query({
  args: {},
  returns: v.union(
    v.object({
      kind: v.literal("wrapup"),
      camp: v.object({
        id: v.id("fight_camps"),
        name: v.string(),
        fightDate: v.string(),
        eventName: v.union(v.string(), v.null()),
        performanceFeeling: v.union(v.string(), v.null()),
      }),
    }),
    v.object({ kind: v.literal("next_camp") }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const now = Date.now();
    const todayIso = new Date(now).toISOString().slice(0, 10);
    const recentCutoffIso = isoNDaysAgo(now, RECENT_WINDOW_DAYS);

    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(CAMP_SCAN_LIMIT);

    // ── Priority 1: a recently-passed, not-completed, not-yet-shown camp ──
    const pendingWrapup = camps
      .filter(
        (c) =>
          !c.isCompleted &&
          c.completionOverlayShownAt == null &&
          c.fightDate < todayIso &&
          c.fightDate >= recentCutoffIso,
      )
      .sort((a, b) => b.fightDate.localeCompare(a.fightDate));

    const wrapCamp = pendingWrapup[0];
    if (wrapCamp) {
      return {
        kind: "wrapup" as const,
        camp: {
          id: wrapCamp._id,
          name: wrapCamp.name,
          fightDate: wrapCamp.fightDate,
          eventName: wrapCamp.eventName ?? null,
          performanceFeeling: wrapCamp.performanceFeeling ?? null,
        },
      };
    }

    // ── Priority 2: a fighter sitting with no upcoming camp ──
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile || profile.role !== "fighter") return null;

    const hasUpcoming = camps.some(
      (c) => !c.isCompleted && c.fightDate >= todayIso,
    );
    if (hasUpcoming) return null;

    const lastNudge = profile.nextCampNudgeShownAt ?? 0;
    if (now - lastNudge < NEXT_CAMP_COOLDOWN_MS) return null;

    return { kind: "next_camp" as const };
  },
});

/**
 * Record that the overlay was shown. Called on REVEAL (not on dismiss) so a
 * force-quit mid-overlay still counts. For "wrapup" this is a compare-and-set:
 * `firstTime` is false if another device already claimed it.
 */
export const markCampPromptShown = mutation({
  args: {
    kind: v.union(v.literal("wrapup"), v.literal("next_camp")),
    campId: v.optional(v.id("fight_camps")),
  },
  returns: v.object({ firstTime: v.boolean() }),
  handler: async (ctx, { kind, campId }) => {
    const userId = await requireUserId(ctx);

    if (kind === "wrapup") {
      if (!campId) throw new Error("campId required for wrapup");
      const camp = await ctx.db.get(campId);
      if (!camp) throw new Error("Camp not found");
      if (camp.userId !== userId) throw new Error("Not authorized");
      if (camp.completionOverlayShownAt != null) return { firstTime: false };
      await ctx.db.patch(campId, { completionOverlayShownAt: Date.now() });
      return { firstTime: true };
    }

    // next_camp: stamp the profile-level cooldown.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    await ctx.db.patch(profile._id, { nextCampNudgeShownAt: Date.now() });
    return { firstTime: true };
  },
});
