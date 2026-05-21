/**
 * CommentsSheet — bottom sheet that loads paginated comments for one
 * feed post and lets the viewer add new ones.
 *
 * Performance discipline:
 *   - `useQuery` is gated on `postId != null` so closed sheets fetch
 *     zero data. One post's comments at a time.
 *   - Input value lives in local component state — never in query args.
 *   - Optimistic insert on send: prepend a `pending: true` row keyed by
 *     a temp id, replaced when the server roundtrip resolves.
 *
 * iOS specifics:
 *   - The sheet is `h-[85vh]` so the input bar still has room when the
 *     keyboard is up. Capacitor's @capacitor/keyboard plugin defaults to
 *     `resize: "native"` — iOS shrinks the WKWebView above the keyboard
 *     automatically, so no manual translateY math is needed (and adding
 *     one double-shifts the input off-screen).
 *   - Long-press on a comment opens an action sheet ("Delete") only if
 *     the viewer is the comment's author OR the post's owner — the
 *     server returns `canDelete` pre-computed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";

const COMMENT_BODY_MAX = 500;
const COMMENT_PAGE_SIZE = 20;

interface CommentsSheetProps {
  postId: Id<"session_media"> | null;
  /** Total comment count from the feed row — drives the header copy
   *  before the paginated query has loaded its first page. */
  initialCount: number;
  onClose: () => void;
  /** Bumps the optimistic comment counter on the feed post. */
  onCommentAdded: () => void;
  onCommentRemoved: () => void;
}

interface DraftComment {
  id: string; // temp id (`local-${nonce}`)
  createdAt: number;
  body: string;
  authorName: string;
  authorAvatar: string | null;
  pending: true;
}

export function CommentsSheet({
  postId,
  initialCount,
  onClose,
  onCommentAdded,
  onCommentRemoved,
}: CommentsSheetProps) {
  const { toast } = useToast();
  const addCommentMut = useMutation(api.feedSocial.addComment);
  const deleteCommentMut = useMutation(api.feedSocial.deleteComment);

  // Skip the query entirely when the sheet is closed — no fetch per panel.
  const { results, status, loadMore } = usePaginatedQuery(
    api.feedSocial.listComments,
    postId ? { postId } : "skip",
    { initialNumItems: COMMENT_PAGE_SIZE },
  );

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [optimistic, setOptimistic] = useState<DraftComment[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset transient state whenever a new post is opened.
  useEffect(() => {
    if (postId === null) {
      setDraft("");
      setOptimistic([]);
      setSending(false);
    }
  }, [postId]);

  // Note: we intentionally do NOT subscribe to Capacitor's keyboard events
  // here. The plugin's default `resize: "native"` mode already shrinks the
  // WKWebView above the iOS keyboard — so the sheet's h-[85vh] + the input
  // bar's safe-area padding naturally float above it. Adding a manual
  // `translateY(--kb-h)` on top of that double-shifts the textarea above
  // the visible viewport, which is why typing appeared broken.

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!postId || !body || body.length > COMMENT_BODY_MAX || sending) return;

    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticRow: DraftComment = {
      id: tempId,
      createdAt: Date.now(),
      body,
      authorName: "You",
      authorAvatar: null,
      pending: true,
    };

    setSending(true);
    setOptimistic((prev) => [...prev, optimisticRow]);
    setDraft("");
    onCommentAdded();
    triggerHaptic(ImpactStyle.Light);

    try {
      await addCommentMut({ postId, body });
      // Server-authoritative row will arrive via the reactive useQuery.
      // Drop the optimistic stub once we know the server has the post.
      setOptimistic((prev) => prev.filter((c) => c.id !== tempId));
    } catch (err) {
      logger.warn("CommentsSheet: addComment failed", { error: err instanceof Error ? err.message : String(err) });
      setOptimistic((prev) => prev.filter((c) => c.id !== tempId));
      setDraft(body); // restore so the user can retry
      onCommentRemoved();
      toast({
        title: "Couldn't post comment",
        description: "Tap send to try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }, [draft, postId, sending, addCommentMut, onCommentAdded, onCommentRemoved, toast]);

  const handleDelete = useCallback(async (commentId: Id<"feed_comments">) => {
    triggerHapticSelection();
    onCommentRemoved();
    try {
      await deleteCommentMut({ commentId });
    } catch (err) {
      logger.warn("CommentsSheet: deleteComment failed", { error: err instanceof Error ? err.message : String(err) });
      onCommentAdded();
      toast({ title: "Couldn't delete comment", variant: "destructive" });
    }
  }, [deleteCommentMut, onCommentAdded, onCommentRemoved, toast]);

  const allRows = [...(results ?? []), ...optimistic];
  const headerCount = Math.max(initialCount, allRows.length);

  return (
    <Sheet open={postId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[85vh] rounded-t-3xl flex flex-col p-0 gap-0 [&>button]:hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/40 shrink-0">
          <SheetHeader className="flex-1 text-left space-y-0">
            <SheetTitle className="text-base font-semibold">
              {headerCount} {headerCount === 1 ? "comment" : "comments"}
            </SheetTitle>
          </SheetHeader>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="h-8 w-8 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center active:scale-90 transition-transform"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        {/* Scrollable list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2 scrollbar-hide">
          {status === "LoadingFirstPage" ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : allRows.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-[14px] text-foreground">No comments yet</p>
              <p className="text-[12px] text-muted-foreground mt-1">Be the first to say something.</p>
            </div>
          ) : (
            <ul className="space-y-3 py-2">
              {allRows.map((row) => (
                <CommentRow
                  key={row.id}
                  row={row}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
          {status === "CanLoadMore" && (
            <button
              type="button"
              onClick={() => loadMore(COMMENT_PAGE_SIZE)}
              className="w-full text-center py-3 text-[12px] font-semibold text-primary active:opacity-70"
            >
              Load older
            </button>
          )}
        </div>

        {/* Pinned input bar. Capacitor Keyboard is in `resize: "none"`
            mode app-wide (see src/main.tsx), so the WKWebView no longer
            resizes when the keyboard opens — instead we mirror the
            keyboard height into `--keyboard-inset` and reserve that
            space here so the input never sits behind the keyboard. */}
        <div
          className="border-t border-border/40 bg-background px-3 pt-2.5 shrink-0"
          style={{
            paddingBottom:
              "max(env(safe-area-inset-bottom, 0px), 12px, var(--keyboard-inset, 0px))",
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_BODY_MAX))}
              placeholder="Add a comment…"
              rows={1}
              className="flex-1 max-h-24 min-h-[40px] resize-none px-3 py-2 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/60"
              maxLength={COMMENT_BODY_MAX}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              aria-label="Send comment"
              className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-90 transition-all disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          {draft.length > COMMENT_BODY_MAX - 50 && (
            <p className="text-[10px] text-muted-foreground text-right mt-1 tabular-nums">
              {draft.length}/{COMMENT_BODY_MAX}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── One comment row ─── */

interface ServerComment {
  id: Id<"feed_comments">;
  createdAt: number;
  body: string;
  author: {
    userId: Id<"users">;
    displayName: string;
    avatarUrl: string | null;
  };
  canDelete: boolean;
}

interface CommentRowProps {
  row: ServerComment | DraftComment;
  onDelete: (id: Id<"feed_comments">) => void;
}

function CommentRow({ row, onDelete }: CommentRowProps) {
  const [pressing, setPressing] = useState(false);
  const pressTimerRef = useRef<number | null>(null);

  // Long-press → confirm-delete inline (cheaper than a full action sheet).
  // We only arm the timer if the row is deletable.
  const canDelete = "canDelete" in row ? row.canDelete : false;

  const onTouchStart = () => {
    if (!canDelete) return;
    pressTimerRef.current = window.setTimeout(() => setPressing(true), 500);
  };
  const onTouchEnd = () => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const isPending = "pending" in row;
  const displayName = "author" in row ? row.author.displayName : row.authorName;
  const avatarUrl = "author" in row ? row.author.avatarUrl : row.authorAvatar;
  const body = row.body;
  const createdAt = row.createdAt;

  return (
    <li
      className="flex gap-3 active:bg-muted/30 -mx-2 px-2 py-1.5 rounded-xs transition-colors"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover shrink-0 mt-0.5" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[12px] font-bold shrink-0 mt-0.5">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold truncate">{displayName}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{shortRelative(createdAt)}</span>
          {isPending && <span className="text-[10px] text-muted-foreground italic">posting…</span>}
        </div>
        <p className="text-[14px] leading-snug break-words mt-0.5">{body}</p>
        {pressing && !isPending && "id" in row && typeof row.id !== "string" && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPressing(false);
                onDelete(row.id as Id<"feed_comments">);
              }}
              className="px-3 py-1 text-[12px] font-semibold text-destructive bg-destructive/10 rounded-md active:bg-destructive/20"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setPressing(false)}
              className="px-3 py-1 text-[12px] font-medium text-muted-foreground active:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function shortRelative(iso: number): string {
  const diff = Date.now() - iso;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
