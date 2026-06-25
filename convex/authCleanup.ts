/**
 * Self-healing cleanup for orphaned password auth accounts.
 *
 * THE PROBLEM
 * When a `users` row is removed by hand (e.g. straight from the Convex
 * dashboard) instead of through `actions/deleteAccount`, the matching
 * `authAccounts` row is left behind pointing at a now-deleted user. On the
 * next sign-up `@convex-dev/auth` finds that leftover row in the
 * `(provider, providerAccountId)` slot and rejects the attempt with
 * "Account <email> already exists" — even though no real user exists.
 *
 * THE FIX
 * `purgeOrphanedAccount` removes a password account ONLY when its `userId` no
 * longer resolves to a live `users` row — a genuinely dead record. A live
 * account is never touched, so a real duplicate email still hits the normal
 * "already exists" guard. Because it can't affect any live user, it is safe to
 * call from the unauthenticated sign-up screen, which calls it just before
 * sign-up to clear the slate.
 *
 * Why call it BEFORE sign-up (not just on the "already exists" error): if the
 * caller re-registers with the SAME password as the deleted account,
 * `@convex-dev/auth`'s `createAccountFromCredentials` finds the orphan, the
 * secret verifies, and it silently signs the user in against a deleted user
 * row (a "ghost" login) WITHOUT throwing. A purge-before-sign-up clears that
 * path too.
 *
 * The lookup is an exact, indexed `.unique()` on `(provider, providerAccountId)`
 * — the same slot `createAccountFromCredentials` collides on — so it stays
 * O(1) at any scale. @convex-dev/auth stores `providerAccountId` verbatim and
 * matches case-sensitively, so passing the same `email` string the sign-up
 * uses is exactly right (a different-cased email is a different account to the
 * library and would never collide). Index names match the canonical
 * `authTables` and mirror the cascade in `deleteAccountMutations.ts`.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const purgeOrphanedAccount = mutation({
  args: { email: v.string() },
  returns: v.object({ purged: v.boolean() }),
  handler: async (ctx, { email }) => {
    if (!email) return { purged: false };

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();
    if (account === null) return { purged: false };

    // Only purge if the owning user is gone. A live user means this is a real
    // duplicate — leave it so "already exists" stays accurate.
    const user = await ctx.db.get(account.userId);
    if (user !== null) return { purged: false };

    // Orphan confirmed. Walk the auth-table graph the same way the full account
    // cascade does: account → verification codes, then any dangling sessions →
    // refresh tokens + verifiers still keyed to the dead userId.
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    await Promise.all(codes.map((c) => ctx.db.delete(c._id)));

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", account.userId))
      .collect();
    for (const s of sessions) {
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      await Promise.all(refreshTokens.map((r) => ctx.db.delete(r._id)));
      const verifiers = await ctx.db
        .query("authVerifiers")
        .filter((q) => q.eq(q.field("sessionId"), s._id))
        .collect();
      await Promise.all(verifiers.map((vf) => ctx.db.delete(vf._id)));
      await ctx.db.delete(s._id);
    }

    // A stale `profiles` row keyed to the dead userId would otherwise linger
    // forever; clear it too so the re-registered account starts clean.
    const staleProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", account.userId))
      .unique();
    if (staleProfile) {
      if (staleProfile.avatarStorageId) {
        try {
          await ctx.storage.delete(staleProfile.avatarStorageId);
        } catch {
          /* already gone */
        }
      }
      await ctx.db.delete(staleProfile._id);
    }

    await ctx.db.delete(account._id);
    return { purged: true };
  },
});
