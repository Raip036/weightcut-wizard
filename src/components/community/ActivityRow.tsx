import { formatDistanceToNow } from "date-fns";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";

type Activity = FunctionReturnType<typeof api.feedActivity.listActivity>;
type ActivityItem = Activity[number];
type LikeGroup = Extract<ActivityItem, { kind: "likes" }>;
type CommentItem = Extract<ActivityItem, { kind: "comment" }>;
type ActorBrief = LikeGroup["actors"][number];

interface ActivityRowProps {
  item: ActivityItem;
  onTap: () => void;
}

export function ActivityRow({ item, onTap }: ActivityRowProps) {
  if (item.kind === "likes") {
    return <LikesRow item={item} onTap={onTap} />;
  }
  return <CommentRow item={item} onTap={onTap} />;
}

/* ─── Helpers ─── */

function formatLikeText(item: LikeGroup): string {
  const names = item.actors.map((a) => a.displayName);
  const moreCount = item.totalCount - item.actors.length;
  let prefix: string;
  if (names.length === 1) {
    prefix = names[0];
  } else if (names.length === 2) {
    prefix = `${names[0]} and ${names[1]}`;
  } else {
    // 3 actors shown
    prefix = `${names[0]}, ${names[1]}`;
  }

  if (moreCount > 0) {
    prefix = `${prefix} and ${moreCount} other${moreCount === 1 ? "" : "s"}`;
  } else if (names.length === 3) {
    prefix = `${names[0]}, ${names[1]} and ${names[2]}`;
  }

  return `${prefix} liked your post`;
}

function timeAgo(ts: number): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

function AvatarCircle({ actor, size = 32 }: { actor: ActorBrief; size?: number }) {
  const initial = actor.displayName.charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full flex-shrink-0 bg-muted flex items-center justify-center overflow-hidden border border-border/30"
      style={{ width: size, height: size }}
    >
      {actor.avatarUrl ? (
        <img
          src={actor.avatarUrl}
          alt={actor.displayName}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-xs font-semibold text-muted-foreground select-none">
          {initial}
        </span>
      )}
    </div>
  );
}

function AvatarStack({ actors }: { actors: ActorBrief[] }) {
  const shown = actors.slice(0, 3);
  return (
    <div className="relative flex" style={{ width: 32 + (shown.length - 1) * 22 }}>
      {shown.map((actor, i) => (
        <div
          key={actor.userId}
          className="absolute"
          style={{ left: i * 22, zIndex: shown.length - i }}
        >
          <AvatarCircle actor={actor} size={32} />
        </div>
      ))}
    </div>
  );
}

function PostThumb({ thumbUrl, thumbDataUrl }: { thumbUrl: string | null; thumbDataUrl: string | null }) {
  const src = thumbUrl ?? thumbDataUrl;
  if (!src) {
    return (
      <div className="w-10 h-10 rounded-xs bg-muted flex-shrink-0 border border-border/20" />
    );
  }
  return (
    <img
      src={src}
      alt="Post thumbnail"
      className="w-10 h-10 rounded-xs object-cover flex-shrink-0 border border-border/20"
    />
  );
}

/* ─── Likes row ─── */

function LikesRow({ item, onTap }: { item: LikeGroup; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full flex items-center gap-3 px-4 py-3 text-left active:scale-[0.99] transition-transform"
    >
      {/* Overlapping avatars */}
      <div className="flex-shrink-0" style={{ minWidth: 32 + (Math.min(item.actors.length, 3) - 1) * 22 }}>
        <AvatarStack actors={item.actors} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug line-clamp-2">
          {formatLikeText(item)}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timeAgo(item.latestAt)}
        </p>
      </div>

      {/* Post thumbnail */}
      <PostThumb thumbUrl={item.post.thumbUrl} thumbDataUrl={item.post.thumbDataUrl} />
    </button>
  );
}

/* ─── Comment row ─── */

function CommentRow({ item, onTap }: { item: CommentItem; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full flex items-center gap-3 px-4 py-3 text-left active:scale-[0.99] transition-transform"
    >
      {/* Single avatar */}
      <AvatarCircle actor={item.actor} size={32} />

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug line-clamp-2">
          <span className="font-semibold">{item.actor.displayName}</span>
          {" "}
          <span className="text-muted-foreground">{item.bodyPreview}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timeAgo(item.createdAt)}
        </p>
      </div>

      {/* Post thumbnail */}
      <PostThumb thumbUrl={item.post.thumbUrl} thumbDataUrl={item.post.thumbDataUrl} />
    </button>
  );
}
