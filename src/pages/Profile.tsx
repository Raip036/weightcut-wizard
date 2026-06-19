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
import {
  ChevronLeft,
  Dumbbell,
  Pencil,
  Settings,
  ShieldCheck,
  TrendingDown,
  Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useProfilePosts } from "@/hooks/community/useProfilePosts";
import { PostGrid } from "@/components/community/PostGrid";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HealthSettingsCard } from "@/components/health/HealthSettingsCard";

// ─── Design tokens ─────────────────────────────────────────────────────

/** Canonical uppercase eyebrow — matches the approved mockup spec. */
const EYEBROW =
  "text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold";

// ─── Helpers ───────────────────────────────────────────────────────────

/** Compact integer formatter ("1.2K", "42") — used by the stats tiles. */
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
        className="min-h-[100dvh] bg-background text-foreground"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-background/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-foreground active:scale-[0.96]"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold text-muted-foreground">Profile</p>
          <div className="h-9 w-9" aria-hidden />
        </div>
        <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
          <h1 className="font-display text-xl font-bold text-foreground">
            Not found
          </h1>
          <p className="mt-2 max-w-[28ch] text-sm text-muted-foreground">
            This profile is private or no longer available.
          </p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-6 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
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

  const subline = [profile?.credentials, profile?.record, profile?.primaryGymName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
      }}
    >
      {/* ─── Cover gradient + floating controls ──────────────────────── */}
      <div className="relative">
        <div className="h-28 w-full bg-gradient-to-br from-primary/25 via-primary/[0.06] to-transparent" />
        <div className="absolute left-0 right-0 top-2 z-10 flex items-center justify-between px-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/30 text-foreground backdrop-blur active:scale-[0.96] supports-[backdrop-filter]:bg-background/30"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* Self-view exposes Settings here; otherwise a balancing spacer. */}
          {isViewingSelf ? (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("wcw:open-settings"))
              }
              className="flex h-9 w-9 items-center justify-center rounded-full bg-background/30 text-foreground backdrop-blur active:scale-[0.96] supports-[backdrop-filter]:bg-background/30"
              aria-label="Settings"
            >
              <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          ) : (
            <div className="h-9 w-9" aria-hidden />
          )}
        </div>
      </div>

      {/* ─── Identity ────────────────────────────────────────────────── */}
      <div className="-mt-9 flex flex-col items-center px-5 text-center">
        <Avatar className="h-[72px] w-[72px] ring-4 ring-background">
          {profile?.avatarUrl ? (
            <AvatarImage
              src={profile.avatarUrl}
              alt={profile.displayName ?? "Athlete"}
              className="object-cover"
            />
          ) : null}
          <AvatarFallback className="bg-[hsl(var(--card))] font-display text-xl font-bold text-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="mt-2.5 flex max-w-full flex-wrap items-center justify-center gap-2">
          <h1 className="truncate font-display text-xl font-bold leading-tight text-foreground">
            {profile?.displayName ?? "Loading…"}
          </h1>
          {sameGym && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/[0.08] px-2 text-[10px] font-semibold uppercase tracking-wider text-func-recovery-green">
              <ShieldCheck className="h-3 w-3" />
              Same Gym
            </span>
          )}
        </div>

        {subline && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {subline}
          </p>
        )}

        {/* Self-view: primary-styled Edit CTA (was an icon button in chrome). */}
        {isViewingSelf && (
          <button
            type="button"
            onClick={() => navigate("/goals")}
            className="mt-3.5 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground active:scale-[0.98]"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
            Edit profile
          </button>
        )}
      </div>

      {/* ─── Stat tiles ──────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-3 gap-2 px-5">
        <StatTile
          icon={Dumbbell}
          label="SESSIONS"
          value={compactNumber(sessionsLogged)}
        />
        <StatTile
          icon={TrendingDown}
          label="KG CUT"
          value={compactNumber(Math.round(kgCutTotal))}
        />
        <StatTile
          icon={Trophy}
          label="CAMPS"
          value={compactNumber(campsCompleted)}
        />
      </div>

      {/* ─── Apple Health settings (self-view only) ─────────────────── */}
      {isViewingSelf && (
        <div className="mx-5 mt-4">
          <HealthSettingsCard />
        </div>
      )}

      {/* ─── Posts grid ─────────────────────────────────────────────── */}
      {/* PostGrid owns its own tile rounding/gutter (off-limits to this
          edit); we add the page's horizontal inset so the wall lines up
          with the stat tiles and identity column above it. */}
      <div className="mt-6 px-5">
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

/**
 * Single stat tile — recessed `surface-inset` panel with a small primary
 * icon, a data-forward font-display tabular-nums number, and a canonical
 * uppercase eyebrow label.
 */
function StatTile({
  icon: TileIcon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="surface-inset flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3.5">
      <TileIcon className="h-[15px] w-[15px] text-primary" strokeWidth={2.2} />
      <span className="font-display text-[22px] font-bold leading-none tabular-nums text-foreground">
        {value}
      </span>
      <span className={EYEBROW}>{label}</span>
    </div>
  );
}
