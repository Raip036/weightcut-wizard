/**
 * Session info block — sits DIRECTLY under the photo deck and binds to
 * whatever post is currently on top.
 *
 * Layout (top → bottom), tuned so comments read on first glance:
 *   1. Inline row: session-type chip (icon + label + duration/RPE) on the
 *      left, INLINE with the latest-comment preview + count on the right.
 *      Tapping the comment opens the comments sheet.
 *   2. Caption (if present) — 2-line clamp. The photo no longer bakes the
 *      caption in (the deck passes `hideCaption`) so it lives here, clear
 *      of the floating heart button.
 *   3. Quick-react emoji bar.
 *   4. Comment input.
 *
 * Like state lives on the photo's floating heart (and shares this card's
 * `engagement` mirror), so there is no separate heart button here — just
 * the social context + the ways to add to it.
 *
 * Engagement state is passed in via `engagement` so the heart-tap on the
 * photo and any mutation here share exactly one optimistic source of truth
 * per post (the page owns the `useFeedEngagement` hook and threads it).
 */
import { Activity, Hand, Lock, Scale, Swords, TrendingDown, Zap } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FeedPost } from "@/hooks/community/useGymFeed";
import type { UseFeedEngagementResult } from "@/hooks/useFeedEngagement";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmojiReactionBar } from "./EmojiReactionBar";
import { CommentInputBar } from "./CommentInputBar";

interface SessionInfoCardProps {
  post: FeedPost;
  /** Shared engagement state — owned by the page, threaded here so the
   *  photo's floating heart and this card hit the same optimistic mirror. */
  engagement: UseFeedEngagementResult;
  /** Open the comments sheet for this post. */
  onCommentTap: (postId: Id<"session_media">, currentCount: number) => void;
  /** Tap the latest-comment author → profile route. */
  onProfileTap: (userId: Id<"users">) => void;
  /** Place a reaction (ASCII slug) on the post. */
  onReact: (key: string) => void;
  /** Submit a comment on the post. */
  onSubmitComment: (text: string) => Promise<void> | void;
  /**
   * Legacy boolean override — when present, takes precedence over the
   * server-supplied `post.visibility`.
   */
  isPrivate?: boolean;
}

export function SessionInfoCard({
  post,
  engagement,
  onCommentTap,
  onReact,
  onSubmitComment,
  isPrivate,
}: SessionInfoCardProps) {
  const postVisibility = (post as FeedPost & {
    visibility?: "gym" | "private";
  }).visibility;
  const showLock = isPrivate ?? postVisibility === "private";

  const TypeIcon = SESSION_TYPE_ICON[post.session?.sessionType?.toLowerCase() ?? ""] ?? Swords;
  const typeLabel = formatSessionType(post.session?.sessionType);
  const sessionTag = (post.session as { sessionTag?: string | null } | null | undefined)?.sessionTag;

  // Latest comment preview — single line, inline with the session chip.
  const latestComments = useQuery(api.feedSocial.listLatestComments, {
    postId: post.id,
    limit: 1,
  });
  const latest = latestComments?.rows?.[0];
  const totalCommentCount = Math.max(
    latestComments?.totalCount ?? 0,
    engagement.commentCount,
  );

  // Muted meta tail: optional activity tag · duration · RPE.
  const metaParts: string[] = [];
  if (sessionTag) metaParts.push(sessionTag);
  if (post.session) metaParts.push(`${post.session.durationMinutes}m`, `RPE ${post.session.rpe}`);
  const metaTail = metaParts.join(" · ");

  return (
    <section className="space-y-2.5">
      {/* Row 1: session type INLINE with the latest comment. */}
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 inline-flex items-center gap-1.5 h-8 rounded-full px-3 text-xs font-medium bg-foreground/[0.06] dark:bg-white/[0.08]">
          <TypeIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
          {typeLabel}
          {showLock && <Lock className="h-3 w-3 text-muted-foreground" strokeWidth={2.4} aria-label="Visible to you only" />}
        </span>
        {metaTail && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums -ml-1">
            {metaTail}
          </span>
        )}

        <button
          type="button"
          onClick={() => onCommentTap(post.id, totalCommentCount)}
          className="flex-1 min-w-0 text-left rounded-xs px-1 py-1 -mx-1 active:bg-muted/40 transition-colors"
        >
          {latest ? (
            <span className="block truncate text-[13px] leading-snug">
              <span className="font-semibold text-foreground">{latest.author.displayName}</span>{" "}
              <span className="text-foreground/85">{latest.body}</span>
              {totalCommentCount > 1 && (
                <span className="text-muted-foreground"> · {totalCommentCount}</span>
              )}
            </span>
          ) : (
            <span className="block truncate text-[13px] text-muted-foreground">
              Be the first to comment
            </span>
          )}
        </button>
      </div>

      {/* Caption (moved off the photo so it clears the heart button). */}
      {post.caption && (
        <p className="text-[14px] leading-snug text-foreground line-clamp-2 px-0.5">
          {post.caption}
        </p>
      )}

      {/* Quick reacts. */}
      <EmojiReactionBar
        reactionCounts={post.reactionCounts ?? {}}
        viewerReactions={post.viewerReactions ?? []}
        onReact={onReact}
      />

      {/* Comment input. */}
      <CommentInputBar onSubmit={onSubmitComment} />
    </section>
  );
}

/* ─── helpers ─── */

const SESSION_TYPE_ICON: Record<string, typeof Swords> = {
  striking: Zap,
  grappling: Hand,
  cardio: Activity,
  cut: TrendingDown,
  weighin: Scale,
  "weigh-in": Scale,
  weigh_in: Scale,
  sparring: Swords,
};

function formatSessionType(t: string | null | undefined): string {
  if (!t) return "Session";
  const cleaned = t.replace(/[_-]+/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
