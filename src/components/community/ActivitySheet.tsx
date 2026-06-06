import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ActivityRow } from "./ActivityRow";

interface ActivitySheetProps {
  open: boolean;
  onClose: () => void;
  gymId: Id<"gyms"> | null;
  onOpenComments: (postId: Id<"session_media">) => void;
}

export function ActivitySheet({
  open,
  onClose,
  gymId,
  onOpenComments,
}: ActivitySheetProps) {
  const items = useQuery(
    api.feedActivity.listActivity,
    open && gymId ? { gymId } : "skip",
  );
  const markSeen = useMutation(api.feedActivity.markActivitySeen);

  // Fire markActivitySeen the first time the sheet opens. The mutation
  // patches lastActivitySeenAt to now, clearing the bell badge.
  useEffect(() => {
    if (open) {
      markSeen({}).catch(() => {});
    }
  }, [open, markSeen]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        hideClose
        className="w-full sm:max-w-md p-0 flex flex-col"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex flex-row items-center justify-between space-y-0">
            <SheetTitle>Activity</SheetTitle>
            <SheetClose
              aria-label="Close"
              className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground active:opacity-70 focus:outline-none [-webkit-tap-highlight-color:transparent]"
            >
              <X className="h-5 w-5" />
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 pt-1 pb-8">
          {items === undefined ? (
            <SkeletonList />
          ) : items.length === 0 ? (
            <EmptyActivity />
          ) : (
            items.map((item) => (
              <ActivityRow
                key={rowKey(item)}
                item={item}
                onTap={() => {
                  if (item.kind === "comment") {
                    onOpenComments(item.post.postId);
                    onClose();
                  } else {
                    onClose();
                  }
                }}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Row key ─── */

type ActivityItem = NonNullable<
  ReturnType<typeof useQuery<typeof api.feedActivity.listActivity>>
>[number];

function rowKey(item: ActivityItem): string {
  return item.kind === "likes"
    ? `likes:${item.post.postId}`
    : `c:${item.commentId}`;
}

/* ─── Loading skeleton ─── */

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-muted animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
        <div className="h-2.5 bg-muted animate-pulse rounded w-1/3" />
      </div>
      <div className="w-10 h-10 rounded-xs bg-muted animate-pulse flex-shrink-0" />
    </div>
  );
}

function SkeletonList() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  );
}

/* ─── Empty state ─── */

function EmptyActivity() {
  return (
    <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
      <p className="text-sm text-muted-foreground leading-relaxed">
        No activity yet. Post a session and rack up some likes.
      </p>
    </div>
  );
}
