/**
 * FeedRightRail: the vertical icon stack on each TikTok-style feed post.
 *
 * Stays compact intentionally: LikeButton + LikeBurst live here too
 * because they're only ever rendered inside this rail. Splitting them
 * into 3 files would buy nothing and make the gesture wiring noisier.
 *
 * Each tap fires an optimistic update via `useFeedEngagement`. The
 * parent owns the canonical state and rolls back on mutation rejection.
 * The rail just renders + dispatches.
 */
import { useEffect, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";

interface FeedRightRailProps {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  /** Increments on each successful like-on transition. Drives the heart-
   *  burst overlay's `key` so the keyframe animation re-runs. */
  burstKey: number;
  onLikeToggle: () => void;
  onOpenComments: () => void;
}

export function FeedRightRail({
  liked,
  likeCount,
  commentCount,
  burstKey,
  onLikeToggle,
  onOpenComments,
}: FeedRightRailProps) {
  return (
    <div
      className="absolute right-3 z-10 flex flex-col items-center gap-7 pointer-events-auto"
      style={{
        // Anchor above the bottom-edge metadata gradient so the lowest
        // icon clears the gradient text on any post.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 140px)",
      }}
    >
      <LikeButton liked={liked} count={likeCount} onToggle={onLikeToggle} />
      <RailButton
        icon={<MessageCircle className="h-7 w-7" strokeWidth={2} />}
        count={commentCount}
        onClick={onOpenComments}
        ariaLabel="Open comments"
      />

      {/* Center-screen heart burst overlay, driven entirely by the `key`
          remount so the CSS keyframe runs exactly once per like-on event. */}
      <LikeBurst burstKey={burstKey} />
    </div>
  );
}

/* ─── Like button ─── */

function LikeButton({
  liked,
  count,
  onToggle,
}: {
  liked: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={liked ? "Unlike" : "Like"}
      aria-pressed={liked}
      className="flex flex-col items-center gap-0.5 active:scale-90 transition-transform duration-100"
      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.55))" }}
    >
      <Heart
        className="h-7 w-7 transition-colors"
        strokeWidth={2}
        fill={liked ? "#ff2d55" : "none"}
        color={liked ? "#ff2d55" : "#ffffff"}
      />
      <span className="text-[11px] font-semibold tabular-nums text-white leading-none mt-0.5">
        {count > 0 ? formatCount(count) : ""}
      </span>
    </button>
  );
}

function RailButton({
  icon,
  count,
  onClick,
  ariaLabel,
}: {
  icon: React.ReactNode;
  count: number;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex flex-col items-center gap-0.5 active:scale-90 transition-transform duration-100 text-white"
      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.55))" }}
    >
      {icon}
      <span className="text-[11px] font-semibold tabular-nums text-white leading-none mt-0.5">
        {count > 0 ? formatCount(count) : ""}
      </span>
    </button>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/* ─── Heart burst overlay ─── */

/**
 * Self-unmounting heart-explosion overlay. The `key` prop on the parent's
 * render forces a fresh mount each time a like fires, which re-runs the
 * CSS keyframe exactly once. No React state drives the animation, it's
 * a pure CSS one-shot.
 */
function LikeBurst({ burstKey }: { burstKey: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (burstKey === 0) return; // no burst on first render
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 720);
    return () => clearTimeout(t);
  }, [burstKey]);
  if (!visible) return null;
  return (
    <div
      key={burstKey}
      aria-hidden
      className="fixed inset-0 z-[10002] pointer-events-none flex items-center justify-center"
    >
      <Heart
        className="h-24 w-24"
        strokeWidth={1.5}
        fill="#ff2d55"
        color="#ff2d55"
        style={{
          filter: "drop-shadow(0 4px 16px rgba(255,40,80,0.6))",
          animation: "likeBurst 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        }}
      />
      <style>{`
        @keyframes likeBurst {
          0%   { transform: scale(0);   opacity: 0; }
          30%  { transform: scale(1.2); opacity: 1; }
          60%  { transform: scale(1);   opacity: 1; }
          100% { transform: scale(1);   opacity: 0; }
        }
      `}</style>
    </div>
  );
}
