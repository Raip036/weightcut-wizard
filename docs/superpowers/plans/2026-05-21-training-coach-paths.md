# Training Coach Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pro-only "Training Coach" widget to the dashboard that maintains persistent multi-step improvement paths (note-driven, goal-driven, coach-prescribed), advances steps automatically as technique logs land, refines through loop-back when the user plateaus, and spawns related/defense paths on completion.

**Architecture:** Path-First. Four new Convex tables (`training_paths`, `training_path_steps`, `training_path_feedback`, `training_path_proposals`) + `training_summaries.extractedTechniques` extension. A single Convex `node` action `trainingCoachPlanner.run` orchestrates six AI stages (extractCandidates → proposePath → generateSteps → advanceStep → evaluatePlateau → completePath). A new `TrainingCoachWidget` replaces the stub `TrainingInsightsWidget` on the dashboard; legacy `convex/actions/trainingInsights.ts` is deleted. Coach push lives on `/coach/athletes/:id`. Pro gating via existing `enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS")`.

**Tech Stack:** Convex (queries/mutations/actions/scheduler), React + TypeScript + Vite, Tailwind + shadcn/ui, Groq (`llama-3.1-8b-instant` cheap + `openai/gpt-oss-120b` heavy), Vitest, date-fns. Reuses existing `_shared/groq.callGroqText`, `_shared/parseResponse.parseJSON`, `_shared/sanitizeUserText`, `_shared/featureGates.enforceFeatureGate`, `actions/_helpers.{requireUserIdFromAction,SECOND_PERSON_DIRECTIVE}`.

---

## File Structure

**New Convex backend files:**
- `convex/training_paths.ts` — queries + mutations for paths/steps/proposals/feedback (one file because they share types and Doc<> mapping)
- `convex/actions/trainingCoachPlanner.ts` — orchestrator action
- `convex/actions/_trainingCoach/prompts.ts` — shared system prompts for the four LLM stages
- `convex/actions/_trainingCoach/extractCandidates.ts` — stage 1 helper
- `convex/actions/_trainingCoach/generateSteps.ts` — stage 3 helper
- `convex/actions/_trainingCoach/evaluatePlateau.ts` — stage 5 helper
- `convex/actions/_trainingCoach/completePath.ts` — stage 6 helper

**Modified Convex files:**
- `convex/schema.ts` — add 4 tables + `extractedTechniques` field on `training_summaries`
- `convex/fight_camp.ts` — schedule planner from `upsertSession` when notes change
- `convex/_shared/featureGates.ts` — add `AI_TRAINING_COACH_PATHS` gate constant
- `convex/actions/_helpers.ts` — no change needed (uses existing helpers)

**Deleted Convex files:**
- `convex/actions/trainingInsights.ts` — superseded by planner

**New frontend files (under `src/components/dashboard/training-coach/`):**
- `TrainingCoachWidget.tsx` — top-level widget
- `HeroStepCard.tsx` — current step + next-2 preview
- `PathsCarousel.tsx` — active path chips with progress bars
- `PathProposalBanner.tsx` — note-driven proposal banner
- `FeedbackStrip.tsx` — 1-tap nailed/off prompt
- `StepDetailSheet.tsx` — bottom sheet for step details
- `RoadmapSheet.tsx` — full vertical roadmap with checkpoints + paused tab
- `NewGoalDialog.tsx` — conversational 3-step goal creation
- `EmptyState.tsx` — cold-start CTAs
- `LockedState.tsx` — non-Pro upgrade CTA

**New frontend files (coach surface):**
- `src/components/coach/PrescribePathSection.tsx` — coach-side push UI on athlete detail page

**Modified frontend files:**
- `src/pages/Dashboard.tsx` — swap `TrainingInsightsWidget` for `TrainingCoachWidget`
- `src/pages/coach/AthleteDetail.tsx` — mount `PrescribePathSection`
- `src/lib/featureFlags.ts` — add `enableTrainingCoachPaths`

**Deleted frontend files:**
- `src/components/dashboard/TrainingInsightsWidget.tsx` — superseded

**Tests:**
- `convex/__tests__/training_paths.test.ts` — query/mutation unit tests
- `convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts`
- `convex/actions/_trainingCoach/__tests__/generateSteps.test.ts`
- `convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts`
- `convex/actions/_trainingCoach/__tests__/completePath.test.ts`
- `convex/actions/__tests__/trainingCoachPlanner.test.ts`
- `src/components/dashboard/training-coach/__tests__/TrainingCoachWidget.test.tsx`
- `src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx`
- `src/components/dashboard/training-coach/__tests__/PathProposalBanner.test.tsx`
- `src/components/dashboard/training-coach/__tests__/RoadmapSheet.test.tsx`
- `tests/training-coach/e2e-happy-path.test.ts` — full flow integration
- `tests/training-coach/e2e-plateau-loopback.test.ts`
- `tests/training-coach/e2e-completion.test.ts`
- `tests/training-coach/e2e-coach-push.test.ts`

---

## Task 1: Schema additions

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add four new tables and extend training_summaries**

Add to the `defineSchema({...})` object in `convex/schema.ts` (after the existing `training_summaries` definition):

```ts
training_paths: defineTable({
  userId: v.id("users"),
  sport: v.string(),
  goal: v.string(),
  goalType: v.union(
    v.literal("note"),
    v.literal("goal"),
    v.literal("coach"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("queued"),
    v.literal("paused"),
    v.literal("completed"),
    v.literal("archived"),
  ),
  sourceTechniqueId: v.optional(v.id("techniques")),
  sourceCoachId: v.optional(v.id("users")),
  notesContext: v.optional(v.string()),
  createdAt: v.number(),
  lastAdvancedAt: v.number(),
}).index("by_user_status", ["userId", "status"])
  .index("by_user_sport", ["userId", "sport"]),

training_path_steps: defineTable({
  pathId: v.id("training_paths"),
  position: v.number(),
  state: v.union(
    v.literal("upcoming"),
    v.literal("current"),
    v.literal("completed"),
    v.literal("remedial"),
  ),
  prescription: v.string(),
  wizardLine: v.string(),
  details: v.object({
    why: v.string(),
    how: v.array(v.string()),
    pitfalls: v.array(v.string()),
  }),
  targetTechniqueId: v.optional(v.id("techniques")),
  targetSport: v.string(),
  expectedSessions: v.number(),
  completedAt: v.optional(v.number()),
  completedFeedback: v.optional(v.union(
    v.literal("nailed"),
    v.literal("off"),
  )),
}).index("by_path_position", ["pathId", "position"]),

training_path_feedback: defineTable({
  pathId: v.id("training_paths"),
  stepId: v.id("training_path_steps"),
  userId: v.id("users"),
  feedback: v.union(v.literal("nailed"), v.literal("off")),
  at: v.number(),
}).index("by_path_at", ["pathId", "at"]),

training_path_proposals: defineTable({
  userId: v.id("users"),
  technique: v.string(),
  techniqueNormalized: v.string(),
  sport: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("snoozed"),
    v.literal("declined"),
  ),
  snoozedUntil: v.optional(v.number()),
  declineCount: v.number(),
  createdAt: v.number(),
}).index("by_user_status", ["userId", "status"])
  .index("by_user_normalized", ["userId", "techniqueNormalized"]),
```

Then modify the existing `training_summaries` table by adding `extractedTechniques: v.optional(v.array(v.string()))` to its existing fields.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If errors mention table fields, re-verify field types match `v.*` validators.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add training paths tables for coach feature"
```

---

## Task 2: Feature gate constant

**Files:**
- Modify: `convex/_shared/featureGates.ts`

- [ ] **Step 1: Locate the existing featureGates module**

Run: `grep -n "AI_TRAINING_SUMMARY\|enforceFeatureGate" convex/_shared/featureGates.ts | head`
Expected: lines showing the existing gate constants and the `enforceFeatureGate` function. If you don't see `AI_TRAINING_SUMMARY` there, search the repo: `grep -rn "AI_TRAINING_SUMMARY" convex/`

- [ ] **Step 2: Add new gate constant**

Open `convex/_shared/featureGates.ts` and add a new entry to the `FEATURE_GATES` map (or whichever constant maps gate names → tier requirements). Mirror the structure of `AI_TRAINING_SUMMARY` exactly. The new key is `AI_TRAINING_COACH_PATHS`. Use the same Pro-tier requirement.

If the gates are defined as a union type, also add `"AI_TRAINING_COACH_PATHS"` to the union.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add convex/_shared/featureGates.ts
git commit -m "feat(gates): add AI_TRAINING_COACH_PATHS gate"
```

---

## Task 3: `pathSlotUsage` query

**Files:**
- Create: `convex/training_paths.ts`
- Test: `convex/__tests__/training_paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/__tests__/training_paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ConvexTestingHelper } from "convex-helpers/testing";
import schema from "../schema";
import { api } from "../_generated/api";

describe("pathSlotUsage", () => {
  it("returns 0/3/0 for a new Pro user with no paths", async () => {
    const t = new ConvexTestingHelper(schema);
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { tier: "pro" } as any);
    });
    const result = await t.runAsUser(userId, api.training_paths.pathSlotUsage, {});
    expect(result).toEqual({ active: 0, max: 3, queued: 0, paused: 0, isPro: true });
  });

  it("counts active and queued paths separately", async () => {
    const t = new ConvexTestingHelper(schema);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("training_paths", {
          userId: uid, sport: "BJJ", goal: `g${i}`, goalType: "note",
          status: "active", createdAt: Date.now(), lastAdvancedAt: Date.now(),
        });
      }
      await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "g3", goalType: "note",
        status: "queued", createdAt: Date.now(), lastAdvancedAt: Date.now(),
      });
      return uid;
    });
    const result = await t.runAsUser(userId, api.training_paths.pathSlotUsage, {});
    expect(result.active).toBe(2);
    expect(result.queued).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t pathSlotUsage`
Expected: FAIL — `pathSlotUsage` not exported from `convex/training_paths.ts`.

- [ ] **Step 3: Create the file and implement**

Create `convex/training_paths.ts`:

```ts
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

export const pathSlotUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const allPaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const user = await ctx.db.get(userId);
    return {
      active: allPaths.filter((p) => p.status === "active").length,
      max: 3 as const,
      queued: allPaths.filter((p) => p.status === "queued").length,
      paused: allPaths.filter((p) => p.status === "paused").length,
      isPro: (user as any)?.tier === "pro",
    };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t pathSlotUsage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/training_paths.ts convex/__tests__/training_paths.test.ts
git commit -m "feat(paths): pathSlotUsage query"
```

---

## Task 4: Path proposal queries + mutations

**Files:**
- Modify: `convex/training_paths.ts`
- Modify: `convex/__tests__/training_paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `convex/__tests__/training_paths.test.ts`:

```ts
describe("path proposals", () => {
  it("getActivePathProposals returns pending and excludes snoozed", async () => {
    const t = new ConvexTestingHelper(schema);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      await ctx.db.insert("training_path_proposals", {
        userId: uid, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 0, createdAt: Date.now(),
      });
      await ctx.db.insert("training_path_proposals", {
        userId: uid, technique: "Armbar", techniqueNormalized: "armbar",
        sport: "BJJ", status: "snoozed", snoozedUntil: Date.now() + 1_000_000,
        declineCount: 1, createdAt: Date.now(),
      });
      return uid;
    });
    const out = await t.runAsUser(userId, api.training_paths.getActivePathProposals, {});
    expect(out.length).toBe(1);
    expect(out[0].technique).toBe("Kimura");
  });

  it("snoozePathProposal sets status and snoozedUntil 7 days out", async () => {
    const t = new ConvexTestingHelper(schema);
    const before = Date.now();
    const { userId, propId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      const pid = await ctx.db.insert("training_path_proposals", {
        userId: uid, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 0, createdAt: Date.now(),
      });
      return { userId: uid, propId: pid };
    });
    await t.runAsUser(userId, api.training_paths.snoozePathProposal, { proposalId: propId });
    const row = await t.run(async (ctx) => ctx.db.get(propId));
    expect((row as any)?.status).toBe("snoozed");
    expect((row as any)?.snoozedUntil).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path proposals"`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement queries + mutations**

Append to `convex/training_paths.ts`:

```ts
import { mutation } from "./_generated/server";

export const getActivePathProposals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training_path_proposals")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const snoozePathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async (ctx, { proposalId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(proposalId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(proposalId, {
      status: "snoozed",
      snoozedUntil: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
  },
});

export const declinePathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async (ctx, { proposalId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(proposalId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(proposalId, {
      status: "declined",
      declineCount: row.declineCount + 1,
    });
  },
});

// acceptPathProposal lives in Task 7's generator; placeholder mutation to
// allow the UI button to compile but throw until the planner is ready.
export const acceptPathProposalStub = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async () => {
    throw new Error("Not implemented yet — wired in Task 13");
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path proposals"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/training_paths.ts convex/__tests__/training_paths.test.ts
git commit -m "feat(paths): proposal queries and snooze/decline mutations"
```

---

## Task 5: Path lifecycle mutations (pause, resume, archive)

**Files:**
- Modify: `convex/training_paths.ts`
- Modify: `convex/__tests__/training_paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `convex/__tests__/training_paths.test.ts`:

```ts
describe("path lifecycle", () => {
  async function seedPath(t: ConvexTestingHelper, status = "active") {
    return await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      const pid = await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "Master kimura", goalType: "note",
        status: status as any, createdAt: Date.now(), lastAdvancedAt: Date.now(),
      });
      return { userId: uid, pathId: pid };
    });
  }

  it("pausePath flips status to paused", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await seedPath(t);
    await t.runAsUser(userId, api.training_paths.pausePath, { pathId });
    const row = await t.run(async (ctx) => ctx.db.get(pathId));
    expect((row as any)?.status).toBe("paused");
  });

  it("resumePath returns paused path to active and promotes from queued if cap reached", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await seedPath(t, "paused");
    await t.runAsUser(userId, api.training_paths.resumePath, { pathId });
    const row = await t.run(async (ctx) => ctx.db.get(pathId));
    expect((row as any)?.status).toBe("active");
  });

  it("archivePath flips status to archived", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await seedPath(t);
    await t.runAsUser(userId, api.training_paths.archivePath, { pathId });
    const row = await t.run(async (ctx) => ctx.db.get(pathId));
    expect((row as any)?.status).toBe("archived");
  });

  it("pausing an active path auto-promotes a queued one", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await seedPath(t);
    const queuedId = await t.run(async (ctx) => {
      return await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "queued", goalType: "note",
        status: "queued", createdAt: Date.now(), lastAdvancedAt: Date.now(),
      });
    });
    await t.runAsUser(userId, api.training_paths.pausePath, { pathId });
    const promoted = await t.run(async (ctx) => ctx.db.get(queuedId));
    expect((promoted as any)?.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path lifecycle"`
Expected: FAIL — mutations missing.

- [ ] **Step 3: Implement mutations**

Append to `convex/training_paths.ts`:

```ts
const ACTIVE_CAP = 3;

async function promoteQueuedIfSlot(ctx: any, userId: any) {
  const allPaths = await ctx.db
    .query("training_paths")
    .withIndex("by_user_status", (q: any) => q.eq("userId", userId))
    .collect();
  const activeCount = allPaths.filter((p: any) => p.status === "active").length;
  if (activeCount >= ACTIVE_CAP) return;
  const nextQueued = allPaths
    .filter((p: any) => p.status === "queued")
    .sort((a: any, b: any) => a.createdAt - b.createdAt)[0];
  if (nextQueued) {
    await ctx.db.patch(nextQueued._id, { status: "active" });
  }
}

export const pausePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(pathId, { status: "paused" });
    await promoteQueuedIfSlot(ctx, userId);
  },
});

export const resumePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    const allPaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const activeCount = allPaths.filter((p) => p.status === "active").length;
    const nextStatus = activeCount >= ACTIVE_CAP ? "queued" : "active";
    await ctx.db.patch(pathId, { status: nextStatus });
  },
});

export const archivePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(pathId, { status: "archived" });
    await promoteQueuedIfSlot(ctx, userId);
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path lifecycle"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/training_paths.ts convex/__tests__/training_paths.test.ts
git commit -m "feat(paths): pause/resume/archive with queue promotion"
```

---

## Task 6: Path + step queries (for widget)

**Files:**
- Modify: `convex/training_paths.ts`
- Modify: `convex/__tests__/training_paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `convex/__tests__/training_paths.test.ts`:

```ts
describe("path reads for widget", () => {
  it("getActivePaths returns active paths ordered by lastAdvancedAt desc", async () => {
    const t = new ConvexTestingHelper(schema);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "older", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 100,
      });
      await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "newer", goalType: "note",
        status: "active", createdAt: 2, lastAdvancedAt: 200,
      });
      return uid;
    });
    const out = await t.runAsUser(userId, api.training_paths.getActivePaths, {});
    expect(out.map((p: any) => p.goal)).toEqual(["newer", "older"]);
  });

  it("getPathWithSteps returns ordered steps", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      const pid = await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "g", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      for (const pos of [3, 1, 2]) {
        await ctx.db.insert("training_path_steps", {
          pathId: pid, position: pos, state: pos === 1 ? "current" : "upcoming",
          prescription: `s${pos}`, wizardLine: `w${pos}`,
          details: { why: "", how: [], pitfalls: [] },
          targetSport: "BJJ", expectedSessions: 1,
        });
      }
      return { userId: uid, pathId: pid };
    });
    const out = await t.runAsUser(userId, api.training_paths.getPathWithSteps, { pathId });
    expect(out.steps.map((s: any) => s.position)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path reads"`
Expected: FAIL.

- [ ] **Step 3: Implement queries**

Append to `convex/training_paths.ts`:

```ts
export const getActivePaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    return rows.sort((a, b) => b.lastAdvancedAt - a.lastAdvancedAt);
  },
});

export const getQueuedPaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "queued"))
      .collect();
  },
});

export const getPausedPaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "paused"))
      .collect();
  },
});

export const getPathWithSteps = query({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const path = await ctx.db.get(pathId);
    if (!path || path.userId !== userId) throw new Error("Not authorized");
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    return {
      path,
      steps: steps.sort((a, b) => a.position - b.position),
    };
  },
});

export const getHeroStep = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const activePaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    if (activePaths.length === 0) return null;
    // Hero = most-recently-advanced active path's current step.
    const hero = activePaths.sort((a, b) => b.lastAdvancedAt - a.lastAdvancedAt)[0];
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", hero._id))
      .collect();
    const sorted = steps.sort((a, b) => a.position - b.position);
    const currentIdx = sorted.findIndex((s) => s.state === "current");
    if (currentIdx === -1) return null;
    return {
      path: hero,
      currentStep: sorted[currentIdx],
      nextSteps: sorted.slice(currentIdx + 1, currentIdx + 3), // next 2
      totalSteps: sorted.length,
      stepNumber: currentIdx + 1,
    };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t "path reads"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/training_paths.ts convex/__tests__/training_paths.test.ts
git commit -m "feat(paths): hero/active/queued/paused queries"
```

---

## Task 7: Step feedback mutation

**Files:**
- Modify: `convex/training_paths.ts`
- Modify: `convex/__tests__/training_paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `convex/__tests__/training_paths.test.ts`:

```ts
describe("submitStepFeedback", () => {
  it("writes a feedback row and patches the step's completedFeedback", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, stepId, pathId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro" } as any);
      const pid = await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "g", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      const sid = await ctx.db.insert("training_path_steps", {
        pathId: pid, position: 1, state: "completed",
        prescription: "p", wizardLine: "w",
        details: { why: "", how: [], pitfalls: [] },
        targetSport: "BJJ", expectedSessions: 1, completedAt: Date.now(),
      });
      return { userId: uid, stepId: sid, pathId: pid };
    });
    await t.runAsUser(userId, api.training_paths.submitStepFeedback, {
      stepId, feedback: "off",
    });
    const step = await t.run(async (ctx) => ctx.db.get(stepId));
    expect((step as any)?.completedFeedback).toBe("off");
    const fbRows = await t.run(async (ctx) =>
      ctx.db.query("training_path_feedback")
        .withIndex("by_path_at", (q: any) => q.eq("pathId", pathId)).collect()
    );
    expect(fbRows.length).toBe(1);
    expect(fbRows[0].feedback).toBe("off");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t submitStepFeedback`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `convex/training_paths.ts`:

```ts
export const submitStepFeedback = mutation({
  args: {
    stepId: v.id("training_path_steps"),
    feedback: v.union(v.literal("nailed"), v.literal("off")),
  },
  handler: async (ctx, { stepId, feedback }) => {
    const userId = await requireUserId(ctx);
    const step = await ctx.db.get(stepId);
    if (!step) throw new Error("Step not found");
    const path = await ctx.db.get(step.pathId);
    if (!path || path.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(stepId, { completedFeedback: feedback });
    await ctx.db.insert("training_path_feedback", {
      pathId: step.pathId, stepId, userId, feedback, at: Date.now(),
    });
    // Plateau trigger wiring happens in Task 14; this mutation only persists.
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/__tests__/training_paths.test.ts -t submitStepFeedback`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/training_paths.ts convex/__tests__/training_paths.test.ts
git commit -m "feat(paths): submitStepFeedback mutation"
```

---

## Task 8: Shared prompts module

**Files:**
- Create: `convex/actions/_trainingCoach/prompts.ts`

- [ ] **Step 1: Create prompts file**

Create `convex/actions/_trainingCoach/prompts.ts`:

```ts
import { SECOND_PERSON_DIRECTIVE } from "../_helpers";
import { PROMPT_INJECTION_GUARD_INSTRUCTION } from "../../_shared/sanitizeUserText";

export const EXTRACT_CANDIDATES_PROMPT = `You are a combat sports note parser. Extract every distinct technique, combination, position, or drill the user MENTIONS LEARNING OR PRACTICING in their session notes. Ignore generic talk ("good session", "tired today").

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Return ONLY valid JSON:
{
  "candidates": [
    {
      "technique": "Kimura from side control",
      "sport": "BJJ",
      "confidence": 0.0-1.0
    }
  ]
}
- Use the canonical name of the technique (no first-person pronouns).
- Sport must be one of: BJJ, Boxing, MMA, Muay Thai, Wrestling, Kickboxing, Judo, Conditioning.
- confidence reflects how clearly the user described learning/practicing it.
- Return [] if no concrete techniques are mentioned.`;

export const GENERATE_STEPS_PROMPT = `You are a combat sports coach building a progression curriculum for ONE specific technique or goal. The output is 5-8 sequential session-bound steps, each one concrete enough that the user can execute it in their next training session.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Step progression conventions:
- Steps 1-2 = solo / shadow / bag drilling (build muscle memory)
- Steps 3-4 = partner drilling with controlled resistance
- Steps 5-6 = live sparring / hunt-for-it
- Step 7-8 = situational mastery (open guard, against higher belt, in scrambles)

Each step must include:
- prescription: one-liner ≤ 80 chars
- wizardLine: ONE sentence that opens with the user's first name and the wizard's encouraging voice
- details.why: one paragraph explaining the goal
- details.how: 3-5 bullets of execution mechanics
- details.pitfalls: 2-3 common mistakes to avoid

FIGHT-CAMP WEIGHTING:
- If daysToFight ≤ 28: bias toward partner/live/finish steps; reduce solo drilling
- If daysToFight ≤ 7: refuse to generate a new path. Return { "refusedReason": "fight_week" }.

Return ONLY valid JSON:
{
  "steps": [
    {
      "position": 1,
      "prescription": "Solo: 50 kimura reps from side control mount, hip out before grab.",
      "wizardLine": "Alright Pratik — start with reps, you can't finish what you can't set up.",
      "details": {
        "why": "Reps cement the hip-out-then-grab order so it survives pressure.",
        "how": ["Mount side control on bag", "Step over to north-south", "Hip out 6 inches before grabbing wrist", "Pull wrist to your sternum"],
        "pitfalls": ["Grabbing wrist before hip out", "Reaching across body"]
      },
      "targetSport": "BJJ",
      "expectedSessions": 1
    }
  ]
}`;

export const EVALUATE_PLATEAU_PROMPT = `You are a combat sports coach helping a user break through a plateau on ONE specific technique. They have logged ${'${stallSignal}'} on this technique. Generate exactly ONE remedial step that addresses the most likely root cause.

${SECOND_PERSON_DIRECTIVE}

The step must be insertable BEFORE the next normal step. Frame it as "Let's refine before we push forward" — never shaming.

Return ONLY valid JSON:
{
  "remedialStep": {
    "prescription": "...",
    "wizardLine": "...",
    "details": { "why": "...", "how": [...], "pitfalls": [...] }
  },
  "stallReason": "1 short phrase, e.g. 'getting countered by frame'"
}`;

export const COMPLETE_PATH_PROMPT = `The user just finished a complete path for ${'${technique}'}. Propose TWO follow-up paths:

1. A RELATED offensive path: a natural next technique that builds on what they just learned. Use the technique_edges graph if any edges are supplied; otherwise pick a sensible adjacent technique.
2. An INVERSE defense path: how to DEFEND against the same technique you just mastered.

Return ONLY valid JSON:
{
  "relatedPath": { "technique": "...", "sport": "...", "goal": "..." },
  "defensePath": { "technique": "...", "sport": "...", "goal": "..." }
}`;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `SECOND_PERSON_DIRECTIVE` or `PROMPT_INJECTION_GUARD_INSTRUCTION` imports fail, check the exact export names in `convex/actions/_helpers.ts` and `convex/_shared/sanitizeUserText.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add convex/actions/_trainingCoach/prompts.ts
git commit -m "feat(planner): shared prompt module"
```

---

## Task 9: `extractCandidates` helper

**Files:**
- Create: `convex/actions/_trainingCoach/extractCandidates.ts`
- Create: `convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractCandidates } from "../extractCandidates";

vi.mock("../../../_shared/groq", () => ({
  callGroqText: vi.fn(),
}));

import { callGroqText } from "../../../_shared/groq";

describe("extractCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses JSON response into candidates", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({
      candidates: [
        { technique: "Kimura from side control", sport: "BJJ", confidence: 0.9 },
      ],
    }));
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

  it("returns [] when LLM returns invalid JSON", async () => {
    (callGroqText as any).mockResolvedValue("not json");
    const out = await extractCandidates({ notes: "anything" });
    expect(out).toEqual([]);
  });

  it("calls the cheap model llama-3.1-8b-instant", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ candidates: [] }));
    await extractCandidates({ notes: "x" });
    const call = (callGroqText as any).mock.calls[0][0];
    expect(call.model).toBe("llama-3.1-8b-instant");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts`
Expected: FAIL — `extractCandidates` not exported.

- [ ] **Step 3: Implement**

Create `convex/actions/_trainingCoach/extractCandidates.ts`:

```ts
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { sanitizeUserText } from "../../_shared/sanitizeUserText";
import { EXTRACT_CANDIDATES_PROMPT } from "./prompts";

export type Candidate = {
  technique: string;
  sport: string;
  confidence: number;
};

export async function extractCandidates(args: {
  notes: string;
}): Promise<Candidate[]> {
  const cleanNotes = sanitizeUserText(args.notes, { maxLength: 1500, raw: true });
  const raw = await callGroqText({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: EXTRACT_CANDIDATES_PROMPT },
      { role: "user", content: `<user_input>${cleanNotes}</user_input>` },
    ],
    temperature: 0.2,
    maxTokens: 600,
    responseFormat: "json",
  });
  const parsed = parseJSON<{ candidates?: Candidate[] }>(raw);
  if (!parsed?.candidates || !Array.isArray(parsed.candidates)) return [];
  return parsed.candidates
    .filter((c) => c && typeof c.technique === "string" && typeof c.sport === "string")
    .map((c) => ({
      technique: c.technique.trim(),
      sport: c.sport.trim(),
      confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
    }));
}

export function normalizeTechnique(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
```

If `callGroqText` doesn't accept the exact options above, open `convex/_shared/groq.ts` and adapt to the signature there — the goal is `model`, `messages`, `temperature`, `maxTokens`, JSON response mode. Common alternative signature: `callGroqText({ model, system, user, temperature })` — adapt.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/_trainingCoach/extractCandidates.ts convex/actions/_trainingCoach/__tests__/extractCandidates.test.ts
git commit -m "feat(planner): extractCandidates stage"
```

---

## Task 10: `generateSteps` helper

**Files:**
- Create: `convex/actions/_trainingCoach/generateSteps.ts`
- Create: `convex/actions/_trainingCoach/__tests__/generateSteps.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/actions/_trainingCoach/__tests__/generateSteps.test.ts`:

```ts
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

  it("returns 5-8 validated steps", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: MOCK_STEPS }));
    const out = await generateSteps({
      sport: "BJJ", goal: "Master kimura", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("steps");
    if (out.kind === "steps") expect(out.steps).toHaveLength(5);
  });

  it("rejects fewer than 5 steps", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: MOCK_STEPS.slice(0, 3) }));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });

  it("rejects steps missing wizardLine", async () => {
    const bad = MOCK_STEPS.map((s) => ({ ...s, wizardLine: undefined }));
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: bad }));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect(out.kind).toBe("error");
  });

  it("returns 'fight_week' when daysToFight <= 7 and LLM refuses", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ refusedReason: "fight_week" }));
    const out = await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: 5, firstName: "Pratik",
    });
    expect(out.kind).toBe("refused");
    if (out.kind === "refused") expect(out.reason).toBe("fight_week");
  });

  it("uses heavy model gpt-oss-120b", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({ steps: MOCK_STEPS }));
    await generateSteps({
      sport: "BJJ", goal: "g", notes: "", daysToFight: null, firstName: "Pratik",
    });
    expect((callGroqText as any).mock.calls[0][0].model).toBe("openai/gpt-oss-120b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/generateSteps.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `convex/actions/_trainingCoach/generateSteps.ts`:

```ts
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { sanitizeUserText } from "../../_shared/sanitizeUserText";
import { GENERATE_STEPS_PROMPT } from "./prompts";

export type GeneratedStep = {
  position: number;
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
  targetSport: string;
  expectedSessions: 1;
};

export type GenerateStepsResult =
  | { kind: "steps"; steps: GeneratedStep[] }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

function validateStep(s: any): s is GeneratedStep {
  if (typeof s?.position !== "number") return false;
  if (typeof s?.prescription !== "string" || s.prescription.length === 0) return false;
  if (typeof s?.wizardLine !== "string" || s.wizardLine.length === 0) return false;
  if (typeof s?.details !== "object" || !s.details) return false;
  if (typeof s.details.why !== "string") return false;
  if (!Array.isArray(s.details.how) || s.details.how.length === 0) return false;
  if (!Array.isArray(s.details.pitfalls)) return false;
  if (typeof s?.targetSport !== "string") return false;
  return true;
}

export async function generateSteps(args: {
  sport: string;
  goal: string;
  notes: string;
  daysToFight: number | null;
  firstName: string;
}): Promise<GenerateStepsResult> {
  const cleanNotes = sanitizeUserText(args.notes, { maxLength: 1500, raw: true });
  const userMsg = [
    `Sport: ${args.sport}`,
    `Goal: ${args.goal}`,
    `User first name: ${args.firstName}`,
    args.daysToFight != null ? `daysToFight: ${args.daysToFight}` : "",
    `Recent notes: <user_input>${cleanNotes}</user_input>`,
  ].filter(Boolean).join("\n");

  const raw = await callGroqText({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: GENERATE_STEPS_PROMPT },
      { role: "user", content: userMsg },
    ],
    temperature: 0.4,
    maxTokens: 3000,
    responseFormat: "json",
  });
  const parsed = parseJSON<{ steps?: any[]; refusedReason?: string }>(raw);
  if (parsed?.refusedReason) {
    return { kind: "refused", reason: parsed.refusedReason };
  }
  const steps = parsed?.steps ?? [];
  if (!Array.isArray(steps) || steps.length < 5 || steps.length > 8) {
    return { kind: "error", message: `expected 5-8 steps, got ${steps.length}` };
  }
  for (const s of steps) {
    if (!validateStep(s)) {
      return { kind: "error", message: `invalid step shape at position ${(s as any)?.position}` };
    }
  }
  return { kind: "steps", steps: steps as GeneratedStep[] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/generateSteps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/_trainingCoach/generateSteps.ts convex/actions/_trainingCoach/__tests__/generateSteps.test.ts
git commit -m "feat(planner): generateSteps stage"
```

---

## Task 11: `evaluatePlateau` helper

**Files:**
- Create: `convex/actions/_trainingCoach/evaluatePlateau.ts`
- Create: `convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts`:

```ts
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
    const out = await evaluatePlateau({ technique: "kimura", stallSignal: "2 off feedbacks" });
    expect(out.kind).toBe("remedial");
    if (out.kind === "remedial") expect(out.step.prescription).toMatch(/hip/);
  });

  it("returns 'error' when LLM omits the wizardLine", async () => {
    const bad = { remedialStep: { ...VALID_REMEDIAL.remedialStep, wizardLine: "" } };
    (callGroqText as any).mockResolvedValue(JSON.stringify(bad));
    const out = await evaluatePlateau({ technique: "kimura", stallSignal: "x" });
    expect(out.kind).toBe("error");
  });
});

describe("detectStallInNotes", () => {
  it.each([
    ["couldn't finish it", true],
    ["got countered by frame", true],
    ["she kept sweeping me", true],
    ["still struggling with timing", true],
    ["hit a sweet kimura", false],
    ["finally landed it", false],
  ])("'%s' → %s", (text, expected) => {
    expect(detectStallInNotes(text, "kimura")).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `convex/actions/_trainingCoach/evaluatePlateau.ts`:

```ts
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { EVALUATE_PLATEAU_PROMPT } from "./prompts";

const STALL_PATTERNS: RegExp[] = [
  /couldn'?t\s+(?:finish|get|land|hit)/i,
  /got\s+countered/i,
  /kept\s+(?:sweeping|losing|getting)/i,
  /still\s+struggling/i,
  /can'?t\s+seem\s+to/i,
  /failed\s+to/i,
  /\bnot\s+landing\b/i,
];

export function detectStallInNotes(notes: string, technique: string): boolean {
  const lower = notes.toLowerCase();
  // Technique must be mentioned at all for the patterns to count.
  if (!lower.includes(technique.toLowerCase())) return false;
  return STALL_PATTERNS.some((re) => re.test(notes));
}

export type RemedialStep = {
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
};

export type EvaluatePlateauResult =
  | { kind: "remedial"; step: RemedialStep; stallReason: string }
  | { kind: "error"; message: string };

export async function evaluatePlateau(args: {
  technique: string;
  stallSignal: string;
}): Promise<EvaluatePlateauResult> {
  const prompt = EVALUATE_PLATEAU_PROMPT.replace("${stallSignal}", args.stallSignal);
  const raw = await callGroqText({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `Technique: ${args.technique}` },
    ],
    temperature: 0.3,
    maxTokens: 700,
    responseFormat: "json",
  });
  const parsed = parseJSON<{ remedialStep?: RemedialStep; stallReason?: string }>(raw);
  const step = parsed?.remedialStep;
  if (!step || !step.prescription || !step.wizardLine || !step.details) {
    return { kind: "error", message: "invalid remedial step shape" };
  }
  if (!step.details.why || !Array.isArray(step.details.how) || step.details.how.length === 0) {
    return { kind: "error", message: "incomplete remedial details" };
  }
  return {
    kind: "remedial",
    step,
    stallReason: parsed?.stallReason ?? "stalled progress",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/_trainingCoach/evaluatePlateau.ts convex/actions/_trainingCoach/__tests__/evaluatePlateau.test.ts
git commit -m "feat(planner): evaluatePlateau stage + stall regex"
```

---

## Task 12: `completePath` helper

**Files:**
- Create: `convex/actions/_trainingCoach/completePath.ts`
- Create: `convex/actions/_trainingCoach/__tests__/completePath.test.ts`

- [ ] **Step 1: Write failing test**

Create `convex/actions/_trainingCoach/__tests__/completePath.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { proposeFollowUps } from "../completePath";

vi.mock("../../../_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../../_shared/groq";

describe("proposeFollowUps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns both relatedPath and defensePath proposals", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({
      relatedPath: { technique: "Kimura to armbar", sport: "BJJ", goal: "Chain it" },
      defensePath: { technique: "Kimura defense", sport: "BJJ", goal: "Defend it" },
    }));
    const out = await proposeFollowUps({ technique: "Kimura from side control", sport: "BJJ" });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.relatedPath.technique).toMatch(/armbar/);
      expect(out.defensePath.technique).toMatch(/defense/i);
    }
  });

  it("returns error when LLM omits one of the proposals", async () => {
    (callGroqText as any).mockResolvedValue(JSON.stringify({
      relatedPath: { technique: "x", sport: "BJJ", goal: "y" },
    }));
    const out = await proposeFollowUps({ technique: "Kimura", sport: "BJJ" });
    expect(out.kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/completePath.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `convex/actions/_trainingCoach/completePath.ts`:

```ts
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { COMPLETE_PATH_PROMPT } from "./prompts";

export type ProposalSeed = {
  technique: string;
  sport: string;
  goal: string;
};

export type ProposeFollowUpsResult =
  | { kind: "ok"; relatedPath: ProposalSeed; defensePath: ProposalSeed }
  | { kind: "error"; message: string };

function validSeed(s: any): s is ProposalSeed {
  return s
    && typeof s.technique === "string" && s.technique.length > 0
    && typeof s.sport === "string"
    && typeof s.goal === "string" && s.goal.length > 0;
}

export async function proposeFollowUps(args: {
  technique: string;
  sport: string;
}): Promise<ProposeFollowUpsResult> {
  const prompt = COMPLETE_PATH_PROMPT.replace("${technique}", args.technique);
  const raw = await callGroqText({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `Sport: ${args.sport}\nTechnique: ${args.technique}` },
    ],
    temperature: 0.4,
    maxTokens: 600,
    responseFormat: "json",
  });
  const parsed = parseJSON<{ relatedPath?: ProposalSeed; defensePath?: ProposalSeed }>(raw);
  if (!validSeed(parsed?.relatedPath) || !validSeed(parsed?.defensePath)) {
    return { kind: "error", message: "missing or invalid path proposals" };
  }
  return {
    kind: "ok",
    relatedPath: parsed!.relatedPath!,
    defensePath: parsed!.defensePath!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run convex/actions/_trainingCoach/__tests__/completePath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/actions/_trainingCoach/completePath.ts convex/actions/_trainingCoach/__tests__/completePath.test.ts
git commit -m "feat(planner): completePath follow-up proposals"
```

---

## Task 13: `trainingCoachPlanner` orchestrator + acceptance mutation

**Files:**
- Create: `convex/actions/trainingCoachPlanner.ts`
- Modify: `convex/training_paths.ts` (replace `acceptPathProposalStub` with real version + new mutations)

- [ ] **Step 1: Implement the orchestrator action**

Create `convex/actions/trainingCoachPlanner.ts`:

```ts
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { extractCandidates, normalizeTechnique } from "./_trainingCoach/extractCandidates";
import { generateSteps } from "./_trainingCoach/generateSteps";
import { evaluatePlateau, detectStallInNotes } from "./_trainingCoach/evaluatePlateau";
import { proposeFollowUps } from "./_trainingCoach/completePath";

export const run = action({
  args: {
    trigger: v.union(
      v.literal("sessionSave"),
      v.literal("manualRefresh"),
      v.literal("goalCreated"),
      v.literal("coachPushed"),
      v.literal("stepFeedback"),
    ),
    // For sessionSave: the session row whose notes just changed.
    sessionId: v.optional(v.id("fight_camp_calendar")),
    // For goalCreated / coachPushed: the path that was just created from a proposal.
    pathId: v.optional(v.id("training_paths")),
    // For stepFeedback: the path whose latest feedback might trigger plateau.
    feedbackPathId: v.optional(v.id("training_paths")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS");

    if (args.trigger === "sessionSave" && args.sessionId) {
      await handleSessionSave(ctx, userId, args.sessionId);
    } else if (args.trigger === "manualRefresh") {
      await handleManualRefresh(ctx, userId);
    } else if (args.trigger === "goalCreated" && args.pathId) {
      await handleGenerateForPath(ctx, userId, args.pathId);
    } else if (args.trigger === "coachPushed" && args.pathId) {
      await handleGenerateForPath(ctx, userId, args.pathId);
    } else if (args.trigger === "stepFeedback" && args.feedbackPathId) {
      await handleFeedbackPlateau(ctx, userId, args.feedbackPathId);
    }
  },
});

async function handleSessionSave(ctx: any, userId: any, sessionId: any) {
  const session = await ctx.runQuery(internal.training_paths.getSessionForPlanner, { sessionId });
  if (!session?.notes) return;
  const candidates = await extractCandidates({ notes: session.notes });
  if (candidates.length === 0) return;
  // Dedup against active paths + decline-list + active proposals.
  await ctx.runMutation(internal.training_paths.upsertProposalsFromCandidates, {
    userId,
    sessionDate: session.date,
    candidates: candidates.map((c) => ({
      technique: c.technique,
      techniqueNormalized: normalizeTechnique(c.technique),
      sport: c.sport,
    })),
  });
  // Also walk active paths for stall language in this session's notes.
  const activePaths = await ctx.runQuery(internal.training_paths.getActivePathsInternal, { userId });
  for (const p of activePaths) {
    if (p.sourceTechniqueId == null) continue;
    if (detectStallInNotes(session.notes, p.goal)) {
      // Patch the path's notesContext so plateau evaluator has the latest excerpt.
      await ctx.runMutation(internal.training_paths.appendNotesContext, {
        pathId: p._id, excerpt: session.notes,
      });
      // Low-priority plateau check.
      await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner._evaluatePlateauForPath, {
        userId, pathId: p._id, signal: "note stall language",
      });
    }
  }
}

async function handleManualRefresh(ctx: any, userId: any) {
  // Reuses the most recent session save logic — pulls the last 7 days of notes.
  const recent = await ctx.runQuery(internal.training_paths.recentNotesText, { userId, days: 7 });
  if (!recent) return;
  const candidates = await extractCandidates({ notes: recent });
  await ctx.runMutation(internal.training_paths.upsertProposalsFromCandidates, {
    userId, sessionDate: new Date().toISOString().slice(0, 10),
    candidates: candidates.map((c) => ({
      technique: c.technique,
      techniqueNormalized: normalizeTechnique(c.technique),
      sport: c.sport,
    })),
  });
}

async function handleGenerateForPath(ctx: any, userId: any, pathId: any) {
  const ctxInputs = await ctx.runQuery(internal.training_paths.getPathContextForGeneration, { pathId });
  if (!ctxInputs) return;
  const result = await generateSteps({
    sport: ctxInputs.sport,
    goal: ctxInputs.goal,
    notes: ctxInputs.notesContext ?? "",
    daysToFight: ctxInputs.daysToFight,
    firstName: ctxInputs.firstName,
  });
  if (result.kind === "refused") {
    await ctx.runMutation(internal.training_paths.markPathRefused, { pathId, reason: result.reason });
    return;
  }
  if (result.kind === "error") {
    await ctx.runMutation(internal.training_paths.markPathError, { pathId, message: result.message });
    return;
  }
  await ctx.runMutation(internal.training_paths.persistSteps, {
    pathId,
    steps: result.steps,
  });
}

async function handleFeedbackPlateau(ctx: any, userId: any, pathId: any) {
  const recentFeedback = await ctx.runQuery(internal.training_paths.recentFeedback, { pathId, limit: 2 });
  if (recentFeedback.length < 2) return;
  if (!recentFeedback.every((r: any) => r.feedback === "off")) return;
  // Two consecutive off — fire plateau eval.
  await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner._evaluatePlateauForPath, {
    userId, pathId, signal: "2 consecutive off feedbacks",
  });
}

// Exported internal action so other handlers can schedule it.
export const _evaluatePlateauForPath = action({
  args: {
    userId: v.id("users"),
    pathId: v.id("training_paths"),
    signal: v.string(),
  },
  handler: async (ctx, { pathId, signal }) => {
    const inputs = await ctx.runQuery(internal.training_paths.getPathContextForGeneration, { pathId });
    if (!inputs) return;
    // Cap: max 2 remedial steps per path.
    const remedialCount = await ctx.runQuery(internal.training_paths.countRemedialSteps, { pathId });
    if (remedialCount >= 2) {
      await ctx.runMutation(internal.training_paths.surfacePrerequisiteBanner, {
        pathId, reason: "third plateau",
      });
      return;
    }
    const result = await evaluatePlateau({ technique: inputs.goal, stallSignal: signal });
    if (result.kind === "remedial") {
      await ctx.runMutation(internal.training_paths.insertRemedialStep, {
        pathId, step: result.step, stallReason: result.stallReason,
      });
    }
  },
});

export const _completePathFollowUps = action({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const inputs = await ctx.runQuery(internal.training_paths.getPathContextForGeneration, { pathId });
    if (!inputs) return;
    const result = await proposeFollowUps({ technique: inputs.goal, sport: inputs.sport });
    if (result.kind === "ok") {
      await ctx.runMutation(internal.training_paths.upsertProposalsFromCandidates, {
        userId: inputs.userId,
        sessionDate: new Date().toISOString().slice(0, 10),
        candidates: [
          { technique: result.relatedPath.technique, techniqueNormalized: normalizeTechnique(result.relatedPath.technique), sport: result.relatedPath.sport },
          { technique: result.defensePath.technique, techniqueNormalized: normalizeTechnique(result.defensePath.technique), sport: result.defensePath.sport },
        ],
      });
    }
  },
});
```

- [ ] **Step 2: Add the internal Convex helpers referenced above**

Open `convex/training_paths.ts`. Add `internalQuery` and `internalMutation` imports at the top:

```ts
import { internalQuery, internalMutation, mutation, query } from "./_generated/server";
```

Then append these helpers (each is plain CRUD — no LLM logic):

```ts
import type { Doc, Id } from "./_generated/dataModel";

export const getSessionForPlanner = internalQuery({
  args: { sessionId: v.id("fight_camp_calendar") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return null;
    return { notes: s.notes ?? "", date: s.date };
  },
});

export const getActivePathsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
  },
});

export const recentNotesText = internalQuery({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx, { userId, days }) => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", cutoff))
      .collect();
    return rows.map((r) => r.notes).filter(Boolean).join("\n");
  },
});

export const recentFeedback = internalQuery({
  args: { pathId: v.id("training_paths"), limit: v.number() },
  handler: async (ctx, { pathId, limit }) => {
    const rows = await ctx.db
      .query("training_path_feedback")
      .withIndex("by_path_at", (q) => q.eq("pathId", pathId))
      .order("desc")
      .take(limit);
    return rows;
  },
});

export const countRemedialSteps = internalQuery({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const rows = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    return rows.filter((r) => r.state === "remedial").length;
  },
});

export const getPathContextForGeneration = internalQuery({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const path = await ctx.db.get(pathId);
    if (!path) return null;
    const user = await ctx.db.get(path.userId) as any;
    // daysToFight: pull active camp if any.
    let daysToFight: number | null = null;
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q: any) => q.eq("userId", path.userId))
      .collect();
    const activeCamp = camps.find((c: any) => !c.isCompleted);
    if (activeCamp?.fightDate) {
      const d = new Date(activeCamp.fightDate).getTime();
      daysToFight = Math.max(0, Math.ceil((d - Date.now()) / 86_400_000));
    }
    return {
      userId: path.userId,
      sport: path.sport,
      goal: path.goal,
      notesContext: path.notesContext,
      daysToFight,
      firstName: user?.firstName ?? user?.name?.split(" ")?.[0] ?? "athlete",
    };
  },
});

export const upsertProposalsFromCandidates = internalMutation({
  args: {
    userId: v.id("users"),
    sessionDate: v.string(),
    candidates: v.array(v.object({
      technique: v.string(),
      techniqueNormalized: v.string(),
      sport: v.string(),
    })),
  },
  handler: async (ctx, { userId, candidates }) => {
    const activeAndQueued = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const activeNormalizedGoals = new Set(
      activeAndQueued
        .filter((p) => p.status === "active" || p.status === "queued")
        .map((p) => normalizeGoal(p.goal)),
    );
    // Spec: at most 3 pending proposal banners surface at once. Excess
    // candidates from a noisy session land later via the GC-and-resurface
    // cron path (Section 8 edge case).
    const PENDING_BANNER_CAP = 3;
    const currentPending = await ctx.db
      .query("training_path_proposals")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .collect();
    let pendingCount = currentPending.length;
    for (const c of candidates) {
      if (pendingCount >= PENDING_BANNER_CAP) break;
      // Dedup against active paths.
      if (activeNormalizedGoals.has(c.techniqueNormalized)) {
        // Merge into existing path's notesContext is handled separately.
        continue;
      }
      // Dedup against existing pending proposals.
      const existing = await ctx.db
        .query("training_path_proposals")
        .withIndex("by_user_normalized", (q) => q.eq("userId", userId).eq("techniqueNormalized", c.techniqueNormalized))
        .first();
      if (existing && existing.status === "pending") continue;
      // Skip if user declined 3+ times in the last 30 days.
      if (existing && existing.declineCount >= 3 && existing.status === "declined"
          && Date.now() - existing.createdAt < 30 * 86_400_000) continue;
      await ctx.db.insert("training_path_proposals", {
        userId,
        technique: c.technique,
        techniqueNormalized: c.techniqueNormalized,
        sport: c.sport,
        status: "pending",
        declineCount: existing?.declineCount ?? 0,
        createdAt: Date.now(),
      });
      pendingCount += 1;
    }
  },
});

function normalizeGoal(goal: string): string {
  return goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const appendNotesContext = internalMutation({
  args: { pathId: v.id("training_paths"), excerpt: v.string() },
  handler: async (ctx, { pathId, excerpt }) => {
    const p = await ctx.db.get(pathId);
    if (!p) return;
    const next = (p.notesContext ?? "") + "\n---\n" + excerpt;
    // Cap to last 4000 chars.
    await ctx.db.patch(pathId, { notesContext: next.slice(-4000) });
  },
});

export const persistSteps = internalMutation({
  args: {
    pathId: v.id("training_paths"),
    steps: v.array(v.any()),
  },
  handler: async (ctx, { pathId, steps }) => {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await ctx.db.insert("training_path_steps", {
        pathId,
        position: i + 1,
        state: i === 0 ? "current" : "upcoming",
        prescription: s.prescription,
        wizardLine: s.wizardLine,
        details: s.details,
        targetSport: s.targetSport,
        expectedSessions: s.expectedSessions ?? 1,
      });
    }
    await ctx.db.patch(pathId, { lastAdvancedAt: Date.now() });
  },
});

export const markPathRefused = internalMutation({
  args: { pathId: v.id("training_paths"), reason: v.string() },
  handler: async (ctx, { pathId }) => {
    await ctx.db.patch(pathId, { status: "archived" });
  },
});

export const markPathError = internalMutation({
  args: { pathId: v.id("training_paths"), message: v.string() },
  handler: async (ctx, { pathId }) => {
    await ctx.db.patch(pathId, { status: "archived" });
  },
});

export const insertRemedialStep = internalMutation({
  args: {
    pathId: v.id("training_paths"),
    step: v.any(),
    stallReason: v.string(),
  },
  handler: async (ctx, { pathId, step }) => {
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    const currentIdx = steps.findIndex((s) => s.state === "current");
    if (currentIdx === -1) return;
    const current = steps.sort((a, b) => a.position - b.position)[currentIdx];
    // Insert remedial at fractional position between previous and current.
    const prevPos = currentIdx === 0 ? 0 : steps[currentIdx - 1].position;
    const remedialPos = (prevPos + current.position) / 2;
    await ctx.db.insert("training_path_steps", {
      pathId,
      position: remedialPos,
      state: "current",
      prescription: step.prescription,
      wizardLine: step.wizardLine,
      details: step.details,
      targetSport: current.targetSport,
      expectedSessions: 1,
    });
    // Demote the old current step back to upcoming.
    await ctx.db.patch(current._id, { state: "upcoming" });
  },
});

export const surfacePrerequisiteBanner = internalMutation({
  args: { pathId: v.id("training_paths"), reason: v.string() },
  handler: async (ctx, { pathId }) => {
    // For v1, we surface this by patching the path's notesContext with a
    // sentinel string that the widget reads. Full prerequisite-graph
    // navigation lands in v2.
    const p = await ctx.db.get(pathId);
    if (!p) return;
    await ctx.db.patch(pathId, {
      notesContext: (p.notesContext ?? "") + "\n[PREREQUISITE_BANNER]",
    });
  },
});

// Public mutation: replace the stub from Task 4.
export const acceptPathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals"), goalType: v.optional(v.string()) },
  handler: async (ctx, { proposalId }): Promise<Id<"training_paths">> => {
    const userId = await requireUserId(ctx);
    const prop = await ctx.db.get(proposalId);
    if (!prop || prop.userId !== userId) throw new Error("Not authorized");
    // Soft cap: if 3 active, create as queued.
    const all = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const status = all.filter((p) => p.status === "active").length >= ACTIVE_CAP ? "queued" : "active";
    const pathId = await ctx.db.insert("training_paths", {
      userId,
      sport: prop.sport,
      goal: prop.technique,
      goalType: "note" as const,
      status,
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.db.patch(proposalId, { status: "accepted" });
    // Schedule step generation. Action is in convex/actions/.
    await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner.run as any, {
      trigger: "goalCreated", pathId,
    });
    return pathId;
  },
});

export const createGoalPath = mutation({
  args: { sport: v.string(), goal: v.string() },
  handler: async (ctx, { sport, goal }): Promise<Id<"training_paths">> => {
    const userId = await requireUserId(ctx);
    const all = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const status = all.filter((p) => p.status === "active").length >= ACTIVE_CAP ? "queued" : "active";
    const pathId = await ctx.db.insert("training_paths", {
      userId, sport, goal,
      goalType: "goal" as const,
      status,
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner.run as any, {
      trigger: "goalCreated", pathId,
    });
    return pathId;
  },
});

export const prescribePath = mutation({
  args: {
    athleteId: v.id("users"),
    sport: v.string(),
    goal: v.string(),
  },
  handler: async (ctx, { athleteId, sport, goal }): Promise<Id<"training_paths">> => {
    const coachId = await requireUserId(ctx);
    // Coach-prescribed paths don't count against the cap.
    const pathId = await ctx.db.insert("training_paths", {
      userId: athleteId, sport, goal,
      goalType: "coach" as const,
      sourceCoachId: coachId,
      status: "active",
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner.run as any, {
      trigger: "coachPushed", pathId,
    });
    return pathId;
  },
});
```

Delete the `acceptPathProposalStub` export added in Task 4.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If a Convex internal reference like `internal.actions.trainingCoachPlanner` is unknown, run `npx convex codegen` first.

- [ ] **Step 4: Commit**

```bash
git add convex/actions/trainingCoachPlanner.ts convex/training_paths.ts
git commit -m "feat(planner): orchestrator action + accept/create/prescribe mutations"
```

---

## Task 14: Wire `sessionSave` trigger into `fight_camp.upsertSession`

**Files:**
- Modify: `convex/fight_camp.ts`

- [ ] **Step 1: Find the upsertSession mutation**

Run: `grep -n "upsertSession\|export const upsert" convex/fight_camp.ts | head`
Note the line numbers; the mutation handler should end with `return sessionId` or similar.

- [ ] **Step 2: Add the scheduler call inside the handler**

At the end of the `upsertSession` mutation handler (after the row is inserted or patched, before the return), add:

```ts
// Training Coach: schedule note-extraction planner if notes were updated.
if (args.notes && args.notes.trim().length > 0) {
  await ctx.scheduler.runAfter(2_000, internal.actions.trainingCoachPlanner.run, {
    trigger: "sessionSave",
    sessionId,
  });
}
```

Make sure `internal` is imported at the top of the file:

```ts
import { internal } from "./_generated/api";
```

- [ ] **Step 3: Wire feedback → plateau scheduler in submitStepFeedback**

Open `convex/training_paths.ts` and modify `submitStepFeedback` (from Task 7). After the feedback row insert, add:

```ts
if (feedback === "off") {
  await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner.run, {
    trigger: "stepFeedback",
    feedbackPathId: step.pathId,
  });
}
```

Add `import { internal } from "./_generated/api";` at the top of `convex/training_paths.ts` if not already present.

- [ ] **Step 4: Wire path completion → followups**

In `convex/training_paths.ts`, add a mutation `markStepCompleted` that the technique-log advance hook calls. Append:

```ts
export const advanceStepOnTechniqueLog = internalMutation({
  args: {
    userId: v.id("users"),
    techniqueId: v.optional(v.id("techniques")),
    techniqueName: v.string(),
    sport: v.string(),
  },
  handler: async (ctx, { userId, techniqueId, techniqueName, sport }) => {
    // Find an active step whose targetTechniqueId matches OR whose path goal fuzzy-matches name.
    const activePaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(techniqueName);
    for (const p of activePaths) {
      if (p.sport !== sport) continue;
      const goalNorm = norm(p.goal);
      if (!(goalNorm.includes(target) || target.includes(goalNorm))) continue;
      const steps = await ctx.db
        .query("training_path_steps")
        .withIndex("by_path_position", (q) => q.eq("pathId", p._id))
        .collect();
      const sorted = steps.sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex((s) => s.state === "current");
      if (idx === -1) continue;
      const cur = sorted[idx];
      await ctx.db.patch(cur._id, { state: "completed", completedAt: Date.now() });
      await ctx.db.patch(p._id, { lastAdvancedAt: Date.now() });
      // Promote next.
      const next = sorted[idx + 1];
      if (next) {
        await ctx.db.patch(next._id, { state: "current" });
      } else {
        // No more steps — complete the path.
        await ctx.db.patch(p._id, { status: "completed" });
        await ctx.scheduler.runAfter(0, internal.actions.trainingCoachPlanner._completePathFollowUps, { pathId: p._id });
      }
      break; // Only advance one path per log.
    }
  },
});
```

Then in `convex/techniques.ts`'s `logTechnique` mutation (find it via `grep -n "export const logTechnique" convex/techniques.ts`), after the insert into `training_technique_logs`, add:

```ts
await ctx.runMutation(internal.training_paths.advanceStepOnTechniqueLog, {
  userId, techniqueId, techniqueName: name, sport,
});
```

Adjust variable names to match the actual mutation's locals.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If imports fail, ensure `internal` is imported in each file you touched.

- [ ] **Step 6: Commit**

```bash
git add convex/fight_camp.ts convex/training_paths.ts convex/techniques.ts
git commit -m "feat(planner): wire sessionSave, stepFeedback, techniqueLog triggers"
```

---

## Task 15: Feature flag + retire old widget/action

**Files:**
- Modify: `src/lib/featureFlags.ts`
- Delete: `src/components/dashboard/TrainingInsightsWidget.tsx`
- Delete: `convex/actions/trainingInsights.ts`

- [ ] **Step 1: Add the flag**

Open `src/lib/featureFlags.ts` and add to the `FEATURE_FLAGS` object:

```ts
enableTrainingCoachPaths: false,  // Default off until v1 ships
```

- [ ] **Step 2: Find every reference to the old widget**

Run: `grep -rn "TrainingInsightsWidget\|trainingInsights" src/ convex/ | grep -v ".test." | head`
Note every file referencing it.

- [ ] **Step 3: Remove references**

Open each file from Step 2 and remove the references (import lines + JSX usages). The widget will be replaced in Task 24; leave the slot empty for now via a placeholder div or comment so the layout doesn't break.

Then delete the files:

```bash
rm src/components/dashboard/TrainingInsightsWidget.tsx
rm convex/actions/trainingInsights.ts
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -u
git add src/lib/featureFlags.ts
git commit -m "chore: retire trainingInsights action and widget"
```

---

## Task 16: `TrainingCoachWidget` shell + locked + empty states

**Files:**
- Create: `src/components/dashboard/training-coach/TrainingCoachWidget.tsx`
- Create: `src/components/dashboard/training-coach/EmptyState.tsx`
- Create: `src/components/dashboard/training-coach/LockedState.tsx`
- Create: `src/components/dashboard/training-coach/__tests__/TrainingCoachWidget.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboard/training-coach/__tests__/TrainingCoachWidget.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainingCoachWidget } from "../TrainingCoachWidget";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => null),
}));
vi.mock("@/lib/featureFlags", () => ({
  FEATURE_FLAGS: { enableTrainingCoachPaths: true },
}));

describe("TrainingCoachWidget", () => {
  it("renders locked state for non-Pro users", async () => {
    const { useQuery } = await import("convex/react");
    (useQuery as any).mockImplementation((q: any) => {
      if (q.toString().includes("pathSlotUsage")) {
        return { active: 0, max: 3, queued: 0, paused: 0, isPro: false };
      }
      return null;
    });
    render(<TrainingCoachWidget />);
    expect(screen.getByText(/upgrade for personalized training paths/i)).toBeInTheDocument();
  });

  it("renders empty state for Pro user with no paths", async () => {
    const { useQuery } = await import("convex/react");
    (useQuery as any).mockImplementation((q: any) => {
      if (q.toString().includes("pathSlotUsage")) {
        return { active: 0, max: 3, queued: 0, paused: 0, isPro: true };
      }
      if (q.toString().includes("getHeroStep")) return null;
      if (q.toString().includes("getActivePaths")) return [];
      return null;
    });
    render(<TrainingCoachWidget />);
    expect(screen.getByText(/no paths yet/i)).toBeInTheDocument();
    expect(screen.getByText(/log a session/i)).toBeInTheDocument();
    expect(screen.getByText(/set a goal/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/training-coach/__tests__/TrainingCoachWidget.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the components**

Create `src/components/dashboard/training-coach/LockedState.tsx`:

```tsx
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export function LockedState() {
  return (
    <div className="rounded-2xl border border-border/50 card-surface p-5 flex flex-col items-center text-center gap-3">
      <Sparkles className="h-6 w-6 text-primary" />
      <p className="text-[14px] font-semibold">Training Coach</p>
      <p className="text-[12px] text-muted-foreground">
        Upgrade for personalized training paths that adapt as you train.
      </p>
      <Link
        to="/upgrade"
        className="rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-[13px] font-semibold"
      >
        Upgrade to Pro
      </Link>
    </div>
  );
}
```

Create `src/components/dashboard/training-coach/EmptyState.tsx`:

```tsx
import { Link } from "react-router-dom";

type Props = { onSetGoal: () => void };

export function EmptyState({ onSetGoal }: Props) {
  return (
    <div className="rounded-2xl border border-border/50 card-surface p-5 flex flex-col items-center text-center gap-3">
      <p className="text-[14px] font-semibold">No paths yet.</p>
      <p className="text-[12px] text-muted-foreground">
        Log a session to auto-extract techniques, or set a goal.
      </p>
      <div className="flex gap-2 w-full mt-1">
        <Link
          to="/training-calendar"
          className="flex-1 rounded-2xl border border-border/50 px-3 py-2 text-[12px] font-semibold text-center"
        >
          Log a session
        </Link>
        <button
          type="button"
          onClick={onSetGoal}
          className="flex-1 rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-[12px] font-semibold"
        >
          Set a goal
        </button>
      </div>
    </div>
  );
}
```

Create `src/components/dashboard/training-coach/TrainingCoachWidget.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { LockedState } from "./LockedState";
import { EmptyState } from "./EmptyState";

export function TrainingCoachWidget() {
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const usage = useQuery(api.training_paths.pathSlotUsage, {});
  const hero = useQuery(api.training_paths.getHeroStep, {});
  const activePaths = useQuery(api.training_paths.getActivePaths, {});

  if (!FEATURE_FLAGS.enableTrainingCoachPaths) return null;
  if (usage === undefined || hero === undefined || activePaths === undefined) {
    return <div className="rounded-2xl card-surface h-32 animate-pulse" />;
  }
  if (!usage?.isPro) return <LockedState />;
  if (!hero && (activePaths?.length ?? 0) === 0) {
    return <EmptyState onSetGoal={() => setGoalDialogOpen(true)} />;
  }
  return (
    <div className="rounded-2xl card-surface border border-border/50 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-2">
        Training Coach
      </p>
      {/* HeroStepCard + PathsCarousel mount here in later tasks */}
      <pre className="text-[11px] text-muted-foreground">hero loaded · paths {activePaths?.length}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/training-coach/__tests__/TrainingCoachWidget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/training-coach/
git commit -m "feat(widget): TrainingCoachWidget shell + locked + empty states"
```

---

## Task 17: `HeroStepCard` component

**Files:**
- Create: `src/components/dashboard/training-coach/HeroStepCard.tsx`
- Create: `src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeroStepCard } from "../HeroStepCard";

const HERO = {
  path: { _id: "p1", goal: "Kimura from side control", sport: "BJJ" } as any,
  currentStep: {
    prescription: "Solo: 50 reps from side control",
    wizardLine: "Alright Pratik — start with reps.",
  } as any,
  nextSteps: [
    { prescription: "Partner drill under failed-grip pressure" } as any,
    { prescription: "Live spar — hunt it once" } as any,
  ],
  totalSteps: 7,
  stepNumber: 3,
};

describe("HeroStepCard", () => {
  it("shows wizard line, prescription, and step counter", () => {
    render(<HeroStepCard hero={HERO} onTap={() => {}} />);
    expect(screen.getByText(/Alright Pratik/)).toBeInTheDocument();
    expect(screen.getByText(/Solo: 50 reps/)).toBeInTheDocument();
    expect(screen.getByText(/Step 3 of 7/)).toBeInTheDocument();
    expect(screen.getByText(/Kimura from side control/)).toBeInTheDocument();
  });

  it("previews the next 2 steps", () => {
    render(<HeroStepCard hero={HERO} onTap={() => {}} />);
    expect(screen.getByText(/Partner drill under failed-grip pressure/)).toBeInTheDocument();
    expect(screen.getByText(/Live spar — hunt it once/)).toBeInTheDocument();
  });

  it("calls onTap when card is clicked", () => {
    const onTap = vi.fn();
    render(<HeroStepCard hero={HERO} onTap={onTap} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/dashboard/training-coach/HeroStepCard.tsx`:

```tsx
type HeroData = {
  path: { _id: string; goal: string; sport: string };
  currentStep: { prescription: string; wizardLine: string };
  nextSteps: Array<{ prescription: string }>;
  totalSteps: number;
  stepNumber: number;
};

type Props = {
  hero: HeroData;
  onTap: () => void;
};

export function HeroStepCard({ hero, onTap }: Props) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left rounded-2xl border border-primary/30 bg-primary/5 p-4 active:scale-[0.99] transition-transform"
    >
      <p className="text-[14px] italic text-foreground/90 leading-snug">
        🧙 “{hero.currentStep.wizardLine}”
      </p>
      <p className="mt-2 text-[15px] font-semibold leading-tight">
        {hero.currentStep.prescription}
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        Step {hero.stepNumber} of {hero.totalSteps} · {hero.path.goal}
      </p>
      {hero.nextSteps.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2 space-y-0.5">
          {hero.nextSteps[0] && (
            <p className="text-[11px] text-muted-foreground">
              Up next: {hero.nextSteps[0].prescription}
            </p>
          )}
          {hero.nextSteps[1] && (
            <p className="text-[11px] text-muted-foreground/70">
              Then: {hero.nextSteps[1].prescription}
            </p>
          )}
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/training-coach/HeroStepCard.tsx src/components/dashboard/training-coach/__tests__/HeroStepCard.test.tsx
git commit -m "feat(widget): HeroStepCard with next-2 preview"
```

---

## Task 18: `PathsCarousel` component

**Files:**
- Create: `src/components/dashboard/training-coach/PathsCarousel.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/training-coach/PathsCarousel.tsx`:

```tsx
import { useMemo } from "react";

type PathChip = {
  _id: string;
  goal: string;
  progress: number; // 0..1
  totalSteps: number;
  completedSteps: number;
};

type Props = {
  paths: PathChip[];
  queuedPaths?: Array<{ goal: string }>;
  onTapPath: (pathId: string) => void;
};

export function PathsCarousel({ paths, queuedPaths, onTapPath }: Props) {
  const chips = useMemo(() => paths.slice(0, 3), [paths]);
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        Active paths
      </p>
      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {chips.map((p) => (
          <button
            key={p._id}
            type="button"
            onClick={() => onTapPath(p._id)}
            className="shrink-0 rounded-xl border border-border/50 px-3 py-2 text-left min-w-[150px] active:bg-muted/40"
          >
            <p className="text-[12px] font-semibold truncate">{p.goal}</p>
            <div className="mt-1.5 flex items-center gap-1">
              {Array.from({ length: p.totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < p.completedSteps ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </button>
        ))}
      </div>
      {queuedPaths && queuedPaths.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          ▶ Up next: {queuedPaths[0].goal}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/training-coach/PathsCarousel.tsx
git commit -m "feat(widget): PathsCarousel with progress bars"
```

---

## Task 19: `PathProposalBanner` component + integration

**Files:**
- Create: `src/components/dashboard/training-coach/PathProposalBanner.tsx`
- Create: `src/components/dashboard/training-coach/__tests__/PathProposalBanner.test.tsx`
- Modify: `src/components/dashboard/training-coach/TrainingCoachWidget.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/dashboard/training-coach/__tests__/PathProposalBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathProposalBanner } from "../PathProposalBanner";

describe("PathProposalBanner", () => {
  it("renders technique name in the prompt", () => {
    render(<PathProposalBanner
      proposal={{ _id: "p1", technique: "Kimura from side control", sport: "BJJ" } as any}
      onAccept={() => {}}
      onSnooze={() => {}}
    />);
    expect(screen.getByText(/Kimura from side control/)).toBeInTheDocument();
  });

  it("fires onAccept when Yes pressed", () => {
    const onAccept = vi.fn();
    render(<PathProposalBanner
      proposal={{ _id: "p1", technique: "X", sport: "BJJ" } as any}
      onAccept={onAccept}
      onSnooze={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: /yes/i }));
    expect(onAccept).toHaveBeenCalledWith("p1");
  });

  it("fires onSnooze when Not yet pressed", () => {
    const onSnooze = vi.fn();
    render(<PathProposalBanner
      proposal={{ _id: "p1", technique: "X", sport: "BJJ" } as any}
      onAccept={() => {}}
      onSnooze={onSnooze}
    />);
    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));
    expect(onSnooze).toHaveBeenCalledWith("p1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/training-coach/__tests__/PathProposalBanner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/dashboard/training-coach/PathProposalBanner.tsx`:

```tsx
import type { Doc, Id } from "@/../convex/_generated/dataModel";

type Props = {
  proposal: Pick<Doc<"training_path_proposals">, "_id" | "technique" | "sport">;
  onAccept: (id: Id<"training_path_proposals">) => void;
  onSnooze: (id: Id<"training_path_proposals">) => void;
};

export function PathProposalBanner({ proposal, onAccept, onSnooze }: Props) {
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3 flex items-center gap-3">
      <span className="text-[18px]">🧙</span>
      <p className="flex-1 text-[12px] leading-snug">
        Spin up a path for <span className="font-semibold">{proposal.technique}</span>?
      </p>
      <button
        type="button"
        onClick={() => onAccept(proposal._id)}
        className="rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onSnooze(proposal._id)}
        className="text-[12px] text-muted-foreground"
      >
        Not yet
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Mount banner inside the widget**

Edit `src/components/dashboard/training-coach/TrainingCoachWidget.tsx`. Replace the body block to include subscription + render:

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { LockedState } from "./LockedState";
import { EmptyState } from "./EmptyState";
import { HeroStepCard } from "./HeroStepCard";
import { PathProposalBanner } from "./PathProposalBanner";

export function TrainingCoachWidget() {
  const [_goalDialogOpen, setGoalDialogOpen] = useState(false);
  const usage = useQuery(api.training_paths.pathSlotUsage, {});
  const hero = useQuery(api.training_paths.getHeroStep, {});
  const activePaths = useQuery(api.training_paths.getActivePaths, {});
  const proposals = useQuery(api.training_paths.getActivePathProposals, {});
  const acceptMut = useMutation(api.training_paths.acceptPathProposal);
  const snoozeMut = useMutation(api.training_paths.snoozePathProposal);

  if (!FEATURE_FLAGS.enableTrainingCoachPaths) return null;
  if (usage === undefined || hero === undefined || activePaths === undefined) {
    return <div className="rounded-2xl card-surface h-32 animate-pulse" />;
  }
  if (!usage.isPro) return <LockedState />;
  if (!hero && (activePaths?.length ?? 0) === 0 && (proposals?.length ?? 0) === 0) {
    return <EmptyState onSetGoal={() => setGoalDialogOpen(true)} />;
  }
  return (
    <div className="space-y-3">
      {proposals && proposals.map((p) => (
        <PathProposalBanner
          key={p._id}
          proposal={p}
          onAccept={(id) => { void acceptMut({ proposalId: id }); }}
          onSnooze={(id) => { void snoozeMut({ proposalId: id }); }}
        />
      ))}
      {hero && <HeroStepCard hero={hero} onTap={() => { /* StepDetailSheet in Task 21 */ }} />}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/dashboard/training-coach/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/training-coach/
git commit -m "feat(widget): PathProposalBanner wired to widget"
```

---

## Task 20: `FeedbackStrip` component

**Files:**
- Create: `src/components/dashboard/training-coach/FeedbackStrip.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/training-coach/FeedbackStrip.tsx`:

```tsx
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

type Props = {
  stepId: Id<"training_path_steps">;
  onDone: () => void;
};

export function FeedbackStrip({ stepId, onDone }: Props) {
  const submit = useMutation(api.training_paths.submitStepFeedback);
  const handle = async (feedback: "nailed" | "off") => {
    await submit({ stepId, feedback });
    onDone();
  };
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 px-3 py-2 flex items-center gap-2">
      <span className="text-[12px] text-muted-foreground flex-1">How'd it go?</span>
      <button
        type="button"
        onClick={() => handle("nailed")}
        className="rounded-lg bg-emerald-500/20 text-emerald-300 px-2.5 py-1 text-[12px] font-semibold"
      >
        👍 nailed
      </button>
      <button
        type="button"
        onClick={() => handle("off")}
        className="rounded-lg bg-rose-500/20 text-rose-300 px-2.5 py-1 text-[12px] font-semibold"
      >
        👎 still off
      </button>
    </div>
  );
}
```

The widget triggers this strip after `advanceStepOnTechniqueLog` completes a step. Wiring: the widget reads the most recently completed step lacking `completedFeedback` and renders the strip until feedback is submitted. Add to `TrainingCoachWidget.tsx`:

```ts
const pendingFeedback = useQuery(api.training_paths.getPendingFeedbackStep, {});
```

And add the query to `convex/training_paths.ts`:

```ts
export const getPendingFeedbackStep = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const paths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    for (const p of paths) {
      const steps = await ctx.db
        .query("training_path_steps")
        .withIndex("by_path_position", (q) => q.eq("pathId", p._id))
        .collect();
      const candidate = steps
        .filter((s) => s.state === "completed" && s.completedAt && !s.completedFeedback)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
      if (candidate && Date.now() - (candidate.completedAt ?? 0) < 24 * 60 * 60 * 1000) {
        return candidate;
      }
    }
    return null;
  },
});
```

Then in the widget, render `<FeedbackStrip stepId={pendingFeedback._id} onDone={...} />` below the hero card when `pendingFeedback` is truthy.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/training-coach/FeedbackStrip.tsx src/components/dashboard/training-coach/TrainingCoachWidget.tsx convex/training_paths.ts
git commit -m "feat(widget): FeedbackStrip + pending-feedback query"
```

---

## Task 21: `StepDetailSheet`

**Files:**
- Create: `src/components/dashboard/training-coach/StepDetailSheet.tsx`
- Modify: `src/components/dashboard/training-coach/TrainingCoachWidget.tsx`

- [ ] **Step 1: Implement the sheet**

Create `src/components/dashboard/training-coach/StepDetailSheet.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { Link } from "react-router-dom";

type Step = {
  _id: Id<"training_path_steps">;
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Step | null;
  pathId: Id<"training_paths"> | null;
};

export function StepDetailSheet({ open, onOpenChange, step, pathId }: Props) {
  const pauseMut = useMutation(api.training_paths.pausePath);
  if (!step) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[18px] leading-tight">{step.prescription}</SheetTitle>
        </SheetHeader>
        <p className="text-[14px] italic text-foreground/80 mt-2">🧙 “{step.wizardLine}”</p>
        <section className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Why</h3>
          <p className="text-[13px] leading-relaxed">{step.details.why}</p>
        </section>
        <section className="mt-4">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">How</h3>
          <ol className="space-y-1 list-decimal list-inside text-[13px]">
            {step.details.how.map((h, i) => <li key={i}>{h}</li>)}
          </ol>
        </section>
        {step.details.pitfalls.length > 0 && (
          <section className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wider text-amber-300 mb-1">Watch out for</h3>
            <ul className="space-y-1 list-disc list-inside text-[13px] text-amber-100/90">
              {step.details.pitfalls.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </section>
        )}
        <div className="mt-6 flex gap-2">
          <Link
            to="/training-calendar"
            className="flex-1 rounded-2xl border border-border/50 px-3 py-2 text-[12px] font-semibold text-center"
          >
            Open in calendar
          </Link>
          {pathId && (
            <button
              type="button"
              onClick={() => { void pauseMut({ pathId }); onOpenChange(false); }}
              className="rounded-2xl border border-amber-500/40 text-amber-300 px-3 py-2 text-[12px] font-semibold"
            >
              Pause path
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Wire from HeroStepCard tap**

In `TrainingCoachWidget.tsx`, add:

```tsx
const [detailOpen, setDetailOpen] = useState(false);
```

Pass `onTap={() => setDetailOpen(true)}` to `<HeroStepCard>`. Add `<StepDetailSheet open={detailOpen} onOpenChange={setDetailOpen} step={hero?.currentStep ?? null} pathId={hero?.path._id ?? null} />` at the bottom of the widget JSX.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/training-coach/
git commit -m "feat(widget): StepDetailSheet with pause + open-in-calendar"
```

---

## Task 22: `RoadmapSheet`

**Files:**
- Create: `src/components/dashboard/training-coach/RoadmapSheet.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/training-coach/RoadmapSheet.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { Check, Loader2, RefreshCw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathId: Id<"training_paths"> | null;
};

export function RoadmapSheet({ open, onOpenChange, pathId }: Props) {
  const data = useQuery(
    api.training_paths.getPathWithSteps,
    pathId ? { pathId } : "skip",
  );
  const pauseMut = useMutation(api.training_paths.pausePath);
  const archiveMut = useMutation(api.training_paths.archivePath);
  if (!pathId) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{data?.path.goal ?? "Path"}</SheetTitle>
        </SheetHeader>
        {!data && <Loader2 className="animate-spin h-5 w-5 mt-4" />}
        {data && (
          <ol className="mt-4 space-y-3">
            {data.steps.map((s) => {
              const color =
                s.state === "completed" ? "bg-emerald-500 border-emerald-500"
                : s.state === "current" ? "bg-primary border-primary animate-pulse"
                : s.state === "remedial" ? "bg-amber-400 border-amber-400"
                : "bg-muted border-border";
              return (
                <li key={s._id} className="flex gap-3">
                  <span className={`mt-0.5 h-6 w-6 rounded-full border-2 flex items-center justify-center ${color}`}>
                    {s.state === "completed" && <Check className="h-3.5 w-3.5 text-background" strokeWidth={3} />}
                    {s.state === "remedial" && <RefreshCw className="h-3 w-3 text-background" strokeWidth={3} />}
                  </span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold">{s.prescription}</p>
                    {s.state === "remedial" && (
                      <p className="text-[11px] text-amber-300 mt-0.5">Refining</p>
                    )}
                    {s.completedAt && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Completed {new Date(s.completedAt).toLocaleDateString()}
                        {s.completedFeedback && ` · ${s.completedFeedback === "nailed" ? "👍" : "👎"}`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data && data.path.status === "active" && (
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => { void pauseMut({ pathId }); onOpenChange(false); }}
              className="flex-1 rounded-2xl border border-amber-500/40 text-amber-300 px-3 py-2 text-[12px] font-semibold"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => { void archiveMut({ pathId }); onOpenChange(false); }}
              className="flex-1 rounded-2xl border border-rose-500/40 text-rose-300 px-3 py-2 text-[12px] font-semibold"
            >
              Archive
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/training-coach/RoadmapSheet.tsx
git commit -m "feat(widget): RoadmapSheet with checkpoint visual"
```

---

## Task 23: `NewGoalDialog`

**Files:**
- Create: `src/components/dashboard/training-coach/NewGoalDialog.tsx`

- [ ] **Step 1: Implement**

Create `src/components/dashboard/training-coach/NewGoalDialog.tsx`:

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";

const SPORTS = ["BJJ", "Boxing", "Muay Thai", "MMA", "Wrestling", "Kickboxing"] as const;
const SUGGESTED = [
  "Land my jab-cross in sparring",
  "Pass closed guard reliably",
  "Win in scrambles",
  "Develop a kick game",
];

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewGoalDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sport, setSport] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const createMut = useMutation(api.training_paths.createGoalPath);

  const handleCreate = async () => {
    if (!sport || !goal.trim()) return;
    setCreating(true);
    try {
      await createMut({ sport, goal: goal.trim() });
      onOpenChange(false);
      setStep(1); setSport(""); setGoal("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>🧙 New path</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-[13px]">Which discipline?</p>
            <div className="grid grid-cols-2 gap-2">
              {SPORTS.map((s) => (
                <button key={s} type="button"
                  onClick={() => { setSport(s); setStep(2); }}
                  className="rounded-2xl border border-border/50 px-3 py-2 text-[13px] font-semibold">{s}</button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[13px]">What outcome are you chasing in {sport}?</p>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Land my jab-cross in sparring" />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button key={s} type="button"
                  onClick={() => setGoal(s)}
                  className="rounded-xl border border-border/50 px-2 py-1 text-[11px]">{s}</button>
              ))}
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setStep(1)} className="text-[12px] text-muted-foreground">Back</button>
              <button type="button" disabled={!goal.trim()} onClick={() => setStep(3)} className="rounded-2xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">Next</button>
            </DialogFooter>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[13px]">Create path?</p>
            <div className="rounded-xl border border-border/50 p-3 text-[12px]">
              <p><span className="text-muted-foreground">Sport:</span> {sport}</p>
              <p><span className="text-muted-foreground">Goal:</span> {goal}</p>
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setStep(2)} className="text-[12px] text-muted-foreground">Back</button>
              <button type="button" disabled={creating} onClick={handleCreate} className="rounded-2xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
                {creating ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire from widget's `+` button**

Open `TrainingCoachWidget.tsx`. Add `import { NewGoalDialog } from "./NewGoalDialog";` and render `<NewGoalDialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen} />` at the end of the JSX. Also expose a `+` button in the widget header next to the title and call `setGoalDialogOpen(true)`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/training-coach/NewGoalDialog.tsx src/components/dashboard/training-coach/TrainingCoachWidget.tsx
git commit -m "feat(widget): NewGoalDialog three-step conversational flow"
```

---

## Task 24: Mount widget on Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Replace the old widget slot**

Open `src/pages/Dashboard.tsx`. Find the placeholder/comment left from Task 15. Add:

```tsx
import { TrainingCoachWidget } from "@/components/dashboard/training-coach/TrainingCoachWidget";
```

Drop `<TrainingCoachWidget />` into the same place the old `<TrainingInsightsWidget />` lived (preserve the grid slot CSS classes).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: successful build.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat(dashboard): mount TrainingCoachWidget"
```

---

## Task 25: Coach push UI on `/coach/athletes/:id`

**Files:**
- Create: `src/components/coach/PrescribePathSection.tsx`
- Modify: `src/pages/coach/AthleteDetail.tsx`

- [ ] **Step 1: Implement the section component**

Create `src/components/coach/PrescribePathSection.tsx`:

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

const SPORTS = ["BJJ", "Boxing", "Muay Thai", "MMA", "Wrestling", "Kickboxing"] as const;

type Props = { athleteId: Id<"users"> };

export function PrescribePathSection({ athleteId }: Props) {
  const [sport, setSport] = useState<string>("BJJ");
  const [goal, setGoal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const prescribe = useMutation(api.training_paths.prescribePath);

  const handleSend = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      await prescribe({ athleteId, sport, goal: goal.trim() });
      setGoal("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/50 card-surface p-4">
      <h3 className="text-[14px] font-semibold mb-3">Prescribe a path</h3>
      <div className="space-y-2">
        <select value={sport} onChange={(e) => setSport(e.target.value)}
          className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-[13px]">
          {SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Master kimura from side control" />
        <button type="button" disabled={busy || !goal.trim()} onClick={handleSend}
          className="w-full rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-[13px] font-semibold disabled:opacity-50">
          {busy ? "Sending…" : "Send to athlete"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Mount on AthleteDetail**

Open `src/pages/coach/AthleteDetail.tsx`. Add at the top:

```tsx
import { PrescribePathSection } from "@/components/coach/PrescribePathSection";
```

Then render `<PrescribePathSection athleteId={athlete._id} />` inside the existing athlete-detail layout (after the recent-sessions block; reuse existing spacing).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: successful build.

- [ ] **Step 4: Commit**

```bash
git add src/components/coach/PrescribePathSection.tsx src/pages/coach/AthleteDetail.tsx
git commit -m "feat(coach): prescribe path section on athlete detail"
```

---

## Task 26: Integration test — happy path

**Files:**
- Create: `tests/training-coach/e2e-happy-path.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/training-coach/e2e-happy-path.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexTestingHelper } from "convex-helpers/testing";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";

vi.mock("../../convex/_shared/groq", () => ({
  callGroqText: vi.fn(),
}));
import { callGroqText } from "../../convex/_shared/groq";

const MOCK_CANDIDATES = JSON.stringify({
  candidates: [{ technique: "Kimura from side control", sport: "BJJ", confidence: 0.9 }],
});
const MOCK_STEPS = JSON.stringify({
  steps: Array.from({ length: 5 }).map((_, i) => ({
    position: i + 1,
    prescription: `Step ${i + 1}`,
    wizardLine: `Pratik — step ${i + 1}`,
    details: { why: "w", how: ["a", "b", "c"], pitfalls: ["p"] },
    targetSport: "BJJ",
    expectedSessions: 1,
  })),
});

describe("Training coach happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("note → confirm → 5 steps → complete → followup proposals", async () => {
    const t = new ConvexTestingHelper(schema);
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { tier: "pro", firstName: "Pratik" } as any);
    });

    // Stage 1: session save with notes — mock extractCandidates LLM
    (callGroqText as any).mockResolvedValueOnce(MOCK_CANDIDATES);
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("fight_camp_calendar", {
        userId, date: "2026-05-21", sessionType: "BJJ",
        durationMinutes: 60, intensity: "hard", rpe: 7,
        notes: "Drilled kimuras from side control all class",
      } as any);
    });
    await t.runAsUser(userId, internal.actions.trainingCoachPlanner.run, {
      trigger: "sessionSave", sessionId,
    });
    const proposals = await t.runAsUser(userId, api.training_paths.getActivePathProposals, {});
    expect(proposals.length).toBe(1);

    // Stage 2: user accepts proposal — mock generateSteps LLM
    (callGroqText as any).mockResolvedValueOnce(MOCK_STEPS);
    const pathId = await t.runAsUser(userId, api.training_paths.acceptPathProposal, {
      proposalId: proposals[0]._id,
    });
    await t.flushScheduled(); // run the planner job that generates steps

    // Stage 3: hero step should be step 1
    const hero = await t.runAsUser(userId, api.training_paths.getHeroStep, {});
    expect(hero?.stepNumber).toBe(1);
    expect(hero?.totalSteps).toBe(5);
  });
});
```

If `ConvexTestingHelper` doesn't expose `flushScheduled`, look for the equivalent (`runScheduledFunctions`, `processScheduled`) — refer to `convex-helpers` docs version installed in this repo (check `package.json`).

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/training-coach/e2e-happy-path.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/training-coach/e2e-happy-path.test.ts
git commit -m "test(coach): happy-path integration"
```

---

## Task 27: Integration test — plateau loop-back

**Files:**
- Create: `tests/training-coach/e2e-plateau-loopback.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/training-coach/e2e-plateau-loopback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexTestingHelper } from "convex-helpers/testing";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";

vi.mock("../../convex/_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../convex/_shared/groq";

const REMEDIAL = JSON.stringify({
  remedialStep: {
    prescription: "Drill hip-out timing",
    wizardLine: "Refining first",
    details: { why: "w", how: ["a"], pitfalls: ["p"] },
  },
  stallReason: "frame defense",
});

describe("Training coach plateau loop-back", () => {
  beforeEach(() => vi.clearAllMocks());

  it("2x off feedback inserts remedial step before next", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId, step1Id, step2Id } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro", firstName: "Pratik" } as any);
      const pid = await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "Kimura", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      const s1 = await ctx.db.insert("training_path_steps", {
        pathId: pid, position: 1, state: "completed",
        prescription: "s1", wizardLine: "w", details: { why: "", how: ["a"], pitfalls: [] },
        targetSport: "BJJ", expectedSessions: 1, completedAt: Date.now(),
      });
      const s2 = await ctx.db.insert("training_path_steps", {
        pathId: pid, position: 2, state: "current",
        prescription: "s2", wizardLine: "w", details: { why: "", how: ["a"], pitfalls: [] },
        targetSport: "BJJ", expectedSessions: 1,
      });
      return { userId: uid, pathId: pid, step1Id: s1, step2Id: s2 };
    });

    // Two off feedbacks
    await t.runAsUser(userId, api.training_paths.submitStepFeedback, { stepId: step1Id, feedback: "off" });
    await t.runAsUser(userId, api.training_paths.submitStepFeedback, { stepId: step2Id, feedback: "off" });

    (callGroqText as any).mockResolvedValue(REMEDIAL);
    await t.flushScheduled();

    const data = await t.runAsUser(userId, api.training_paths.getPathWithSteps, { pathId });
    const remedial = data.steps.find((s: any) => s.state === "current");
    expect(remedial?.prescription).toMatch(/hip-out/);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/training-coach/e2e-plateau-loopback.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/training-coach/e2e-plateau-loopback.test.ts
git commit -m "test(coach): plateau loop-back integration"
```

---

## Task 28: Integration test — completion → follow-ups

**Files:**
- Create: `tests/training-coach/e2e-completion.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/training-coach/e2e-completion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexTestingHelper } from "convex-helpers/testing";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";

vi.mock("../../convex/_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../convex/_shared/groq";

const FOLLOWUPS = JSON.stringify({
  relatedPath: { technique: "Kimura to armbar", sport: "BJJ", goal: "Chain it" },
  defensePath: { technique: "Kimura defense", sport: "BJJ", goal: "Defend it" },
});

describe("Training coach completion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("completing the last step generates 2 proposal banners", async () => {
    const t = new ConvexTestingHelper(schema);
    const { userId, pathId } = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { tier: "pro", firstName: "Pratik" } as any);
      const pid = await ctx.db.insert("training_paths", {
        userId: uid, sport: "BJJ", goal: "Kimura from side control", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      await ctx.db.insert("training_path_steps", {
        pathId: pid, position: 1, state: "current",
        prescription: "last", wizardLine: "w",
        details: { why: "", how: ["a"], pitfalls: [] },
        targetSport: "BJJ", expectedSessions: 1,
      });
      return { userId: uid, pathId: pid };
    });

    (callGroqText as any).mockResolvedValue(FOLLOWUPS);

    // Simulate technique log → advanceStepOnTechniqueLog → completes path → schedules follow-ups
    await t.run(async (ctx) => {
      const tid = await ctx.db.insert("techniques", { name: "Kimura", nameNormalized: "kimura", sport: "BJJ" } as any);
      await ctx.runMutation(internal.training_paths.advanceStepOnTechniqueLog, {
        userId, techniqueId: tid, techniqueName: "Kimura from side control", sport: "BJJ",
      });
    });
    await t.flushScheduled();

    const proposals = await t.runAsUser(userId, api.training_paths.getActivePathProposals, {});
    expect(proposals.length).toBe(2);
    const techniques = proposals.map((p: any) => p.technique);
    expect(techniques).toContain("Kimura to armbar");
    expect(techniques).toContain("Kimura defense");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/training-coach/e2e-completion.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/training-coach/e2e-completion.test.ts
git commit -m "test(coach): completion follow-ups integration"
```

---

## Task 29: Integration test — coach push

**Files:**
- Create: `tests/training-coach/e2e-coach-push.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/training-coach/e2e-coach-push.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexTestingHelper } from "convex-helpers/testing";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";

vi.mock("../../convex/_shared/groq", () => ({ callGroqText: vi.fn() }));
import { callGroqText } from "../../convex/_shared/groq";

const STEPS = JSON.stringify({
  steps: Array.from({ length: 5 }).map((_, i) => ({
    position: i + 1,
    prescription: `s${i + 1}`,
    wizardLine: `Pratik — s${i + 1}`,
    details: { why: "w", how: ["a"], pitfalls: ["p"] },
    targetSport: "BJJ",
    expectedSessions: 1,
  })),
});

describe("Training coach coach-push", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coach prescribes a path that appears on athlete with sourceCoachId", async () => {
    const t = new ConvexTestingHelper(schema);
    const { coachId, athleteId } = await t.run(async (ctx) => {
      const c = await ctx.db.insert("users", { tier: "pro", firstName: "Mike" } as any);
      const a = await ctx.db.insert("users", { tier: "pro", firstName: "Pratik" } as any);
      return { coachId: c, athleteId: a };
    });

    (callGroqText as any).mockResolvedValue(STEPS);
    const pathId = await t.runAsUser(coachId, api.training_paths.prescribePath, {
      athleteId, sport: "BJJ", goal: "Drill double leg",
    });
    await t.flushScheduled();

    const hero = await t.runAsUser(athleteId, api.training_paths.getHeroStep, {});
    expect(hero?.path._id).toBe(pathId);
    expect((hero?.path as any).sourceCoachId).toBe(coachId);
    expect(hero?.totalSteps).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/training-coach/e2e-coach-push.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/training-coach/e2e-coach-push.test.ts
git commit -m "test(coach): coach push integration"
```

---

## Task 30: Final build + lint sweep + flag flip readiness

**Files:**
- All (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: successful build with no new errors.

- [ ] **Step 3: Lint changed files**

Run: `npx eslint convex/training_paths.ts convex/actions/trainingCoachPlanner.ts convex/actions/_trainingCoach/ src/components/dashboard/training-coach/ src/components/coach/PrescribePathSection.tsx`
Expected: no new errors. Pre-existing `@typescript-eslint/no-explicit-any` warnings in other files are acceptable.

- [ ] **Step 4: Snapshot the design spec link in the changelog or release notes if your repo maintains one**

Skip if no changelog file exists. If `CHANGELOG.md` exists at repo root, add an entry under the next unreleased version:

```md
- feat(training-coach): linear improvement paths feature (Pro). See docs/superpowers/specs/2026-05-21-training-coach-paths-design.md
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md 2>/dev/null || true
git commit --allow-empty -m "chore: training coach paths v1 complete"
```

- [ ] **Step 6: iOS sync (release prep only — do not flip the flag yet)**

Run: `npx cap sync ios`
Expected: copies new web build into ios/.

---

## Deferred Spec Items (Tracked, Not Implemented in v1)

These edge cases from the spec are intentionally **not** in the task list above — they need follow-up tickets after the v1 ships and signal validates the core flow. Listed here so they don't get forgotten:

| Spec ref | Item | Why deferred |
|---|---|---|
| §8 row "Coach pushes conflicting path" | Replacement modal on athlete side when coach pushes a path whose technique already has an active note-driven path | Coach push only conflicts when athlete also has an active note path on the same technique — rare in v1. Needs UX work for the modal copy and "Keep mine" branch. |
| §8 row "Path 14 days idle" | Cron job that auto-pauses paths whose sport hasn't been trained in 14 days | Requires a new scheduled function + telemetry to validate the 14-day threshold doesn't annoy users. |
| §6.7 "max 3 coach pushes/week per athlete" | Rate limit enforcement in `prescribePath` mutation | Coach feature usage will be low in v1 internal rollout; add the limit when we onboard external gyms. |
| §6.3 "Paused tab on roadmap sheet" | Dedicated tab listing all paused paths with bulk resume | Single-path resume button exists via Roadmap sheet; bulk view can ship when users actually accumulate paused paths. |

Each item is a 1-2 task follow-up; create separate tickets when v1 metrics warrant them.

---

## Post-Plan: Feature Flag Flip Plan

After merging this plan's PR, flip `enableTrainingCoachPaths` to `true` in stages:
1. **Internal users (Pratik + dev gym):** flip via per-user override
2. **10% Pro cohort:** flip via cohort-based feature-flag rollout
3. **100% Pro:** flag default → true

Watch the telemetry metrics from the design spec (Section 9) during each stage. Roll back by flipping the flag back to false — no schema rollback needed because the new tables are additive.
