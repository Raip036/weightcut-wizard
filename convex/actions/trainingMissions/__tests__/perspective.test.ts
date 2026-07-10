/**
 * checkPerspective: the deterministic perspective gate.
 *
 * The regression fixture is the reported bug: the note "I can't check the kick
 * my opponent throws after a boxing combination" produced drills telling the
 * athlete to THROW boxing combinations. The athlete is the defender; an
 * "offense" objective on that diagnosis must be caught here, at the only layer
 * where it can be asserted without an LLM.
 *
 * LLM prompt behaviour stays untested by design, consistent with
 * `convex/__tests__/mastery_spine.test.ts`.
 */

import { describe, test, expect } from "vitest";
import { checkPerspective } from "../perspective";
import type { Diagnosis } from "../generate";

/** The reported bug, as the DIAGNOSE stage should now read it. */
const BOXING_COMBO_DIAGNOSIS: Diagnosis = {
  category: "technical",
  problem: "You cannot check the kick that lands at the end of their combination.",
  failingComponent: "raising the shin in time as the combination ends",
  athleteRole: "defender",
  opponentAction: "boxing combination followed by a kick",
  athleteResponse: "check the kick",
  targetTechnique: "leg check",
  notesEvidence: "I can't check the kick my opponent throws after a boxing combination",
  confidence: "high",
};

function withDiagnosis(overrides: Partial<Diagnosis>): Diagnosis {
  return { ...BOXING_COMBO_DIAGNOSIS, ...overrides };
}

describe("checkPerspective", () => {
  test("defender + offense is the reported inversion", () => {
    const result = checkPerspective(BOXING_COMBO_DIAGNOSIS, "offense");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an inversion");
    // The feedback must name the athlete's own response and warn off the
    // opponent's action, since it is fed straight into the revision pass.
    expect(result.problem).toContain("PERSPECTIVE INVERSION");
    expect(result.problem).toContain("check the kick");
    expect(result.problem).toContain("boxing combination followed by a kick");
    expect(result.problem).toContain("defender");
  });

  test("counter_attacker + pressure is an inversion", () => {
    const result = checkPerspective(
      withDiagnosis({
        athleteRole: "counter_attacker",
        athleteResponse: "slip the jab then answer with a cross",
      }),
      "pressure",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an inversion");
    expect(result.problem).toContain("counter attacker");
    expect(result.problem).toContain("slip the jab then answer with a cross");
  });

  test("defender + defense is coherent", () => {
    expect(checkPerspective(BOXING_COMBO_DIAGNOSIS, "defense")).toEqual({
      ok: true,
    });
  });

  test("attacker + offense is coherent", () => {
    const diagnosis = withDiagnosis({
      athleteRole: "attacker",
      opponentAction: "",
      athleteResponse: "finish the double-leg takedown",
      targetTechnique: "double-leg takedown",
    });

    expect(checkPerspective(diagnosis, "offense")).toEqual({ ok: true });
  });

  test("an objective outside the vocabulary passes", () => {
    // normalizeObjective coerces unknown values to "counter" upstream, so the
    // gate must never fire on something it does not recognise.
    expect(checkPerspective(BOXING_COMBO_DIAGNOSIS, "counter")).toEqual({
      ok: true,
    });
    expect(checkPerspective(BOXING_COMBO_DIAGNOSIS, "wrestle-up")).toEqual({
      ok: true,
    });
    expect(checkPerspective(BOXING_COMBO_DIAGNOSIS, "")).toEqual({ ok: true });
  });

  test("objective casing and padding do not defeat the gate", () => {
    const result = checkPerspective(BOXING_COMBO_DIAGNOSIS, "  Offense ");
    expect(result.ok).toBe(false);
  });

  test("falls back to targetTechnique when athleteResponse is blank", () => {
    const result = checkPerspective(
      withDiagnosis({ athleteResponse: "" }),
      "offense",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an inversion");
    expect(result.problem).toContain("leg check");
  });
});
