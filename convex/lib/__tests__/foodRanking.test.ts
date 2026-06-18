import { describe, it, expect } from "vitest";
import {
  rankFoods,
  type RankableFood,
  type HistoryEntry,
} from "../foodRanking";

/**
 * foodRanking — pure ranking module.
 *
 * Tier invariant under test:  HISTORY ≫ CLEAN_INGREDIENT > BRANDED > NAME_MATCH
 */

// Minimal helper so fixtures stay focused on the fields ranking cares about.
function food(partial: Partial<RankableFood> & { id: string; name: string }): RankableFood {
  return {
    brand: "",
    calories_per_100g: 0,
    protein_per_100g: 0,
    carbs_per_100g: 0,
    fats_per_100g: 0,
    ...partial,
  };
}

function names(results: RankableFood[]): string[] {
  return results.map((r) => r.name);
}

// A "chicken" search in a deliberately BAD initial order:
// branded items first, the very noisy long entry early, concise clean
// ingredients buried at the bottom.
const CHICKEN_RESULTS: RankableFood[] = [
  food({ id: "b1", name: "Chicken Bites", brand: "Tyson", dataType: "Branded" }),
  food({
    id: "noisy",
    name: "Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, braised",
    dataType: "SR Legacy",
  }),
  food({ id: "b2", name: "Crispy Chicken Strips", brand: "Perdue", dataType: "Branded" }),
  food({ id: "f1", name: "Chicken breast, raw", dataType: "Foundation" }),
  food({ id: "f2", name: "Chicken thigh, raw", dataType: "Foundation" }),
];

describe("rankFoods — clean ingredients beat noise and brands (no history)", () => {
  const ranked = rankFoods(CHICKEN_RESULTS, "chicken", []);
  const order = names(ranked);

  it("surfaces both concise clean ingredients above the noisy long entry", () => {
    const breastIdx = order.indexOf("Chicken breast, raw");
    const thighIdx = order.indexOf("Chicken thigh, raw");
    const noisyIdx = order.findIndex((n) => n.startsWith("Chicken, broiler"));

    expect(breastIdx).toBeLessThan(noisyIdx);
    expect(thighIdx).toBeLessThan(noisyIdx);
  });

  it("ranks concise clean ingredients above branded items", () => {
    const breastIdx = order.indexOf("Chicken breast, raw");
    const thighIdx = order.indexOf("Chicken thigh, raw");
    const brandedIdxs = [
      order.indexOf("Chicken Bites"),
      order.indexOf("Crispy Chicken Strips"),
    ];

    for (const bIdx of brandedIdxs) {
      expect(breastIdx).toBeLessThan(bIdx);
      expect(thighIdx).toBeLessThan(bIdx);
    }
  });

  it("puts the two concise clean ingredients at ranks #1 and #2", () => {
    expect(order.slice(0, 2).sort()).toEqual(
      ["Chicken breast, raw", "Chicken thigh, raw"].sort(),
    );
  });
});

describe("rankFoods — history boost dominates", () => {
  it("jumps a frequently-logged item to #1 over a 'better' clean ingredient", () => {
    const history: HistoryEntry[] = [
      {
        key: "chicken thigh, raw|",
        name: "Chicken thigh, raw",
        brand: "",
        logCount: 8,
        lastUsedAt: 0,
      },
    ];

    const ranked = rankFoods(CHICKEN_RESULTS, "chicken", history);
    const order = names(ranked);

    expect(order[0]).toBe("Chicken thigh, raw");
    expect(order.indexOf("Chicken thigh, raw")).toBeLessThan(
      order.indexOf("Chicken breast, raw"),
    );
  });

  it("matches history loosely by name when brand differs (brand-insensitive)", () => {
    // History stored a brand; the result is unbranded but same name → still boosts.
    const history: HistoryEntry[] = [
      {
        key: "chicken bites|tyson",
        name: "Chicken Bites",
        brand: "Tyson",
        logCount: 10,
        lastUsedAt: 0,
      },
    ];
    const ranked = rankFoods(CHICKEN_RESULTS, "chicken", history);
    // The heavily-logged branded "Chicken Bites" should now lead despite being
    // a branded item that otherwise ranks below clean ingredients.
    expect(names(ranked)[0]).toBe("Chicken Bites");
  });
});

describe("rankFoods — stability", () => {
  it("preserves original relative order for equal-score items", () => {
    // All identical scoring profile (same dataType, no brand, no query match,
    // same name length) → equal scores → original order must be preserved.
    const equal: RankableFood[] = [
      food({ id: "a", name: "Aaa Aaa Aaa Aaa", dataType: "Foundation" }),
      food({ id: "b", name: "Bbb Bbb Bbb Bbb", dataType: "Foundation" }),
      food({ id: "c", name: "Ccc Ccc Ccc Ccc", dataType: "Foundation" }),
      food({ id: "d", name: "Ddd Ddd Ddd Ddd", dataType: "Foundation" }),
    ];

    const ranked = rankFoods(equal, "zzz-no-match", []);
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...CHICKEN_RESULTS];
    rankFoods(CHICKEN_RESULTS, "chicken", []);
    expect(CHICKEN_RESULTS).toEqual(copy);
  });
});
