import { describe, it, expect } from "vitest";
import { deriveNutrientCategory } from "../_shared/nutrientCategories";

describe("deriveNutrientCategory", () => {
  it("classifies vitamins", () => {
    expect(deriveNutrientCategory("Vitamin D")).toBe("vitamin");
    expect(deriveNutrientCategory("vitamin b12")).toBe("vitamin");
    expect(deriveNutrientCategory("B12")).toBe("vitamin");
    expect(deriveNutrientCategory("Folate")).toBe("vitamin");
    expect(deriveNutrientCategory("Vitamin C")).toBe("vitamin");
  });

  it("classifies minerals", () => {
    expect(deriveNutrientCategory("Iron")).toBe("mineral");
    expect(deriveNutrientCategory("Zinc")).toBe("mineral");
    expect(deriveNutrientCategory("Magnesium")).toBe("mineral");
    expect(deriveNutrientCategory("Calcium")).toBe("mineral");
    expect(deriveNutrientCategory("Selenium")).toBe("mineral");
  });

  it("classifies fatty acids", () => {
    expect(deriveNutrientCategory("Omega-3")).toBe("fatty_acid");
    expect(deriveNutrientCategory("omega 3")).toBe("fatty_acid");
    expect(deriveNutrientCategory("EPA")).toBe("fatty_acid");
    expect(deriveNutrientCategory("DHA")).toBe("fatty_acid");
  });

  it("defaults unknown names to other", () => {
    expect(deriveNutrientCategory("Fiber")).toBe("other");
    expect(deriveNutrientCategory("")).toBe("other");
    expect(deriveNutrientCategory("Choline")).toBe("other");
  });
});
