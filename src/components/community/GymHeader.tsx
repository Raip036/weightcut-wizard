/**
 * Page-level header for the Corner tab.
 *
 * Anchored at the top of the Community page beneath the iOS safe-area
 * inset. Two visual blocks:
 *
 *   - Left: gym name (22pt semibold) + member-count subtitle (text-sm
 *     muted, e.g. "37 members · 12 training this week"). Subtitle uses
 *     a skeleton while the count query is in flight so we don't flash a
 *     placeholder.
 *
 *   - Right: "Bring a teammate" pill button. The pill is a `glass-card`
 *     so it inherits the same blur/border treatment as every other
 *     surface on the page — keeping the visual language consistent
 *     across the tab.
 *
 * Member count + active-poster count come from the backend
 * `api.gyms.getMemberCount` query (added in a parallel PR). Until that
 * query lands the subtitle simply stays in skeleton state; never
 * crashes the page.
 */
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";
import { ActivityBell } from "./ActivityBell";

interface GymHeaderProps {
  gymName: string;
  /**
   * Identifier for the active gym. Optional because `Community.tsx` may
   * not have resolved it yet on first paint — when absent we skip the
   * member-count query and degrade to the bare header.
   */
  gymId?: Id<"gyms"> | null;
  /**
   * Legacy prop — used to be the caller-computed teammate count. The
   * subtitle now reads `api.gyms.getMemberCount` directly, but we keep
   * the prop accepted-but-ignored so existing call sites compile during
   * the parallel-PR transition window.
   */
  memberCount?: number | null;
  onInviteClick: () => void;
  onActivityClick: () => void;
  /**
   * Resolved logo URL for the active gym (already resolved server-side via
   * Convex File Storage). Optional — when absent or null, GymLogoAvatar
   * falls back to a single-letter avatar derived from `gymName`.
   */
  logoUrl?: string | null;
  /**
   * Tap handler for the gym title cluster (logo + name + counts). Opens
   * the GymProfileSheet. Optional — when omitted, the cluster renders as
   * a non-interactive div so existing call sites keep working.
   */
  onProfileOpen?: () => void;
}

interface MemberCountResult {
  memberCount: number;
  activePosters7d: number;
  /** Invite code is intentionally optional on the server side — coaches
   *  see it, randoms don't. We only render it when present. */
  inviteCode?: string | null;
}

/**
 * Resolve the `api.gyms.getMemberCount` reference at runtime. The
 * generated `api` typings may not yet include the function while the
 * backend PR is in flight; we read it through an `unknown`-typed proxy
 * so this file still compiles strictly.
 */
function getMemberCountRef(): Parameters<typeof useQuery>[0] | null {
  const gyms = api.gyms as unknown as Record<
    string,
    Parameters<typeof useQuery>[0] | undefined
  >;
  return gyms["getMemberCount"] ?? null;
}

export function GymHeader({
  gymName,
  gymId,
  // memberCount is intentionally destructured-and-ignored to preserve
  // the legacy call signature. Subtitle reads the live server count.
  memberCount: _memberCount,
  // onInviteClick retained on the prop contract for backwards compat,
  // but the inline pill it powered has been removed from this header.
  // The invite affordance now lives on the EmptyFeed card only.
  onInviteClick: _onInviteClick,
  onActivityClick,
  logoUrl,
  onProfileOpen,
}: GymHeaderProps) {
  void _memberCount;
  void _onInviteClick;

  // Always call the hook (rules-of-hooks) — fall back to an already-deployed
  // query ref + a "skip" sentinel so the call is a no-op when either
  // the backend isn't ready or `gymId` is null.
  const queryRef = getMemberCountRef();
  const refForCall = (queryRef ??
    api.gyms.getById) as Parameters<typeof useQuery>[0];
  const args = queryRef && gymId ? { gymId } : "skip";
  const countRaw = useQuery(refForCall, args) as
    | MemberCountResult
    | null
    | undefined;
  // `undefined` from the query means "not loaded yet"; treat the
  // "no ref + skipped" combo as not-loaded so the skeleton shows once
  // and the consumer never sees garbage.
  const memberData = queryRef ? countRaw : undefined;

  // `null` is the server's "not a member of this gym" sentinel. Render
  // without the count subtitle but never crash the page.
  const isLoading = memberData === undefined;
  const hasCounts = memberData != null;
  const memberCount = memberData?.memberCount ?? 0;
  const activePosters = memberData?.activePosters7d ?? 0;

  // The left cluster (logo + title + counts) is the tap target that opens
  // the gym profile sheet. When `onProfileOpen` is supplied we render it as
  // a <button>; otherwise we fall back to a plain <div> so non-interactive
  // call sites keep their non-clickable header. ActivityBell sits as a
  // sibling so we never nest <button>s.
  const clusterContent = (
    <>
      <GymLogoAvatar logoUrl={logoUrl ?? null} name={gymName} size={48} />
      <div className="flex-1 min-w-0">
        <h1 className="text-[19px] font-bold leading-tight tracking-[-0.01em] truncate">
          {gymName}
        </h1>
        {isLoading ? (
          <div className="mt-1.5">
            <Skeleton className="h-3.5 w-40" />
          </div>
        ) : hasCounts ? (
          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center gap-1">
              {/* live dot — signals the gym is active this week */}
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.16)]"
              />
              <span className="tabular-nums text-foreground/80 font-medium">
                {activePosters} training this week
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <header className="px-5 pt-1 pb-3">
      {/* Premium identity card — gradient wash + radial primary glow so
          the gym reads as the page's anchor, not just a text row. */}
      <div className="relative flex items-center justify-between gap-2 overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-white/[0.045] to-white/[0.01] p-3.5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120px 80px at 90% -10%, hsl(217 91% 58% / 0.16), transparent 70%)",
          }}
        />
        {onProfileOpen ? (
          <button
            type="button"
            onClick={onProfileOpen}
            className="relative z-[1] flex-1 min-w-0 flex items-center gap-3 text-left active:opacity-80 transition-opacity"
            aria-label={`Open ${gymName} profile`}
          >
            {clusterContent}
          </button>
        ) : (
          <div className="relative z-[1] flex-1 min-w-0 flex items-center gap-3">
            {clusterContent}
          </div>
        )}

        {/* Right-side: activity bell only. The "Bring a teammate" pill
            has been removed from this header — invites live on the
            EmptyFeed card now. */}
        <div className="relative z-[1] flex items-center gap-2 flex-shrink-0">
          <ActivityBell gymId={gymId ?? null} onClick={onActivityClick} />
        </div>
      </div>
    </header>
  );
}
