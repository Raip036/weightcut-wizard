import { describe, it, expect } from "vitest";
import { deriveDayType } from "@/lib/dayType";

describe("deriveDayType", () => {
  it("returns rest when no session is logged", () => {
    expect(deriveDayType(null)).toBe("rest");
    expect(deriveDayType(undefined)).toBe("rest");
  });

  it("returns rest for an explicit Rest-primary session", () => {
    expect(deriveDayType({ sessionType: "Rest" })).toBe("rest");
    expect(deriveDayType({ sessionType: "Rest", sessionTag: "Yoga" })).toBe("rest");
  });

  it("returns hard for a contact session", () => {
    expect(deriveDayType({ sessionType: "BJJ", sessionTag: "Sparring" })).toBe("hard");
    expect(deriveDayType({ sessionType: "Boxing", sessionTag: "Live Grappling" })).toBe("hard");
  });

  it("returns hard for a heavy-load activity tag", () => {
    expect(deriveDayType({ sessionType: "Muay Thai", sessionTag: "Hard Drilling" })).toBe("hard");
  });

  it("returns hard when intensity / rpe are at the top of the range", () => {
    expect(deriveDayType({ sessionType: "S&C", sessionTag: "Strength", rpe: 9 })).toBe("hard");
    expect(deriveDayType({ sessionType: "S&C", sessionTag: "Strength", intensityLevel: 5 })).toBe("hard");
    expect(deriveDayType({ sessionType: "S&C", sessionTag: "Conditioning", intensity: "high" })).toBe("hard");
  });

  it("returns medium for a logged, non-rest, non-hard session", () => {
    expect(deriveDayType({ sessionType: "BJJ", sessionTag: "Drilling", rpe: 5 })).toBe("medium");
    expect(deriveDayType({ sessionType: "S&C", sessionTag: "Strength", intensity: "moderate" })).toBe("medium");
  });

  it("defaults to medium when the signal is ambiguous", () => {
    expect(deriveDayType({ sessionType: "BJJ" })).toBe("medium");
  });
});
