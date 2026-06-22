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

/** Best-effort contributing-week set for a row, tolerant of legacy rows that
 *  predate the `contributingWeeks` field. */
function weeksOf(row: {
  contributingWeeks?: string[];
  firstSeenWeek: string;
  lastSeenWeek: string;
}): string[] {
  if (row.contributingWeeks && row.contributingWeeks.length > 0) {
    return row.contributingWeeks;
  }
  return Array.from(new Set([row.firstSeenWeek, row.lastSeenWeek]));
}

export const upsertFromDebrief = internalMutation({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    takeaways: v.array(takeawayValidator),
  },
  handler: async (ctx, { userId, weekStart, takeaways }) => {
    const now = Date.now();

    // ── Step 1: detach this week from every technique it previously fed. ────
    // Regenerating a week's recap must REPLACE that week's contributions, not
    // stack on top of them — otherwise the LLM paraphrasing the same move
    // ("Slip jab into uppercut" vs "Jab slip to uppercut") leaves a trail of
    // near-duplicate rows. Rows orphaned by the removal are deleted.
    const allRows = await ctx.db
      .query("training_techniques")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of allRows) {
      const weeks = weeksOf(row);
      if (!weeks.includes(weekStart)) continue;
      const remaining = weeks.filter((w) => w !== weekStart);
      if (remaining.length === 0) {
        await ctx.db.delete(row._id);
      } else {
        const sorted = [...remaining].sort();
        await ctx.db.patch(row._id, {
          contributingWeeks: remaining,
          timesLogged: remaining.length,
          firstSeenWeek: sorted[0],
          lastSeenWeek: sorted[sorted.length - 1],
          updatedAt: now,
        });
      }
    }

    // ── Step 2: (re-)add this week's takeaways. ─────────────────────────────
    // Within a single debrief the LLM can still emit two paraphrases of the
    // same move; `seen` collapses them so we don't double-insert in one pass.
    const seen = new Set<string>();
    for (const tk of takeaways) {
      const key = normalizeTechniqueKey(tk.discipline, tk.technique);
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await ctx.db
        .query("training_techniques")
        .withIndex("by_user_norm", (q) =>
          q.eq("userId", userId).eq("techniqueNormalized", key),
        )
        .first();
      if (existing) {
        const weeks = Array.from(new Set([...weeksOf(existing), weekStart]));
        const sorted = [...weeks].sort();
        await ctx.db.patch(existing._id, {
          contributingWeeks: weeks,
          timesLogged: weeks.length,
          firstSeenWeek: sorted[0],
          lastSeenWeek: sorted[sorted.length - 1],
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
          contributingWeeks: [weekStart],
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
