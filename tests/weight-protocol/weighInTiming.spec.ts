/**
 * Unit tests for convex/_shared/weighInTiming.ts — specifically
 * `resolveWeighInIso`, the single source of truth that turns a fight date +
 * weigh-in timing into the true make-weight (weigh-in) day.
 *
 *   day_before → fightDate − 1 day
 *   same_day   → fightDate
 */

import { describe, it, expect } from "vitest";
import { resolveWeighInIso } from "../../convex/_shared/weighInTiming";

describe("resolveWeighInIso", () => {
  it("day_before → fight date minus one day", () => {
    expect(resolveWeighInIso("2026-06-15", "day_before")).toBe("2026-06-14");
  });

  it("same_day → the fight date itself", () => {
    expect(resolveWeighInIso("2026-06-15", "same_day")).toBe("2026-06-15");
  });

  it("crosses a month boundary correctly (UTC, no off-by-one)", () => {
    expect(resolveWeighInIso("2026-07-01", "day_before")).toBe("2026-06-30");
  });

  it("crosses a year boundary correctly", () => {
    expect(resolveWeighInIso("2026-01-01", "day_before")).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(resolveWeighInIso("2028-03-01", "day_before")).toBe("2028-02-29");
  });

  it("defaults unknown / missing timing to day_before (historical behavior)", () => {
    expect(resolveWeighInIso("2026-06-15", null)).toBe("2026-06-14");
    expect(resolveWeighInIso("2026-06-15", undefined)).toBe("2026-06-14");
    expect(resolveWeighInIso("2026-06-15", "")).toBe("2026-06-14");
  });

  it("normalizes legacy same-day strings to same_day", () => {
    for (const legacy of ["morning_of", "day_of", "two_hour", "same-day"]) {
      expect(resolveWeighInIso("2026-06-15", legacy)).toBe("2026-06-15");
    }
  });

  it("returns an unparseable fight date unchanged", () => {
    expect(resolveWeighInIso("", "day_before")).toBe("");
    expect(resolveWeighInIso("not-a-date", "day_before")).toBe("not-a-date");
  });
});
