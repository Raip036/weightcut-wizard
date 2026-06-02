/**
 * Session info card — the glass card that sits under the polaroid
 * stack and binds to whatever post is currently on top.
 *
 * Why this is a separate component (vs. baking the metadata into the
 * polaroid frame): real polaroids don't have call-to-action buttons.
 * Keeping the polaroid pure-photo lets the gesture feel sacred (you
 * flick a polaroid, not a UI surface). All the interactive affordances
 * — like, comment, author tap-through — live one container below in
 * the standard app chrome.
 *
 * Engagement state is passed in via the `engagement` prop so the
 * glove-tap (on the polaroid) and the heart-tap (on this card) share
 * exactly one source of truth per post. The page component owns the
 * `useFeedEngagement` hook and threads it through — instantiating it
 * twice for the same post would split the optimistic state and let
 * the two surfaces drift apart between renders.
 */
import { Activity, Hand, Heart, Lock, MessageCircle, Scale, Swords, TrendingDown, Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FeedPost } from "@/hooks/community/useGymFeed";
import type { UseFeedEngagementResult } from "@/hooks/useFeedEngagement";
import type { Id } from "../../../convex/_generated/dataModel";
import { streakRingClass, streakEmoji } from "./PolaroidCard";

const INLINE_COMMENT_PREVIEW_LIMIT = 2;

interface SessionInfoCardProps {
  post: FeedPost;
  /** Shared engagement state — owned by the page, threaded here so
   *  double-tap on the polaroid and heart-tap on this card hit the
   *  same optimistic mirror. */
  engagement: UseFeedEngagementResult;
  /** Open the comments sheet for this post. */
  onCommentTap: (postId: Id<"session_media">, currentCount: number) => void;
  /** Tap the avatar / name → profile route. */
  onProfileTap: (userId: Id<"users">) => void;
  /**
   * Legacy boolean override — when present, takes precedence over the
   * server-supplied `post.visibility`. The feed query already filters
   * private posts unless you're the owner so the icon only ever appears
   * on the viewer's own private rows in practice.
   */
  isPrivate?: boolean;
}

export function SessionInfoCard({
  post,
  engagement,
  onCommentTap,
  onProfileTap,
  isPrivate,
}: SessionInfoCardProps) {
  // Server is the source of truth for visibility. The legacy `isPrivate`
  // prop still wins if a caller explicitly passes it (during the
  // transition to the new field) — otherwise we read `post.visibility`,
  // which lands on every row from `gymFeed.listFeed` / `listProfilePosts`.
  const postVisibility = (post as FeedPost & {
    visibility?: "gym" | "private";
  }).visibility;
  const showLock = isPrivate ?? postVisibility === "private";


  const TypeIcon = SESSION_TYPE_ICON[post.session?.sessionType?.toLowerCase() ?? ""] ?? Swords;
  const typeLabel = formatSessionType(post.session?.sessionType);
  // OPTIONAL activity descriptor (Sparring, Strength, …). Lands on the
  // session via migrate-on-read; read defensively so the type stays additive.
  const sessionTag = (post.session as { sessionTag?: string | null } | null | undefined)?.sessionTag;

  // Instagram-style inline preview: latest 2 comments under the engagement
  // row. Only this card (the top of the polaroid stack) is mounted, so we
  // don't spawn N reactive subscriptions for cards below. The query is
  // independent of `listFeed` — new comments re-emit only this slice so
  // the preview animates in without disturbing the deck.
  const latestComments = useQuery(api.feedSocial.listLatestComments, {
    postId: post.id,
    limit: INLINE_COMMENT_PREVIEW_LIMIT,
  });
  const previewRows = latestComments?.rows ?? [];
  const totalCommentCount = Math.max(
    latestComments?.totalCount ?? 0,
    engagement.commentCount,
  );
  const hasOverflow = totalCommentCount > previewRows.length;

  return (
    <section className="glass-card rounded-xs border border-border/50 p-4">
      {/* Header row: training-type chip */}
      <div className="flex items-center gap-2 mb-3">
        <span className="h-7 rounded-full px-3 text-xs font-medium bg-foreground/[0.06] dark:bg-white/[0.08] inline-flex items-center gap-1.5">
          <TypeIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
          {typeLabel}
        </span>
        {sessionTag && (
          <span className="h-7 rounded-full px-2.5 text-[11px] font-medium bg-muted/40 text-muted-foreground inline-flex items-center">
            {sessionTag}
          </span>
        )}
        {post.session && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {post.session.durationMinutes} min · RPE {post.session.rpe}
          </span>
        )}
      </div>

      {/* Caption — 2-line clamp. The polaroid carries the date in its
          caption strip, so we don't repeat it here. */}
      {post.caption && (
        <p className="text-[14px] leading-snug text-foreground line-clamp-2 mb-3">
          {post.caption}
        </p>
      )}

      {/* Bottom row: author (left) · engagement (right). Tap targets
          are visually 20px but the parent buttons are 44px so iOS HIG
          minimum hit-target is honoured. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onProfileTap(post.author.userId)}
          className="flex items-center gap-2 min-w-0 -ml-1.5 px-1.5 py-1 rounded-xs active:bg-muted/40 transition-colors"
        >
          {post.author.avatarUrl ? (
            <img
              src={post.author.avatarUrl}
              alt=""
              className={`h-7 w-7 rounded-full object-cover shrink-0 ${(post.author.streakDays ?? 0) >= 7 ? streakRingClass(post.author.streakDays ?? 0) : ""}`}
            />
          ) : (
            <div className={`h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold shrink-0 ${(post.author.streakDays ?? 0) >= 7 ? streakRingClass(post.author.streakDays ?? 0) : ""}`}>
              {post.author.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="text-[13px] font-medium truncate">
            {post.author.displayName}
          </span>
          {(post.author.streakDays ?? 0) >= 7 && (
            <span
              aria-label={`${post.author.streakDays}-day streak`}
              className="text-[11px] leading-none shrink-0"
              title={`${post.author.streakDays}-day training streak`}
            >
              {streakEmoji(post.author.streakDays ?? 0)}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            · {shortRelative(post.createdAt)}
          </span>
          {showLock && (
            <Lock
              aria-label="Visible to you only"
              // Spec'd at 12px next to the relative-time text.
              className="h-3 w-3 text-muted-foreground shrink-0"
              strokeWidth={2.4}
            />
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <EngagementButton
            ariaLabel={engagement.liked ? "Unlike post" : "Like post"}
            count={engagement.likeCount}
            onTap={engagement.toggleLike}
            burstKey={engagement.burstKey}
          >
            <Heart
              className={`h-5 w-5 transition-colors ${engagement.liked ? "fill-func-danger-red text-func-danger-red" : "text-foreground"}`}
              strokeWidth={2.2}
            />
          </EngagementButton>

          <EngagementButton
            ariaLabel="Open comments"
            count={engagement.commentCount}
            onTap={() => onCommentTap(post.id, engagement.commentCount)}
          >
            <MessageCircle className="h-5 w-5 text-foreground" strokeWidth={2.2} />
          </EngagementButton>
        </div>
      </div>

      {/* Instagram-style inline comment preview. Renders only when there
          is at least one comment so empty cards stay tall-target-friendly
          for the polaroid flick. "View all" jumps into the existing
          CommentsSheet via the same handler the comment icon uses. */}
      {previewRows.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40 space-y-1">
          {hasOverflow && (
            <button
              type="button"
              onClick={() => onCommentTap(post.id, totalCommentCount)}
              className="text-[12px] text-muted-foreground active:text-foreground transition-colors"
            >
              View all {totalCommentCount} comments
            </button>
          )}
          <AnimatePresence initial={false}>
            {previewRows.map((c) => (
              <motion.button
                key={c.id}
                type="button"
                onClick={() => onCommentTap(post.id, totalCommentCount)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="block w-full text-left text-[13px] leading-snug truncate"
              >
                <span className="font-semibold text-foreground">{c.author.displayName}</span>{" "}
                <span className="text-foreground/85">{c.body}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

/* ─── engagement button ─── */

interface EngagementButtonProps {
  ariaLabel: string;
  count: number;
  onTap: () => void;
  burstKey?: number;
  children: React.ReactNode;
}

function EngagementButton({ ariaLabel, count, onTap, burstKey, children }: EngagementButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onTap}
      className="relative h-11 min-w-11 px-2 flex items-center gap-1 rounded-xs active:bg-muted/40 transition-colors"
    >
      {children}
      <span className="text-[12px] font-medium tabular-nums">{count}</span>
      {/* Like burst — tiny scale pop when the count flips up. */}
      {burstKey !== undefined && burstKey > 0 && (
        <AnimatePresence>
          <motion.span
            key={burstKey}
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-start pl-2 pointer-events-none"
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
          >
            <Heart className="h-5 w-5 fill-func-danger-red/30 text-func-danger-red/40" strokeWidth={0} />
          </motion.span>
        </AnimatePresence>
      )}
    </button>
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
  // Capitalise + replace underscores so "weigh_in" → "Weigh in".
  const cleaned = t.replace(/[_-]+/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function shortRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
