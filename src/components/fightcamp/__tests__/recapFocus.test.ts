import { describe, test, expect } from "vitest";
import { deriveFocusDiscipline } from "../recapFocus";

describe("deriveFocusDiscipline", () => {
  test("picks the most frequent discipline", () => {
    expect(deriveFocusDiscipline(
      [{ discipline: "MMA" }, { discipline: "MMA" }, { discipline: "S&C" }], "S&C",
    )).toBe("MMA");
  });
  test("breaks ties by first occurrence", () => {
    expect(deriveFocusDiscipline(
      [{ discipline: "Boxing" }, { discipline: "MMA" }], "S&C",
    )).toBe("Boxing");
  });
  test("falls back when no takeaways", () => {
    expect(deriveFocusDiscipline([], "S&C")).toBe("S&C");
    expect(deriveFocusDiscipline(undefined, "S&C")).toBe("S&C");
  });
  test("falls back when all disciplines blank", () => {
    expect(deriveFocusDiscipline([{ discipline: "" }, {}], "S&C")).toBe("S&C");
  });
});
