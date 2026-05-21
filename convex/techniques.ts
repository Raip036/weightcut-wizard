/**
 * Skill tree / techniques.
 *
 * Tables: techniques (global), technique_edges (graph), and per-user
 * user_technique_progress + training_technique_logs.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId, optionalUserId } from "./lib/auth";
import { internal } from "./_generated/api";

export const listTechniques = query({
  args: { sport: v.optional(v.string()) },
  handler: async (ctx, { sport }) => {
    await optionalUserId(ctx);
    if (sport) {
      return await ctx.db
        .query("techniques")
        .filter((q) => q.eq(q.field("sport"), sport))
        .collect();
    }
    return await ctx.db.query("techniques").collect();
  },
});

export const listEdges = query({
  args: {},
  handler: async (ctx) => {
    await optionalUserId(ctx);
    return await ctx.db.query("technique_edges").collect();
  },
});

export const getUserProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("user_technique_progress")
      .withIndex("by_user_technique", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const listLogs = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { from, to }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training_technique_logs")
      .withIndex("by_user_date", (q) => {
        const base = q.eq("userId", userId);
        if (from && to) return base.gte("date", from).lte("date", to);
        if (from) return base.gte("date", from);
        if (to) return base.lte("date", to);
        return base;
      })
      .collect();
    return rows;
  },
});

export const logTechnique = mutation({
  args: {
    techniqueId: v.id("techniques"),
    date: v.string(),
    sessionId: v.optional(v.id("fight_camp_calendar")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const logId = await ctx.db.insert("training_technique_logs", {
      userId,
      techniqueId: args.techniqueId,
      sessionId: args.sessionId,
      date: args.date,
      notes: args.notes,
    });
    // Update progression counter.
    const existing = await ctx.db
      .query("user_technique_progress")
      .withIndex("by_user_technique", (q) =>
        q.eq("userId", userId).eq("techniqueId", args.techniqueId),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        timesLogged: existing.timesLogged + 1,
        lastLoggedAt: now,
      });
    } else {
      await ctx.db.insert("user_technique_progress", {
        userId,
        techniqueId: args.techniqueId,
        level: "learning",
        timesLogged: 1,
        firstLoggedAt: now,
        lastLoggedAt: now,
      });
    }
    // Training Coach: advance any active path whose current step targets
    // this technique + sport. Fuzzy match on goal name.
    const technique = await ctx.db.get(args.techniqueId);
    if (technique) {
      await ctx.runMutation(
        internal.training_paths.advanceStepOnTechniqueLog,
        {
          userId,
          techniqueName: technique.name,
          sport: technique.sport,
        },
      );
    }
    return logId;
  },
});

/**
 * Idempotent technique upsert. Normalises duplicates by (sport, nameNormalized).
 * Returns the canonical id whether the row was created here or already existed.
 */
export const upsertTechnique = mutation({
  args: {
    name: v.string(),
    nameNormalized: v.string(),
    sport: v.string(),
    position: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    const existing = await ctx.db
      .query("techniques")
      .withIndex("by_normalized", (q) =>
        q.eq("nameNormalized", args.nameNormalized).eq("sport", args.sport),
      )
      .first();
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (args.position) patch.position = args.position;
      if (args.category) patch.category = args.category;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch as any);
      return existing._id;
    }
    return await ctx.db.insert("techniques", {
      name: args.name,
      nameNormalized: args.nameNormalized,
      sport: args.sport,
      position: args.position,
      category: args.category,
    });
  },
});

/**
 * Bulk-add chain edges. Deduplicates by (from, to, relation) so repeat AI
 * calls don't multiply the graph.
 */
export const upsertEdges = mutation({
  args: {
    edges: v.array(
      v.object({
        fromTechniqueId: v.id("techniques"),
        toTechniqueId: v.id("techniques"),
        relationType: v.string(),
      }),
    ),
  },
  handler: async (ctx, { edges }) => {
    await requireUserId(ctx);
    const inserted: any[] = [];
    for (const e of edges) {
      const existing = await ctx.db
        .query("technique_edges")
        .withIndex("by_from", (q) => q.eq("fromTechniqueId", e.fromTechniqueId))
        .filter((q) =>
          q.and(
            q.eq(q.field("toTechniqueId"), e.toTechniqueId),
            q.eq(q.field("relationType"), e.relationType),
          ),
        )
        .first();
      if (existing) {
        inserted.push(existing);
      } else {
        const id = await ctx.db.insert("technique_edges", e);
        const row = await ctx.db.get(id);
        if (row) inserted.push(row);
      }
    }
    return inserted;
  },
});

export const setProgressLevel = mutation({
  args: {
    techniqueId: v.id("techniques"),
    level: v.string(),
  },
  handler: async (ctx, { techniqueId, level }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("user_technique_progress")
      .withIndex("by_user_technique", (q) =>
        q.eq("userId", userId).eq("techniqueId", techniqueId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { level });
      return existing._id;
    }
    return await ctx.db.insert("user_technique_progress", {
      userId,
      techniqueId,
      level,
      timesLogged: 0,
    });
  },
});
