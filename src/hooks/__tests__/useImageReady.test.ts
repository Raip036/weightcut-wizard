import { describe, it, expect } from "vitest";
import { imageStatusReducer, type ImageStatus } from "../useImageReady";

/**
 * These transitions encode the fix for the community-feed "freeze on swipe"
 * bug. Before the fix the image had no path out of "loading" on failure
 * (no onError) and no reset when the card was promoted to a new src — so a
 * failed/changed image left the card frozen invisible. The reducer now models
 * both an `error` terminal state and a `reset` back to `loading`.
 */
describe("imageStatusReducer", () => {
  it("starts resolving from loading → ready on load", () => {
    expect(imageStatusReducer("loading", { type: "load" })).toBe("ready");
  });

  it("resolves to error on load failure (was previously impossible → freeze)", () => {
    expect(imageStatusReducer("loading", { type: "error" })).toBe("error");
  });

  it("resets to loading when the src changes (card promotion case)", () => {
    const cases: ImageStatus[] = ["loading", "ready", "error"];
    for (const from of cases) {
      expect(imageStatusReducer(from, { type: "reset" })).toBe("loading");
    }
  });

  it("recovers from a prior error once the new src loads", () => {
    const reset = imageStatusReducer("error", { type: "reset" });
    expect(reset).toBe("loading");
    expect(imageStatusReducer(reset, { type: "load" })).toBe("ready");
  });
});
