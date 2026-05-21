/**
 * Static "you're all caught up" card that mounts at the bottom of the
 * Polaroid swipe deck (see spec 2026-05-19-polaroid-tinder-swipe-design).
 *
 * Why this file is intentionally tiny:
 *   - PolaroidStack owns ALL motion. This component must be cheap to
 *     render — no `motion.*` wrappers, no effects, no state.
 *   - It mirrors the exact outer frame of `PolaroidCard` (white card,
 *     `p-4 pb-10 rounded-sm`, square image well) so the deck
 *     can slot it in without layout jolt when the last real post exits.
 *   - The relative-time helper (`@/lib/relativeTime`) is the same util
 *     used elsewhere (ActivityRow, etc.) — keep it consistent rather
 *     than pulling in `date-fns`'s `formatDistanceToNow` separately.
 */
import { Sparkles } from "lucide-react";
import { relativeTime } from "@/lib/relativeTime";

interface EndOfFeedCardProps {
  /** Optional ISO timestamp of when the feed was last fetched, shown as "Last update: 2h ago". */
  lastUpdated?: string;
}

export function EndOfFeedCard({ lastUpdated }: EndOfFeedCardProps): JSX.Element {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="bg-white p-4 pb-10 rounded-sm select-none">
        {/* Illustration well — mirrors PolaroidCard's `aspect-square`
            image area so the outer dimensions match exactly. */}
        <div className="relative aspect-square overflow-hidden bg-neutral-100 flex items-center justify-center">
          <Sparkles
            className="h-12 w-12 text-primary/60"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </div>

        {/* Caption strip — replaces the polaroid's date row with the
            caught-up copy. Kept centered like the original strip. */}
        <div className="mt-3 flex flex-col items-center text-center">
          <p className="text-base font-semibold text-foreground">
            You&apos;re all caught up.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            New posts will show here as your gym shares.
          </p>
          {lastUpdated && (
            <p className="text-[10px] text-muted-foreground/60 mt-2">
              Last refreshed {relativeTime(lastUpdated)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
