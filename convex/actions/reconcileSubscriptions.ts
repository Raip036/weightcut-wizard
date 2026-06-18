"use node";

/**
 * Daily subscription reconciliation safety net — fix F6 (server portion).
 *
 * RevenueCat webhooks are the primary write path for subscription state, but
 * they can be MISSED (RC outage, transient Convex 5xx, network blip). The most
 * damaging miss is a dropped `RENEWAL`: a paying user's stored
 * `subscriptionExpiresAt` lapses, the bounded-expiry invariant (F1) correctly
 * drops them to free, and — unless they reopen the app (the client resume-verify
 * half of F6 handles that) — they stay wrongly downgraded.
 *
 * This cron closes that gap server-side. Once a day it:
 *   1. Pulls every non-free, non-lifetime profile whose expiry sits in a window
 *      straddling now (expired ≤2d ago, or expiring ≤1d ahead) — the band where
 *      a missed renewal actually matters.
 *   2. For each, re-verifies the entitlement against the RC REST API via the
 *      same trusted `verifyEntitlement(userId)` used by the client-triggered
 *      `activatePremium` action (RC validated the StoreKit receipt against
 *      Apple, so a positive answer means Apple confirmed payment).
 *   3. On a positive answer, calls `internal.profiles.activatePremiumVerified`
 *      with the fresh `{ tier, expiresAtMs }`. That mutation extends the expiry
 *      for renewals and is idempotent (its stale-expiry / lifetime guards make
 *      a re-run a no-op when nothing changed).
 *
 * What it deliberately does NOT do:
 *   - It never forcibly writes "free". When `verifyEntitlement` returns `null`
 *     (no active entitlement), we leave the stored expiry alone and let the
 *     bounded-expiry invariant + the RC `EXPIRATION` webhook lapse them
 *     naturally. Forcing "free" here would race the webhook and could wrongly
 *     drop a user mid-renewal whose RC snapshot is briefly stale. We only log.
 *
 * Resilience: each user is wrapped in try/catch so one RC API failure (timeout,
 * 5xx, network) doesn't abort the whole batch. A sane per-run cap bounds the
 * number of outbound RC calls. A summary is logged at the end.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { verifyEntitlement } from "../lib/revenuecat";

/** Upper bound on RC REST calls per run. The boundary window keeps the
 *  candidate set small in practice; this is a defensive ceiling so a data
 *  anomaly (e.g. a backfill that drops a pile of expiries into the window)
 *  can't fan out into thousands of RC calls in a single cron tick. Excess
 *  candidates roll over to the next day's run. */
const MAX_PER_RUN = 200;

interface BoundaryCandidate {
  userId: Id<"users">;
  subscriptionTier: string;
  subscriptionExpiresAt: number;
  revenuecatCustomerId?: string;
}

interface ReconcileSummary {
  checked: number;
  extended: number;
  lapsed: number;
  errors: number;
  capped: boolean;
}

export const runDaily = internalAction({
  args: {},
  handler: async (ctx): Promise<ReconcileSummary> => {
    const candidates = (await ctx.runQuery(
      internal.profiles_internal.listSubscriptionsNearBoundary,
    )) as BoundaryCandidate[];

    const capped = candidates.length > MAX_PER_RUN;
    const batch = capped ? candidates.slice(0, MAX_PER_RUN) : candidates;

    let checked = 0;
    let extended = 0;
    let lapsed = 0;
    let errors = 0;

    for (const candidate of batch) {
      checked++;
      try {
        // RevenueCat is configured with the Convex `users._id` as the
        // `app_user_id` — same mapping the client activation flow relies on.
        const verified = await verifyEntitlement(
          candidate.userId as unknown as string,
        );

        if (!verified) {
          // No active entitlement. Do NOT write "free" — the bounded-expiry
          // invariant (F1) + the RC EXPIRATION webhook handle the drop. Just
          // record the outcome.
          lapsed++;
          console.info("[reconcile-subscriptions] no active entitlement", {
            userId: candidate.userId,
            storedTier: candidate.subscriptionTier,
            storedExpiresAtMs: candidate.subscriptionExpiresAt,
          });
          continue;
        }

        // Positive verification. `activatePremiumVerified` extends the expiry
        // for genuine renewals and is idempotent — its stale-expiry guard
        // turns a re-run with the same (or older) expiry into a no-op.
        await ctx.runMutation(internal.profiles.activatePremiumVerified, {
          userId: candidate.userId,
          tier: verified.tier,
          expiresAtMs: verified.expiresAtMs,
        });
        extended++;
      } catch (err) {
        // One RC API / mutation failure must not abort the batch. Log and
        // continue — the user is retried on the next daily run.
        errors++;
        console.error("[reconcile-subscriptions] reconcile failed", {
          userId: candidate.userId,
          error: String((err as Error)?.message ?? err),
        });
      }
    }

    const summary: ReconcileSummary = {
      checked,
      extended,
      lapsed,
      errors,
      capped,
    };
    console.info("[reconcile-subscriptions] daily run complete", {
      ...summary,
      totalCandidates: candidates.length,
    });
    return summary;
  },
});
