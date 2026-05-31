/**
 * Dev-only seeder for the Community feed. Inserts a small set of mock
 * `session_media` rows attributed to the caller and stamped with the
 * caller's first active gym, so the polaroid stack has something to render
 * during local development / screenshots without an upload flow.
 *
 * Production gating happens in the UI layer (the "Seed feed" button is
 * only mounted in dev). The mutation itself is a public mutation so the
 * client can call it directly via the Convex React client.
 *
 * NB: this is intentionally NOT an internalMutation — internal functions
 * are only callable from other Convex functions (actions / crons), not
 * from the client. The dev-toolbar entry point needs a public mutation.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

/**
 * Picsum returns deterministic images per `seed/<key>` URL so reruns
 * produce the same visual feed (handy for QA screenshots). No auth, no
 * rate limit, no API key required — fine for dev seeding.
 */
const MOCK_IMAGES = [
  "https://picsum.photos/seed/fight1/640/640",
  "https://picsum.photos/seed/fight2/640/640",
  "https://picsum.photos/seed/fight3/640/640",
  "https://picsum.photos/seed/fight4/640/640",
  "https://picsum.photos/seed/fight5/640/640",
  "https://picsum.photos/seed/fight6/640/640",
  "https://picsum.photos/seed/fight7/640/640",
  "https://picsum.photos/seed/fight8/640/640",
];

const MOCK_CAPTIONS = [
  "5 rounds on the bag. Felt sharp.",
  "Sparring camp, week 3.",
  "Strength + conditioning AM session.",
  "Recovery run, easy 5k.",
  "Heavy bag intervals.",
  "Pad work with coach.",
  "Mobility + breathwork.",
  "Open mat. Drilled the cross-counter.",
];

/**
 * Insert 8 mock polaroid posts spaced one hour apart so the feed shows a
 * clean descending ladder. All posts:
 *   - are authored by the caller (avoids needing other users in the gym)
 *   - are stamped with the caller's first active gym membership
 *   - skip Convex Storage entirely — the external `mockUrl` is rendered
 *     directly by `listFeed`'s fallback path
 *   - omit `sessionId` because there's no guarantee the caller has a
 *     `fight_camp_calendar` row, and the field is now optional in the
 *     schema for this exact reason
 *
 * Returns the list of inserted post ids so the caller can verify the
 * insert succeeded / route to the new posts.
 */
export const seedMockFeed = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    // Resolve the caller's first active gym membership. The feed is
    // gym-scoped so without a gym the seeded posts wouldn't surface in
    // `listFeed` at all.
    const member = await ctx.db
      .query("gym_members")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .first();
    if (!member) throw new Error("Join a gym first");
    const gymId: Id<"gyms"> = member.gymId;

    const now = Date.now();
    const todayIso = new Date(now).toISOString().slice(0, 10);
    const inserted: Id<"session_media">[] = [];

    for (let i = 0; i < MOCK_IMAGES.length; i++) {
      const id = await ctx.db.insert("session_media", {
        // Self-authored for simplicity — no need to spin up other users.
        userId,
        gymId,
        kind: "photo",
        // Inline external URL; listFeed falls back to this when
        // `storageId` is absent. Real uploads always set `storageId`.
        mockUrl: MOCK_IMAGES[i],
        caption: MOCK_CAPTIONS[i],
        // YYYY-MM-DD bucket — matches the `_creationTime` offsetting below.
        capturedAt: todayIso,
        // Seed some initial engagement so the polaroid renders the
        // counter badges. Randomised per post for visual variety; safe
        // because reactionCounts/likeCount/commentCount are all just
        // cached numbers (the underlying detail tables stay empty).
        likeCount: Math.floor(Math.random() * 20),
        commentCount: Math.floor(Math.random() * 5),
        reactionCounts: {},
        visibility: "gym",
      });
      inserted.push(id);
    }

    return { count: inserted.length, ids: inserted, gymId, seededAt: now };
  },
});
