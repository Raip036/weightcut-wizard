"use node";

/**
 * Activate-premium — strict, server-verified premium activation.
 *
 * The ONLY path that flips a user's `profile.subscriptionTier` from "free"
 * to a paid tier (other than the RevenueCat webhook, which is server-to-
 * server and equally trusted). The flow:
 *
 *   1. Read the caller's `userId` from Convex auth. This is also the RC
 *      `app_user_id` we configured at sign-in.
 *   2. Call `verifyEntitlement(userId)` which hits the RC REST API with a
 *      server-held `REVENUECAT_API_KEY`. RC validated the underlying
 *      StoreKit receipt against Apple, so a positive answer means Apple
 *      confirmed payment.
 *   3. If the user is NOT entitled → throw. The client never flips premium
 *      based on a client-supplied tier or expiry. There is no fallback,
 *      no grace period, no client trust.
 *   4. If verified → call the internal `profiles.activatePremiumVerified`
 *      mutation with the RC-derived tier and expiry. The mutation has
 *      lifetime / out-of-order guards but no client-trust path of its own.
 *
 * This action takes NO arguments. The previous design accepted `tier` and
 * `expiresAt` from the client — that surface was forgeable and is gone.
 *
 * Errors surface as user-facing toasts in the paywall handler:
 *   - `CONFIG_MISSING_REVENUECAT_API_KEY` — deploy misconfig, fail loud.
 *   - `RC_VERIFY_NETWORK_FAILED` / `RC_VERIFY_HTTP_*` — transient; user retries.
 *   - `RC_NOT_ENTITLED` — user genuinely hasn't paid.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { verifyEntitlement } from "../lib/revenuecat";
import { createPostHogClient } from "../_shared/posthog";

export const run = action({
  args: {},
  handler: async (ctx): Promise<{
    tier: string;
    expiresAt: string | null;
    source: "rc-verified";
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const verified = await verifyEntitlement(userId as unknown as string);
    if (!verified) {
      throw new Error("RC_NOT_ENTITLED");
    }

    await ctx.runMutation(internal.profiles.activatePremiumVerified, {
      userId,
      tier: verified.tier,
      expiresAtMs: verified.expiresAtMs,
    });

    const posthog = createPostHogClient();
    if (posthog) {
      posthog.identify({
        distinctId: userId,
        properties: {
          subscription_tier: verified.tier,
          subscription_expires_at: verified.expiresAtMs ? new Date(verified.expiresAtMs).toISOString() : null,
        },
      });
      posthog.capture({
        distinctId: userId,
        event: "premium activated",
        properties: {
          tier: verified.tier,
          expires_at: verified.expiresAtMs ? new Date(verified.expiresAtMs).toISOString() : null,
          source: "rc-verified",
        },
      });
      await posthog.shutdown();
    }

    return {
      tier: verified.tier,
      expiresAt: verified.expiresAtMs ? new Date(verified.expiresAtMs).toISOString() : null,
      source: "rc-verified",
    };
  },
});
