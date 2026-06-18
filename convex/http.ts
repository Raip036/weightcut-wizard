/**
 * HTTP router for Convex.
 *
 * Convex Auth registers its OAuth callback / sign-in routes here via
 * `auth.addHttpRoutes(http)`. After deployment, the following routes are
 * available at `https://<deployment>.convex.site`:
 *
 *  Always:
 *   GET  /.well-known/openid-configuration
 *   GET  /.well-known/jwks.json
 *
 *  OAuth (when an OAuth provider is configured — e.g. Apple):
 *   GET  /api/auth/signin/:provider
 *   GET  /api/auth/callback/:provider
 *
 * The Apple Sign-In Services ID must list
 *   https://<deployment>.convex.site/api/auth/callback/apple
 * as a Return URL on the Apple Developer console.
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * RevenueCat webhook.
 *
 * Configure RevenueCat to POST to:
 *   https://<deployment>.convex.site/webhooks/revenuecat
 * with header `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
 *
 * The body's `event` shape is documented at
 * https://www.revenuecat.com/docs/webhooks. We map the event type to a
 * tier/expiry patch and delegate the write to
 * `internal.profiles.updateSubscriptionFromRevenueCat` which is the only
 * non-auth-context entry point allowed to flip a user's tier.
 */
const revenueCatWebhook = httpAction(async (ctx, req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  const authHeader = req.headers.get("Authorization");
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid-json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = payload?.event;
  if (!event || !event.app_user_id) {
    return new Response(JSON.stringify({ error: "missing-event" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const eventType = String(event.type ?? "");
  const KNOWN_EVENTS = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "EXPIRATION",
    "CANCELLATION",
    "BILLING_ISSUE",
  ]);
  if (eventType && !KNOWN_EVENTS.has(eventType)) {
    // Surface unfamiliar RevenueCat events at the HTTP layer too — gives
    // us a paper trail in Convex logs without needing to wait for a DB
    // round-trip into the mutation.
    console.info("[revenuecat-webhook] unrecognised event type", {
      eventType,
      appUserId: event.app_user_id,
    });
  }

  let result: { ok: boolean; reason?: string; skipped?: string };
  try {
    result = await ctx.runMutation(
      internal.profiles.updateSubscriptionFromRevenueCat,
      {
        appUserId: event.app_user_id as string,
        eventType,
        productId:
          typeof event.product_id === "string" ? event.product_id : undefined,
        expirationAtMs:
          typeof event.expiration_at_ms === "number"
            ? event.expiration_at_ms
            : undefined,
        // F3 — unique event id (idempotency) + occurrence timestamp (ordering).
        eventId: typeof event.id === "string" ? event.id : undefined,
        eventTimestampMs:
          typeof event.event_timestamp_ms === "number"
            ? event.event_timestamp_ms
            : undefined,
      },
    );
  } catch (err) {
    console.error("[revenuecat-webhook] update failed", err);
    return new Response(JSON.stringify({ error: "profile-update-failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Orphaned events (user deleted, never finished signup, etc.) should NOT
  // bounce RevenueCat with a 5xx — they'll retry forever. Acknowledge with
  // 200 and surface the reason in the body.
  if (!result?.ok) {
    return new Response(
      JSON.stringify({ ok: false, reason: result?.reason ?? "unknown" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/webhooks/revenuecat",
  method: "POST",
  handler: revenueCatWebhook,
});

export default http;
