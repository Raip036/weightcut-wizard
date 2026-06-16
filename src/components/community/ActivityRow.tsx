import { formatDistanceToNow } from "date-fns";
import type { FunctionReturnType } from "convex/server";
import { Heart, MessageCircle, UserPlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { reactionEmoji } from "./reactionEmoji";

type ListResult = FunctionReturnType<typeof api.feedActivity.listActivity>;
type ActivityItem = ListResult["items"][number];

type LikeGroup = Extract<ActivityItem, { kind: "likes" }>;
type CommentItem = Extract<ActivityItem, { kind: "comment" }>;
type ReactionGroup = Extract<ActivityItem, { kind: "reactions" }>;
type MemberJoined = Extract<ActivityItem, { kind: "member_joined" }>;
type ActorBrief = LikeGroup["actors"][number];

interface ActivityRowProps {
  item: ActivityItem;
  isUnread: boolean;
  /** Whole-row tap — the sheet decides routing. */
  onTap: () => void;
  /** Avatar tap → view that actor's profile. */
  onOpenProfile: (userId: Id<"users">) => void;
}

export function ActivityRow({ item, isUnread, onTap, onOpenProfile }: ActivityRowProps) {
  switch (item.kind) {
    case "likes":
      return (
        <LikesRow
          item={item}
          isUnread={isUnread}
          onTap={onTap}
          onOpenProfile={onOpenProfile}
        />
      );
    case "comment":
      return (
        <CommentRow
          item={item}
          isUnread={isUnread}
          onTap={onTap}
          onOpenProfile={onOpenProfile}
        />
      );
    case "reactions":
      return (
        <ReactionsRow
          item={item}
          isUnread={isUnread}
          onTap={onTap}
          onOpenProfile={onOpenProfile}
        />
      );
    case "member_joined":
      return (
        <MemberJoinedRow
          item={item}
          isUnread={isUnread}
          onTap={onTap}
          onOpenProfile={onOpenProfile}
        />
      );
  }
}

/* ─── Text helpers ─── */

/** Build the leading actor phrase (e.g. "Sam", "Sam and Alex", "Sam and 3 others"). */
function actorPhrase(actors: ActorBrief[], totalCount: number): string {
  const names = actors.map((a) => a.displayName);
  const moreCount = totalCount - actors.length;

  let prefix: string;
  if (names.length === 1) {
    prefix = names[0];
  } else if (names.length === 2) {
    prefix = `${names[0]} and ${names[1]}`;
  } else {
    prefix = `${names[0]}, ${names[1]}`;
  }

  if (moreCount > 0) {
    prefix = `${prefix} and ${moreCount} other${moreCount === 1 ? "" : "s"}`;
  } else if (names.length === 3) {
    prefix = `${names[0]}, ${names[1]} and ${names[2]}`;
  }

  return prefix;
}

function formatLikeText(item: LikeGroup): string {
  return `${actorPhrase(item.actors, item.totalCount)} liked your post`;
}

function formatReactionText(item: ReactionGroup): string {
  return `${actorPhrase(item.actors, item.totalCount)} reacted`;
}

function timeAgo(ts: number): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

/* ─── Avatar primitives ─── */

function AvatarCircle({ actor, size = 36 }: { actor: ActorBrief; size?: number }) {
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

function AvatarStack({ actors, size = 36 }: { actors: ActorBrief[]; size?: number }) {
  const shown = actors.slice(0, 3);
  const step = Math.round(size * 0.62);
  return (
    <div className="relative flex" style={{ width: size + (shown.length - 1) * step, height: size }}>
      {shown.map((actor, i) => (
        <div
          key={actor.userId}
          className="absolute top-0"
          style={{ left: i * step, zIndex: shown.length - i }}
        >
          <div className="rounded-full ring-2 ring-background">
            <AvatarCircle actor={actor} size={size} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Type-icon badge config per activity kind. */
const TYPE_BADGE = {
  likes: { tint: "bg-destructive text-white", icon: <Heart className="h-2.5 w-2.5" strokeWidth={2.6} fill="currentColor" /> },
  comment: { tint: "bg-primary text-primary-foreground", icon: <MessageCircle className="h-2.5 w-2.5" strokeWidth={2.6} /> },
  member_joined: { tint: "bg-func-recovery-green text-white", icon: <UserPlus className="h-2.5 w-2.5" strokeWidth={2.6} /> },
} as const;

/**
 * Avatar (single or stacked) with a 16px type-icon badge overlapping the
 * bottom-right corner. The badge tap is delegated to the row; the avatar
 * itself opens the actor's profile (stopPropagation to avoid double-firing).
 */
function BadgedAvatar({
  actors,
  kind,
  emojiKey,
  size,
  onOpenProfile,
}: {
  actors: ActorBrief[];
  kind: ActivityItem["kind"];
  emojiKey?: string;
  size: number;
  onOpenProfile: (userId: Id<"users">) => void;
}) {
  const primary = actors[0];
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`View ${primary?.displayName ?? "athlete"}'s profile`}
      onClick={(e) => {
        e.stopPropagation();
        if (primary) onOpenProfile(primary.userId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (primary) onOpenProfile(primary.userId);
        }
      }}
      className="relative inline-flex flex-shrink-0 outline-none [-webkit-tap-highlight-color:transparent] active:opacity-80"
    >
      {actors.length > 1 ? (
        <AvatarStack actors={actors} size={size} />
      ) : (
        <AvatarCircle actor={primary} size={size} />
      )}

      {/* Type badge */}
      {kind === "reactions" ? (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card text-[10px] leading-none ring-2 ring-background"
        >
          {reactionEmoji(emojiKey ?? "")}
        </span>
      ) : (
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-background ${TYPE_BADGE[kind].tint}`}
        >
          {TYPE_BADGE[kind].icon}
        </span>
      )}
    </span>
  );
}

/* ─── Post thumbnail ─── */

function PostThumb({ thumbUrl, thumbDataUrl }: { thumbUrl: string | null; thumbDataUrl: string | null }) {
  const src = thumbUrl ?? thumbDataUrl;
  if (!src) {
    return <div className="w-11 h-11 rounded-md bg-muted flex-shrink-0 border border-border/20" />;
  }
  return (
    <img
      src={src}
      alt="Post thumbnail"
      className="w-11 h-11 rounded-md object-cover flex-shrink-0 border border-border/20"
    />
  );
}

/* ─── Shared row shell ─── */

function RowShell({
  isUnread,
  onTap,
  avatar,
  children,
  trailing,
}: {
  isUnread: boolean;
  onTap: () => void;
  avatar: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={`relative w-full flex items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99] ${
        isUnread ? "bg-primary/[0.04]" : ""
      }`}
    >
      {/* Unread dot at the leading edge */}
      {isUnread && (
        <span
          aria-label="Unread"
          className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[7px] w-[7px] rounded-full bg-primary"
        />
      )}

      {avatar}

      <div className="flex-1 min-w-0">{children}</div>

      {trailing}
    </button>
  );
}

/** Two-line text body: sentence + relative time. */
function RowText({ children, ts }: { children: React.ReactNode; ts: number }) {
  return (
    <>
      <p className="text-sm leading-snug line-clamp-2 text-foreground">{children}</p>
      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{timeAgo(ts)}</p>
    </>
  );
}

/* ─── Likes row ─── */

function LikesRow({
  item,
  isUnread,
  onTap,
  onOpenProfile,
}: {
  item: LikeGroup;
  isUnread: boolean;
  onTap: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
}) {
  return (
    <RowShell
      isUnread={isUnread}
      onTap={onTap}
      avatar={
        <BadgedAvatar actors={item.actors} kind="likes" size={36} onOpenProfile={onOpenProfile} />
      }
      trailing={<PostThumb thumbUrl={item.post.thumbUrl} thumbDataUrl={item.post.thumbDataUrl} />}
    >
      <RowText ts={item.ts}>
        <span className="font-semibold">{actorPhrase(item.actors, item.totalCount)}</span> liked your post
      </RowText>
    </RowShell>
  );
}

/* ─── Comment row ─── */

function CommentRow({
  item,
  isUnread,
  onTap,
  onOpenProfile,
}: {
  item: CommentItem;
  isUnread: boolean;
  onTap: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
}) {
  return (
    <RowShell
      isUnread={isUnread}
      onTap={onTap}
      avatar={
        <BadgedAvatar actors={[item.actor]} kind="comment" size={36} onOpenProfile={onOpenProfile} />
      }
      trailing={<PostThumb thumbUrl={item.post.thumbUrl} thumbDataUrl={item.post.thumbDataUrl} />}
    >
      <RowText ts={item.ts}>
        <span className="font-semibold">{item.actor.displayName}</span>{" "}
        <span className="text-muted-foreground">{item.bodyPreview}</span>
      </RowText>
    </RowShell>
  );
}

/* ─── Reactions row ─── */

function ReactionsRow({
  item,
  isUnread,
  onTap,
  onOpenProfile,
}: {
  item: ReactionGroup;
  isUnread: boolean;
  onTap: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
}) {
  return (
    <RowShell
      isUnread={isUnread}
      onTap={onTap}
      avatar={
        <BadgedAvatar
          actors={item.actors}
          kind="reactions"
          emojiKey={item.emojiKey}
          size={36}
          onOpenProfile={onOpenProfile}
        />
      }
      trailing={<PostThumb thumbUrl={item.post.thumbUrl} thumbDataUrl={item.post.thumbDataUrl} />}
    >
      <RowText ts={item.ts}>
        <span className="font-semibold">{actorPhrase(item.actors, item.totalCount)}</span> reacted{" "}
        <span aria-hidden>{reactionEmoji(item.emojiKey)}</span>
      </RowText>
    </RowShell>
  );
}

/* ─── Member-joined row ─── */

function MemberJoinedRow({
  item,
  isUnread,
  onTap,
  onOpenProfile,
}: {
  item: MemberJoined;
  isUnread: boolean;
  onTap: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
}) {
  return (
    <RowShell
      isUnread={isUnread}
      onTap={onTap}
      avatar={
        // No post thumbnail for this kind — give the avatar a touch more presence.
        <BadgedAvatar
          actors={[item.actor]}
          kind="member_joined"
          size={42}
          onOpenProfile={onOpenProfile}
        />
      }
    >
      <RowText ts={item.ts}>
        <span className="font-semibold">{item.actor.displayName}</span> joined your gym
      </RowText>
    </RowShell>
  );
}
