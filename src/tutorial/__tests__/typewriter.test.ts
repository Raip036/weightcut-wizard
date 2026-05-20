import { describe, it, expect } from "vitest";
import { charIntervalMs, endsAtSentence } from "../typewriter";

describe("charIntervalMs", () => {
  it("returns 14ms for normal pace", () => {
    expect(charIntervalMs("normal")).toBe(14);
  });
  it("returns 32ms for slow pace", () => {
    expect(charIntervalMs("slow")).toBe(32);
  });
  it("defaults to normal when undefined", () => {
    expect(charIntervalMs(undefined)).toBe(14);
  });
});

describe("endsAtSentence", () => {
  it("returns true when the last revealed char is . ? or !", () => {
    expect(endsAtSentence("Hello.")).toBe(true);
    expect(endsAtSentence("What?")).toBe(true);
    expect(endsAtSentence("Wow!")).toBe(true);
  });
  it("returns false otherwise", () => {
    expect(endsAtSentence("Hello")).toBe(false);
    expect(endsAtSentence("")).toBe(false);
    expect(endsAtSentence("mid,")).toBe(false);
  });
});
