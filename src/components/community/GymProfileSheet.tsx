/**
 * Bottom-sheet view of a gym's public-to-members profile.
 *
 * Triggered by tapping the GymHeader cluster on the Corner tab. Reuses
 * `api.gyms.getById` (already gated to members + owner) and
 * `api.gym_members.listMembersForActiveMember` (gated to active members
 * of the same gym). Stats come from `api.gyms.getMemberCount`, and the
 * caller's own membership row (needed for the Leave-gym mutation) is
 * resolved via `api.gym_members.getMineForGym`. All data flows reactively
 * via `useQuery`, so the sheet stays fresh while open.
 *
 * Layout (top to bottom):
 *   1. Header media — gradient banner, centered logo, gym name,
 *      discipline pill + member-count chip.
 *   2. About (collapsible, default expanded) — bio, location, coach row.
 *   3. Members (collapsible) — total count + horizontal avatar strip,
 *      first 8 visible with a "View all members" hint when more exist.
 *   4. Stats (collapsible) — this-week posts / active members /
 *      sessions-today grid. Falls back to an empty-state card.
 *   5. Actions (always visible) — Leave-gym button (members only) with
 *      destructive AlertDialog. Owner sees a small "you own this gym"
 *      note instead.
 *
 * Animations: collapsible bodies use `motion/react` `AnimatePresence` for
 * height: auto transitions. Section mount uses a 60ms stagger capped at
 * 4 children. All motion respects `useReducedMotion`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronDown, MapPin, Loader2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";
import { Icon } from "@/components/ui/Icon";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";

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

interface GymMembership {
  id: Id<"gym_members">;
  gym_id: Id<"gyms">;
  user_id: Id<"users">;
  member_role: "coach" | "athlete";
  share_data: boolean;
  status: string;
}

interface GymStats {
  memberCount: number;
  activePosters7d: number;
  activePostersToday: number;
  viewerPostedToday: boolean;
}

type SectionKey = "about" | "members" | "stats";

const MEMBER_PREVIEW_COUNT = 8;

export function GymProfileSheet({ gymId, open, onOpenChange }: GymProfileSheetProps) {
  const { userId } = useUser();
  const { toast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  // Queries are all gated on `gymId` (and `open`, so we don't burn reads
  // on a closed sheet that just hasn't unmounted yet).
  const shouldQuery = open && !!gymId;
  const gym = useQuery(
    api.gyms.getById,
    shouldQuery && gymId ? { gymId } : "skip",
  ) as GymRecord | null | undefined;

  const members = useQuery(
    api.gym_members.listMembersForActiveMember,
    shouldQuery && gymId ? { gymId } : "skip",
  ) as GymMemberRow[] | undefined;

  const myMembership = useQuery(
    api.gym_members.getMineForGym,
    shouldQuery && gymId ? { gymId } : "skip",
  ) as GymMembership | null | undefined;

  const stats = useQuery(
    api.gyms.getMemberCount,
    shouldQuery && gymId ? { gymId } : "skip",
  ) as GymStats | null | undefined;

  const leaveGym = useMutation(api.gym_members.removeMember);
  const setShareData = useMutation(api.gym_members.setShareData);

  // Default-expanded About; the other two start collapsed so the sheet
  // opens to a calm, single-section state.
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    about: true,
    members: false,
    stats: false,
  });
  const toggle = (key: SectionKey) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Local-optimistic mirror of `share_data` so the Switch flips instantly
  // and we can revert on failure without waiting for the reactive query
  // to round-trip. Null until the membership row first lands.
  const [shareDataLocal, setShareDataLocal] = useState<boolean | null>(null);
  useEffect(() => {
    if (myMembership?.share_data !== undefined) {
      setShareDataLocal(myMembership.share_data);
    }
  }, [myMembership?.share_data]);
  const currentShare = shareDataLocal ?? myMembership?.share_data ?? true;

  const gymLoading = gym === undefined;
  const membersLoading = members === undefined;
  const statsLoading = stats === undefined;

  const isOwner = !!(gym?.owner_user_id && userId && gym.owner_user_id === userId);
  const isMember = myMembership?.status === "active";
  const memberId = myMembership?.id ?? null;

  // Coach display name (from owner profile). The gym owner is always
  // inserted as a coach-role member of their own gym, so we can read it
  // off the member list rather than firing a second profile query.
  const coachName = useMemo(() => {
    if (!gym?.owner_user_id || !members) return null;
    return members.find((m) => m.userId === gym.owner_user_id)?.displayName ?? null;
  }, [gym?.owner_user_id, members]);

  const memberCount = members?.length ?? stats?.memberCount ?? null;
  const visibleMembers = members?.slice(0, MEMBER_PREVIEW_COUNT) ?? [];
  const extraMembers = Math.max(0, (members?.length ?? 0) - MEMBER_PREVIEW_COUNT);

  // Founded month/year for the About card. Falls back gracefully when
  // `created_at` is null (public-stub view, which shouldn't normally hit
  // this code path because non-members can't open the sheet).
  const founded = useMemo(() => {
    if (!gym?.created_at) return null;
    const d = new Date(gym.created_at);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [gym?.created_at]);

  const handleToggleShare = useCallback(async () => {
    if (!memberId) return;
    const next = !currentShare;
    setShareDataLocal(next); // optimistic
    try {
      await setShareData({ memberId, shareData: next });
      toast({ title: next ? "Data sharing on" : "Data sharing off" });
    } catch (err: any) {
      setShareDataLocal(!next); // revert
      logger.error("GymProfileSheet: setShareData failed", err);
      toast({
        title: "Couldn't update",
        description: err?.message,
        variant: "destructive",
      });
    }
  }, [memberId, currentShare, setShareData, toast]);

  const handleLeave = async () => {
    if (!memberId) return;
    setLeaving(true);
    try {
      await leaveGym({ memberId });
      toast({ title: "Left gym" });
      setLeaveOpen(false);
      onOpenChange(false);
    } catch (err: any) {
      logger.error("GymProfileSheet: leave failed", err);
      toast({
        title: "Could not leave gym",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setLeaving(false);
    }
  };

  // Stagger config — 60ms per section, capped at 4 (5 items max, the
  // header counts as item 0). Disabled under reduced motion.
  const stagger = prefersReducedMotion ? 0 : 0.06;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92vh] rounded-t-2xl flex flex-col p-0"
      >
        <VisuallyHidden>
          <SheetTitle>Gym profile</SheetTitle>
        </VisuallyHidden>

        <div
          className="flex-1 overflow-y-auto scrollbar-hide"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6rem)" }}
        >
          {/* 1. Header media ─────────────────────────────────────────── */}
          {/* Gradient anchored to the very top of the sheet — the inner */}
          {/* `pt-9` clears the absolute close button (× sits top-right). */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="relative overflow-hidden border-b border-border/40 rounded-t-2xl"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(180deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.04) 60%, transparent 100%)",
              }}
              aria-hidden
            />
            <div className="relative flex flex-col items-center text-center px-5 pt-9 pb-5">
              {gymLoading ? (
                <Skeleton className="h-16 w-16 rounded-xs" />
              ) : (
                <GymLogoAvatar
                  logoUrl={gym?.logo_url ?? null}
                  name={gym?.name ?? "Gym"}
                  size={72}
                />
              )}
              <h2 className="mt-3 text-[24px] font-bold tracking-tight leading-tight tabular-nums truncate max-w-full">
                {gymLoading ? (
                  <Skeleton className="h-7 w-40 inline-block" />
                ) : (
                  gym?.name ?? "Gym"
                )}
              </h2>

              {/* Discipline pill + member-count chip */}
              {!gymLoading && (
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                  {gym?.disciplines?.[0] ? (
                    <DisciplinePill discipline={gym.disciplines[0]} />
                  ) : null}
                  {memberCount != null && (
                    <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-muted/60 text-[11px] font-semibold text-muted-foreground tabular-nums">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </span>
                  )}
                </div>
              )}

              {/* Extra disciplines spill into a second compact row so the
                  header doesn't grow unbounded for multi-discipline gyms. */}
              {!gymLoading && gym?.disciplines && gym.disciplines.length > 1 && (
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  {gym.disciplines.slice(1).map((d) => (
                    <DisciplinePill key={d} discipline={d} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* 2. About ────────────────────────────────────────────────── */}
          <SectionFrame index={1} stagger={stagger} reduced={!!prefersReducedMotion}>
            <CollapsibleSection
              label="About"
              expanded={expanded.about}
              onToggle={() => toggle("about")}
              reduced={!!prefersReducedMotion}
            >
              <div className="card-surface rounded-xs p-4 space-y-3">
                {gymLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-5/6" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                ) : (
                  <>
                    {gym?.about?.trim() ? (
                      <p className="text-[13px] text-foreground leading-snug whitespace-pre-wrap">
                        {gym.about}
                      </p>
                    ) : (
                      <p className="text-[13px] text-muted-foreground leading-snug">
                        No description yet.
                      </p>
                    )}

                    {(gym?.location?.trim() || founded || coachName) && (
                      <div className="pt-3 border-t border-border/40 space-y-1.5">
                        {gym?.location?.trim() && (
                          <MetaRow
                            icon={<MapPin className="h-3.5 w-3.5" />}
                            label="Location"
                            value={gym.location}
                          />
                        )}
                        {founded && (
                          <MetaRow
                            icon={
                              <Icon
                                name="calendarOutline"
                                size={14}
                                className="text-muted-foreground"
                              />
                            }
                            label="Founded"
                            value={founded}
                          />
                        )}
                        {coachName && (
                          <MetaRow
                            icon={
                              <Icon
                                name="ribbonOutline"
                                size={14}
                                className="text-muted-foreground"
                              />
                            }
                            label="Coach"
                            value={coachName}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </CollapsibleSection>
          </SectionFrame>

          {/* 3. Members ──────────────────────────────────────────────── */}
          <SectionFrame index={2} stagger={stagger} reduced={!!prefersReducedMotion}>
            <CollapsibleSection
              label="Members"
              count={membersLoading ? undefined : members?.length ?? 0}
              expanded={expanded.members}
              onToggle={() => toggle("members")}
              reduced={!!prefersReducedMotion}
            >
              <div className="card-surface rounded-xs p-4 space-y-3">
                {membersLoading ? (
                  <div className="flex gap-3 overflow-hidden">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <Skeleton className="h-2.5 w-10" />
                      </div>
                    ))}
                  </div>
                ) : members && members.length > 0 ? (
                  <>
                    <p className="text-[13px] text-muted-foreground leading-snug">
                      {members.length} {members.length === 1 ? "member" : "members"} in this gym.
                    </p>
                    <div
                      className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1"
                      role="list"
                    >
                      {visibleMembers.map((m) => (
                        <div
                          key={m.userId}
                          role="listitem"
                          className="flex flex-col items-center gap-1.5 shrink-0 w-14"
                        >
                          <MemberAvatar
                            avatarUrl={m.avatarUrl}
                            displayName={m.displayName}
                            size={48}
                          />
                          <span className="text-[11px] text-muted-foreground truncate w-full text-center">
                            {firstName(m.displayName)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {extraMembers > 0 && (
                      <p className="text-[12px] font-medium text-primary">
                        +{extraMembers} more {extraMembers === 1 ? "member" : "members"}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-muted-foreground leading-snug">
                    No members yet.
                  </p>
                )}
              </div>
            </CollapsibleSection>
          </SectionFrame>

          {/* 4. Stats ────────────────────────────────────────────────── */}
          <SectionFrame index={3} stagger={stagger} reduced={!!prefersReducedMotion}>
            <CollapsibleSection
              label="Stats"
              expanded={expanded.stats}
              onToggle={() => toggle("stats")}
              reduced={!!prefersReducedMotion}
            >
              <div className="card-surface rounded-xs p-4">
                {statsLoading ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="rounded-xs bg-muted/30 p-3 space-y-2">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-2.5 w-16" />
                      </div>
                    ))}
                  </div>
                ) : stats ? (
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile
                      value={stats.memberCount}
                      label={stats.memberCount === 1 ? "Member" : "Members"}
                    />
                    <StatTile
                      value={stats.activePosters7d}
                      label="Active this week"
                    />
                    <StatTile
                      value={stats.activePostersToday}
                      label="Trained today"
                    />
                    <StatTile
                      value={founded ? founded.split(" ")[1] ?? "N/A" : "N/A"}
                      label="Since"
                      isText
                    />
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground leading-snug">
                    No stats yet. Check back after your gym logs some sessions.
                  </p>
                )}
              </div>
            </CollapsibleSection>
          </SectionFrame>

          {/* 5. Actions ──────────────────────────────────────────────── */}
          <SectionFrame index={4} stagger={stagger} reduced={!!prefersReducedMotion}>
            <div className="px-5 mt-6 space-y-3">
              {gymLoading || myMembership === undefined ? (
                <Skeleton className="h-12 w-full rounded-2xl" />
              ) : (
                <>
                  {/* Data-sharing toggle — shown for any member (owner */}
                  {/* included; an owner can opt out of sharing their own */}
                  {/* data with their own dashboard). */}
                  {(isMember || isOwner) && memberId && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={handleToggleShare}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          handleToggleShare();
                        }
                      }}
                      className="flex items-center gap-3 rounded-2xl border border-border/40 bg-muted/10 p-4 cursor-pointer active:opacity-80 transition-opacity"
                    >
                      <div className="h-9 w-9 rounded-xs bg-primary/15 flex items-center justify-center shrink-0">
                        <Icon
                          name="shareSocialOutline"
                          size={16}
                          className="text-primary"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold leading-tight">
                          Share my data with the coach
                        </p>
                        <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                          Recovery scores, weight trend, sessions show up in their dashboard.
                        </p>
                      </div>
                      <Switch
                        checked={currentShare}
                        onCheckedChange={() => handleToggleShare()}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Share my data with the coach"
                      />
                    </div>
                  )}

                  {isOwner ? (
                    <p className="text-[12px] text-muted-foreground text-center">
                      You own this gym. Manage ownership in Settings.
                    </p>
                  ) : isMember && memberId ? (
                    <button
                      type="button"
                      onClick={() => setLeaveOpen(true)}
                      className="w-full rounded-2xl border border-func-danger-red/40 bg-func-danger-red/[0.04] px-4 py-3 text-func-danger-red font-semibold active:scale-[0.99] transition flex items-center justify-center"
                    >
                      <Icon name="logOutOutline" size={16} className="mr-2" />
                      Leave gym
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </SectionFrame>
        </div>
      </SheetContent>

      <AlertDialog open={leaveOpen} onOpenChange={(o) => !leaving && setLeaveOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">
              Leave {gym?.name ?? "this gym"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You will no longer appear in the gym roster or feed. Your past posts will be tagged as posted by a former member. Your coach will lose visibility of your training data going forward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-center sm:justify-center gap-2">
            <AlertDialogCancel disabled={leaving} className="mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={leaving}
              className="bg-func-danger-red hover:bg-func-danger-red/90"
            >
              {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Leave gym"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

/**
 * Wraps each below-header section in a staggered fade-in on first mount.
 * `index` is the section ordinal (1..n); `stagger` is per-step delay in
 * seconds. When reduced motion is requested the wrapper degrades to a
 * plain div with no animation.
 */
function SectionFrame({
  index,
  stagger,
  reduced,
  children,
}: {
  index: number;
  stagger: number;
  reduced: boolean;
  children: React.ReactNode;
}) {
  if (reduced) return <div>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 4) * stagger }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Section row with a tap-to-toggle header (chevron rotates 90deg when
 * open) and an `AnimatePresence` body that height-animates between
 * collapsed and expanded. The `count` chip is optional — when supplied
 * it sits flush-right next to the chevron.
 */
function CollapsibleSection({
  label,
  count,
  expanded,
  onToggle,
  reduced,
  children,
}: {
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  reduced: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 mt-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 py-2 -mx-1 px-1 active:opacity-70 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
            {label}
          </span>
          {typeof count === "number" && (
            <span className="inline-flex items-center h-4 px-1.5 rounded-full bg-muted/60 text-[10px] font-semibold text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </div>
        <ChevronDown
          className="h-4 w-4 text-muted-foreground/60 transition-transform"
          style={{
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            transitionDuration: reduced ? "0ms" : "180ms",
          }}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Discipline-coloured chip. Same visual as the original Disciplines grid. */
function DisciplinePill({ discipline }: { discipline: string }) {
  const token = disciplineToken(discipline);
  return (
    <span
      className="inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{
        backgroundColor: `hsl(var(${token}) / 0.15)`,
        color: `hsl(var(${token}))`,
      }}
    >
      {disciplineLabel(discipline)}
    </span>
  );
}

/** Single label/value row used inside the About card's meta block. */
function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted-foreground/80 shrink-0 flex items-center justify-center w-4">
        {icon}
      </span>
      <span className="text-muted-foreground/70 w-16 shrink-0">{label}</span>
      <span className="text-foreground font-medium truncate">{value}</span>
    </div>
  );
}

/** 2-col stat card. `isText` switches off tabular-nums for non-numeric values. */
function StatTile({
  value,
  label,
  isText,
}: {
  value: string | number;
  label: string;
  isText?: boolean;
}) {
  return (
    <div className="rounded-xs bg-muted/30 p-3 flex flex-col gap-0.5">
      <span
        className={`text-[17px] font-semibold leading-none ${isText ? "" : "tabular-nums"}`}
      >
        {value}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 mt-1">
        {label}
      </span>
    </div>
  );
}

/**
 * Circular member avatar with single-letter fallback. Size-configurable
 * because the new Members section renders a larger 48px chip than the
 * old 32px list row.
 */
function MemberAvatar({
  avatarUrl,
  displayName,
  size = 32,
}: {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
}) {
  const initial = (displayName.trim()[0] || "?").toUpperCase();
  const dim = { width: size, height: size };
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${displayName} avatar`}
        className="rounded-full object-cover bg-muted/40 flex-shrink-0"
        style={dim}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0"
      style={dim}
      aria-label={`${displayName} avatar`}
    >
      <span
        className="font-semibold text-muted-foreground"
        style={{ fontSize: Math.max(11, Math.round(size * 0.4)) }}
      >
        {initial}
      </span>
    </div>
  );
}

/** Strip the surname so the Members strip can fit a name under each 48px chip. */
function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "Member";
  const [first] = trimmed.split(/\s+/);
  return first ?? trimmed;
}
