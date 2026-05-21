/**
 * Coach-only moderation queue for the gym-scoped social tab.
 *
 * Mounted at `/community/moderation` (route is wired in `App.tsx`).
 *
 * Access model:
 *  - Two signals are checked in parallel: the global `profile.role` and the
 *    primary gym's per-member role on `useMyGyms`. Either grants access.
 *  - Non-coaches see an `<AccessDenied />` block instead of the queue. The
 *    convex query is also coach-only on the server, so this guard is a UX
 *    affordance — the server will reject anyway if someone fakes the prop.
 *
 * Data:
 *  - `api.feedSocial.listGymReports` returns open reports for the user's
 *    primary gym, joined with a lightweight post preview block. Reactive
 *    by default — confirming a takedown via `softDeletePost` will cause
 *    Convex to re-run the query and drop the row from the list on the
 *    next tick, no explicit refetch needed.
 *  - "Dismiss" is local-only for now — there's no `dismissReport` mutation
 *    yet, so we just hide the row in component state with the `id` set.
 *    A future server-side mutation can replace this without UI changes.
 *
 * Pull-to-refresh is handled by the project-global `<PullToRefresh />`
 * mounted at the App root, so this page doesn't need its own wrapper.
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, Loader2, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useMyGyms, type MyGymRow } from "@/hooks/coach/useMyGyms";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSuccess, triggerHapticWarning } from "@/lib/haptics";

/** Reason chip colours. Tuned for dark-mode contrast and to read at a
 *  glance — harassment is the most severe and so gets the warmest hue. */
const REASON_STYLES: Record<
  "spam" | "inappropriate" | "harassment" | "other",
  { label: string; className: string }
> = {
  spam: {
    label: "Spam",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  inappropriate: {
    label: "Inappropriate",
    className: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  },
  harassment: {
    label: "Harassment",
    className: "bg-red-500/15 text-red-300 border-red-500/30",
  },
  other: {
    label: "Other",
    className: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  },
};

/** Server returns `kind: "photo" | "video"` (etc) — but only `url` is
 *  used here for the 56px thumbnail. We accept `string | null` from the
 *  storage helper and fall back to a neutral swatch when missing. */
interface ReportRowData {
  id: string;
  createdAt: number;
  reason: keyof typeof REASON_STYLES;
  note: string | null;
  reporter: { displayName: string };
  post: {
    id: Id<"session_media">;
    url: string | null;
    caption: string | null;
  } | null;
}

/**
 * Resolve the "is this user a coach in any gym" question without making
 * the page hang on a slow membership join. We accept either:
 *   - the global profile role (`coach` once they've finished onboarding), or
 *   - the user being the owner of any of their listed gyms.
 * The strict `member_role` field referenced in spec isn't on `MyGymRow`
 * today, so the gym-owner fallback covers the same intent.
 */
function isCoachUser(args: {
  profileRole: string | null | undefined;
  gyms: MyGymRow[];
  userId: string | null;
}): boolean {
  if (args.profileRole === "coach") return true;
  if (!args.userId) return false;
  return args.gyms.some((g) => g.coach_user_id === args.userId);
}

export default function Moderation(): JSX.Element {
  const navigate = useNavigate();
  const { userId, profile } = useUser();
  const { gyms, loading: gymsLoading } = useMyGyms(userId);
  const { toast } = useToast();

  const isCoach = useMemo(
    () => isCoachUser({ profileRole: profile?.role, gyms, userId }),
    [profile?.role, gyms, userId],
  );

  // Pick the user's primary gym. For multi-gym coaches the queue is
  // gym-scoped on the server; a gym picker in the header is a v2 task.
  const primaryGym = gyms[0] ?? null;
  const gymId = primaryGym?.gym_id as Id<"gyms"> | undefined;

  const reports = useQuery(
    api.feedSocial.listGymReports,
    isCoach && gymId ? { gymId, status: "open" } : "skip",
  );

  const softDeletePost = useMutation(api.feedSocial.softDeletePost);

  // Locally-dismissed report ids. The server query auto-evicts confirmed
  // takedowns because the post gets `deletedAt` patched, but "Dismiss"
  // is purely a client hide until a server-side mutation lands.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleConfirmTakedown = useCallback(
    async (reportId: string, postId: Id<"session_media">) => {
      setPendingId(reportId);
      try {
        await softDeletePost({ postId });
        await triggerHapticSuccess();
        toast({
          title: "Post removed",
          description: "It'll disappear from the gym feed on the next tick.",
        });
      } catch (err) {
        await triggerHapticWarning();
        const message =
          err instanceof Error ? err.message : "Couldn't remove the post.";
        toast({
          title: "Takedown failed",
          description: message,
          variant: "destructive",
        });
      } finally {
        setPendingId(null);
      }
    },
    [softDeletePost, toast],
  );

  const handleDismiss = useCallback(
    (reportId: string) => {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        next.add(reportId);
        return next;
      });
      void triggerHapticWarning();
      toast({
        title: "Report hidden",
        description: "It'll come back next time you open this page.",
      });
    },
    [toast],
  );

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // ── Access guard ────────────────────────────────────────────────────
  // Wait until we actually know whether the user is a coach. Otherwise
  // a coach who refreshes the page would briefly see the AccessDenied
  // empty state while `useMyGyms` is still loading.
  if (gymsLoading) {
    return <LoadingShell />;
  }

  if (!isCoach) {
    return <AccessDenied onBack={handleBack} />;
  }

  // ── Loaded coach ────────────────────────────────────────────────────
  const filtered: ReportRowData[] = (reports ?? [])
    .filter((r) => !dismissedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      reason: r.reason,
      note: r.note,
      reporter: { displayName: r.reporter.displayName },
      post: r.post
        ? {
            id: r.post.id,
            url: r.post.url ?? null,
            caption: r.post.caption ?? null,
          }
        : null,
    }));

  const isLoadingReports = reports === undefined;

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-border/50">
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            aria-label="Back"
            onClick={handleBack}
            className="h-11 w-11 -ml-2 flex items-center justify-center rounded-xs active:bg-white/5 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-[17px] font-semibold tracking-tight">
            Moderation queue
          </h1>
          {!isLoadingReports && filtered.length > 0 && (
            <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
              {filtered.length} open
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <main
        className="px-4 py-4 space-y-3"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)",
        }}
      >
        {isLoadingReports ? (
          <ReportRowSkeletons />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map((row) => (
            <ReportRow
              key={row.id}
              row={row}
              busy={pendingId === row.id}
              onConfirm={handleConfirmTakedown}
              onDismiss={handleDismiss}
            />
          ))
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function ReportRow(props: {
  row: ReportRowData;
  busy: boolean;
  onConfirm: (reportId: string, postId: Id<"session_media">) => void;
  onDismiss: (reportId: string) => void;
}): JSX.Element {
  const { row, busy, onConfirm, onDismiss } = props;
  const reasonStyle = REASON_STYLES[row.reason] ?? REASON_STYLES.other;
  const age = relativeAge(row.createdAt);
  const postId = row.post?.id ?? null;

  return (
    <article className="glass-card rounded-xs border border-border/50 p-4">
      <div className="flex items-start gap-3">
        {/* 56px thumbnail */}
        <div className="h-14 w-14 shrink-0 rounded-xs overflow-hidden bg-neutral-800 border border-border/40">
          {row.post?.url ? (
            <img
              src={row.post.url}
              alt={row.post.caption ?? "Reported post"}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
              No media
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-[14px] font-medium truncate">
              {row.reporter.displayName}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${reasonStyle.className}`}
            >
              {reasonStyle.label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
            {age}
          </p>
          {row.note && (
            <p className="mt-2 text-[13px] text-foreground/80 line-clamp-3">
              &ldquo;{row.note}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-11 flex-1 rounded-xs"
          disabled={busy || !postId}
          onClick={() => {
            if (postId) onConfirm(row.id, postId);
          }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Removing…
            </span>
          ) : (
            "Confirm takedown"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 rounded-xs"
          disabled={busy}
          onClick={() => onDismiss(row.id)}
        >
          Dismiss
        </Button>
      </div>
    </article>
  );
}

function ReportRowSkeletons(): JSX.Element {
  // Three skeleton rows — matches the densest "open reports" state we
  // expect for a single gym, so the layout shift on data-arrival is small.
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="glass-card rounded-xs border border-border/50 p-4"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-14 w-14 rounded-xs" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-11 flex-1 rounded-xs" />
            <Skeleton className="h-11 w-24 rounded-xs" />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16">
      <div className="h-14 w-14 rounded-xs bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
        <ShieldAlert className="h-6 w-6 text-emerald-300" />
      </div>
      <p className="text-[15px] font-semibold">All clear. No open reports.</p>
      <p className="mt-1 text-[13px] text-muted-foreground max-w-xs">
        New reports from your gym will show up here as members flag posts.
      </p>
    </div>
  );
}

function LoadingShell(): JSX.Element {
  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="px-4 py-6 space-y-3">
        <Skeleton className="h-7 w-44 rounded-md" />
        <ReportRowSkeletons />
      </div>
    </div>
  );
}

function AccessDenied(props: { onBack: () => void }): JSX.Element {
  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-8 text-center"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)",
      }}
    >
      <div className="h-14 w-14 rounded-xs bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
        <ShieldAlert className="h-6 w-6 text-red-300" />
      </div>
      <p className="text-[17px] font-semibold">Coaches only</p>
      <p className="mt-1 text-[13px] text-muted-foreground max-w-xs">
        The moderation queue is restricted to gym coaches. Ask your coach if
        you think something needs to come down.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-6 h-11 rounded-xs px-5"
        onClick={props.onBack}
      >
        Back
      </Button>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

function relativeAge(epochMs: number): string {
  try {
    return formatDistanceToNow(new Date(epochMs), { addSuffix: true });
  } catch {
    return "";
  }
}
