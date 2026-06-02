/**
 * Fight-camp domain: combines five tables into one file because they all
 * share the same access pattern (auth scope by userId + simple list/CRUD).
 *
 * Tables covered: fight_camps, fight_camp_calendar, fight_week_logs,
 *                 fight_week_plans, training_summaries.
 */
import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { internal } from "./_generated/api";
import { normalizeLegacySession } from "./lib/sessionTypes";

// ───────────────────────────────────────────────────────────────────────
// Smart-defaults constants
// ───────────────────────────────────────────────────────────────────────

/**
 * Mirror of the "Steady" preset in
 * `src/components/nav/QuickLogDialog.tsx` (INTENSITY_PRESETS[1]). Kept here
 * so `getSmartDefaults` returns the exact same values the QuickLog preset
 * fills in when the user taps "Steady". If you change the preset over
 * there, change this here too — there is no shared source of truth yet.
 */
const STEADY_PRESET = {
  intensity: "Steady",
  intensityLevel: 2,
  rpe: 5,
} as const;

/** Final fallbacks when the user has no calendar history at all. */
const FALLBACK_SESSION_TYPE = "Strength";
const FALLBACK_DURATION_MINUTES = 60;
const RECENT_HISTORY_TAKE = 200;
const SAME_TYPE_SAMPLE_SIZE = 5;

// ───────────────────────────────────────────────────────────────────────
// Validation helpers
// ───────────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function assertValidFightDate(fightDate: string) {
  if (!ISO_DATE.test(fightDate)) {
    throw new Error("fightDate must be ISO YYYY-MM-DD");
  }
  const ts = Date.parse(fightDate);
  if (Number.isNaN(ts)) {
    throw new Error("fightDate is not a valid date");
  }
  const now = Date.now();
  // Allow today (subtract one day's worth of ms to permit same-day creation).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (ts < todayStart.getTime()) {
    throw new Error("fightDate must be today or later");
  }
  if (ts > now + FIVE_YEARS_MS) {
    throw new Error("fightDate must be within 5 years");
  }
}

function assertValidStartingWeight(startingWeightKg: number | undefined) {
  if (startingWeightKg === undefined) return;
  if (!Number.isFinite(startingWeightKg)) {
    throw new Error("startingWeightKg must be a finite number");
  }
  if (startingWeightKg < 30 || startingWeightKg > 250) {
    throw new Error("startingWeightKg must be between 30 and 250 kg");
  }
}

// ───────────────────────────────────────────────────────────────────────
// fight_camps
// ───────────────────────────────────────────────────────────────────────

export const listCamps = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows;
  },
});

export const getCamp = query({
  args: { id: v.id("fight_camps") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return null;
    if (row.userId !== userId) throw new Error("Not authorized");
    return row;
  },
});

export const createCamp = mutation({
  args: {
    name: v.string(),
    fightDate: v.string(),
    eventName: v.optional(v.string()),
    profilePicUrl: v.optional(v.string()),
    weighInTiming: v.optional(v.string()),
    startingWeightKg: v.optional(v.number()),
    endWeightKg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    assertValidFightDate(args.fightDate);
    assertValidStartingWeight(args.startingWeightKg);
    return await ctx.db.insert("fight_camps", {
      userId,
      ...args,
      updatedAt: Date.now(),
    });
  },
});

export const updateCamp = mutation({
  args: {
    id: v.id("fight_camps"),
    name: v.optional(v.string()),
    fightDate: v.optional(v.string()),
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
  },
  handler: async (ctx, { id, ...rest }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Camp not found");
    if (row.userId !== userId) throw new Error("Not authorized");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch as any);
  },
});

export const deleteCamp = mutation({
  args: { id: v.id("fight_camps") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(id);
  },
});

/**
 * Derive the user's currently active camp. "Active" = the latest non-completed
 * camp whose fightDate is in the future (or today). When nothing is upcoming
 * we fall back to the most-recent camp regardless of state so the dashboard
 * can offer a "wrap up + start next" prompt even after the fight date passes.
 *
 * Pure-read; no schema change. Keeps existing consumers (which still read
 * profiles.target_date) backwards-compatible.
 */
export const getActiveCamp = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // Bounded scan: most users have <50 camps; the index returns insertion
    // order so we sort/filter in-memory from this slice.
    const rows = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    if (rows.length === 0) return null;

    const todayIso = new Date().toISOString().slice(0, 10);
    const upcoming = rows
      .filter((r) => !r.isCompleted && r.fightDate >= todayIso)
      .sort((a, b) => a.fightDate.localeCompare(b.fightDate)); // soonest first

    if (upcoming.length > 0) return upcoming[0];

    // No upcoming non-completed camp — return the most-recent camp by
    // fightDate so the UI can decide whether to offer a wrap-up prompt.
    const sorted = [...rows].sort((a, b) => b.fightDate.localeCompare(a.fightDate));
    return sorted[0];
  },
});

/**
 * Mark a camp complete and (optionally) write the retrospective fields the
 * schema already supports. Used by WrapUpCampDialog before the user starts
 * a new camp.
 */
export const completeCamp = mutation({
  args: {
    id: v.id("fight_camps"),
    endWeightKg: v.optional(v.number()),
    totalWeightCut: v.optional(v.number()),
    weightViaDehydration: v.optional(v.number()),
    weightViaCarbReduction: v.optional(v.number()),
    rehydrationNotes: v.optional(v.string()),
    performanceFeeling: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Camp not found");
    if (row.userId !== userId) throw new Error("Not authorized");
    const patch: Record<string, unknown> = {
      isCompleted: true,
      updatedAt: Date.now(),
    };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(id, patch as any);
  },
});

/**
 * Called from the initial onboarding flow and the NextCampWizard. Inserts a
 * fight_camps row only when there's no active row that already covers the
 * same fightDate; this keeps the call idempotent (re-running onboarding from
 * a stale draft won't produce duplicate camps).
 */
export const createCampFromOnboarding = mutation({
  args: {
    name: v.string(),
    fightDate: v.string(),
    eventName: v.optional(v.string()),
    weighInTiming: v.optional(v.string()),
    startingWeightKg: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    assertValidFightDate(args.fightDate);
    assertValidStartingWeight(args.startingWeightKg);
    const existing = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const dupe = existing.find(
      (r) => !r.isCompleted && r.fightDate === args.fightDate,
    );
    if (dupe) return dupe._id;
    return await ctx.db.insert("fight_camps", {
      userId,
      ...args,
      updatedAt: Date.now(),
    });
  },
});

// ───────────────────────────────────────────────────────────────────────
// fight_camp_calendar
// ───────────────────────────────────────────────────────────────────────

export const listCalendar = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("userId", userId);
        if (from && to) return base.gte("date", from).lte("date", to);
        if (from) return base.gte("date", from);
        if (to) return base.lte("date", to);
        return base;
      })
      .collect();
    // Resolve mediaUrl ONLY for rows that have a mediaStorageId.
    // Perf model: bounded by media-having-rows, not total rows. A typical
    // 28-day calendar has ~3-5 sessions with media → 3-5 storage.getUrl
    // calls per tick instead of 28. Agent B previously stripped this
    // resolution entirely to fix the O(N) hot path; this restores
    // thumbnails for Recovery + TrainingCalendar while keeping the win.
    const mediaRowIndexes: number[] = [];
    rows.forEach((r, i) => {
      if (r.mediaStorageId) mediaRowIndexes.push(i);
    });
    const resolvedUrls = await Promise.all(
      mediaRowIndexes.map((i) => ctx.storage.getUrl(rows[i].mediaStorageId!)),
    );
    const urlByIndex = new Map<number, string | null>();
    mediaRowIndexes.forEach((i, k) => urlByIndex.set(i, resolvedUrls[k]));
    return rows.map((r, i) => {
      // Migrate-on-read: legacy rows stored an activity string in sessionType.
      // Split into {primary, tag} so every consumer sees the new two-level
      // shape (sessionType = primary, sessionTag = optional activity).
      const norm = normalizeLegacySession(r.sessionType, r.sessionTag);
      return {
        ...r,
        sessionType: norm.primary,
        sessionTag: norm.tag ?? undefined,
        mediaUrl: urlByIndex.get(i) ?? null,
      };
    });
  },
});

/**
 * Pre-fill the ReviewSheet chips (gym / sessionType / duration / intensity)
 * for the photo-first round-card flow with a single DB round-trip.
 *
 * Resolution rules (see 2026-05-19-round-card-photo-first-tracking-design):
 *  - gymId / gymName ........ user's primary active `gym_members` row,
 *                             gym name resolved via `gyms` lookup
 *  - sessionType ............ today's planned `fight_camp_calendar` row
 *                             (if any), else most recent logged session,
 *                             else "Strength"
 *  - durationMinutes ........ rounded mean of the last 5 same-type
 *                             durations; fallback 60
 *  - intensity / *Level / rpe the "Steady" preset values from
 *                             QuickLogDialog
 *
 * Returns the literal fallback shape when unauthenticated so the
 * ReviewSheet never blocks on a missing identity (the spec calls for the
 * sheet to render chips with whatever it can resolve and save anyway).
 */
export const getSmartDefaults = query({
  args: {},
  returns: v.object({
    gymId: v.union(v.id("gyms"), v.null()),
    gymName: v.union(v.string(), v.null()),
    gymLogoUrl: v.union(v.string(), v.null()),
    sessionType: v.string(),
    sessionTag: v.union(v.string(), v.null()),
    durationMinutes: v.number(),
    intensity: v.string(),
    intensityLevel: v.number(),
    rpe: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        gymId: null,
        gymName: null,
        gymLogoUrl: null,
        sessionType: FALLBACK_SESSION_TYPE,
        sessionTag: null,
        durationMinutes: FALLBACK_DURATION_MINUTES,
        intensity: STEADY_PRESET.intensity,
        intensityLevel: STEADY_PRESET.intensityLevel,
        rpe: STEADY_PRESET.rpe,
      };
    }

    // 1. Primary active gym (first active membership wins — multi-gym
    //    leaderboards are out of scope; same heuristic as
    //    `addSessionMedia` / `createCalendarEntry` below).
    const membership = await ctx.db
      .query("gym_members")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .first();
    let gymId: Id<"gyms"> | null = null;
    let gymName: string | null = null;
    // `gyms.logoStorageId` is a Convex Storage reference (v.id("_storage")),
    // so we materialise it to a long-lived URL here for the polaroid's
    // bottom strip. Null when the gym has no logo set (or no membership).
    let gymLogoUrl: string | null = null;
    if (membership) {
      gymId = membership.gymId;
      const gym = await ctx.db.get(membership.gymId);
      gymName = gym?.name ?? null;
      if (gym?.logoStorageId) {
        gymLogoUrl = await ctx.storage.getUrl(gym.logoStorageId);
      }
    }

    // 2. Session type — prefer today's planned row, else most recent
    //    logged row, else the hard-coded fallback. Today's date is built
    //    from the server clock as YYYY-MM-DD; the client renders the
    //    chip from this string so there's no TZ drift to chase here.
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayRow = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", todayIso),
      )
      .first();

    let rawType: string;
    let rawTag: string | null | undefined;
    if (todayRow) {
      rawType = todayRow.sessionType;
      rawTag = todayRow.sessionTag;
    } else {
      // Most-recent logged session by date (descending). Bounded scan;
      // typical users log < 1k sessions and we only need the newest.
      const mostRecent = await ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .first();
      rawType = mostRecent?.sessionType ?? FALLBACK_SESSION_TYPE;
      rawTag = mostRecent?.sessionTag;
    }
    // Split into the two-level shape so the ReviewSheet prefills the primary
    // chip + optional tag chip.
    const { primary: sessionType, tag: sessionTag } = normalizeLegacySession(
      rawType,
      rawTag,
    );

    // 3. Duration — mean of the last 5 same-type entries, rounded to the
    //    nearest 5 minutes. Falls back to 60 when there's no history.
    //    We pull a bounded slice via the user-date index (descending) and
    //    filter in memory so we don't need a (userId, sessionType) index.
    const recent = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(RECENT_HISTORY_TAKE);
    const sameType = recent
      .filter(
        (r) =>
          normalizeLegacySession(r.sessionType, r.sessionTag).primary ===
          sessionType,
      )
      .slice(0, SAME_TYPE_SAMPLE_SIZE);

    let durationMinutes: number = FALLBACK_DURATION_MINUTES;
    if (sameType.length > 0) {
      const sum = sameType.reduce((acc, r) => acc + r.durationMinutes, 0);
      const mean = sum / sameType.length;
      // Round to nearest 5 minutes; clamp to a sane minimum so a stale
      // partial entry can't suggest a 0-minute session.
      const rounded = Math.round(mean / 5) * 5;
      durationMinutes = rounded > 0 ? rounded : FALLBACK_DURATION_MINUTES;
    }

    return {
      gymId,
      gymName,
      gymLogoUrl,
      sessionType,
      sessionTag: sessionTag ?? null,
      durationMinutes,
      intensity: STEADY_PRESET.intensity,
      intensityLevel: STEADY_PRESET.intensityLevel,
      rpe: STEADY_PRESET.rpe,
    };
  },
});

/**
 * Step 1 of the training-media upload flow: returns a one-time POST URL.
 * The client posts the image/video to it, receives a `storageId`, then
 * passes it to `createCalendarEntry` / `updateCalendarEntry` below.
 */
export const generateMediaUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Resolve a freshly uploaded media `storageId` to a long-lived public URL.
 * Auth-gated so anonymous callers can't enumerate storage. Used by the
 * upload helper to surface a URL the legacy supabase `media_url` column
 * can still hold during the transition window.
 */
export const getMediaUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await requireUserId(ctx);
    return await ctx.storage.getUrl(storageId);
  },
});

export const createCalendarEntry = mutation({
  args: {
    date: v.string(),
    // PRIMARY category (martial art / "S&C" / "Rest").
    sessionType: v.string(),
    // Optional activity tag (Sparring, Strength, …).
    sessionTag: v.optional(v.string()),
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
    // Contact rounds for sparring / live grappling sessions. Omitted for
    // non-contact sessions; the recovery engine reads it for contact load.
    rounds: v.optional(v.number()),
    mediaStorageId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    // Provenance of the row — set by whichever entry surface created it.
    // Optional so historical callers (legacy QuickLog, manual editor) still
    // type-check while the photo-first round-card flow opts in explicitly.
    source: v.optional(v.union(
      v.literal("quicklog"),
      v.literal("round_card"),
      v.literal("manual"),
    )),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    // Find the user's primary active gym membership. First active row wins;
    // multi-gym leaderboards are out of scope.
    const membership = await ctx.db
      .query("gym_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    const sessionId = await ctx.db.insert("fight_camp_calendar", {
      userId,
      gymId: membership?.gymId,
      ...args,
    });
    // Training Coach: schedule note-extraction planner if notes are present.
    if (args.notes && args.notes.trim().length > 0) {
      await ctx.scheduler.runAfter(
        2_000,
        internal.actions.trainingCoachPlanner._runInternal,
        { userId, trigger: "sessionSave", sessionId },
      );
      // Training Missions (Trigger A — see
      // docs/superpowers/specs/2026-05-21-training-missions-design.md).
      // Try-wrapped so a not-yet-deployed action (or codegen lag while the
      // sibling agent's `convex/actions/trainingMissions/generate.ts` lands)
      // can't break session logging.
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingMissions.generate.generateMissionIfReady,
          { userId, sport: args.sessionType },
        );
      } catch (err) {
        console.warn("missions schedule failed", err);
      }
      // Discipline XP — +10 for logging a session with notes. Initial
      // creation only; `updateCalendarEntry` deliberately does NOT award
      // so users can't farm XP by editing the same row. Fire-and-forget
      // try/catch so a scheduler/codegen hiccup never blocks the save.
      try {
        if (args.sessionType) {
          await ctx.scheduler.runAfter(
            0,
            internal.user_discipline_xp.awardXp,
            {
              userId,
              sport: args.sessionType,
              amount: 10,
              reason: "log_session",
            },
          );
        }
      } catch (err) {
        console.warn("disciplineXp schedule failed", err);
      }
    }
    // Recompute fight-form score after calendar entry creation
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: args.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
    return sessionId;
  },
});

export const updateCalendarEntry = mutation({
  args: {
    id: v.id("fight_camp_calendar"),
    sessionType: v.optional(v.string()),
    // Pass a string to set/replace the activity tag, `null` to clear it,
    // or omit to leave unchanged.
    sessionTag: v.optional(v.union(v.string(), v.null())),
    intensity: v.optional(v.string()),
    intensityLevel: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    rpe: v.optional(v.number()),
    bodyweight: v.optional(v.number()),
    fatigueLevel: v.optional(v.number()),
    sorenessLevel: v.optional(v.number()),
    sleepHours: v.optional(v.number()),
    sleepQuality: v.optional(v.string()),
    mobilityDone: v.optional(v.boolean()),
    // Pass a number to set rounds. Not provided ⇒ field unchanged.
    rounds: v.optional(v.number()),
    // Pass `null` to remove the existing media (deletes the storage object).
    mediaStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, mediaStorageId, sessionTag, ...rest }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Entry not found");
    if (row.userId !== userId) throw new Error("Not authorized");

    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    // Activity tag: a string sets it, `null` clears it (stored as absent so
    // the optional schema field validates), `undefined` leaves it unchanged.
    if (sessionTag !== undefined) {
      patch.sessionTag = sessionTag ?? undefined;
    }

    // Handle media replacement / removal: delete the previous storage object
    // BEFORE patching the new id so we never orphan an old file.
    if (mediaStorageId !== undefined) {
      if (row.mediaStorageId && row.mediaStorageId !== mediaStorageId) {
        try {
          await ctx.storage.delete(row.mediaStorageId);
        } catch {
          /* prior media already missing — ignore */
        }
      }
      patch.mediaStorageId = mediaStorageId ?? undefined;
    }

    await ctx.db.patch(id, patch as any);

    // Training Coach: if the notes field was edited (and is non-empty), kick
    // off the planner. Mirrors createCalendarEntry's hook.
    if (typeof rest.notes === "string" && rest.notes.trim().length > 0) {
      await ctx.scheduler.runAfter(
        2_000,
        internal.actions.trainingCoachPlanner._runInternal,
        { userId, trigger: "sessionSave", sessionId: id },
      );
    }

    // Training Missions (Trigger A — see
    // docs/superpowers/specs/2026-05-21-training-missions-design.md).
    // Check the *resulting* row's notes: prefer the just-patched value, fall
    // back to the pre-existing notes when this patch didn't touch them.
    // Try-wrapped so a not-yet-deployed missions action can't break the
    // session edit.
    const effectiveNotes =
      typeof rest.notes === "string" ? rest.notes : row.notes;
    const effectiveSport =
      typeof rest.sessionType === "string" ? rest.sessionType : row.sessionType;
    if (effectiveNotes && effectiveNotes.trim().length > 0) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingMissions.generate.generateMissionIfReady,
          { userId, sport: effectiveSport },
        );
      } catch (err) {
        console.warn("missions schedule failed", err);
      }
    }

    // Recompute fight-form score after calendar entry update. `date` is
    // not editable via this mutation (no `date` arg in the validator), so
    // a single recompute against the row's existing date is sufficient.
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: row.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const deleteCalendarEntry = mutation({
  args: { id: v.id("fight_camp_calendar") },
  handler: async (ctx, { id }) => {
    // Auth: surface a stable, client-distinguishable message. Anything else
    // thrown by this mutation should be a true bug — every transient/missing
    // dependency is swallowed below so the user-visible delete is idempotent.
    const userId = await requireUserId(ctx);

    // Idempotent: deleting an already-deleted row is a no-op, not an error.
    // The client may retry (network blip, double-tap) and must not see a
    // "Couldn't delete" toast just because the row already went.
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) {
      // Distinct from auth — caller is signed in but doesn't own this row.
      throw new Error("Not authorized to delete this session");
    }

    // Legacy single-media attachment. Storage object may already be gone if
    // the row was edited via updateCalendarEntry(mediaStorageId: null) and
    // the file was reaped — swallow that specific error and continue.
    if (row.mediaStorageId) {
      try {
        await ctx.storage.delete(row.mediaStorageId);
      } catch {
        /* already gone — fine */
      }
    }

    // Cascade-delete every multi-attachment media row for this session,
    // freeing the storage objects too. Without this, deleting a session
    // leaks the photo/video bytes forever.
    //
    // EVERY step here is wrapped: a concurrent `removeSessionMedia` from
    // another tab can race us between `.collect()` and `.delete(a._id)`,
    // and an unwrapped throw there used to abort the whole transactional
    // mutation — surfacing as the "Couldn't delete session — Check your
    // connection" toast even though nothing was wrong with the network.
    const attachments = await ctx.db
      .query("session_media")
      .withIndex("by_session", (q) => q.eq("sessionId", id))
      .collect();
    for (const a of attachments) {
      if (a.storageId) {
        try {
          await ctx.storage.delete(a.storageId);
        } catch {
          /* storage object already gone — fine */
        }
      }
      try {
        await ctx.db.delete(a._id);
      } catch {
        /* row already deleted by a concurrent mutation — fine */
      }
    }

    // Final delete of the session row itself. Wrapped for the same race —
    // if a parallel call already removed it, treat as success.
    try {
      await ctx.db.delete(id);
    } catch {
      /* already gone — fine */
    }

    // Recompute fight-form score after calendar entry deletion
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, {
        userId,
        date: row.date,
      });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

// ───────────────────────────────────────────────────────────────────────
// session_media — multi-attachment photo/video on a logged session
// ───────────────────────────────────────────────────────────────────────

/**
 * Persist a freshly uploaded media file against a session. Caller already
 * minted a one-time URL via `generateMediaUploadUrl` and POSTed the bytes
 * — they pass the resulting storageId here together with the session id
 * and the kind (photo|video, derived from the file's MIME type).
 */
export const addSessionMedia = mutation({
  args: {
    sessionId: v.id("fight_camp_calendar"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("photo"), v.literal("video")),
    capturedAt: v.optional(v.string()),
    caption: v.optional(v.string()),
    // Visibility override — defaults to "gym" so existing call sites
    // (legacy QuickLog photo upload, post-workout media picker) are
    // untouched. The photo-first round-card "Log only" CTA passes
    // "private" so the polaroid lands in the user's history without
    // appearing on the gym feed (spec §3.6).
    visibility: v.optional(v.union(v.literal("gym"), v.literal("private"))),
  },
  handler: async (
    ctx,
    { sessionId, storageId, kind, capturedAt, caption, visibility },
  ) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");

    // Resolve the gym the post should appear in. Prefer the session's own
    // `gymId` (already denormalised by the leaderboard pipeline). Fall back
    // to the uploader's primary active membership so a quick-log selfie
    // from a session that wasn't gym-tagged still lands in their gym's
    // feed. NULL = personal-only — the post never appears in `listFeed`.
    let gymId = session.gymId;
    if (!gymId) {
      const primary = await ctx.db
        .query("gym_members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      if (primary) gymId = primary.gymId;
    }

    return await ctx.db.insert("session_media", {
      sessionId,
      userId,
      storageId,
      kind,
      capturedAt: capturedAt ?? session.date,
      caption: caption?.trim() || undefined,
      gymId,
      visibility: visibility ?? "gym",
    });
  },
});

/**
 * Remove one media attachment. Deletes the underlying storage object
 * before the row so an aborted call can't leave a row pointing at a
 * dead storage id.
 */
export const removeSessionMedia = mutation({
  args: { mediaId: v.id("session_media") },
  handler: async (ctx, { mediaId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(mediaId);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    if (row.storageId) {
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        /* already gone */
      }
    }
    await ctx.db.delete(mediaId);
  },
});

/**
 * All media rows for one session, oldest → newest. Each row resolves its
 * storage id to a long-lived URL so the client renders <img>/<video>
 * directly without an extra round-trip.
 */
export const listSessionMedia = query({
  args: { sessionId: v.id("fight_camp_calendar") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) return [];
    const rows = await ctx.db
      .query("session_media")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect();
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        sessionId: r.sessionId,
        kind: r.kind,
        capturedAt: r.capturedAt,
        caption: r.caption ?? null,
        url: r.storageId ? await ctx.storage.getUrl(r.storageId) : null,
        createdAt: r._creationTime,
      })),
    );
  },
});

/**
 * Library view: every media attachment the user owns, newest first, with
 * the parent session's discipline + date joined in. Optional
 * `disciplineFilter` scopes to one session_type ("BJJ", "Boxing", ...).
 *
 * Pagination is intentionally simple (offset-style via `limit`) — we
 * expect typical libraries < 1000 items in the first year and the
 * library page renders the full list with virtualisation handled by
 * `content-visibility: auto`. Switch to a cursor pattern if libraries
 * grow large enough that this becomes a hot path.
 */
export const listMyMediaLibrary = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    disciplineFilter: v.optional(v.string()),
  },
  handler: async (ctx, { limit, cursor, disciplineFilter }) => {
    const userId = await requireUserId(ctx);
    const cap = Math.min(Math.max(limit ?? 60, 10), 100);
    const page = await ctx.db
      .query("session_media")
      .withIndex("by_user_captured", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate({ numItems: cap, cursor: cursor ?? null });
    const rows = page.page;

    // Batch-load all unique sessions in one parallel pass instead of N awaits.
    // Filter out null/undefined sessionIds — legacy session_media rows can
    // have an orphaned sessionId after the parent session was deleted.
    const uniqueSessionIds = Array.from(
      new Set(
        rows
          .map((r) => r.sessionId as unknown as string | null | undefined)
          .filter((sid): sid is string => sid != null && sid !== ""),
      ),
    );
    const sessionDocs = await Promise.all(
      uniqueSessionIds.map((sid) => ctx.db.get(sid as any)),
    );
    const sessions = new Map<string, any>();
    uniqueSessionIds.forEach((sid, i) => {
      const doc = sessionDocs[i];
      if (doc) sessions.set(sid, doc);
    });

    const results = await Promise.all(
      rows.map(async (r) => {
        const s = sessions.get(r.sessionId as unknown as string);
        const norm = s
          ? normalizeLegacySession(s.sessionType as string, s.sessionTag as string | undefined)
          : null;
        return {
          id: r._id,
          sessionId: r.sessionId,
          kind: r.kind,
          capturedAt: r.capturedAt,
          caption: r.caption ?? null,
          url: r.storageId ? await ctx.storage.getUrl(r.storageId) : null,
          sessionType: norm?.primary ?? null,
          sessionTag: norm?.tag ?? null,
          sessionDate: (s?.date as string) ?? r.capturedAt,
          sessionNotes: (s?.notes as string | undefined) ?? null,
        };
      }),
    );
    const filtered =
      disciplineFilter && disciplineFilter !== "all"
        ? results.filter((r) => r.sessionType === disciplineFilter)
        : results;
    return {
      page: filtered,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Distinct discipline labels (session_type) the user has at least one
 * media attachment for. Powers the filter chip row on the library page
 * — only shows chips that actually have media behind them.
 */
export const listMediaDisciplines = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("session_media")
      .withIndex("by_user_captured", (q) => q.eq("userId", userId))
      .take(500);
    // Filter out null/undefined sessionIds — orphaned session_media rows
    // (parent session deleted) would otherwise crash ctx.db.get below.
    const sessionIds = new Set(
      rows
        .map((r) => r.sessionId as unknown as string | null | undefined)
        .filter((sid): sid is string => sid != null && sid !== ""),
    );
    const disciplines = new Set<string>();
    for (const sid of sessionIds) {
      const s = await ctx.db.get(sid as any);
      if (s && (s as any).sessionType) {
        // Group the filter chips by PRIMARY discipline.
        const norm = normalizeLegacySession(
          (s as any).sessionType as string,
          (s as any).sessionTag as string | undefined,
        );
        disciplines.add(norm.primary);
      }
    }
    return Array.from(disciplines).sort();
  },
});

// ───────────────────────────────────────────────────────────────────────
// fight_week_logs
// ───────────────────────────────────────────────────────────────────────

export const listWeekLogs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // Bounded — fight-week is at most ~10 days; 60 is generous.
    const rows = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);
    return rows;
  },
});

export const upsertWeekLog = mutation({
  args: {
    logDate: v.string(),
    weightKg: v.optional(v.number()),
    fluidIntakeMl: v.optional(v.number()),
    carbsG: v.optional(v.number()),
    sweatSessionMin: v.optional(v.number()),
    supplements: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("logDate", args.logDate),
      )
      .first();
    if (existing) {
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      for (const [k, val] of Object.entries(args)) {
        if (val !== undefined && k !== "logDate") patch[k] = val;
      }
      await ctx.db.patch(existing._id, patch as any);
      return existing._id;
    }
    return await ctx.db.insert("fight_week_logs", {
      userId,
      ...args,
      updatedAt: Date.now(),
    });
  },
});

// ───────────────────────────────────────────────────────────────────────
// fight_week_plans
// ───────────────────────────────────────────────────────────────────────

export const getActivePlan = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("fight_week_plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Pick the plan closest to today (or future).
    if (rows.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const future = rows.filter((r) => r.fightDate >= today);
    return (
      future.sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ??
      rows.sort((a, b) => b.fightDate.localeCompare(a.fightDate))[0]
    );
  },
});

export const upsertPlan = mutation({
  args: {
    fightCampId: v.optional(v.id("fight_camps")),
    fightDate: v.string(),
    startingWeightKg: v.number(),
    targetWeightKg: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("fight_week_plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("fightDate"), args.fightDate))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        fightCampId: args.fightCampId ?? existing.fightCampId,
        startingWeightKg: args.startingWeightKg,
        targetWeightKg: args.targetWeightKg,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("fight_week_plans", {
      userId,
      ...args,
      updatedAt: Date.now(),
    });
  },
});

// ───────────────────────────────────────────────────────────────────────
// training_summaries
// ───────────────────────────────────────────────────────────────────────

export const getSummaryForWeek = query({
  args: { weekStart: v.string() },
  handler: async (ctx, { weekStart }) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId).eq("weekStart", weekStart),
      )
      .first();
  },
});

export const upsertSummary = mutation({
  args: {
    weekStart: v.string(),
    sessionIds: v.array(v.string()),
    notesFingerprint: v.string(),
    summaryData: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId).eq("weekStart", args.weekStart),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionIds: args.sessionIds,
        notesFingerprint: args.notesFingerprint,
        summaryData: args.summaryData,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("training_summaries", {
      userId,
      ...args,
      updatedAt: Date.now(),
    });
  },
});

/** All training summaries for the current user, newest first. */
export const listAllSummaries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await requireUserId(ctx);
    const cap = Math.min(Math.max(limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) => q.eq("userId", userId))
      .order("desc")
      .take(cap);
    return rows;
  },
});

export const deleteSummary = mutation({
  args: { id: v.id("training_summaries") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(id);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Training Missions — internal queries
// ───────────────────────────────────────────────────────────────────────

/**
 * List session rows for one user + sessionType (sport) whose `_creationTime`
 * is >= `since` and whose `notes` field is non-empty. Sorted ascending by
 * `_creationTime` so callers can join the notes in chronological order
 * before sending them to the LLM.
 *
 * Used by `internal.actions.trainingMissions.generate.generateMissionIfReady`
 * to gather the new notes that should seed the next mission. Bounded scan
 * via `by_user_date` index — typical users log < 30 sessions/month so the
 * collected set is small enough to filter in memory.
 */
export const listNotesSince = internalQuery({
  args: {
    userId: v.id("users"),
    sport: v.string(),
    since: v.number(),
  },
  handler: async (ctx, { userId, sport, since }) => {
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .filter(
        (r) =>
          normalizeLegacySession(r.sessionType, r.sessionTag).primary === sport &&
          r._creationTime >= since &&
          typeof r.notes === "string" &&
          r.notes.trim().length > 0,
      )
      .sort((a, b) => a._creationTime - b._creationTime);
  },
});

/**
 * Distinct (userId, sport) pairs for sessions with non-empty notes since
 * a given cursor. Used by the Training Missions hourly sweep cron to
 * schedule generateMissionIfReady for every active note-author across
 * every sport they've journaled in. See `actions/trainingMissions/sweep.ts`.
 */
export const listSessionPairsWithNotesSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    // Full table scan bounded by `_creationTime >= since`. The
    // `by_user_date` index is keyed on (userId, date) — for the sweep we
    // don't have a userId to anchor on, so a scan it is. The lookback
    // window (30 days in the caller) keeps the row count manageable.
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .filter((q) => q.gte(q.field("_creationTime"), since))
      .collect();

    const seen = new Set<string>();
    const pairs: { userId: Id<"users">; sport: string }[] = [];
    for (const r of rows) {
      if (typeof r.notes !== "string" || r.notes.trim().length === 0) continue;
      if (!r.sessionType) continue;
      const sport = normalizeLegacySession(r.sessionType, r.sessionTag).primary;
      const key = `${r.userId}::${sport}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ userId: r.userId, sport });
    }
    return pairs;
  },
});
