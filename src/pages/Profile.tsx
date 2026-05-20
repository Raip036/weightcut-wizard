/**
 * Profile page (Corner tab) — public-ish view of one gym member.
 *
 * Mounted at `/profile/:userId`. Reads the user via
 * `api.profiles.getByUserId` (server is authoritative for `sameGym` and
 * the stats triple), and surfaces a 3-column grid of their posts via
 * `useProfilePosts` / `api.gymFeed.listProfilePosts`.
 *
 * ─── Backend contract ─────────────────────────────────────────────────
 *
 *   export const getByUserId = query({
 *     args: { userId: v.id("users") },
 *     handler: async (ctx, { userId }) => {
 *       // returns:
 *       // {
 *       //   userId, displayName, avatarUrl, credentials (string|null),
 *       //   record (string|null), primaryGymId, primaryGymName,
 *       //   sameGym: boolean,
 *       //   stats: { sessionsLogged, kgCutTotal, campsCompleted },
 *       // } | null
 *     },
 *   });
 *
 * `null` from the server means "no such user / not visible to viewer";
 * the page renders a minimal Not found state with a back button.
 */
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Pencil, ShieldCheck } from "lucide-react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useProfilePosts } from "@/hooks/community/useProfilePosts";
import { PostGrid } from "@/components/community/PostGrid";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { HealthSettingsCard } from "@/components/health/HealthSettingsCard";

// ─── Helpers ───────────────────────────────────────────────────────────

/** Compact integer formatter ("1.2K", "42") — used by the stats row. */
function compactNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1_000) {
    return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  }
  return String(Math.round(v));
}

interface ProfileLookupShape {
  userId?: Id<"users">;
  displayName?: string | null;
  avatarUrl?: string | null;
  /** "Black belt, 8-2-0" etc. — free-form credentials line. Optional. */
  credentials?: string | null;
  /** "8-2-0 MMA" fight record line. Optional. */
  record?: string | null;
  /** Primary gym for "Same Gym?" comparison. */
  primaryGymId?: Id<"gyms"> | null;
  primaryGymName?: string | null;
  /** Server-computed: viewer shares a gym with this user. Source of truth. */
  sameGym?: boolean;
  stats?: {
    sessionsLogged?: number;
    kgCutTotal?: number;
    campsCompleted?: number;
  };
}

// ─── Component ─────────────────────────────────────────────────────────

export default function Profile() {
  const params = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { userId: viewerId } = useUser();

  const profileUserId = (params.userId ?? "") as Id<"users">;

  // Single-source profile fetch. `undefined` = still loading; `null` =
  // backend says no such (visible) user; otherwise the populated shape.
  const profile = useQuery(
    api.profiles.getByUserId,
    profileUserId ? { userId: profileUserId } : "skip",
  ) as ProfileLookupShape | null | undefined;

  // Posts grid — drives both the visible grid and the "X posts" stat.
  const { results: posts, status, loadMore } = useProfilePosts(
    profileUserId || null,
  );

  const isViewingSelf = viewerId === profileUserId;

  // ─── Not found ─────────────────────────────────────────────────────
  // `null` is the explicit "no such (visible) profile" signal from the
  // backend. `undefined` means still loading — let the header render its
  // placeholder copy instead of flashing the empty state.
  if (profile === null) {
    return (
      <div
        className="min-h-[100dvh] bg-black text-white"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-black/90 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-black/70">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white active:scale-[0.96]"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold text-white/90">Profile</p>
          <div className="h-9 w-9" aria-hidden />
        </div>
        <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
          <h1 className="text-lg font-semibold text-white">Not found</h1>
          <p className="mt-2 max-w-[28ch] text-sm text-white/55">
            This profile is private or no longer available.
          </p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-6 h-10 rounded-2xl bg-white px-5 text-sm font-semibold text-zinc-950 active:scale-[0.98]"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // "Same Gym?" — server is authoritative. Hide the pill on self-view so
  // we don't tell the user they share a gym with themselves.
  const sameGym = !!profile?.sameGym && !isViewingSelf;

  // Stats — the server returns 0s when there's no data, but defend
  // against an older client shape that omits the field entirely.
  const stats = profile?.stats ?? {};
  const sessionsLogged = stats.sessionsLogged ?? 0;
  const kgCutTotal = stats.kgCutTotal ?? 0;
  const campsCompleted = stats.campsCompleted ?? 0;

  const initials = (profile?.displayName ?? "Athlete")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "A";

  return (
    <div
      className="min-h-[100dvh] bg-black text-white"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
      }}
    >
      {/* ─── Header bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-black/90 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-black/70">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white active:scale-[0.96]"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold text-white/90">
          {profile?.displayName ?? "Profile"}
        </p>
        {/* Self-view: edit profile shortcut. Otherwise spacer for balance. */}
        {isViewingSelf ? (
          <button
            type="button"
            onClick={() => navigate("/goals")}
            className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold text-white active:scale-[0.96]"
            aria-label="Edit profile"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
            Edit profile
          </button>
        ) : (
          <div className="h-9 w-9" aria-hidden />
        )}
      </div>

      {/* ─── Identity row ───────────────────────────────────────────── */}
      <div className="flex items-start gap-4 px-5 pb-5 pt-3">
        <Avatar className="h-16 w-16 border border-white/10">
          {profile?.avatarUrl ? (
            <AvatarImage
              src={profile.avatarUrl}
              alt={profile.displayName ?? "Athlete"}
              className="object-cover"
            />
          ) : null}
          <AvatarFallback className="bg-zinc-800 text-base font-semibold text-white">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold leading-tight">
              {profile?.displayName ?? "Loading…"}
            </h1>
            {sameGym && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-white/[0.08] px-2 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                <ShieldCheck className="h-3 w-3" />
                Same Gym
              </span>
            )}
          </div>
          {(profile?.credentials || profile?.record) && (
            <p className="line-clamp-2 text-xs text-white/55">
              {[profile?.credentials, profile?.record].filter(Boolean).join(" · ")}
            </p>
          )}
          {profile?.primaryGymName && (
            <p className="text-xs text-white/40">{profile.primaryGymName}</p>
          )}
        </div>
      </div>

      {/* ─── Stats row ──────────────────────────────────────────────── */}
      <div className="mx-5 grid grid-cols-3 rounded-2xl border border-white/[0.06] bg-white/[0.03]">
        <StatCell label="Sessions" value={compactNumber(sessionsLogged)} />
        <StatCell
          label="kg cut"
          value={compactNumber(Math.round(kgCutTotal))}
        />
        <StatCell label="Camps" value={compactNumber(campsCompleted)} />
      </div>

      {/* ─── Apple Health settings (self-view only) ─────────────────── */}
      {isViewingSelf && (
        <div className="mx-5 mt-4">
          <HealthSettingsCard />
        </div>
      )}

      {/* ─── Posts grid ─────────────────────────────────────────────── */}
      <div className="mt-6 px-px">
        <PostGrid
          posts={posts}
          loading={
            status === "LoadingFirstPage" || status === "LoadingMore"
          }
          canLoadMore={status === "CanLoadMore"}
          onLoadMore={() => loadMore(12)}
        />
      </div>
    </div>
  );
}

/** Single stat column — number on top, label below in muted white. */
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-0.5 px-3 py-4",
        // Subtle divider between cells without spilling at the rounded corners.
        "border-l border-white/[0.05] first:border-l-0",
      )}
    >
      <span className="text-base font-semibold leading-none">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </span>
    </div>
  );
}
