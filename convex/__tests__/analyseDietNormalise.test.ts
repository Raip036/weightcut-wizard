import { describe, it, expect } from "vitest";
import { normaliseAnalysis } from "../actions/analyseDiet";

describe("normaliseAnalysis", () => {
  it("injects a derived category onto each micronutrient", () => {
    const out = normaliseAnalysis({
      micronutrients: [
        { name: "Vitamin D", percentRDA: 28, amount: "2ug", rdaTarget: "15ug" },
        { name: "Iron", percentRDA: 60, amount: "11mg", rdaTarget: "18mg" },
        { name: "Omega-3", percentRDA: 40, amount: "0.4g", rdaTarget: "1g" },
      ],
    });
    expect(out.micronutrients.map((m) => m.category)).toEqual([
      "vitamin", "mineral", "fatty_acid",
    ]);
  });

  it("maps snake_case food contributions", () => {
    const out = normaliseAnalysis({
      food_contributions: [
        {
          food: "Salmon",
          meal_type: "dinner",
          nutrients: [{ name: "Omega-3", amount: "1.2 g" }],
        },
      ],
    });
    expect(out.foodContributions).toEqual([
      {
        food: "Salmon",
        mealType: "dinner",
        nutrients: [{ name: "Omega-3", amount: "1.2 g" }],
      },
    ]);
  });

  it("maps key insights and coerces an unknown focus to health", () => {
    const out = normaliseAnalysis({
      keyInsights: [
        { focus: "performance", text: "Iron is low, which can blunt aerobic output." },
        { focus: "wellbeing", text: "Add colour for antioxidants." },
      ],
    });
    expect(out.keyInsights).toEqual([
      { focus: "performance", text: "Iron is low, which can blunt aerobic output." },
      { focus: "health", text: "Add colour for antioxidants." },
    ]);
  });

  it("returns empty arrays for missing sections", () => {
    const out = normaliseAnalysis({});
    expect(out.micronutrients).toEqual([]);
    expect(out.foodContributions).toEqual([]);
    expect(out.keyInsights).toEqual([]);
    expect(out.gaps).toEqual([]);
  });
});
