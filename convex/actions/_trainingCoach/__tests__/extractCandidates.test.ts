import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractCandidates, normalizeTechnique } from "../extractCandidates";

vi.mock("../../../_shared/groq", () => ({
  callGroqText: vi.fn(),
}));

import { callGroqText } from "../../../_shared/groq";

describe("extractCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses JSON response into candidates", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({
        candidates: [
          { technique: "Kimura from side control", sport: "BJJ", confidence: 0.9 },
        ],
      }),
    );
    const out = await extractCandidates({ notes: "Worked kimuras today" });
    expect(out).toEqual([
      { technique: "Kimura from side control", sport: "BJJ", confidence: 0.9 },
    ]);
  });

  it("returns [] when LLM returns no candidates", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ candidates: [] }));
    const out = await extractCandidates({ notes: "ok session" });
    expect(out).toEqual([]);
  });

  it("returns [] when LLM returns unparseable text", async () => {
    (callGroqText as any).mockResolvedValue("not json at all");
    const out = await extractCandidates({ notes: "anything" });
    expect(out).toEqual([]);
  });

  it("returns [] when Groq call throws", async () => {
    (callGroqText as any).mockRejectedValue(new Error("AI_TIMEOUT"));
    const out = await extractCandidates({ notes: "anything" });
    expect(out).toEqual([]);
  });

  it("calls the heavy gpt-oss-120b model in JSON mode", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ candidates: [] }));
    await extractCandidates({ notes: "x" });
    const call = (callGroqText as any).mock.calls[0][0];
    // Candidate extraction uses the heavy-tier model — its quality drives the
    // whole downstream training-coach pipeline (see extractCandidates.ts).
    expect(call.model).toBe("openai/gpt-oss-120b");
    expect(call.response_format).toEqual({ type: "json_object" });
  });

  it("defaults confidence to 0.5 when LLM omits it", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({ candidates: [{ technique: "Jab", sport: "Boxing" }] }),
    );
    const out = await extractCandidates({ notes: "x" });
    expect(out[0].confidence).toBe(0.5);
  });
});

describe("normalizeTechnique", () => {
  it.each([
    ["Kimura from side control", "kimura-from-side-control"],
    ["jab-cross", "jab-cross"],
    ["  Spaces!! ", "spaces"],
    ["", ""],
  ])("'%s' -> '%s'", (input, expected) => {
    expect(normalizeTechnique(input)).toBe(expected);
  });
});
