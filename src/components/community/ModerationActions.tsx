/**
 * Per-post moderation overflow menu (the "kebab" on a polaroid).
 *
 * Renders a 44px `MoreVertical` tap target → shadcn `DropdownMenu` with
 * three role-gated items:
 *   - Report          (always available; opens an internal ReportPostSheet)
 *   - Remove post     (author OR coach, and the post is not already down)
 *   - Restore post    (coach only, and the post is currently soft-deleted)
 *
 * "Remove" is gated by a shadcn `AlertDialog` because soft-delete pulls
 * the post from every member's feed within one reactive tick; that's
 * irreversible-feeling enough to warrant a confirm. Restore is a no-op
 * if the post is already visible (server is idempotent), so we don't
 * bother with a confirm there.
 *
 * The component owns the local `open` state of the `ReportPostSheet` so
 * the parent (e.g. PolaroidStack top card) only has to drop the
 * component in. No prop drilling for the sheet.
 */
import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { Flag, MoreVertical, RotateCcw, Trash2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  triggerHaptic,
  triggerHapticSuccess,
  triggerHapticWarning,
} from "@/lib/haptics";
import { ReportPostSheet } from "./ReportPostSheet";

export interface ModerationActionsPost {
  _id: Id<"session_media">;
  /** Caller is the post's author. Reveals "Remove post" even for non-coaches. */
  isAuthor: boolean;
  /** Caller is a coach in the post's gym. Reveals takedown + restore. */
  isCoach: boolean;
  /** Server soft-delete timestamp. `null`/undefined = visible post. */
  deletedAt?: number | null;
}

export interface ModerationActionsProps {
  post: ModerationActionsPost;
  /** Called after any mutation (or a successful report) so the parent can
   *  refresh its local view, e.g. pop the polaroid from the stack. The
   *  Convex query the parent renders will also auto-update reactively;
   *  this is for parent-managed state (cursors, transient overlays). */
  onActionComplete?: () => void;
}

export function ModerationActions({
  post,
  onActionComplete,
}: ModerationActionsProps): JSX.Element {
  const { toast } = useToast();
  const softDeletePost = useMutation(api.feedSocial.softDeletePost);
  const restorePost = useMutation(api.feedSocial.restorePost);

  // UI state: report sheet visibility + remove-confirm dialog visibility.
  // Both are local to this component so the parent never has to wire
  // them in.
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDeleted = !!post.deletedAt;
  const canRemove = (post.isAuthor || post.isCoach) && !isDeleted;
  const canRestore = post.isCoach && isDeleted;

  const handleOpenReport = useCallback(() => {
    void triggerHaptic();
    setReportOpen(true);
  }, []);

  const handleReportSheetChange = useCallback(
    (open: boolean) => {
      setReportOpen(open);
      // The sheet itself handles its success toast. We just propagate the
      // "something happened" hook so the parent can re-render.
      if (!open) onActionComplete?.();
    },
    [onActionComplete],
  );

  const handleRemove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await softDeletePost({ postId: post._id });
      await triggerHapticSuccess();
      toast({
        title: "Post removed",
        description: "It'll disappear from the feed on the next tick.",
      });
      setConfirmRemoveOpen(false);
      onActionComplete?.();
    } catch (err) {
      await triggerHapticWarning();
      const message =
        err instanceof Error ? err.message : "Couldn't remove the post.";
      toast({
        title: "Couldn't remove post",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, onActionComplete, post._id, softDeletePost, toast]);

  const handleRestore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await restorePost({ postId: post._id });
      await triggerHapticSuccess();
      toast({
        title: "Post restored",
        description: "It's back in the feed.",
      });
      onActionComplete?.();
    } catch (err) {
      await triggerHapticWarning();
      const message =
        err instanceof Error ? err.message : "Couldn't restore the post.";
      toast({
        title: "Couldn't restore post",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, onActionComplete, post._id, restorePost, toast]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Post actions"
            // 44px tap target per Apple HIG; the icon stays 18px.
            className="h-11 w-11 inline-flex items-center justify-center rounded-xs bg-black/40 backdrop-blur-md text-white active:bg-black/60 transition-colors"
            // Stop the parent polaroid stack from interpreting this tap
            // as a card flick / long-press.
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-[18px] w-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="w-48 rounded-xs border-border/50 bg-background/95 backdrop-blur-md"
        >
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              handleOpenReport();
            }}
            className="rounded-xs py-2.5"
          >
            <Flag className="h-4 w-4 mr-2" />
            Report
          </DropdownMenuItem>

          {canRemove && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void triggerHaptic();
                setConfirmRemoveOpen(true);
              }}
              className="rounded-xs py-2.5 text-func-danger-red focus:text-red-200 focus:bg-func-danger-red/10"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove post
            </DropdownMenuItem>
          )}

          {canRestore && (
            <DropdownMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault();
                void handleRestore();
              }}
              className="rounded-xs py-2.5"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Restore post
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Remove-confirm. shadcn `AlertDialog` traps focus and dims the
          backdrop; we keep the prose tight so the action is unambiguous. */}
      <AlertDialog
        open={confirmRemoveOpen}
        onOpenChange={(open) => {
          if (!busy) setConfirmRemoveOpen(open);
        }}
      >
        <AlertDialogContent className="rounded-xs border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this post?</AlertDialogTitle>
            <AlertDialogDescription>
              It'll be hidden from the gym feed and from your profile within a
              moment. {post.isCoach && !post.isAuthor ? "As a coach you can restore it later from the moderation queue." : "You won't be able to restore it yourself, so ask your coach."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                // Stop the default close so we can keep the dialog open
                // while the mutation flies; close happens in handleRemove.
                e.preventDefault();
                void handleRemove();
              }}
              className="bg-func-danger-red/90 hover:bg-func-danger-red focus:ring-func-danger-red/40"
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report sheet: owns its own form state and submit logic. */}
      <ReportPostSheet
        open={reportOpen}
        onOpenChange={handleReportSheetChange}
        postId={post._id}
      />
    </>
  );
}

export default ModerationActions;
