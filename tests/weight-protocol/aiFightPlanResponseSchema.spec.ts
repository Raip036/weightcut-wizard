import { describe, it, expect } from "vitest";
import { AiFightPlanResponseSchema } from "../../convex/_shared/aiSchemas";

/**
 * Regression: the lenient AI-response schema must tolerate a model that
 * omits the top-level `days` array. `mergeFightPlan` does `ai.days ?? []`
 * and rebuilds days from the deterministic skeleton, so a missing `days`
 * is expected — it must NOT throw a ZodError (which surfaced to users as
 * "Couldn't build your protocol" / `path: ["days"], "Required"`).
 */
describe("AiFightPlanResponseSchema", () => {
  it("parses an empty object (model returned no copy / `{}` fallback)", () => {
    const result = AiFightPlanResponseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("parses a response that omits `days`", () => {
    const result = AiFightPlanResponseSchema.safeParse({
      rolling: { peakWaterDay: "T-6", sodiumCliffDay: "T-2", glycogenFloorDay: "T-1" },
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a well-formed `days` array", () => {
    const result = AiFightPlanResponseSchema.safeParse({
      days: [{ dayLabel: "T-7", carbsCopy: "Hold carbs steady today." }],
    });
    expect(result.success).toBe(true);
  });
});
