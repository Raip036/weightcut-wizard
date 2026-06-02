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

  it("listTechniques returns [] for anonymous callers", async () => {
    const t = convexTest(schema);
    const rows = await t.query(api.training_techniques.listTechniques, {});
    expect(rows).toEqual([]);
  });
});
