import { describe, it, expect, vi, beforeEach } from "vitest";
import { proposeFollowUps } from "../completePath";

vi.mock("../../../_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../../_shared/groq";

describe("proposeFollowUps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns both relatedPath and defensePath proposals", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({
        relatedPath: { technique: "Kimura to armbar", sport: "BJJ", goal: "Chain it" },
        defensePath: { technique: "Kimura defense", sport: "BJJ", goal: "Defend it" },
      }),
    );
    const out = await proposeFollowUps({
      technique: "Kimura from side control",
      sport: "BJJ",
    });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.relatedPath.technique).toMatch(/armbar/);
      expect(out.defensePath.technique).toMatch(/defense/i);
    }
  });

  it("returns 'error' when LLM omits one of the proposals", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({
        relatedPath: { technique: "x", sport: "BJJ", goal: "y" },
      }),
    );
    const out = await proposeFollowUps({ technique: "Kimura", sport: "BJJ" });
    expect(out.kind).toBe("error");
  });

  it("returns 'error' when LLM returns proposal with empty technique", async () => {
    (callGroqText as any).mockResolvedValue(
      JSON.stringify({
        relatedPath: { technique: "", sport: "BJJ", goal: "y" },
        defensePath: { technique: "x", sport: "BJJ", goal: "y" },
      }),
    );
    const out = await proposeFollowUps({ technique: "Kimura", sport: "BJJ" });
    expect(out.kind).toBe("error");
  });
});
