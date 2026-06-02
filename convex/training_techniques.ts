/**
 * All-time technique log. Replaces the flashcard SR engine. Weekly recaps
 * (convex/actions/trainingSummary.ts) upsert their takeaways here; the
 * Technique Log UI reads them back grouped by discipline.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Normalize a discipline+technique into a dedup key: lowercase, collapse
 *  whitespace, strip surrounding punctuation. "Scissor Sweep!" === "scissor sweep". */
export function normalizeTechniqueKey(discipline: string, technique: string): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return `${norm(discipline)}::${norm(technique)}`;
}

const takeawayValidator = v.object({
  discipline: v.string(),
  technique: v.string(),
  cue: v.optional(v.string()),
  detail: v.string(),
  sourceSessionDate: v.optional(v.string()),
});

export const upsertFromDebrief = internalMutation({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    takeaways: v.array(takeawayValidator),
  },
  handler: async (ctx, { userId, weekStart, takeaways }) => {
    const now = Date.now();
    for (const tk of takeaways) {
      const key = normalizeTechniqueKey(tk.discipline, tk.technique);
      const existing = await ctx.db
        .query("training_techniques")
        .withIndex("by_user_norm", (q) =>
          q.eq("userId", userId).eq("techniqueNormalized", key),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          timesLogged: existing.timesLogged + 1,
          lastSeenWeek: weekStart,
          detail: tk.detail,
          cue: tk.cue ?? existing.cue,
          sourceSessionDate: tk.sourceSessionDate ?? existing.sourceSessionDate,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("training_techniques", {
          userId,
          discipline: tk.discipline,
          technique: tk.technique,
          techniqueNormalized: key,
          cue: tk.cue,
          detail: tk.detail,
          sourceSessionDate: tk.sourceSessionDate,
          timesLogged: 1,
          firstSeenWeek: weekStart,
          lastSeenWeek: weekStart,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  },
});

export const listTechniques = query({
  args: { discipline: v.optional(v.string()) },
  handler: async (ctx, { discipline }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = discipline
      ? await ctx.db
          .query("training_techniques")
          .withIndex("by_user_discipline", (q) =>
            q.eq("userId", userId).eq("discipline", discipline),
          )
          .collect()
      : await ctx.db
          .query("training_techniques")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
    return rows
      .sort((a, b) => b.lastSeenWeek.localeCompare(a.lastSeenWeek))
      .slice(0, 500);
  },
});
