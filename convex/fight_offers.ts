/**
 * Fight offer mutations + queries.
 *
 * A fight offer is a `gym_announcements` row with `kind: "fight_offer"`
 * plus a 1:1 `fight_offers` row carrying the structured fields (date,
 * weight class, event, opponent…). The announcement carries the common
 * feed metadata (sender, body, targets, media) so the fighter-facing
 * `announcements.listForUser` query already returns offers; this module
 * adds the create/respond/select mutations + a coach-facing detail query.
 *
 * Design notes — see docs/superpowers/specs/2026-05-16-fight-offers-design.md
 * for the full design rationale. Highlights:
 *  - Ternary signal (yes / maybe / pass), one row per (offer, user) upserted
 *    on change.
 *  - `selectFighter` auto-creates a fight camp pre-populated with the
 *    offer's date + weight class, unless the fighter has an active camp
 *    that would overlap — in which case the offer still flips to "filled"
 *    but `fightCampId` stays null and the UI surfaces a warning.
 *  - `withdrawOffer` keeps interest rows for audit; only the status flips.
 */
import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { assertGymOwner, assertGymMember } from "./gyms";
import { internal } from "./_generated/api";

// ─────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Coach-only. Creates the announcement + offer row in one mutation. The
 * announcement is the feed surface (kind: "fight_offer", body = pitch),
 * the offer row carries the structured fields.
 */
export const createOffer = mutation({
  args: {
    gymId: v.id("gyms"),
    body: v.optional(v.string()),
    targetUserIds: v.optional(v.array(v.id("users"))),
    imageUrl: v.optional(v.string()),
    mediaStorageId: v.optional(v.id("_storage")),
    mediaKind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    // Structured offer fields
    fightDate: v.number(),
    weightClassKg: v.number(),
    eventName: v.optional(v.string()),
    opponentName: v.optional(v.string()),
    location: v.optional(v.string()),
    purseText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, args.gymId, userId);

    if (!Number.isFinite(args.fightDate) || args.fightDate <= 0) {
      throw new Error("Fight date is required");
    }
    if (!Number.isFinite(args.weightClassKg) || args.weightClassKg <= 0) {
      throw new Error("Weight class is required");
    }

    const isBroadcast = !args.targetUserIds || args.targetUserIds.length === 0;
    const trimmedBody = args.body?.trim() || undefined;

    const announcementId = await ctx.db.insert("gym_announcements", {
      gymId: args.gymId,
      senderUserId: userId,
      body: trimmedBody,
      isBroadcast,
      kind: "fight_offer",
      imageUrl: args.imageUrl,
      mediaStorageId: args.mediaStorageId,
      mediaKind: args.mediaKind,
    });

    if (!isBroadcast && args.targetUserIds) {
      for (const targetId of args.targetUserIds) {
        await ctx.db.insert("gym_announcement_targets", {
          announcementId,
          userId: targetId,
        });
      }
    }

    const offerId = await ctx.db.insert("fight_offers", {
      announcementId,
      gymId: args.gymId,
      fightDate: args.fightDate,
      weightClassKg: args.weightClassKg,
      eventName: args.eventName?.trim() || undefined,
      opponentName: args.opponentName?.trim() || undefined,
      location: args.location?.trim() || undefined,
      purseText: args.purseText?.trim() || undefined,
      status: "open",
    });

    // Fire-and-forget push fanout via the same path text/poll announcements
    // use. Scheduled (not awaited) so latency stays bounded for the coach.
    await ctx.scheduler.runAfter(
      0,
      internal.actions.sendAnnouncementPush.run,
      { announcementId },
    );

    return { announcementId, offerId };
  },
});

/**
 * Fighter expresses interest. Upserts on (offerId, userId) so changing
 * your answer just overwrites the row — no signal history.
 */
export const setInterest = mutation({
  args: {
    offerId: v.id("fight_offers"),
    signal: v.union(
      v.literal("yes"),
      v.literal("maybe"),
      v.literal("pass"),
    ),
  },
  handler: async (ctx, { offerId, signal }) => {
    const userId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    if (offer.status !== "open") {
      throw new Error("Offer no longer open");
    }
    // Must be a member of the gym hosting the offer.
    await assertGymMember(ctx, offer.gymId, userId);

    const existing = await ctx.db
      .query("fight_offer_interests")
      .withIndex("by_offer_user", (q) =>
        q.eq("offerId", offerId).eq("userId", userId),
      )
      .unique();

    if (existing) {
      if (existing.signal === signal) return existing._id;
      await ctx.db.patch(existing._id, { signal, createdAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("fight_offer_interests", {
      offerId,
      userId,
      signal,
      createdAt: Date.now(),
    });
  },
});

/**
 * Coach picks a fighter. Auto-creates a fight camp pre-populated with the
 * offer's date + weight class; if the fighter already has an overlapping
 * active camp we skip camp creation but still flip the offer to "filled"
 * so the coach has closure. The skipped-camp warning is surfaced via the
 * return value so the UI can display it inline.
 */
export const selectFighter = mutation({
  args: {
    offerId: v.id("fight_offers"),
    fighterUserId: v.id("users"),
  },
  handler: async (ctx, { offerId, fighterUserId }) => {
    const coachUserId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await assertGymOwner(ctx, offer.gymId, coachUserId);

    if (offer.status !== "open") {
      throw new Error("This offer was just filled");
    }

    // The fight_camps table treats `isCompleted: false | undefined` as an
    // active camp. If the fighter already has one we keep their hands off
    // their data and just flip the offer to filled with no camp link; the
    // coach gets a warning the UI surfaces inline.
    const existingCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", fighterUserId))
      .collect();
    const overlapping = existingCamps.find((c) => !c.isCompleted);

    const fightDateIso = new Date(offer.fightDate).toISOString().slice(0, 10);

    let fightCampId: Id<"fight_camps"> | null = null;
    if (!overlapping) {
      // Create a new camp anchored on the offer's date. The schema's camp
      // row carries name + fightDate (string YYYY-MM-DD); the target weight
      // lives on the fighter's profile (fightWeekTargetKg) so the rest of
      // the app reads from one place.
      const newCampId = await ctx.db.insert("fight_camps", {
        userId: fighterUserId,
        name: offer.eventName ?? "Fight Camp",
        fightDate: fightDateIso,
        eventName: offer.eventName ?? undefined,
        updatedAt: Date.now(),
      });
      fightCampId = newCampId;
    }

    // ALWAYS patch the fighter's profile so every AI feature
    // (cut-plan, weight-cut math, fight-camp coach, fight-week analysis,
    // hydration protocol, etc.) starts using the coach-confirmed fight
    // date the moment confirmation lands. This used to be gated on
    // `!overlapping` which left fighters with an active camp pointing
    // at their old target date — making AI suggestions diverge from
    // the fight the coach just put them on.
    const fighterProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", fighterUserId))
      .unique();
    if (fighterProfile) {
      await ctx.db.patch(fighterProfile._id, {
        targetDate: fightDateIso,
        fightWeekTargetKg: offer.weightClassKg,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(offerId, {
      status: "filled",
      selectedFighterUserId: fighterUserId,
      fightCampId: fightCampId ?? undefined,
      filledAt: Date.now(),
    });

    // Notify the picked fighter — show up in their announcements feed AND
    // fire a push. Targeted (not broadcast) so it only goes to them.
    const eventLine = offer.eventName ? ` for ${offer.eventName}` : "";
    const dateLine = new Date(offer.fightDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    await notifyFighter(ctx, {
      gymId: offer.gymId,
      coachUserId,
      fighterUserId,
      body:
        `You're up${eventLine}!\n` +
        `${dateLine} · ${offer.weightClassKg.toFixed(1)}kg.\n` +
        (overlapping
          ? "Your target date is now this fight — your old camp is still on your dashboard, review it when you can."
          : "Fight camp opened with your new date and target weight."),
    });

    return {
      filled: true,
      fightCampId,
      skippedCampCreation: !!overlapping,
    };
  },
});

/**
 * Coach-only: pull the offer back. Works on open OR filled offers. When a
 * previously-filled offer is withdrawn we notify the picked fighter and
 * clear the selection on the offer row, but we DO NOT touch the fight
 * camp / profile data we wrote when they were picked — destroying the
 * fighter's training plan would be too aggressive. The fighter can
 * delete it themselves from their dashboard if they no longer need it.
 */
export const withdrawOffer = mutation({
  args: { offerId: v.id("fight_offers") },
  handler: async (ctx, { offerId }) => {
    const coachUserId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await assertGymOwner(ctx, offer.gymId, coachUserId);
    if (offer.status === "withdrawn") return; // idempotent

    const previouslyFilledFighter = offer.selectedFighterUserId ?? null;

    await ctx.db.patch(offerId, {
      status: "withdrawn",
      selectedFighterUserId: undefined,
      fightCampId: undefined,
      filledAt: undefined,
    });

    if (previouslyFilledFighter) {
      await notifyFighter(ctx, {
        gymId: offer.gymId,
        coachUserId,
        fighterUserId: previouslyFilledFighter,
        body:
          "The fight you were offered has been withdrawn. " +
          "Your training plan is still in your dashboard — adjust or delete it if you no longer need it.",
      });
    }
  },
});

/**
 * Coach-only: re-open a filled offer without picking a new fighter yet.
 * Clears the previously-picked fighter from the offer + notifies them so
 * they aren't left thinking the slot is still theirs. Their auto-created
 * fight camp + profile target are left in place (same reasoning as
 * withdrawOffer).
 */
export const reopenOffer = mutation({
  args: { offerId: v.id("fight_offers") },
  handler: async (ctx, { offerId }) => {
    const coachUserId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await assertGymOwner(ctx, offer.gymId, coachUserId);
    if (offer.status === "open") return;

    const previouslyFilledFighter = offer.selectedFighterUserId ?? null;
    await ctx.db.patch(offerId, {
      status: "open",
      selectedFighterUserId: undefined,
      fightCampId: undefined,
      filledAt: undefined,
    });

    if (previouslyFilledFighter) {
      await notifyFighter(ctx, {
        gymId: offer.gymId,
        coachUserId,
        fighterUserId: previouslyFilledFighter,
        body:
          "Your coach reopened the fight offer — the slot's no longer confirmed for you. " +
          "Check the offer to see what's next.",
      });
    }
  },
});

/**
 * Coach-only: swap the selected fighter on a filled offer. Auto-creates a
 * fresh camp for the new fighter (same logic as `selectFighter`) and
 * notifies both the old and new fighters. Old fighter's existing camp +
 * profile target are untouched so they can decide what to do with their
 * existing plan.
 */
export const changeFighter = mutation({
  args: {
    offerId: v.id("fight_offers"),
    newFighterUserId: v.id("users"),
  },
  handler: async (ctx, { offerId, newFighterUserId }) => {
    const coachUserId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await assertGymOwner(ctx, offer.gymId, coachUserId);
    if (offer.status !== "filled") {
      throw new Error("Only filled offers can be reassigned");
    }
    if (offer.selectedFighterUserId === newFighterUserId) return;

    const previousFighter = offer.selectedFighterUserId ?? null;

    // Mirror selectFighter's camp-creation behaviour for the new fighter.
    const existingCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", newFighterUserId))
      .collect();
    const overlapping = existingCamps.find((c) => !c.isCompleted);
    const fightDateIso = new Date(offer.fightDate).toISOString().slice(0, 10);

    let newCampId: Id<"fight_camps"> | null = null;
    if (!overlapping) {
      newCampId = await ctx.db.insert("fight_camps", {
        userId: newFighterUserId,
        name: offer.eventName ?? "Fight Camp",
        fightDate: fightDateIso,
        eventName: offer.eventName ?? undefined,
        updatedAt: Date.now(),
      });
    }

    // Mirror selectFighter — always patch the new fighter's profile
    // target so every AI feature picks up the coach-confirmed fight
    // date. Camp creation stays gated on overlap (we don't want to
    // double-stack camps), but the profile target is the single source
    // of truth that AI features read, so it MUST update.
    const newFighterProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", newFighterUserId))
      .unique();
    if (newFighterProfile) {
      await ctx.db.patch(newFighterProfile._id, {
        targetDate: fightDateIso,
        fightWeekTargetKg: offer.weightClassKg,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(offerId, {
      selectedFighterUserId: newFighterUserId,
      fightCampId: newCampId ?? undefined,
      filledAt: Date.now(),
    });

    // Notify both sides — winner gets the "you're up" message, the
    // displaced fighter gets a heads-up.
    const dateLine = new Date(offer.fightDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    await notifyFighter(ctx, {
      gymId: offer.gymId,
      coachUserId,
      fighterUserId: newFighterUserId,
      body:
        `You're up${offer.eventName ? ` for ${offer.eventName}` : ""}!\n` +
        `${dateLine} · ${offer.weightClassKg.toFixed(1)}kg.\n` +
        (overlapping
          ? "Your target date is now this fight — your old camp is still on your dashboard, review it when you can."
          : "Fight camp opened with your new date and target weight."),
    });
    if (previousFighter && previousFighter !== newFighterUserId) {
      await notifyFighter(ctx, {
        gymId: offer.gymId,
        coachUserId,
        fighterUserId: previousFighter,
        body:
          "The fight you were offered has been reassigned. Your training plan is still in your dashboard if you want to keep using it.",
      });
    }

    return {
      changed: true,
      newCampId,
      skippedCampCreation: !!overlapping,
    };
  },
});

/**
 * Coach-only: permanently delete an offer, the parent announcement, every
 * interest row, and any media attached. If the offer was previously
 * filled, the picked fighter gets a notification. Their fight camp +
 * profile target are left in place — destructive data deletes are
 * scoped to the offer surface only.
 */
export const deleteOffer = mutation({
  args: { offerId: v.id("fight_offers") },
  handler: async (ctx, { offerId }) => {
    const coachUserId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) return;
    await assertGymOwner(ctx, offer.gymId, coachUserId);

    const previouslyFilledFighter = offer.selectedFighterUserId ?? null;

    // Wipe interests first so nothing references the offer.
    const interests = await ctx.db
      .query("fight_offer_interests")
      .withIndex("by_offer", (q) => q.eq("offerId", offerId))
      .collect();
    for (const row of interests) await ctx.db.delete(row._id);

    // Drop the parent announcement (and its targets / media storage).
    const ann = await ctx.db.get(offer.announcementId);
    if (ann) {
      const targets = await ctx.db
        .query("gym_announcement_targets")
        .withIndex("by_announcement", (q) => q.eq("announcementId", ann._id))
        .collect();
      for (const t of targets) await ctx.db.delete(t._id);
      if (ann.mediaStorageId) {
        try {
          await ctx.storage.delete(ann.mediaStorageId);
        } catch {
          /* already gone — fine */
        }
      }
      await ctx.db.delete(ann._id);
    }

    await ctx.db.delete(offerId);

    if (previouslyFilledFighter) {
      await notifyFighter(ctx, {
        gymId: offer.gymId,
        coachUserId,
        fighterUserId: previouslyFilledFighter,
        body:
          "The fight you were offered has been cancelled by your coach. Your training plan is still in your dashboard.",
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Post a targeted text announcement to a single fighter and trigger the
 * existing push fanout. Used by offer-lifecycle mutations to keep fighters
 * in the loop when their slot moves.
 */
async function notifyFighter(
  ctx: MutationCtx,
  args: {
    gymId: Id<"gyms">;
    coachUserId: Id<"users">;
    fighterUserId: Id<"users">;
    body: string;
  },
) {
  const announcementId = await ctx.db.insert("gym_announcements", {
    gymId: args.gymId,
    senderUserId: args.coachUserId,
    body: args.body,
    isBroadcast: false,
    kind: "text",
  });
  await ctx.db.insert("gym_announcement_targets", {
    announcementId,
    userId: args.fighterUserId,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.sendAnnouncementPush.run,
    { announcementId },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────

/**
 * Coach-facing summary of the gym's recent offers — newest first. Pre-
 * computes per-status interest counts so the dashboard tile can show
 * "3 yes · 1 maybe" without a per-offer follow-up.
 */
export const listForGym = query({
  args: { gymId: v.id("gyms"), limit: v.optional(v.number()) },
  handler: async (ctx, { gymId, limit }) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, gymId, userId);
    const cap = Math.min(limit ?? 20, 50);

    const offers = await ctx.db
      .query("fight_offers")
      .withIndex("by_gym_status", (q) => q.eq("gymId", gymId))
      .collect();
    // Newest first by _creationTime (offer id is monotonic).
    offers.sort((a, b) => b._creationTime - a._creationTime);
    const sliced = offers.slice(0, cap);

    return Promise.all(
      sliced.map(async (offer) => {
        const interests = await ctx.db
          .query("fight_offer_interests")
          .withIndex("by_offer", (q) => q.eq("offerId", offer._id))
          .collect();
        const counts = { yes: 0, maybe: 0, pass: 0 };
        for (const r of interests) counts[r.signal] += 1;
        return {
          id: offer._id,
          announcement_id: offer.announcementId,
          fight_date: offer.fightDate,
          weight_class_kg: offer.weightClassKg,
          event_name: offer.eventName ?? null,
          opponent_name: offer.opponentName ?? null,
          location: offer.location ?? null,
          status: offer.status,
          selected_fighter_user_id: offer.selectedFighterUserId ?? null,
          counts,
        };
      }),
    );
  },
});

/**
 * Coach-facing offer detail. Returns the offer row plus every interest
 * joined to lightweight athlete data (display name, avatar, current
 * weight, goal weight) so the picker UI has everything in one round-trip.
 */
export const getOffer = query({
  args: { offerId: v.id("fight_offers") },
  handler: async (ctx, { offerId }) => {
    const userId = await requireUserId(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) return null;
    await assertGymOwner(ctx, offer.gymId, userId);

    const interests = await ctx.db
      .query("fight_offer_interests")
      .withIndex("by_offer", (q) => q.eq("offerId", offerId))
      .collect();

    const enriched = await Promise.all(
      interests.map(async (row) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", row.userId))
          .unique();
        return {
          user_id: row.userId,
          signal: row.signal,
          created_at: row.createdAt,
          display_name: profile?.displayName ?? "Athlete",
          current_weight_kg: profile?.currentWeightKg ?? null,
          goal_weight_kg: profile?.goalWeightKg ?? null,
        };
      }),
    );

    return {
      id: offer._id,
      announcement_id: offer.announcementId,
      gym_id: offer.gymId,
      fight_date: offer.fightDate,
      weight_class_kg: offer.weightClassKg,
      event_name: offer.eventName ?? null,
      opponent_name: offer.opponentName ?? null,
      location: offer.location ?? null,
      purse_text: offer.purseText ?? null,
      status: offer.status,
      selected_fighter_user_id: offer.selectedFighterUserId ?? null,
      fight_camp_id: offer.fightCampId ?? null,
      interests: enriched,
    };
  },
});
