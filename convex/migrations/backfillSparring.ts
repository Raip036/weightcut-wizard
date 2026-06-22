import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * One-shot backfill that stamps Mastery Spine defaults on existing
 * `sparring_assignments` rows that pre-date Task 0.2.
 *
 * Defaults applied where the field is currently unset:
 *   source       → "library"
 *   landedCount  → 0
 *   combinations → []
 *   timesLogged  → 0
 *
 * Idempotent: rows that already have these fields set are skipped.
 * Paginated with `.take(200)` + self-reschedule so it stays within
 * Convex transaction limits regardless of table size.
 *
 * Run via:
 *   npx convex run migrations/backfillSparring:run
 */
export const run = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    patchedTotal: v.optional(v.number()),
    skippedTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cursor = args.cursor ?? null;
    const patchedTotal = args.patchedTotal ?? 0;
    const skippedTotal = args.skippedTotal ?? 0;

    // Page using `.take(200)` via a full-table scan with an explicit
    // cursor implemented through the _id index ordering.
    // We use `paginate` here because Convex's `.take()` on a query
    // doesn't support resumption across transactions; `paginate` is the
    // idiomatic batch/reschedule pattern that honours transaction limits.
    const page = await ctx.db
      .query("sparring_assignments")
      .paginate({ cursor, numItems: 200 });

    let patched = 0;
    let skipped = 0;

    for (const row of page.page) {
      const needsPatch =
        row.source === undefined ||
        row.landedCount === undefined ||
        row.combinations === undefined ||
        row.timesLogged === undefined;

      if (!needsPatch) {
        skipped++;
        continue;
      }

      await ctx.db.patch(row._id, {
        ...(row.source === undefined ? { source: "library" as const } : {}),
        ...(row.landedCount === undefined ? { landedCount: 0 } : {}),
        ...(row.combinations === undefined ? { combinations: [] } : {}),
        ...(row.timesLogged === undefined ? { timesLogged: 0 } : {}),
      });
      patched++;
    }

    const newPatchedTotal = patchedTotal + patched;
    const newSkippedTotal = skippedTotal + skipped;

    if (!page.isDone) {
      // More rows remain — reschedule immediately to stay within limits.
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillSparring.run,
        {
          cursor: page.continueCursor,
          patchedTotal: newPatchedTotal,
          skippedTotal: newSkippedTotal,
        },
      );
    }

    return {
      patched,
      skipped,
      patchedTotal: newPatchedTotal,
      skippedTotal: newSkippedTotal,
      done: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
