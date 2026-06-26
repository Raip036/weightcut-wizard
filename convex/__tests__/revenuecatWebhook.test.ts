import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { effectiveTier } from "../_shared/tier";

/**
 * Regression coverage for the 7-day App Store free trial, focused on the
 * cancel-during-trial requirement:
 *
 *   A user starts a 7-day free trial. If they cancel BEFORE it ends, they are
 *   still honoured Pro right up until the trial-end date — they just are not
 *   charged and the subscription does not continue past that date.
 *
 * The entitlement writer under test is the RevenueCat webhook mutation
 * `updateSubscriptionFromRevenueCat` (the only server-side write path besides
 * the verified client action). The behaviour relies on:
 *   - INITIAL_PURCHASE storing the trial-end as a finite future expiry,
 *   - CANCELLATION never changing the tier and never shortening/nulling the
 *     expiry (fix F5),
 *   - `effectiveTier` granting Pro purely on (tier != free && now < expiry),
 *   - EXPIRATION (or simply now passing the expiry) dropping to free.
 *
 * Plus the F3 ordering / idempotency / stale-expiry guards that keep a late or
 * replayed event from corrupting the stored expiry.
 */

const DAY = 86_400_000;

async function seedFreeUser(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId,
      age: 30,
      sex: "M",
      heightCm: 180,
      currentWeightKg: 80,
      goalWeightKg: 75,
      targetDate: "2026-12-01",
      activityLevel: "moderate",
      goalType: "weight_loss",
      role: "fighter",
      subscriptionTier: "free",
    } as any);
    return userId;
  });
}

async function getProfile(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
  );
}

type WebhookArgs = {
  eventType: string;
  productId?: string;
  expirationAtMs?: number;
  eventId?: string;
  eventTimestampMs?: number;
};

function send(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  args: WebhookArgs,
) {
  return t.mutation(internal.profiles.updateSubscriptionFromRevenueCat, {
    appUserId: userId as unknown as string,
    ...args,
  });
}

const MONTHLY = "com.weightcutwizard.premium.monthly";

describe("RevenueCat webhook — 7-day trial cancel-before-end is honoured", () => {
  it("INITIAL_PURCHASE of a trial grants Pro until the trial-end expiry", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const trialEnd = Date.now() + 7 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: trialEnd,
      eventId: "e-init",
      eventTimestampMs: 1000,
    });

    const p = await getProfile(t, userId);
    expect(p!.subscriptionTier).toBe("premium_monthly");
    expect(p!.subscriptionExpiresAt).toBe(trialEnd);
    expect(effectiveTier(p)).toBe("pro");
  });

  it("CANCELLATION mid-trial keeps tier + expiry → still Pro until trial-end, then free", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const trialEnd = Date.now() + 7 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: trialEnd,
      eventId: "e-init",
      eventTimestampMs: 1000,
    });
    // RevenueCat re-sends the (unchanged) trial-end expiry on cancellation.
    await send(t, userId, {
      eventType: "CANCELLATION",
      expirationAtMs: trialEnd,
      eventId: "e-cancel",
      eventTimestampMs: 2000,
    });

    const p = await getProfile(t, userId);
    // Tier untouched, expiry preserved → user keeps Pro for the rest of the trial.
    expect(p!.subscriptionTier).toBe("premium_monthly");
    expect(p!.subscriptionExpiresAt).toBe(trialEnd);
    expect(effectiveTier(p)).toBe("pro");
    // After the trial-end date passes, it lapses to free (no charge, no renew).
    expect(effectiveTier(p, trialEnd + 1)).toBe("free");
  });

  it("CANCELLATION without a fresh expiry preserves the existing trial-end expiry", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const trialEnd = Date.now() + 7 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: trialEnd,
      eventId: "e-init",
      eventTimestampMs: 1000,
    });
    // Malformed cancellation that omits the expiry must NOT wipe it.
    await send(t, userId, {
      eventType: "CANCELLATION",
      eventId: "e-cancel",
      eventTimestampMs: 2000,
    });

    const p = await getProfile(t, userId);
    expect(p!.subscriptionTier).toBe("premium_monthly");
    expect(p!.subscriptionExpiresAt).toBe(trialEnd);
    expect(effectiveTier(p)).toBe("pro");
  });

  it("EXPIRATION at trial-end drops to free and arms the Pro-ended cutscene", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const trialEnd = Date.now() + 7 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: trialEnd,
      eventId: "e-init",
      eventTimestampMs: 1000,
    });
    await send(t, userId, {
      eventType: "EXPIRATION",
      eventId: "e-exp",
      eventTimestampMs: 3000,
    });

    const p = await getProfile(t, userId);
    expect(p!.subscriptionTier).toBe("free");
    expect(p!.subscriptionExpiresAt == null).toBe(true);
    // Lapse cutscene armed exactly once (was previously non-free).
    expect(typeof p!.proEndedPendingAt).toBe("number");
    expect(effectiveTier(p)).toBe("free");
  });
});

describe("RevenueCat webhook — ordering / idempotency / stale-expiry guards", () => {
  it("ignores an out-of-order CANCELLATION so it can't clobber a later RENEWAL", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const renewalExpiry = Date.now() + 30 * DAY;
    const earlierExpiry = Date.now() + 4 * DAY;

    // Newest event processed first: a RENEWAL pushing expiry out 30 days.
    await send(t, userId, {
      eventType: "RENEWAL",
      productId: MONTHLY,
      expirationAtMs: renewalExpiry,
      eventId: "e-renew",
      eventTimestampMs: 2000,
    });
    // A late/replayed CANCELLATION with an OLDER timestamp must be ignored.
    const res = await send(t, userId, {
      eventType: "CANCELLATION",
      expirationAtMs: earlierExpiry,
      eventId: "e-cancel",
      eventTimestampMs: 1000,
    });

    expect((res as { skipped?: string }).skipped).toBe("out-of-order");
    const p = await getProfile(t, userId);
    expect(p!.subscriptionExpiresAt).toBe(renewalExpiry);
    expect(effectiveTier(p)).toBe("pro");
  });

  it("is idempotent — replaying the same eventId never re-applies", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const trialEnd = Date.now() + 7 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: trialEnd,
      eventId: "dup-1",
      eventTimestampMs: 1000,
    });
    // Replay the SAME event id but with a tampered far-future expiry — ignored.
    const res = await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: Date.now() + 999 * DAY,
      eventId: "dup-1",
      eventTimestampMs: 1000,
    });

    expect((res as { skipped?: string }).skipped).toBe("duplicate");
    const p = await getProfile(t, userId);
    expect(p!.subscriptionExpiresAt).toBe(trialEnd);
  });

  it("ignores a stale (older) expiry from a non-EXPIRATION event", async () => {
    const t = convexTest(schema);
    const userId = await seedFreeUser(t);
    const farExpiry = Date.now() + 30 * DAY;
    const nearExpiry = Date.now() + 5 * DAY;

    await send(t, userId, {
      eventType: "INITIAL_PURCHASE",
      productId: MONTHLY,
      expirationAtMs: farExpiry,
      eventId: "e-init",
    });
    // A RENEWAL carrying an OLDER expiry (and no ordering timestamp) must not
    // shorten the stored expiry.
    const res = await send(t, userId, {
      eventType: "RENEWAL",
      productId: MONTHLY,
      expirationAtMs: nearExpiry,
      eventId: "e-stale",
    });

    expect((res as { skipped?: string }).skipped).toBe("stale-expiry");
    const p = await getProfile(t, userId);
    expect(p!.subscriptionExpiresAt).toBe(farExpiry);
    expect(effectiveTier(p)).toBe("pro");
  });
});
