/**
 * Training-summary flashcards — public queries / mutations and the
 * internal upsert called by `actions/trainingSummary.ts` after the LLM
 * round-trip.
 *
 * Spec: docs/superpowers/specs/2026-05-21-training-summary-flashcards.md
 *
 * Spaced-repetition state lives inline on each row (`intervalDays`,
 * `dueAt`, `reviews`, `lapses`, `lastReviewedAt`). The actual scheduler
 * lives in `convex/lib/srSchedule.ts` so both this file and the frontend
 * mirror share the same rules.
 *
 * `cardKey` (sha-256 of "sport::normalisedFront") dedups identical cards
 * across regenerations so re-running a week's summary patches the back/
 * cue/source date *without* resetting the user's learned interval.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUserId } from "./lib/auth";
import { initialState, scheduleNext } from "./lib/srSchedule";

// ───────────────────────────────────────────────────────────────────────
// cardKey helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Lowercase, collapse runs of whitespace to a single space, strip
 * trailing punctuation. Deliberately conservative: only trims chars the
 * LLM frequently varies (".", "?", "!", "…", ",", ":", ";", spaces) so
 * "Scissor sweep — what's the base-leg cue?" and
 * "Scissor sweep — what's the base-leg cue" hash to the same key.
 */
function normaliseFront(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…,:;\s]+$/u, "")
    .trim();
}

/**
 * SHA-256 hex digest. `crypto.subtle` is available in the Convex V8
 * runtime (see `convex/auth.ts` for prior art) so this file does NOT
 * need a `"use node"` directive — keeping it as a regular mutation
 * means `internal.training_summary_cards.upsertCardsFromSummary` runs
 * in the same transactional context as a normal db.patch / insert.
 */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function computeCardKey(sport: string, front: string): Promise<string> {
  return sha256Hex(`${sport.toLowerCase()}::${normaliseFront(front)}`);
}

// ───────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────

/**
 * All cards owned by the current user whose `dueAt` is <= now, sorted by
 * `dueAt asc`. Capped at 50 so the deck never tries to render hundreds
 * of cards in one tick. Anonymous callers get an empty array (the
 * dashboard widget runs even when auth is still resolving).
 */
export const getDueToday = query({
  args: {},
  handler: async (ctx): Promise<Doc<"training_summary_cards">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("training_summary_cards")
      .withIndex("by_user_due", (q) =>
        q.eq("userId", userId).lte("dueAt", now),
      )
      .order("asc")
      .take(50);
    return rows;
  },
});

/**
 * All cards that were born in `weekStart`, oldest first. Drives the
 * weekly deck view (timeline chip → load that week's cards). The
 * `_creationTime` of each row is what we sort by — the index returns
 * insertion order so we just resort after the collect to be explicit.
 */
export const getCardsForWeek = query({
  args: { weekStart: v.string() },
  handler: async (
    ctx,
    { weekStart },
  ): Promise<Doc<"training_summary_cards">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("training_summary_cards")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId).eq("weekStart", weekStart),
      )
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * Distinct `weekStart` strings the user has a `training_summaries` row
 * for, sorted desc (most recent first). Pulled from `training_summaries`
 * — NOT from `training_summary_cards` — because a week may have been
 * summarised under the legacy "techniques + steps" shape (no cards
 * generated) and we still want the timeline chip to surface it so the
 * user can hit Regenerate.
 *
 * Bounded scan: typical users have < 50 summaries; the auth-onboarding
 * flow can't produce thousands of weeks. Caps at 200 to be safe.
 */
export const listSummarisedWeeks = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) => q.eq("userId", userId))
      .take(200);
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.weekStart);
    return Array.from(seen).sort((a, b) => b.localeCompare(a));
  },
});

// ───────────────────────────────────────────────────────────────────────
// Scheduling mutations
// ───────────────────────────────────────────────────────────────────────

async function applyRecall(
  ctx: MutationCtx,
  userId: Id<"users">,
  cardId: Id<"training_summary_cards">,
  recall: "got" | "forgot",
) {
  const card = await ctx.db.get(cardId);
  if (!card) throw new Error("Card not found");
  if (card.userId !== userId) throw new Error("Not authorized");
  const next = scheduleNext(
    { intervalDays: card.intervalDays, lapses: card.lapses },
    recall,
  );
  await ctx.db.patch(cardId, {
    intervalDays: next.intervalDays,
    dueAt: next.dueAt,
    lapses: next.lapses,
    lastReviewedAt: next.lastReviewedAt,
    reviews: card.reviews + 1,
  });
  return { nextDueAt: next.dueAt, intervalDays: next.intervalDays };
}

export const recallCard = mutation({
  args: { cardId: v.id("training_summary_cards") },
  handler: async (ctx, { cardId }) => {
    const userId = await requireUserId(ctx);
    return await applyRecall(ctx, userId, cardId, "got");
  },
});

export const forgetCard = mutation({
  args: { cardId: v.id("training_summary_cards") },
  handler: async (ctx, { cardId }) => {
    const userId = await requireUserId(ctx);
    return await applyRecall(ctx, userId, cardId, "forgot");
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal upsert — called by `actions/trainingSummary.ts`
// ───────────────────────────────────────────────────────────────────────

/**
 * Upsert a batch of generated cards for one user/week. Existing rows
 * (matched by `cardKey`) are patched — `back`, `cue`, `sourceSessionDate`,
 * and `weekStart` are refreshed but the spaced-repetition state
 * (`intervalDays`, `dueAt`, `reviews`, `lapses`, `lastReviewedAt`) is
 * preserved so re-running a summary doesn't reset the user's progress.
 *
 * New rows are inserted with `initialState()` from srSchedule (1-day
 * interval, due tomorrow, zero reviews/lapses).
 */
export const upsertCardsFromSummary = internalMutation({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    cards: v.array(
      v.object({
        sport: v.string(),
        front: v.string(),
        back: v.string(),
        cue: v.optional(v.string()),
        sourceSessionDate: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { userId, weekStart, cards }) => {
    const now = Date.now();
    let inserted = 0;
    let patched = 0;
    for (const card of cards) {
      const cardKey = await computeCardKey(card.sport, card.front);
      const existing = await ctx.db
        .query("training_summary_cards")
        .withIndex("by_user_card_key", (q) =>
          q.eq("userId", userId).eq("cardKey", cardKey),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          back: card.back,
          cue: card.cue,
          sourceSessionDate: card.sourceSessionDate,
          weekStart,
        });
        patched += 1;
      } else {
        const sr = initialState(now);
        await ctx.db.insert("training_summary_cards", {
          userId,
          sport: card.sport,
          weekStart,
          cardKey,
          front: card.front,
          back: card.back,
          cue: card.cue,
          sourceSessionDate: card.sourceSessionDate,
          intervalDays: sr.intervalDays,
          dueAt: sr.dueAt,
          reviews: 0,
          lapses: sr.lapses,
          lastReviewedAt: undefined,
          createdAt: now,
        });
        inserted += 1;
      }
    }
    return { inserted, patched };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// TEMP — visual QA seed. Remove before shipping.
// ───────────────────────────────────────────────────────────────────────────

import { mutation as _mutation } from "./_generated/server";

/**
 * Drops a full training summary fixture into the DB for the current week:
 *   - `training_summaries` row with the new { weekHeadline, stats, cards } shape
 *   - matching `training_summary_cards` rows (3 due-now, 1 already learned, 2
 *     "due tomorrow") so every state in the flashcard UI has a sample.
 */
export const _devSeedFlashcards = _mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ summaryId: Id<"training_summaries">; cardsInserted: number }> => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Current ISO Monday in UTC — matches the spec's weekStart convention.
    const today = new Date();
    const dow = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    today.setUTCDate(today.getUTCDate() - dow);
    const weekStart = today.toISOString().slice(0, 10);

    const cards = [
      {
        sport: "BJJ",
        front: "Scissor sweep — what's the base-leg cue?",
        back: "Trap their lead leg with your shin, then chop their post leg with your top leg. Knee-on-knee = sweep angle.",
        cue: "Trap then chop",
        sourceSessionDate: "2026-05-19",
      },
      {
        sport: "BJJ",
        front: "Why did your hip-escape stall against passes?",
        back: "Frame on the shoulder first, only then move the hip. Hip without frame = they ride your back.",
        cue: "Frame first, hip second",
        sourceSessionDate: "2026-05-20",
      },
      {
        sport: "Muay Thai",
        front: "Coach's note on your teep — what was the fix?",
        back: "Drive through with the hip, don't flick. Land the heel, not the toes, and re-chamber back to guard.",
        cue: "Heel through the hip",
        sourceSessionDate: "2026-05-18",
      },
      {
        sport: "Wrestling",
        front: "Single-leg finish drill — which side did you struggle to angle?",
        back: "Off-side. Step out 45° to clear their post, then lift with both arms locked, not just the bicep.",
        cue: "Angle out, double-lock",
        sourceSessionDate: "2026-05-20",
      },
      {
        sport: "BJJ",
        front: "What's the entry cue for the loop choke off broken posture?",
        back: "Drag their head across your centreline, near hand under the chin, far hand grips their lapel and rolls the wrist in.",
        cue: "Across, under, roll",
      },
      {
        sport: "Muay Thai",
        front: "How do you defend the inside low kick without checking?",
        back: "Sub-step the front foot in 4 inches and turn the knee in — absorb on the thigh, not the shin.",
        cue: "Sub-step + thigh",
      },
    ];

    // Insert the cards. Three are due NOW (last review yesterday → forgot, so
    // due today), one is due "tomorrow" (interval=2 → already learned once),
    // two are brand new (initialState → due tomorrow).
    const cardsInserted = cards.length;
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      const normalised = c.front.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?…,:;]+$/, "");
      const cardKey = `seed::${c.sport.toLowerCase()}::${normalised}`;

      // Don't double-insert if the seed has been run before.
      const existing = await ctx.db
        .query("training_summary_cards")
        .withIndex("by_user_card_key", (q) =>
          q.eq("userId", userId).eq("cardKey", cardKey),
        )
        .first();

      let stateOverrides: {
        intervalDays: number;
        dueAt: number;
        reviews: number;
        lapses: number;
        lastReviewedAt?: number;
      };
      if (i < 3) {
        // Due now — reviewed once, "got it" 1 day ago.
        stateOverrides = {
          intervalDays: 1,
          dueAt: now - DAY_MS / 2,
          reviews: 1,
          lapses: 0,
          lastReviewedAt: now - DAY_MS,
        };
      } else if (i === 3) {
        // Already learned — reviewed twice, "got it" both times, due in 2 days.
        stateOverrides = {
          intervalDays: 4,
          dueAt: now + 2 * DAY_MS,
          reviews: 2,
          lapses: 0,
          lastReviewedAt: now - 2 * DAY_MS,
        };
      } else {
        // Brand new — use the canonical initial state.
        const init = initialState(now);
        stateOverrides = {
          intervalDays: init.intervalDays,
          dueAt: init.dueAt,
          reviews: 0,
          lapses: 0,
          lastReviewedAt: undefined,
        };
      }

      const row = {
        userId,
        sport: c.sport,
        weekStart,
        cardKey,
        front: c.front,
        back: c.back,
        cue: c.cue,
        sourceSessionDate: c.sourceSessionDate,
        ...stateOverrides,
        createdAt: now - i * 1000, // stable ordering for the deck
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("training_summary_cards", row);
      }
    }

    // Upsert the matching training_summaries row so the frontend's
    // shape-detection picks the new (flashcard) renderer rather than the
    // legacy chip path. summaryData is `v.any()` so the new shape lands
    // without a schema migration.
    const stats = {
      sessionsLogged: 4,
      totalMinutes: 240,
      topDiscipline: "BJJ",
      avgRpe: 7.2,
      avgSleepHours: 7.5,
    };
    const summaryData = {
      weekHeadline:
        "Strong guard-retention week — you broke through on the scissor sweep, still struggling with passes after the second hip escape.",
      stats,
      cards: cards.map((c) => ({
        sport: c.sport,
        front: c.front,
        back: c.back,
        cue: c.cue,
        sourceSessionDate: c.sourceSessionDate,
      })),
    };

    const existingSummary = await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId).eq("weekStart", weekStart),
      )
      .first();

    let summaryId: Id<"training_summaries">;
    if (existingSummary) {
      await ctx.db.patch(existingSummary._id, {
        summaryData,
        sessionIds: ["seed-1", "seed-2", "seed-3", "seed-4"],
        notesFingerprint: `seed::${weekStart}::v1`,
        updatedAt: now,
      });
      summaryId = existingSummary._id;
    } else {
      summaryId = await ctx.db.insert("training_summaries", {
        userId,
        weekStart,
        sessionIds: ["seed-1", "seed-2", "seed-3", "seed-4"],
        notesFingerprint: `seed::${weekStart}::v1`,
        summaryData,
        updatedAt: now,
      });
    }

    return { summaryId, cardsInserted };
  },
});
