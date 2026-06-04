/**
 * Persisted Fight Camp Coach conversation memory (Phase 4).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 4 ("Persisted conversation memory (Pro)") + §6 (data model).
 *
 * Backs the `coach_conversations` table so the coach can remember across the
 * whole camp server-side, rather than the prior localStorage-only last-16
 * window. The action/context layer decides WHEN to use these (Pro-only per
 * spec); there is intentionally NO Pro gate here — these are plain
 * authed CRUD helpers.
 *
 * Auth: every function calls `requireUserId(ctx)` and scopes all reads/writes
 * to that user (Convex has no row-level security — see convex/lib/auth.ts).
 *
 * Camp scoping: `appendTurns` denormalises the user's active/most-recent camp
 * onto each row at append time, using the same selection rule as
 * `coachCockpit.getCockpit` / `coachBriefing` / `coachSafety_internal`:
 * the nearest fight on/after today is the "active" camp; if none is upcoming
 * we fall back to the most recent past camp so off-/post-season turns still
 * attach to a sensible camp. `campId` stays optional for users with no camps
 * at all.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Default number of recent turns `getConversation` returns. */
const DEFAULT_CONVERSATION_LIMIT = 40;
/** Hard ceiling so a caller can't ask for an unbounded scan. */
const MAX_CONVERSATION_LIMIT = 200;
/** Batch size for deleting a user's conversation rows. */
const CLEAR_PAGE_SIZE = 200;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Resolve the camp a freshly-appended turn belongs to.
 *
 * Same convention as the rest of the coach surfaces: nearest upcoming fight
 * (fightDate >= today, earliest first); else the most recent past camp; else
 * undefined when the user has no camps.
 */
async function resolveCampId(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"fight_camps"> | undefined> {
  const camps = await ctx.db
    .query("fight_camps")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  if (camps.length === 0) return undefined;

  const today = todayIso();
  const upcoming = camps
    .filter((c) => c.fightDate >= today)
    .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0];
  if (upcoming) return upcoming._id;

  // No upcoming fight — fall back to the most recent past camp.
  const mostRecent = camps
    .slice()
    .sort((a, b) => b.fightDate.localeCompare(a.fightDate))[0];
  return mostRecent?._id;
}

// ── Public return shape (client imports this with `import type`) ───────────

export interface CoachConversationTurn {
  role: "user" | "assistant";
  content: string;
  blocksJson?: string;
  createdAt: number;
}

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * `api.coachConversation.appendTurns` — append one or more chat turns.
 *
 * Resolves the calling user + their active/most-recent camp, then inserts
 * each turn with a monotonic `createdAt`. Inserting within a single mutation
 * with a strictly-increasing stamp guarantees stable oldest-first ordering
 * even when several turns land in the same millisecond.
 */
export const appendTurns = mutation({
  args: {
    turns: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        blocksJson: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { turns }) => {
    const userId = await requireUserId(ctx);
    if (turns.length === 0) return { inserted: 0 };

    const campId = await resolveCampId(ctx, userId);

    // Monotonic base stamp; +i keeps insertion order stable within the batch.
    const base = Date.now();
    let inserted = 0;
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      await ctx.db.insert("coach_conversations", {
        userId,
        campId,
        role: turn.role,
        content: turn.content,
        blocksJson: turn.blocksJson,
        createdAt: base + i,
      });
      inserted++;
    }

    return { inserted };
  },
});

/**
 * `api.coachConversation.clearConversation` — delete all of the calling
 * user's persisted coach turns. Paginated so a long history can't blow the
 * mutation document-scan limit.
 */
export const clearConversation = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    let deleted = 0;
    // Loop in bounded pages until no rows remain for this user.
    for (;;) {
      const rows = await ctx.db
        .query("coach_conversations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(CLEAR_PAGE_SIZE);
      if (rows.length === 0) break;

      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }

      if (rows.length < CLEAR_PAGE_SIZE) break;
    }

    return { deleted };
  },
});

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * `api.coachConversation.getConversation` — the user's recent turns,
 * oldest-first, ready to seed the chat UI / prompt history.
 *
 * Reads the newest `limit` rows (descending) then reverses to oldest-first so
 * the most recent context is always included even when the history exceeds
 * `limit`.
 */
export const getConversation = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<CoachConversationTurn[]> => {
    const userId = await requireUserId(ctx);

    const take = Math.min(
      Math.max(1, limit ?? DEFAULT_CONVERSATION_LIMIT),
      MAX_CONVERSATION_LIMIT,
    );

    // Newest-first by `_creationTime` (auto-appended to every index), then
    // reverse to oldest-first for rendering / prompt assembly.
    const rowsDesc = await ctx.db
      .query("coach_conversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(take);

    return rowsDesc
      .reverse()
      .map((row) => ({
        role: row.role,
        content: row.content,
        blocksJson: row.blocksJson,
        createdAt: row.createdAt,
      }));
  },
});
