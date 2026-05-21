import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluatePlateau, detectStallInNotes } from "../evaluatePlateau";

vi.mock("../../../_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../../_shared/groq";

const VALID_REMEDIAL = {
  remedialStep: {
    prescription: "Drill hip-out timing under partner pressure.",
    wizardLine: "Let's refine before we push forward.",
    details: { why: "Hip out is the bottleneck.", how: ["a", "b"], pitfalls: ["p"] },
  },
  stallReason: "getting countered by frame",
};

describe("evaluatePlateau", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a remedial step from a valid LLM response", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify(VALID_REMEDIAL));
    const out = await evaluatePlateau({
      technique: "kimura",
      stallSignal: "2 off feedbacks",
    });
    expect(out.kind).toBe("remedial");
    if (out.kind === "remedial") expect(out.step.prescription).toMatch(/hip/);
  });

  it("returns 'error' when LLM omits the wizardLine", async () => {
    const bad = { remedialStep: { ...VALID_REMEDIAL.remedialStep, wizardLine: "" } };
    (callGroqText as any).mockResolvedValue(JSON.stringify(bad));
    const out = await evaluatePlateau({ technique: "kimura", stallSignal: "x" });
    expect(out.kind).toBe("error");
  });

  it("returns 'error' when LLM omits details.how", async () => {
    const bad = {
      remedialStep: {
        ...VALID_REMEDIAL.remedialStep,
        details: { ...VALID_REMEDIAL.remedialStep.details, how: [] },
      },
    };
    (callGroqText as any).mockResolvedValue(JSON.stringify(bad));
    const out = await evaluatePlateau({ technique: "kimura", stallSignal: "x" });
    expect(out.kind).toBe("error");
  });

  it("defaults stallReason when LLM omits it", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({ remedialStep: VALID_REMEDIAL.remedialStep }),
    );
    const out = await evaluatePlateau({ technique: "kimura", stallSignal: "x" });
    if (out.kind === "remedial") expect(out.stallReason).toBe("stalled progress");
  });
});

describe("detectStallInNotes", () => {
  it.each([
    ["I couldn't finish the kimura tonight", "kimura", true],
    ["got countered by frame on every kimura attempt", "kimura", true],
    ["she kept sweeping me when i tried kimura", "kimura", true],
    ["still struggling with my kimura grip", "kimura", true],
    ["hit a sweet kimura against the brown belt", "kimura", false],
    ["finally landed the kimura", "kimura", false],
    ["couldn't finish it", "kimura", false], // technique not mentioned
  ])("'%s' (technique=%s) -> %s", (text, tech, expected) => {
    expect(detectStallInNotes(text, tech)).toBe(expected);
  });
});
