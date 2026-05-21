import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSteps } from "../generateSteps";

vi.mock("../../../_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../../_shared/groq";

const MOCK_STEPS = [1, 2, 3, 4, 5].map((i) => ({
  position: i,
  prescription: `Step ${i}`,
  wizardLine: `Pratik — step ${i}`,
  details: { why: "why", how: ["a", "b", "c"], pitfalls: ["p"] },
  targetSport: "BJJ",
  expectedSessions: 1,
}));

describe("generateSteps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 5-8 validated steps from a valid LLM response", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: MOCK_STEPS }));
    const out = await generateSteps({
      sport: "BJJ", goal: "Master kimura", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("steps");
    if (out.kind === "steps") expect(out.steps).toHaveLength(5);
  });

  it("rejects fewer than 5 steps", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({ steps: MOCK_STEPS.slice(0, 3) }),
    );
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });

  it("rejects more than 8 steps", async () => {
    const tooMany = Array.from({ length: 9 }).map((_, i) => MOCK_STEPS[0]);
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: tooMany }));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });

  it("rejects steps missing wizardLine", async () => {
    const bad = MOCK_STEPS.map((s) => ({ ...s, wizardLine: "" }));
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: bad }));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });

  it("returns 'refused' when LLM signals fight_week", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({ refusedReason: "fight_week" }),
    );
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: 5, firstName: "Pratik",
    });
    expect(out.kind).toBe("refused");
    if (out.kind === "refused") expect(out.reason).toBe("fight_week");
  });

  it("uses the heavy gpt-oss-120b model", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: MOCK_STEPS }));
    await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect((callGroqText as any).mock.calls[0][0].model).toBe("openai/gpt-oss-120b");
  });

  it("propagates groq errors as error result", async () => {
    (callGroqText as any).mockRejectedValue(new Error("AI_TIMEOUT"));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });
});
