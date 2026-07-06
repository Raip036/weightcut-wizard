"use node";

/**
 * Delete-account orchestration.
 *
 * Convex has no `ON DELETE CASCADE`, so we hand-cascade across every table
 * referencing the user. We split the work across multiple internal mutations
 * because a single mutation has a write limit and would brown out for
 * power-users with thousands of meal_items. Internal mutations live in a
 * sibling V8 file (`deleteAccountMutations.ts`) since this action file is
 * Node-runtime.
 *
 * Storage cleanup is best-effort — failures there must not block account
 * deletion.
 */
import { action } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import { createPostHogClient } from "../_shared/posthog";

// Fixed allow-list of self-reported exit reasons captured on the final
// delete confirmation. Kept as a closed set (no free-text) so we never
// ingest PII into analytics. Anything outside this set — including a
// missing arg from an older client that predates the reason picker —
// collapses to "not_given" so the property is always present.
const ALLOWED_DELETE_REASONS = new Set([
  "too_expensive",
  "not_using",
  "missing_features",
  "found_alternative",
  "technical_issues",
  "other",
]);

export const run = action({
  // `reason` is optional for backward compatibility: old clients call
  // `deleteAccount({})` with no reason and must keep working unchanged.
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, { reason }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const cleanReason =
      reason && ALLOWED_DELETE_REASONS.has(reason) ? reason : "not_given";

    // Cascade across every user-scoped table. Each step is its own
    // mutation so write budgets are per-call instead of shared, and so a
    // failure here surfaces *which* step blew up — without this wrapper
    // the client just saw a generic "Failed to delete account" toast and
    // we had no way to tell which table left orphans.
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["meals", () => ctx.runMutation(internal.deleteAccountMutations.cascadeMeals, { userId })],
      ["training", () => ctx.runMutation(internal.deleteAccountMutations.cascadeTraining, { userId })],
      ["wellness", () => ctx.runMutation(internal.deleteAccountMutations.cascadeWellness, { userId })],
      ["misc", () => ctx.runMutation(internal.deleteAccountMutations.cascadeMisc, { userId })],
      ["gymOwnership", () => ctx.runMutation(internal.deleteAccountMutations.cascadeGymOwnership, { userId })],
      ["profile", () => ctx.runMutation(internal.deleteAccountMutations.cascadeProfile, { userId })],
    ];

    for (const [name, run] of steps) {
      try {
        await run();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[deleteAccount] step "${name}" failed for user ${userId}: ${message}`,
        );
        const posthogErr = createPostHogClient();
        if (posthogErr) {
          posthogErr.captureException(err, userId, { failed_step: name });
          await posthogErr.shutdown();
        }
        throw new Error(`Account deletion failed during ${name}: ${message}`);
      }
    }

    const posthog = createPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: userId,
        event: "account deleted",
        properties: { reason: cleanReason },
      });
      await posthog.shutdown();
    }

    return { success: true };
  },
});
