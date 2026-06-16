import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
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
import { groupActivity } from "./activityGrouping";

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
  const navigate = useNavigate();
  const data = useQuery(
    api.feedActivity.listActivity,
    open && gymId ? { gymId } : "skip",
  );
  const markSeen = useMutation(api.feedActivity.markActivitySeen);

  // Freeze the unread baseline so the "New" band reflects items since the
  // LAST open, not this one. We capture lastSeenAt BEFORE stamping it to now.
  const [frozenSeenAt, setFrozenSeenAt] = useState<number | null>(null);

  // Reset the frozen baseline whenever the sheet closes.
  useEffect(() => {
    if (!open) setFrozenSeenAt(null);
  }, [open]);

  // Capture the pre-open baseline once data arrives. Guard on a numeric
  // lastSeenAt so a stale/old-shape backend response (pre-deploy) degrades to
  // an empty feed instead of crashing the grouping with undefined items.
  useEffect(() => {
    if (open && frozenSeenAt === null && typeof data?.lastSeenAt === "number") {
      setFrozenSeenAt(data.lastSeenAt);
    }
  }, [open, data, frozenSeenAt]);

  // Only stamp lastActivitySeenAt AFTER we've captured the pre-open baseline,
  // so the markActivitySeen write can't clobber the "New" band.
  useEffect(() => {
    if (open && frozenSeenAt !== null) {
      markSeen({}).catch(() => {});
    }
  }, [open, frozenSeenAt, markSeen]);

  const sections = useMemo(
    () =>
      frozenSeenAt !== null && Array.isArray(data?.items)
        ? groupActivity(data.items, frozenSeenAt, Date.now())
        : [],
    [data, frozenSeenAt],
  );

  const openProfile = (userId: Id<"users">) => {
    onClose();
    navigate(`/profile/${userId}`);
  };

  const handleTap = (item: ActivityItem) => {
    switch (item.kind) {
      case "comment":
        onOpenComments(item.post.postId);
        onClose();
        break;
      case "member_joined":
        onClose();
        navigate(`/profile/${item.actor.userId}`);
        break;
      case "likes":
      case "reactions":
        onClose();
        break;
    }
  };

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

        <div className="flex-1 overflow-y-auto pb-8">
          {data === undefined ? (
            <SkeletonList />
          ) : sections.length === 0 ? (
            <EmptyActivity />
          ) : (
            sections.map((section) => {
              const isNew = section.id === "new";
              return (
                <section
                  key={section.id}
                  className={isNew ? "bg-primary/[0.04]" : undefined}
                >
                  <h2 className="flex items-center gap-1.5 px-4 pt-4 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">
                    {isNew && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                    <span className={isNew ? "text-primary" : undefined}>
                      {section.label}
                    </span>
                  </h2>
                  {section.items.map((item) => (
                    <ActivityRow
                      key={rowKey(item)}
                      item={item}
                      isUnread={isNew}
                      onTap={() => handleTap(item)}
                      onOpenProfile={openProfile}
                    />
                  ))}
                </section>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Row key ─── */

type ActivityItem = NonNullable<
  FunctionReturnType<typeof api.feedActivity.listActivity>
>["items"][number];

function rowKey(item: ActivityItem): string {
  switch (item.kind) {
    case "likes":
      return `likes:${item.post.postId}`;
    case "comment":
      return `c:${item.commentId}`;
    case "reactions":
      return `r:${item.post.postId}:${item.emojiKey}`;
    case "member_joined":
      return `m:${item.actor.userId}:${item.joinedAt}`;
  }
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
    <div className="flex flex-col items-center justify-center h-64 px-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/[0.06]">
        <span className="h-2 w-2 rounded-full bg-primary/50" />
      </div>
      <p className="text-sm font-medium text-foreground/80">
        No activity yet
      </p>
      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
        Post a session and rack up some likes.
      </p>
    </div>
  );
}
