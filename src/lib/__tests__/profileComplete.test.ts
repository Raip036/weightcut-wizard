import { describe, it, expect } from "vitest";
import { isProfileComplete } from "../profileComplete";

describe("isProfileComplete", () => {
  it("maintenance profile is complete without a target_date", () => {
    expect(isProfileComplete({ goal_type: "maintaining", age: 30, current_weight_kg: 75 })).toBe(true);
  });
  it("cutting profile needs a target_date", () => {
    expect(isProfileComplete({ goal_type: "cutting", age: 30, current_weight_kg: 75 })).toBe(false);
    expect(isProfileComplete({ goal_type: "cutting", age: 30, current_weight_kg: 75, target_date: "2026-09-01" })).toBe(true);
  });
  it("losing profile needs a target_date", () => {
    expect(isProfileComplete({ goal_type: "losing", age: 30, current_weight_kg: 75 })).toBe(false);
  });
  it("requires age and current weight even for maintenance", () => {
    expect(isProfileComplete({ goal_type: "maintaining", current_weight_kg: 75 })).toBe(false);
    expect(isProfileComplete({ goal_type: "maintaining", age: 30 })).toBe(false);
  });
  it("null/undefined is not complete", () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete(undefined)).toBe(false);
  });
});
