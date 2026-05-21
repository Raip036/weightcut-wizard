/**
 * Bottom-sheet view of a gym's public-to-members profile.
 *
 * Triggered by tapping the GymHeader cluster on the Corner tab. Reuses
 * `api.gyms.getById` (already gated to members + owner) and the new
 * `api.gym_members.listMembersForActiveMember` (gated to active members
 * of the same gym). All section data is read reactively via `useQuery`,
 * so the sheet stays fresh while open — no manual refetch required.
 *
 * Sections (top to bottom):
 *   1. Hero — 80px rounded-xs logo + name + location row + "Coached by"
 *   2. About — gym.about with an empty-state fallback
 *   3. Disciplines — discipline-coloured chips (reuses `disciplineToken`)
 *   4. Members — header + scrollable list of {avatar, displayName}
 *
 * When `gymId` is null we short-circuit the body to a thin skeleton so
 * the sheet still animates open cleanly if the parent opens it before
 * the gym id resolves (defensive — Community.tsx only opens it when a
 * primaryGym exists).
 */
import { useQuery } from "convex/react";
import { MapPin } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

interface GymProfileSheetProps {
  gymId: Id<"gyms"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface GymRecord {
  id: Id<"gyms">;
  name: string;
  owner_user_id: Id<"users"> | null;
  invite_code: string | null;
  location: string | null;
  logo_url: string | null;
  disciplines: string[] | null;
  fighter_count: number | null;
  about: string | null;
  updated_at: string | null;
  created_at: string;
}

interface GymMemberRow {
  userId: Id<"users">;
  displayName: string;
  avatarUrl: string | null;
}

export function GymProfileSheet({ gymId, open, onOpenChange }: GymProfileSheetProps) {
  // Both queries are gated on `gymId`. When null, we pass "skip" so Convex
  // doesn't burn a round-trip on an impossible request.
  const gym = useQuery(
    api.gyms.getById,
    gymId ? { gymId } : "skip",
  ) as GymRecord | null | undefined;

  const members = useQuery(
    api.gym_members.listMembersForActiveMember,
    gymId ? { gymId } : "skip",
  ) as GymMemberRow[] | undefined;

  // Coach display name (from owner profile). Sourced from the member list
  // when present — the gym owner is always inserted as a coach-role member
  // of their own gym. Fallback: skip the "Coached by" row.
  const coachName =
    gym?.owner_user_id && members
      ? members.find((m) => m.userId === gym.owner_user_id)?.displayName ?? null
      : null;

  const gymLoading = gym === undefined;
  const membersLoading = members === undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92vh] rounded-t-2xl flex flex-col"
      >
        <SheetHeader className="flex-shrink-0 text-left">
          <SheetTitle className="sr-only">Gym profile</SheetTitle>
        </SheetHeader>

        <div
          className="flex-1 overflow-y-auto scrollbar-hide"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6rem)" }}
        >
          {/* Hero ─────────────────────────────────────────────────────── */}
          <section className="flex flex-col items-center text-center pt-2 pb-6">
            {gymLoading ? (
              <Skeleton className="h-20 w-20 rounded-xs" />
            ) : (
              <GymLogoAvatar
                logoUrl={gym?.logo_url ?? null}
                name={gym?.name ?? "Gym"}
                size={80}
              />
            )}
            <h2 className="mt-3 text-title font-semibold leading-tight">
              {gymLoading ? (
                <Skeleton className="h-7 w-40 inline-block" />
              ) : (
                gym?.name ?? "Gym"
              )}
            </h2>
            <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {gymLoading
                  ? "—"
                  : gym?.location?.trim()
                    ? gym.location
                    : "Location not set"}
              </span>
            </div>
            {coachName && (
              <p className="mt-1 text-sm text-muted-foreground">
                Coached by {coachName}
              </p>
            )}
          </section>

          {/* About ────────────────────────────────────────────────────── */}
          <section className="px-5 space-y-3">
            <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
              About
            </p>
            <div className="card-surface rounded-xs p-4">
              {gymLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              ) : gym?.about?.trim() ? (
                <p className="text-body-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {gym.about}
                </p>
              ) : (
                <p className="text-body-sm text-muted-foreground">
                  No description yet.
                </p>
              )}
            </div>
          </section>

          {/* Disciplines ─────────────────────────────────────────────── */}
          {!gymLoading && gym?.disciplines && gym.disciplines.length > 0 && (
            <section className="px-5 space-y-3 mt-6">
              <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
                Disciplines
              </p>
              <div className="flex flex-wrap gap-2">
                {gym.disciplines.map((d) => {
                  const token = disciplineToken(d);
                  return (
                    <span
                      key={d}
                      className="inline-flex items-center h-7 px-3 rounded-full text-[11px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: `hsl(var(${token}) / 0.15)`,
                        color: `hsl(var(${token}))`,
                      }}
                    >
                      {disciplineLabel(d)}
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          {/* Members ─────────────────────────────────────────────────── */}
          <section className="px-5 space-y-3 mt-6">
            <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
              Members {membersLoading ? "" : `(${members?.length ?? 0})`}
            </p>
            <ul className="space-y-2">
              {membersLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 card-surface rounded-xs p-3"
                  >
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-3.5 w-32" />
                  </li>
                ))
              ) : members && members.length > 0 ? (
                members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 card-surface rounded-xs p-3"
                  >
                    <MemberAvatar
                      avatarUrl={m.avatarUrl}
                      displayName={m.displayName}
                    />
                    <span className="text-body-sm text-foreground truncate">
                      {m.displayName}
                    </span>
                  </li>
                ))
              ) : (
                <li className="card-surface rounded-xs p-3 text-body-sm text-muted-foreground">
                  No members yet.
                </li>
              )}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * 32px round member avatar with single-letter fallback. Inlined rather
 * than reaching for the global Avatar shadcn component because we only
 * need the most minimal "image-or-initial" behaviour here, and the
 * round shape contrasts the rounded-xs gym logo cleanly.
 */
function MemberAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const initial = (displayName.trim()[0] || "?").toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${displayName} avatar`}
        className="h-8 w-8 rounded-full object-cover bg-muted/40 flex-shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0"
      aria-label={`${displayName} avatar`}
    >
      <span className="text-[12px] font-semibold text-muted-foreground">
        {initial}
      </span>
    </div>
  );
}
