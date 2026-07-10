/**
 * Deterministic perspective gate for generated missions.
 *
 * The diagnosis records WHO does WHAT. An athlete who is the defender (or the
 * counter-attacker) in the exchange, but whose mission carries an offensive
 * objective, is being drilled on the opponent's half of it: they asked how to
 * check a kick and the drills teach them to throw the combination that precedes
 * it.
 *
 * VERIFY cannot catch this on its own, because the drills faithfully serve the
 * objective they were handed. The check is a pure function of two fields, so it
 * runs before VERIFY, costs nothing, and feeds the same revision pass.
 *
 * Pure module: no Convex, no LLM, no I/O. `Diagnosis` is a type-only import,
 * erased at compile time, so nothing from the action bundle is pulled in here.
 */

import type { Diagnosis } from "./generate";

/** Roles where the opponent acts first and the athlete must answer. */
const RESPONDING_ROLES: ReadonlySet<Diagnosis["athleteRole"]> = new Set([
  "defender",
  "counter_attacker",
]);

/** Objectives that make the athlete the one initiating the exchange. */
const INITIATING_OBJECTIVES: ReadonlySet<string> = new Set([
  "offense",
  "pressure",
]);

export type PerspectiveResult =
  | { ok: true }
  | { ok: false; problem: string };

/**
 * Check that the mission's objective is compatible with the athlete's role in
 * the diagnosed exchange.
 *
 * @param diagnosis The required Stage A diagnosis, carrying the role split.
 * @param objective The normalised strategic objective the drills were built for.
 * @returns `{ ok: true }`, or `{ ok: false, problem }` naming the inversion and
 *          what the drills must train instead.
 */
export function checkPerspective(
  diagnosis: Diagnosis,
  objective: string,
): PerspectiveResult {
  const normalized = objective.trim().toLowerCase();
  if (
    !RESPONDING_ROLES.has(diagnosis.athleteRole) ||
    !INITIATING_OBJECTIVES.has(normalized)
  ) {
    return { ok: true };
  }

  const role = diagnosis.athleteRole.replace(/_/g, " ");
  // athleteResponse is the athlete's half of the exchange. targetTechnique is
  // the same thing named as a technique, so it is the natural fallback if the
  // model left the response blank.
  const response =
    diagnosis.athleteResponse.trim() || diagnosis.targetTechnique.trim();
  const opponentAction = diagnosis.opponentAction.trim();

  return {
    ok: false,
    problem: [
      `PERSPECTIVE INVERSION. In this exchange the athlete is the ${role}, but the objective is "${normalized}", which drills the opponent's half of it.`,
      opponentAction
        ? `"${opponentAction}" is what the OPPONENT does; the athlete must never rehearse it as their own attack.`
        : "",
      `Every drill must train the athlete's own response: ${response}.`,
      `Rebuild all 3 drills around that response and set the objective to "defense", "counter", or "escape", whichever matches what the athlete has to do when the opponent's action arrives.`,
    ]
      .filter((line) => line.length > 0)
      .join(" "),
  };
}
