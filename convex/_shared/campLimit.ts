/**
 * Free-tier fight-camp creation limit.
 *
 * Rule: a FREE user may create exactly ONE fight camp, ever — and that camp
 * is specifically the one auto-created during the fighter ONBOARDING flow.
 * Every other creation path (manual "start a new camp", the post-fight
 * overlay, re-running onboarding) is Pro-only.
 *
 * Why a dedicated helper instead of the plain `MULTIPLE_FIGHT_CAMPS` gate:
 * a "just lose weight" user finishes onboarding with ZERO camps but must
 * STILL be blocked from creating one afterwards. A brand-new fighter about to
 * create their first (onboarding) camp ALSO has zero camps. The two are
 * indistinguishable by count — so the discriminator is whether the request is
 * the blessed onboarding auto-create (`isOnboarding`), gated by a persistent
 * lifetime counter so the flag can only ever unlock the single first camp.
 *
 * The server is authoritative. The client gate (ProUpsellScreen at the
 * post-onboarding entry points) is just the front door.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { effectiveTier } from "./tier";

/**
 * DEV-ONLY paywall bypass — mirrors `featureGates.ts`'s guard so the full Pro
 * surface is testable on the dev deployment without a real subscription. Set
 * ONLY on dev: `npx convex env set DEV_GATE_BYPASS true`. Never in prod.
 */
function devGateBypassEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    !!process.env &&
    process.env.DEV_GATE_BYPASS === "true"
  );
}

/**
 * Enforce the free-tier camp limit before a `fight_camps` insert.
 *
 * Throws `Error("PRO_FEATURE_REQUIRED:MULTIPLE_FIGHT_CAMPS")` when a free
 * user is not allowed to create the camp. Pro users always pass.
 *
 * A free user is allowed ONLY when `opts.isOnboarding === true` AND they have
 * never created a camp before (`priorUsage === 0`). `priorUsage` is the max
 * of the persisted `campsCreatedCount` and the live camp-row count — the
 * row-count fallback correctly gates grandfathered users who created a camp
 * before `campsCreatedCount` existed.
 *
 * @returns `priorUsage` so the caller can set `campsCreatedCount` to
 *          `priorUsage + 1` after a successful insert.
 */
export async function assertCanCreateCamp(
  ctx: MutationCtx,
  userId: Id<"users">,
  opts: { isOnboarding: boolean },
): Promise<number> {
  // Dev short-circuit: still report a sane priorUsage so the counter stays
  // monotonic, but never throw.
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  // Bounded scan: most users have a handful of camps. `take(2)` is enough to
  // distinguish "0 camps" from "1+ camps"; we don't need an exact count for
  // the gate, only the persisted counter for the post-insert increment.
  const someCamps = await ctx.db
    .query("fight_camps")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(2);
  const persisted = profile?.campsCreatedCount ?? 0;
  const priorUsage = Math.max(persisted, someCamps.length);

  if (devGateBypassEnabled()) return priorUsage;
  if (effectiveTier(profile) === "pro") return priorUsage;

  // Free user: the single blessed camp is the onboarding auto-create, and
  // only when they've never created one before.
  if (opts.isOnboarding && priorUsage === 0) return priorUsage;

  throw new Error("PRO_FEATURE_REQUIRED:MULTIPLE_FIGHT_CAMPS");
}

/**
 * After a successful `fight_camps` insert, advance the lifetime counter.
 * Pass the `priorUsage` returned by {@link assertCanCreateCamp} so the value
 * stays monotonic even for grandfathered users (whose persisted counter was
 * behind their real row count).
 */
export async function bumpCampsCreatedCount(
  ctx: MutationCtx,
  userId: Id<"users">,
  priorUsage: number,
): Promise<void> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!profile) return; // No profile row — nothing to write the counter onto.
  await ctx.db.patch(profile._id, { campsCreatedCount: priorUsage + 1 });
}
