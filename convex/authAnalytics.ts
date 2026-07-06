"use node";

/**
 * Server-side auth analytics.
 *
 * `captureSignedUp` is scheduled (runAfter 0) from the `createOrUpdateUser`
 * callback in `convex/auth.ts` on the brand-new-user branch ONLY, so it fires
 * exactly once per created account regardless of auth provider (password,
 * Apple web/native, Google web/native). Mutations cannot make network calls,
 * hence the hop into this Node action for posthog-node.
 *
 * distinct_id = the Convex `users` id — the SAME id the client passes to
 * posthog.identify via AnalyticsBridge, so server and client events join
 * into one PostHog person.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { createPostHogClient } from "./_shared/posthog";

export const captureSignedUp = internalAction({
  args: {
    userId: v.id("users"),
    /** Auth provider family: "password" | "apple" | "google" (or raw id). */
    method: v.string(),
    /** "fighter" | "coach" — from the profile bootstrap. */
    role: v.string(),
  },
  handler: async (_ctx, { userId, method, role }) => {
    const posthog = createPostHogClient();
    if (!posthog) return null; // POSTHOG_API_KEY/HOST unset (e.g. dev deploy)
    posthog.capture({
      distinctId: userId,
      event: "signed_up",
      properties: { method, role, source: "server" },
    });
    await posthog.shutdown();
    return null;
  },
});
