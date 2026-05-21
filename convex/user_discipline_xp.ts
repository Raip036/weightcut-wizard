import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { levelFromXp } from "./lib/xp";

/**
 * Per-discipline XP / level read+write surface.
 *
 * Reads are public queries used by the Training Coach widget; writes are
 * `internalMutation` only — callers schedule `awardXp` from inside other
 * mutations (mission ticks, session logs). XP is never awarded by direct
 * client calls.
 *
 * See `docs/superpowers/specs/2026-05-21-camp-xp-redesign.md`.
 */

// ───────────────────────────────────────────────────────────────────────────
// Shared shape
// ───────────────────────────────────────────────────────────────────────────

export type DisciplineXpView = {
  sport: string;
  totalXp: number;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
};

function toView(row: Doc<"user_discipline_xp">): DisciplineXpView {
  const info = levelFromXp(row.totalXp);
  return {
    sport: row.sport,
    totalXp: row.totalXp,
    level: info.level,
    currentLevelXp: info.currentLevelXp,
    nextLevelXp: info.nextLevelXp,
    progress: info.progress,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Public queries
// ───────────────────────────────────────────────────────────────────────────

/**
 * All XP rows for the current user, sorted by totalXp desc. Returns an
 * empty array for unauthenticated callers so the widget renders cleanly
 * during cold start rather than throwing.
 */
export const getAllForUser = query({
  args: {},
  handler: async (ctx): Promise<DisciplineXpView[]> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return [];

    const rows = await ctx.db
      .query("user_discipline_xp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const views = rows.map(toView);
    views.sort((a, b) => b.totalXp - a.totalXp);
    return views;
  },
});

/**
 * Single (user, sport) lookup. Returns null when no XP has been awarded
 * for the discipline yet so callers can choose between "Lv 1, 0 XP" and
 * a not-started state.
 */
export const getForSport = query({
  args: { sport: v.string() },
  handler: async (ctx, { sport }): Promise<DisciplineXpView | null> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return null;

    const row = await ctx.db
      .query("user_discipline_xp")
      .withIndex("by_user_sport", (q) =>
        q.eq("userId", userId).eq("sport", sport),
      )
      .first();
    if (!row) return null;
    return toView(row);
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Internal — only scheduled from other mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * Upsert XP for (userId, sport) and report level transitions.
 *
 * Always returns shape `{ leveledUp, prevLevel, newLevel, totalXp, awarded }`.
 * `amount <= 0` is a no-op that returns zeros without touching the row —
 * callers shouldn't have to special-case that path.
 */
export const awardXp = internalMutation({
  args: {
    userId: v.id("users"),
    sport: v.string(),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (
    ctx,
    { userId, sport, amount },
  ): Promise<{
    leveledUp: boolean;
    prevLevel: number;
    newLevel: number;
    totalXp: number;
    awarded: number;
  }> => {
    const existing = await ctx.db
      .query("user_discipline_xp")
      .withIndex("by_user_sport", (q) =>
        q.eq("userId", userId).eq("sport", sport),
      )
      .first();

    // Skip non-positive awards; return current state untouched so callers
    // can blindly forward any computed `amount` without guarding.
    if (amount <= 0) {
      const totalXp = existing?.totalXp ?? 0;
      const level = levelFromXp(totalXp).level;
      return {
        leveledUp: false,
        prevLevel: level,
        newLevel: level,
        totalXp,
        awarded: 0,
      };
    }

    const now = Date.now();
    const prevXp = existing?.totalXp ?? 0;
    const nextXp = prevXp + amount;
    const prevLevel = levelFromXp(prevXp).level;
    const newLevel = levelFromXp(nextXp).level;

    if (existing) {
      await ctx.db.patch(existing._id, { totalXp: nextXp, updatedAt: now });
    } else {
      await ctx.db.insert("user_discipline_xp", {
        userId,
        sport,
        totalXp: nextXp,
        updatedAt: now,
      });
    }

    return {
      leveledUp: newLevel > prevLevel,
      prevLevel,
      newLevel,
      totalXp: nextXp,
      awarded: amount,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// TEMP — visual QA seed. Remove before shipping.
// ───────────────────────────────────────────────────────────────────────────

import { mutation as _mutation } from "./_generated/server";

export const _devSeedXp = _mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: true }> => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const seeds: { sport: string; totalXp: number }[] = [
      { sport: "BJJ", totalXp: 320 },        // mid-Lv 2
      { sport: "Muay Thai", totalXp: 80 },   // early Lv 1
      { sport: "Wrestling", totalXp: 480 },  // late Lv 3 (close to Lv 4 at 800)
    ];
    for (const s of seeds) {
      const existing = await ctx.db
        .query("user_discipline_xp")
        .withIndex("by_user_sport", (q) =>
          q.eq("userId", userId).eq("sport", s.sport),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { totalXp: s.totalXp, updatedAt: now });
      } else {
        await ctx.db.insert("user_discipline_xp", {
          userId,
          sport: s.sport,
          totalXp: s.totalXp,
          updatedAt: now,
        });
      }
    }
    return { ok: true };
  },
});
