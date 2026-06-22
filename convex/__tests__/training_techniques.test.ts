import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => ctx.db.insert("users", {} as any));
}

describe("training_techniques.upsertFromDebrief", () => {
  it("inserts new techniques with timesLogged=1", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId,
      weekStart: "2026-05-18",
      takeaways: [
        { discipline: "BJJ", technique: "Scissor sweep", cue: "Hook-Push-Tilt", detail: "Tilt onto the open side." },
      ],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timesLogged).toBe(1);
    expect(rows[0].firstSeenWeek).toBe("2026-05-18");
  });

  it("merges a recurring technique: bumps timesLogged + lastSeenWeek, keeps firstSeenWeek", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const base = { discipline: "BJJ", technique: "Scissor Sweep!", detail: "x" };
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-18", takeaways: [{ ...base, technique: "Scissor sweep" }],
    });
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-25", takeaways: [{ ...base, detail: "updated" }],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timesLogged).toBe(2);
    expect(rows[0].firstSeenWeek).toBe("2026-05-18");
    expect(rows[0].lastSeenWeek).toBe("2026-05-25");
    expect(rows[0].detail).toBe("updated");
  });

  it("regenerating the SAME week replaces its techniques (no paraphrase duplicates)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const wk = "2026-05-18";
    // First generation.
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: wk,
      takeaways: [{ discipline: "Boxing", technique: "Slip jab into right uppercut, roll under left hook", detail: "a" }],
    });
    // Regeneration of the same week — the LLM paraphrases the same move, so it
    // normalizes to a DIFFERENT key. It must REPLACE, not stack.
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: wk,
      takeaways: [{ discipline: "Boxing", technique: "Jab slip to right uppercut then roll under left hook", detail: "b" }],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].technique).toBe("Jab slip to right uppercut then roll under left hook");
    expect(rows[0].timesLogged).toBe(1);
  });

  it("regenerating one week leaves another week's contribution intact", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const base = { discipline: "BJJ", technique: "Scissor sweep", detail: "x" };
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-18", takeaways: [base],
    });
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-25", takeaways: [base],
    });
    // Regenerate the later week with a paraphrase → that week detaches from the
    // shared row and re-attaches to a new one; the earlier week is untouched.
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-25",
      takeaways: [{ discipline: "BJJ", technique: "Scissor sweeps", detail: "y" }],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(2);
    const original = rows.find((r) => r.techniqueNormalized.includes("scissor sweep") && r.timesLogged === 1 && r.firstSeenWeek === "2026-05-18");
    expect(original).toBeTruthy();
    expect(original!.lastSeenWeek).toBe("2026-05-18");
  });

  it("dedupes paraphrase collisions WITHIN a single debrief pass", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-18",
      takeaways: [
        { discipline: "BJJ", technique: "Scissor sweep", detail: "a" },
        { discipline: "BJJ", technique: "Scissor Sweep!", detail: "b" },
      ],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timesLogged).toBe(1);
  });

  it("listTechniques returns [] for anonymous callers", async () => {
    const t = convexTest(schema);
    const rows = await t.query(api.training_techniques.listTechniques, {});
    expect(rows).toEqual([]);
  });
});
