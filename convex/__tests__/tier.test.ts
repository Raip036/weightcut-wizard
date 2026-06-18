import { describe, it, expect } from "vitest";
import { effectiveTier } from "../_shared/tier";

/**
 * F1 / F4 — bounded-expiry guard + custom-trial removal.
 *
 * Core invariant under test: a non-lifetime entitlement MUST carry a finite,
 * future expiry to grant Pro. Only `premium_lifetime` may have a null expiry.
 * The legacy `trialEndsAt` → Pro branch has been removed.
 */

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 86_400_000; // +1 day
const PAST = NOW - 86_400_000; // -1 day

describe("effectiveTier — bounded-expiry guard (F1)", () => {
  it("(a) non-lifetime tier with null expiry → free", () => {
    expect(
      effectiveTier(
        { subscriptionTier: "premium_monthly", subscriptionExpiresAt: undefined } as any,
        NOW,
      ),
    ).toBe("free");
    expect(
      effectiveTier(
        { subscriptionTier: "premium_annual", subscriptionExpiresAt: null } as any,
        NOW,
      ),
    ).toBe("free");
  });

  it("(b) premium_lifetime with null expiry → pro", () => {
    expect(
      effectiveTier(
        { subscriptionTier: "premium_lifetime", subscriptionExpiresAt: undefined } as any,
        NOW,
      ),
    ).toBe("pro");
    expect(
      effectiveTier(
        { subscriptionTier: "premium_lifetime", subscriptionExpiresAt: null } as any,
        NOW,
      ),
    ).toBe("pro");
  });

  it("(c) non-lifetime with future expiry → pro", () => {
    expect(
      effectiveTier(
        { subscriptionTier: "premium_monthly", subscriptionExpiresAt: FUTURE } as any,
        NOW,
      ),
    ).toBe("pro");
    expect(
      effectiveTier(
        { subscriptionTier: "premium_annual", subscriptionExpiresAt: FUTURE } as any,
        NOW,
      ),
    ).toBe("pro");
  });

  it("(d) non-lifetime with past expiry → free", () => {
    expect(
      effectiveTier(
        { subscriptionTier: "premium_monthly", subscriptionExpiresAt: PAST } as any,
        NOW,
      ),
    ).toBe("free");
  });

  it("expiry boundary: expiresAt === now → free (must be strictly future)", () => {
    expect(
      effectiveTier(
        { subscriptionTier: "premium_monthly", subscriptionExpiresAt: NOW } as any,
        NOW,
      ),
    ).toBe("free");
  });
});

describe("effectiveTier — custom-trial branch removed (F4)", () => {
  it("(e) profile with only a future trialEndsAt (no paid tier) → free", () => {
    expect(
      effectiveTier(
        {
          subscriptionTier: "free",
          subscriptionExpiresAt: undefined,
          trialEndsAt: FUTURE,
        } as any,
        NOW,
      ),
    ).toBe("free");
  });

  it("future trialEndsAt with undefined tier → free", () => {
    expect(
      effectiveTier(
        {
          subscriptionTier: undefined,
          subscriptionExpiresAt: undefined,
          trialEndsAt: FUTURE,
        } as any,
        NOW,
      ),
    ).toBe("free");
  });
});

describe("effectiveTier — misc", () => {
  it("null/undefined profile → free", () => {
    expect(effectiveTier(null, NOW)).toBe("free");
    expect(effectiveTier(undefined, NOW)).toBe("free");
  });

  it('plain "free" tier → free', () => {
    expect(
      effectiveTier(
        { subscriptionTier: "free", subscriptionExpiresAt: undefined } as any,
        NOW,
      ),
    ).toBe("free");
  });
});
