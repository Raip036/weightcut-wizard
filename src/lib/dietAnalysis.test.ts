import { describe, it, expect } from "vitest";
import {
  status,
  coverageStats,
  groupByCategory,
  cleanFoodName,
  clean,
} from "./dietAnalysis";
import type { MicronutrientData } from "@/types/dietAnalysis";

const micro = (
  name: string,
  percentRDA: number,
  category: MicronutrientData["category"],
): MicronutrientData => ({ name, percentRDA, category, amount: "", rdaTarget: "" });

describe("status", () => {
  it("buckets percentages into low / getting there / good", () => {
    expect(status(20).label).toBe("low");
    expect(status(55).label).toBe("getting there");
    expect(status(80).label).toBe("good");
  });
});

describe("coverageStats", () => {
  it("averages capped percentRDA and counts on-point vs to-improve", () => {
    const micros = [
      micro("Vitamin D", 30, "vitamin"),
      micro("Iron", 70, "mineral"),
      micro("Omega-3", 200, "fatty_acid"), // capped at 100 for the average
    ];
    const s = coverageStats(micros);
    expect(s.coveragePct).toBe(67); // (30 + 70 + 100) / 3 = 66.67 -> 67
    expect(s.onPoint).toBe(2); // Iron (70) and Omega-3 (>=70)
    expect(s.toImprove).toBe(1); // Vitamin D
  });

  it("returns zeros for an empty list", () => {
    expect(coverageStats([])).toEqual({ coveragePct: 0, onPoint: 0, toImprove: 0 });
  });
});

describe("groupByCategory", () => {
  it("splits into vitamins, minerals, fatty acids and sorts lows first", () => {
    const micros = [
      micro("Iron", 80, "mineral"),
      micro("Zinc", 40, "mineral"),
      micro("Vitamin C", 50, "vitamin"),
      micro("Omega-3", 30, "fatty_acid"),
    ];
    const g = groupByCategory(micros);
    expect(g.vitamins.map((m) => m.name)).toEqual(["Vitamin C"]);
    expect(g.minerals.map((m) => m.name)).toEqual(["Zinc", "Iron"]); // 40 before 80
    expect(g.fattyAcids.map((m) => m.name)).toEqual(["Omega-3"]);
  });
});

describe("cleanFoodName", () => {
  it("strips a trailing parenthetical quantity", () => {
    expect(cleanFoodName("Salmon (100g)")).toBe("Salmon");
    expect(cleanFoodName("Eggs")).toBe("Eggs");
  });
});

describe("clean", () => {
  it("replaces em and en dashes", () => {
    expect(clean("a — b")).toBe("a - b");
    expect(clean("a–b")).toBe("a-b");
    expect(clean(undefined)).toBe("");
  });
});
