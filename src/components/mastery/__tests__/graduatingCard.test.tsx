import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DisciplineCard } from "../MasterySpine";
import {
  createCycleDetectorState,
  resolveCycleXp,
  stepCycleDetection,
} from "../useMinimumDisplay";
import type { SparringAssignment } from "@/components/sparring/SparringAssignmentRow";

// The "graduating" phase is the window between the last drill tick (missions
// archived server-side) and the sparring assignments landing. Before it existed
// the discipline had neither missions nor assignments, so getMasteryFlow dropped
// it and the card hard-unmounted: the list reflowed, the in-card sparring loader
// could not render (its parent was gone), and the reward timer was cleared on
// unmount. These assert the card survives that window with the loader inside it.
//
// Rendered with react-dom/server, matching the repo's DOM-less vitest env
// (see vitest.config.ts). A `graduating` entry carries no missions and no
// assignments, so neither MissionCard nor SparringAssignmentRow mounts and no
// Convex hook is reached.

const noop = () => {};

function renderCard(
  overrides: Partial<Parameters<typeof DisciplineCard>[0]> = {},
) {
  return renderToStaticMarkup(
    <DisciplineCard
      discipline="boxing"
      missions={[]}
      assignments={[]}
      serverPhase="graduating"
      reducedMotion={false}
      onCycleComplete={noop}
      generatingSparring={false}
      {...overrides}
    />,
  );
}

describe("DisciplineCard: graduating phase", () => {
  it("keeps the discipline rendered and shows the sparring loader", () => {
    const html = renderCard();
    // The card itself survived.
    expect(html).toContain("Boxing");
    // The in-card sparring loader is up (MasteryGeneratingCard kind="sparring").
    expect(html).toContain("Generating sparring");
    expect(html).toContain('aria-busy="true"');
    // And the drill-phase furniture is gone.
    expect(html).not.toContain("Sparring sealed");
  });

  it("shows the loader on a held sparring generation even outside the graduating phase", () => {
    // Regeneration: the server says "spar" and the rows exist, but the held
    // min-display latch still wants the loader up.
    const rows: SparringAssignment[] = [
      {
        _id: "a1",
        discipline: "boxing",
        technique: "Check the low kick",
        whenToUse: "After a boxing combination",
        setups: [],
        counters: [],
        status: "todo",
        updatedAt: 0,
        timesLogged: 0,
        source: "graduated",
        landedCount: 0,
      },
    ];
    const html = renderCard({
      serverPhase: "spar",
      assignments: rows,
      generatingSparring: true,
    });
    expect(html).toContain("Generating sparring");
    expect(html).not.toContain("Check the low kick");
  });

  it("shows the drill list, not the loader, while drilling", () => {
    const html = renderCard({ serverPhase: "drill" });
    expect(html).toContain("Sparring sealed");
    expect(html).not.toContain("Generating sparring");
  });

  it("renders under reduced motion without the freeze box", () => {
    const html = renderCard({ reducedMotion: true });
    expect(html).toContain("Generating sparring");
  });
});

describe("cutscene XP", () => {
  it("consumes the server's cycleXp when markLanded provides it", () => {
    // 5 items * 20 + 1 mission * 100 + 3 masteries * 45 + 50 bonus.
    expect(resolveCycleXp(385)).toBe(385);
    // Zero is a real figure, not a missing one.
    expect(resolveCycleXp(0)).toBe(0);
  });

  it("falls back to the flat bonus when the server sends no cycleXp", () => {
    expect(resolveCycleXp(undefined)).toBe(50);
  });

  it("falls back to the detector's estimate on the deterministic path", () => {
    // The deterministic detector never sees a mutation result, so it can only
    // estimate: prevCount * 45 + 50. That estimate stays a backstop, and it is
    // deliberately NOT what the imperative path reports.
    const state = createCycleDetectorState("campA");
    stepCycleDetection(state, { boxing: 3 }, "campA", true); // baseline
    const fired = stepCycleDetection(state, { boxing: 0 }, "campA", true);
    expect(fired).toEqual([{ discipline: "boxing", xp: 3 * 45 + 50 }]);
    // The server's figure for the same cycle differs; when it is available the
    // imperative path wins and the estimate is never consulted.
    expect(resolveCycleXp(385)).not.toBe(fired[0].xp);
  });
});
