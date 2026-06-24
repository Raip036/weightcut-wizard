/**
 * Dev-only manual tools — NOT exposed to the client.
 *
 * These are `internalMutation`s so they can only be invoked from the Convex
 * CLI (`npx convex run`) or other server code, never from the app. Handy for
 * flipping a test account between free and pro while developing.
 *
 * Usage (run against the deployment your `npx convex dev` is pointed at):
 *
 *   # Upgrade to Pro (defaults to a 1-year future expiry)
 *   npx convex run devTools:setTierByEmail '{"email":"you@example.com","tier":"pro"}'
 *
 *   # Downgrade to free
 *   npx convex run devTools:setTierByEmail '{"email":"you@example.com","tier":"free"}'
 *
 * After running, refresh the app (the profile query re-subscribes live).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const setTierByEmail = internalMutation({
  args: {
    email: v.string(),
    tier: v.union(v.literal("free"), v.literal("pro")),
    // Optional override for how far in the future the pro expiry sits.
    // Ignored for `tier: "free"`. Defaults to one year out.
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, { email, tier, expiresInDays }) => {
    const target = email.trim().toLowerCase();

    // Convex Auth `users` table carries the email. Scan + case-insensitive
    // match so this works regardless of how the address was stored.
    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (!user) {
      throw new Error(`No auth user found with email "${email}"`);
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) {
      throw new Error(`No profile found for user ${user._id} (${email})`);
    }

    const now = Date.now();
    if (tier === "pro") {
      const expiresAt = now + (expiresInDays ?? 365) * 24 * 60 * 60 * 1000;
      await ctx.db.patch(profile._id, {
        subscriptionTier: "pro",
        subscriptionExpiresAt: expiresAt,
        subscriptionUpdatedAt: now,
      });
      return {
        email,
        tier: "pro",
        subscriptionExpiresAt: expiresAt,
        expiresAtReadable: new Date(expiresAt).toISOString(),
      };
    }

    // Downgrade: clear the entitlement entirely.
    await ctx.db.patch(profile._id, {
      subscriptionTier: "free",
      subscriptionExpiresAt: undefined,
      subscriptionUpdatedAt: now,
    });
    return { email, tier: "free" };
  },
});
