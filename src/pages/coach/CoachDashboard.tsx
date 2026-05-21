/**
 * Coach Dashboard — redesigned for engagement, hierarchy, and scan-ability.
 *
 * Vibe: Bold + status-coded (Apple Health). Solid primary blue accents,
 * semantic colors (emerald/amber/rose) for status, no gradients on UI.
 *
 * Layout top → bottom:
 *   1. Header (coach name + refresh + settings chip)
 *   2. Gym header card (logo, name, invite code + share)
 *   3. EITHER:
 *      - Stats grid (3 tiles: On plan / Watch / Alert)   when athletes exist
 *      - "Getting started" hero with checklist            when no athletes
 *   4. Athlete roster (status-edge cards, sorted by severity)
 *   5. Fight offers tile
 *   6. Gym feed widget
 *   7. Weekly leaderboard
 *   8. Floating action button (bottom-right) — "Announce" — only when athletes
 */
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Copy,
  Check,
  Share2,
  Megaphone,
  RefreshCw,
  UserPlus,
  Building2,
  Eye,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useUser } from "@/contexts/UserContext";
import { useCoachData, type AthleteOverviewRow, type GymRow } from "@/hooks/coach/useCoachData";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { shareGymInvite } from "@/lib/shareInvite";
import { CoachSettingsSheet } from "@/components/coach/CoachSettingsSheet";
import { GymLogoUpload } from "@/components/coach/GymLogoUpload";
import { AthleteAvatar } from "@/components/coach/AthleteAvatar";
import { StrainSparkline } from "@/components/coach/StrainSparkline";
import { AnnouncementComposeSheet } from "@/components/coach/AnnouncementComposeSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CoachFightOffersTile } from "@/components/coach/CoachFightOffersTile";
import { LeaderboardSection } from "@/components/leaderboard/LeaderboardSection";
import { GymFeedWidget } from "@/components/coach/GymFeedWidget";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { localCache } from "@/lib/localCache";
import ErrorBoundary from "@/components/ErrorBoundary";
import { registerPullRefresh } from "@/lib/pullRefreshRegistry";
import type { Id } from "../../../convex/_generated/dataModel";

// ── Helpers ──────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

function relativeWeight(a: AthleteOverviewRow): { delta: number | null; target: number | null } {
  const target = a.fight_week_target_kg ?? a.goal_weight_kg ?? null;
  if (a.current_weight_kg == null || target == null) return { delta: null, target };
  return { delta: +(a.current_weight_kg - target).toFixed(1), target };
}

type Severity = "ok" | "warn" | "alert";

function flagSeverity(a: AthleteOverviewRow): Severity {
  if (a.fight_form && a.fight_form.state === "ok") {
    if (a.fight_form.label === "at_risk") return "alert";
    if (a.fight_form.label === "off_pace") return "warn";
  }
  const wDays = daysSince(a.last_weight_at);
  if (wDays != null && wDays >= 3) return "alert";
  const cals = a.todays_calories || 0;
  const goal = a.daily_calorie_goal || 0;
  if (goal > 0 && cals > goal * 1.15) return "warn";
  if (wDays != null && wDays >= 2) return "warn";
  return "ok";
}

// Severity sort order: alert first → warn → ok. Within each bucket,
// freshest stale logs first so "5d no log" lands at the very top.
const SEV_RANK: Record<Severity, number> = { alert: 0, warn: 1, ok: 2 };
function bySeverity(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  const da = SEV_RANK[flagSeverity(a)];
  const db = SEV_RANK[flagSeverity(b)];
  if (da !== db) return da - db;
  const ad = daysSince(a.last_weight_at) ?? -1;
  const bd = daysSince(b.last_weight_at) ?? -1;
  return bd - ad;
}

// Apple Health-style edge bars + accent classes per severity.
const SEV_EDGE: Record<Severity, string> = {
  ok: "bg-func-recovery-green",
  warn: "bg-func-warning-yellow",
  alert: "bg-func-danger-red",
};
const SEV_BADGE_BG: Record<Severity, string> = {
  ok: "bg-func-recovery-green/12 text-func-recovery-green ring-func-recovery-green/25",
  warn: "bg-func-warning-yellow/12 text-func-warning-yellow ring-func-warning-yellow/25",
  alert: "bg-func-danger-red/12 text-func-danger-red ring-func-danger-red/25",
};
const SEV_LABEL: Record<Severity, string> = {
  ok: "On plan",
  warn: "Watch",
  alert: "Alert",
};

const FIGHT_FORM_LABEL: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

// ── Page ─────────────────────────────────────────────────────────────

export default function CoachDashboard() {
  const { userId, userName } = useUser();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { gyms, athletes, loading, refresh } = useCoachData(userId);
  const prefersReduced = useReducedMotion();

  const handleLogoUploaded = (gymId: string, newUrl: string | null) => {
    if (!userId) return;
    try {
      const cached = localCache.get<GymRow[]>(userId, "coach_gyms") || [];
      const updated = cached.map((g) => (g.id === gymId ? { ...g, logo_url: newUrl } : g));
      localCache.set(userId, "coach_gyms", updated);
    } catch {}
    void refresh();
  };
  const [copied, setCopied] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composingForGym, setComposingForGym] = useState<GymRow | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    try { localStorage.removeItem("wcw_intended_role"); } catch {}
  }, []);

  useEffect(() => registerPullRefresh(() => refresh()), [refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, AthleteOverviewRow[]>();
    for (const a of athletes) {
      if (!map.has(a.gym_id)) map.set(a.gym_id, []);
      map.get(a.gym_id)!.push(a);
    }
    return map;
  }, [athletes]);

  const stats = useMemo(() => {
    const total = athletes.length;
    const alerts = athletes.filter((a) => flagSeverity(a) === "alert").length;
    const warns = athletes.filter((a) => flagSeverity(a) === "warn").length;
    const okCount = total - alerts - warns;
    return { total, alerts, warns, okCount };
  }, [athletes]);

  const copyCode = async (code: string) => {
    triggerHaptic(ImpactStyle.Light);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1800);
      toast({ title: "Invite code copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const shareInvite = async (gym: GymRow) => {
    triggerHaptic(ImpactStyle.Light);
    const result = await shareGymInvite({ gymName: gym.name, code: gym.invite_code });
    if (result.via === "clipboard") {
      toast({ title: "Invite link copied", description: "Paste it anywhere" });
    } else if (result.via === "none") {
      toast({ title: "Could not share", variant: "destructive" });
    }
  };

  if (loading && athletes.length === 0) return <DashboardSkeleton />;

  if (!loading && gyms.length === 0) {
    return <Navigate to="/coach/onboarding" replace />;
  }

  // For the FAB — only show the announce button when there's a roster to
  // announce TO. A new coach pre-invite doesn't need this affordance yet.
  const hasAnyAthletes = athletes.length > 0;
  const fabGym = composingForGym ?? gyms[0];

  return (
    <ErrorBoundary>
      <div
        className="animate-page-in space-y-4 px-5 py-3 sm:p-5 md:p-6 w-full max-w-3xl mx-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              Coach
            </p>
            <h1 className="text-[19px] font-bold leading-tight truncate">
              {userName || gyms[0].name}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); void refresh(); }}
              disabled={loading}
              className="h-9 w-9 rounded-full bg-muted/60 flex items-center justify-center active:bg-muted/80 transition-colors disabled:opacity-60"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="h-9 w-9 rounded-full bg-muted/60 flex items-center justify-center active:bg-muted/80 transition-colors"
              aria-label="Settings"
            >
              <span className="text-[12px] font-semibold text-muted-foreground">
                {(userName || "C").charAt(0).toUpperCase()}
              </span>
            </button>
          </div>
        </div>

        {/* Per-gym sections */}
        {gyms.map((gym) => {
          const gymAthletes = (grouped.get(gym.id) ?? []).slice().sort(bySeverity);
          const hasAthletes = gymAthletes.length > 0;

          // Per-gym stats (only computed when needed)
          const gymStats = {
            total: gymAthletes.length,
            alerts: gymAthletes.filter((a) => flagSeverity(a) === "alert").length,
            warns: gymAthletes.filter((a) => flagSeverity(a) === "warn").length,
          };
          gymStats.alerts;
          const okCount = gymStats.total - gymStats.alerts - gymStats.warns;

          return (
            <section key={gym.id} className="space-y-4">
              {/* Gym header — compact identity card */}
              <div className="rounded-xs border border-border/60 bg-card/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <GymLogoUpload
                    gymId={gym.id}
                    gymName={gym.name}
                    currentLogoUrl={gym.logo_url}
                    size={44}
                    onUploaded={(url) => handleLogoUploaded(gym.id, url)}
                    hideRemove
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold truncate">{gym.name}</p>
                    {gym.location && (
                      <p className="text-[11px] text-muted-foreground truncate">{gym.location}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => copyCode(gym.invite_code)}
                      className="flex items-center gap-1.5 px-2.5 min-h-[36px] rounded-xs bg-muted/40 active:bg-muted/60 transition-colors"
                      aria-label="Copy invite code"
                    >
                      <span className="font-mono text-[12px] font-semibold tracking-widest tabular-nums">
                        {gym.invite_code}
                      </span>
                      {copied === gym.invite_code ? (
                        <Check className="h-3 w-3 text-func-recovery-green" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      onClick={() => shareInvite(gym)}
                      className="flex items-center justify-center min-h-[36px] min-w-[36px] rounded-xs bg-muted/40 active:bg-muted/60 transition-colors text-muted-foreground"
                      aria-label="Share invite link"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Stats grid OR Getting Started hero */}
              {hasAthletes ? (
                <StatsGrid
                  okCount={okCount}
                  warns={gymStats.warns}
                  alerts={gymStats.alerts}
                  prefersReduced={prefersReduced}
                />
              ) : (
                <GettingStartedHero
                  gym={gym}
                  onShareInvite={() => shareInvite(gym)}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onTour={() => {
                    triggerHaptic(ImpactStyle.Light);
                    setPreviewOpen(true);
                  }}
                  prefersReduced={prefersReduced}
                />
              )}

              {/* Athlete roster — comes BEFORE offers/feed/leaderboard so
                  triage is the first thing the coach scans through. */}
              {hasAthletes && (
                <div className="space-y-2">
                  <SectionLabel>Roster · sorted by who needs you</SectionLabel>
                  {gymAthletes.map((a) => (
                    <AthleteRow
                      key={a.user_id}
                      athlete={a}
                      onOpen={() => navigate(`/coach/athletes/${a.user_id}`)}
                    />
                  ))}
                </div>
              )}

              {/* Fight offers, feed, leaderboard — operational/ambient
                  context BELOW the roster so the coach scans triage first.
                  Hidden entirely on the empty-roster state so the Getting
                  Started hero is the only thing the coach sees. */}
              {hasAthletes && (
                <>
                  <CoachFightOffersTile gymId={gym.id} />
                  <GymFeedWidget gymId={gym.id as Id<"gyms">} gymName={gym.name} />
                  <LeaderboardSection
                    gymId={gym.id as Id<"gyms">}
                    viewer="coach"
                    onRowClick={(userId) => navigate(`/coach/athletes/${userId}`)}
                  />
                </>
              )}
            </section>
          );
        })}
      </div>

      {/* Floating Announce button — only when there's a roster to announce to */}
      {hasAnyAthletes && fabGym && (
        <button
          onClick={() => { triggerHaptic(ImpactStyle.Medium); setComposingForGym(fabGym); }}
          className="fixed z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/40 flex items-center justify-center active:scale-95 transition-transform"
          style={{
            right: "calc(env(safe-area-inset-right, 0px) + 18px)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
          }}
          aria-label="New announcement"
        >
          <Megaphone className="h-5 w-5" strokeWidth={2.25} />
        </button>
      )}

      <CoachSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      {composingForGym && (
        <AnnouncementComposeSheet
          open={!!composingForGym}
          onOpenChange={(o) => { if (!o) setComposingForGym(null); }}
          gymId={composingForGym.id}
          gymName={composingForGym.name}
          athletes={grouped.get(composingForGym.id) ?? []}
        />
      )}
      <AthletePreviewSheet open={previewOpen} onOpenChange={setPreviewOpen} />
    </ErrorBoundary>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground/70">
      {children}
    </p>
  );
}

function StatsGrid({
  okCount,
  warns,
  alerts,
  prefersReduced,
}: {
  okCount: number;
  warns: number;
  alerts: number;
  prefersReduced: boolean | null;
}) {
  const tiles = [
    { value: okCount,  label: "On plan", edge: "bg-func-recovery-green", tone: "text-func-recovery-green", glow: "shadow-func-recovery-green/10" },
    { value: warns,    label: "Watch",   edge: "bg-func-warning-yellow",   tone: "text-func-warning-yellow",   glow: "shadow-func-warning-yellow/10"   },
    { value: alerts,   label: "Alert",   edge: "bg-func-danger-red",    tone: "text-func-danger-red",    glow: "shadow-func-danger-red/10"    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={prefersReduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: "easeOut", delay: i * 0.05 }}
          className={`relative overflow-hidden rounded-xs border border-border/50 bg-card/70 px-3 pt-3 pb-3 shadow-lg ${t.glow}`}
        >
          {/* Status edge — Apple Health-style top color bar */}
          <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${t.edge}`} />
          <p className={`display-number text-[28px] font-black leading-none tabular-nums ${t.tone}`}>
            {t.value}
          </p>
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-muted-foreground">
            {t.label}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

function AthleteRow({
  athlete,
  onOpen,
}: {
  athlete: AthleteOverviewRow;
  onOpen: () => void;
}) {
  const sev = flagSeverity(athlete);
  const { delta, target } = relativeWeight(athlete);
  const wDays = daysSince(athlete.last_weight_at);

  // Pick the single most-relevant data point for the right side.
  let keyMetric: { value: string; sub: string; tone: string };
  if (sev === "alert" && wDays != null && wDays >= 3) {
    keyMetric = {
      value: `${wDays}d`,
      sub: "no log",
      tone: "text-func-danger-red",
    };
  } else if (athlete.fight_form && athlete.fight_form.state === "ok") {
    keyMetric = {
      value: String(athlete.fight_form.score),
      sub: FIGHT_FORM_LABEL[athlete.fight_form.label] ?? "Form",
      tone:
        athlete.fight_form.label === "sharp" ? "text-func-recovery-green" :
        athlete.fight_form.label === "sharpening" ? "text-func-warning-yellow" :
        athlete.fight_form.label === "off_pace" ? "text-func-carbs-orange" :
        "text-func-danger-red",
    };
  } else if (delta != null && target != null) {
    const absV = Math.abs(delta);
    const signed = absV < 0.1 ? "0.0" : delta > 0 ? `+${absV.toFixed(1)}` : `−${absV.toFixed(1)}`;
    keyMetric = {
      value: signed,
      sub: "to target",
      tone:
        absV < 0.1 ? "text-func-recovery-green" :
        delta > 0  ? "text-func-warning-yellow"   :
        "text-func-recovery-green",
    };
  } else {
    keyMetric = {
      value: `${Math.round(athlete.todays_calories || 0)}`,
      sub: "kcal today",
      tone: "text-foreground/80",
    };
  }

  return (
    <button
      onClick={onOpen}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xs border border-border/50 bg-card/60 pl-4 pr-3 py-3 min-h-[64px] text-left active:bg-muted/30 transition-colors"
    >
      {/* Apple Health-style status edge bar */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${SEV_EDGE[sev]}`} />

      <AthleteAvatar avatarUrl={athlete.avatar_url} name={athlete.display_name} size={36} />

      {/* Name + meta — flexible width, truncates if name is long. Badge
          moved to the right-side column so it stays in a vertical line
          across rows regardless of name length. */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold truncate">{athlete.display_name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground truncate tabular-nums">
          {athlete.current_weight_kg != null ? `${athlete.current_weight_kg.toFixed(1)}kg` : "—"}
          {target != null ? ` · target ${target.toFixed(1)}` : ""}
          {wDays != null && wDays >= 1 ? ` · ${wDays}d ago` : " · logged today"}
        </p>
      </div>

      {/* 7-day strain sparkline — hides on narrow viewports */}
      <StrainSparkline
        values={athlete.strain_7d ?? []}
        width={52}
        height={20}
        className="flex-shrink-0 hidden sm:block"
      />
      <StrainSparkline
        values={athlete.strain_7d ?? []}
        width={40}
        height={18}
        className="flex-shrink-0 sm:hidden"
      />

      {/* Right column — fixed width keeps badge + value + sub aligned
          vertically across every row. Width is wide enough to fit the
          longest status label ("ON PLAN") + a 3-char metric. */}
      <div className="flex-shrink-0 w-[78px] text-right">
        <span
          className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ring-1 ${SEV_BADGE_BG[sev]}`}
        >
          {SEV_LABEL[sev]}
        </span>
        <p className={`mt-1 text-[20px] font-bold tabular-nums leading-none ${keyMetric.tone}`}>
          {keyMetric.value}
        </p>
        <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
          {keyMetric.sub}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
    </button>
  );
}

// ── Getting Started Hero ────────────────────────────────────────────
// Brand-new coach (zero athletes) — single consolidated card with the
// wizard + a 3-item checklist replacing the row of 3 empty cards.

function GettingStartedHero({
  gym,
  onShareInvite,
  onOpenSettings,
  onTour,
  prefersReduced,
}: {
  gym: GymRow;
  onShareInvite: () => void;
  onOpenSettings: () => void;
  onTour: () => void;
  prefersReduced: boolean | null;
}) {
  const items: ChecklistItem[] = [
    { id: "create",   done: true,                       label: "Create your gym",        meta: gym.name, action: null },
    { id: "invite",   done: false, kind: "primary",     label: "Invite your first fighter", meta: gym.invite_code, action: onShareInvite, actionLabel: "Share invite", icon: UserPlus },
    { id: "profile",  done: !!gym.logo_url,             label: "Complete gym profile",  meta: "Logo · disciplines · roster size", action: onOpenSettings, actionLabel: "Open settings", icon: Building2 },
    { id: "tour",     done: false,                      label: "Tour the athlete view", meta: "Sample card preview",              action: onTour, actionLabel: "See preview", icon: Eye },
  ];

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative overflow-hidden rounded-xs border border-primary/25 bg-card/70 p-4 shadow-xl shadow-primary/10"
    >
      {/* Top mascot + greeting */}
      <div className="flex items-start gap-3 mb-4">
        <div className="relative shrink-0" style={{ width: 60, height: 60 }}>
          <div style={{ width: 140, height: 140, transform: "scale(0.43)", transformOrigin: "top left" }}>
            <WizardCharacter pose="wave" />
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
            Welcome, coach
          </p>
          <h2 className="mt-0.5 text-[17px] font-bold leading-tight">
            Let's get your fighters in.
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
            Three quick steps to set up. The roster lands here once they join.
          </p>
        </div>
      </div>

      {/* Checklist */}
      <ul className="space-y-2">
        {items.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </ul>
    </motion.div>
  );
}

type ChecklistItem = {
  id: string;
  done: boolean;
  label: string;
  meta?: string;
  action: (() => void) | null;
  actionLabel?: string;
  kind?: "primary";
  icon?: typeof UserPlus;
};

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const Icon = item.icon;
  return (
    <li
      className={`flex items-center gap-3 rounded-xs border px-3 py-2.5 ${
        item.done
          ? "border-func-recovery-green/20 bg-func-recovery-green/[0.04]"
          : item.kind === "primary"
            ? "border-primary/30 bg-primary/[0.06]"
            : "border-border/50 bg-card/50"
      }`}
    >
      {/* Status circle */}
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          item.done
            ? "bg-func-recovery-green/20 ring-1 ring-func-recovery-green/40"
            : "bg-primary/15 ring-1 ring-primary/30"
        }`}
      >
        {item.done ? (
          <Check className="h-3.5 w-3.5 text-func-recovery-green" strokeWidth={3} />
        ) : Icon ? (
          <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
        ) : (
          <span className="text-[10px] font-bold text-primary">·</span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={`text-[13px] font-semibold leading-tight ${
            item.done ? "text-muted-foreground line-through decoration-func-recovery-green/50" : "text-foreground"
          }`}
        >
          {item.label}
        </p>
        {item.meta && (
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{item.meta}</p>
        )}
      </div>

      {item.action && (
        <button
          onClick={item.action}
          className={`shrink-0 h-9 w-[104px] rounded-xs text-[11px] font-semibold whitespace-nowrap leading-none flex items-center justify-center text-center active:scale-[0.96] transition-transform ${
            item.kind === "primary"
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
              : "bg-muted/40 text-foreground hover:bg-muted/60"
          }`}
        >
          {item.actionLabel ?? "Open"}
        </button>
      )}
    </li>
  );
}

// ── Athlete preview sheet ───────────────────────────────────────────
// Mock-data tour so a new coach sees how the active roster will look
// before any fighters have joined. Each sample row demonstrates one
// severity state with annotations pointing at the moving parts.

function AthletePreviewSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl border-border/60 px-5 pt-5 pb-8 max-h-[88vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[19px] font-bold">Your roster, at a glance</SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            Once fighters join your gym, you'll see them sorted by who needs you most. Here's how each row reads.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          <SampleRow
            sev="alert"
            avatarInitial="S"
            name="Sasha R."
            meta="118.4kg · target 116.0 · 5d ago"
            metric={{ value: "5d", sub: "no log", tone: "text-func-danger-red" }}
            spark={[3, 2, 1, 1, 0, 0, 0]}
          />
          <SampleRow
            sev="warn"
            avatarInitial="M"
            name="Mei L."
            meta="120.1kg · target 118.0 · 1d ago"
            metric={{ value: "+2.1", sub: "to target", tone: "text-func-warning-yellow" }}
            spark={[6, 5, 6, 7, 6, 5, 6]}
          />
          <SampleRow
            sev="ok"
            avatarInitial="D"
            name="Daniel V."
            meta="70.3kg · target 70.0 · logged today"
            metric={{ value: "82", sub: "Sharp", tone: "text-func-recovery-green" }}
            spark={[4, 5, 6, 7, 7, 6, 7]}
          />
        </div>

        {/* Annotation legend — fixed-width leading column so every row's
            text starts at the same x position regardless of badge shape. */}
        <ul className="mt-5 space-y-3 text-[12px] text-muted-foreground leading-snug">
          <li className="flex items-start gap-3">
            <span className="flex w-12 shrink-0 items-center justify-center pt-0.5">
              <span aria-hidden className="h-4 w-1 rounded-sm bg-func-danger-red" />
            </span>
            <span className="flex-1">
              <span className="font-semibold text-foreground">Left edge</span> = severity. Rose = alert, amber = watch, emerald = on plan.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex w-12 shrink-0 items-center justify-center pt-0.5">
              <span aria-hidden className="inline-flex items-center justify-center rounded-full bg-func-danger-red/12 text-func-danger-red ring-1 ring-func-danger-red/25 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider">
                Alert
              </span>
            </span>
            <span className="flex-1">
              <span className="font-semibold text-foreground">Status pill</span> labels the severity in words.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex w-12 shrink-0 items-center justify-center pt-0.5">
              <span aria-hidden className="inline-block h-3 w-8 rounded-sm bg-primary/30 ring-1 ring-primary/40" />
            </span>
            <span className="flex-1">
              <span className="font-semibold text-foreground">Sparkline</span> shows 7-day training strain (RPE-hours).
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex w-12 shrink-0 items-center justify-center pt-0.5">
              <span aria-hidden className="text-[13px] font-bold leading-none text-func-recovery-green tabular-nums">82</span>
            </span>
            <span className="flex-1">
              <span className="font-semibold text-foreground">Right metric</span> is the one number that matters most for that athlete — readiness score, days since log, or delta to target.
            </span>
          </li>
        </ul>

        <button
          onClick={() => onOpenChange(false)}
          className="mt-6 w-full h-11 rounded-xs bg-primary text-primary-foreground font-semibold text-[14px] shadow-md shadow-primary/30 active:scale-[0.98] transition-transform"
        >
          Got it
        </button>
      </SheetContent>
    </Sheet>
  );
}

function SampleRow({
  sev,
  avatarInitial,
  name,
  meta,
  metric,
  spark,
}: {
  sev: Severity;
  avatarInitial: string;
  name: string;
  meta: string;
  metric: { value: string; sub: string; tone: string };
  spark: number[];
}) {
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-xs border border-border/50 bg-card/60 pl-4 pr-3 py-3 min-h-[60px]">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${SEV_EDGE[sev]}`} />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[12px] font-bold text-muted-foreground">
        {avatarInitial}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold truncate">{name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground truncate tabular-nums">{meta}</p>
      </div>
      <StrainSparkline values={spark} width={44} height={18} className="flex-shrink-0" />
      <div className="flex-shrink-0 w-[78px] text-right">
        <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ring-1 ${SEV_BADGE_BG[sev]}`}>
          {SEV_LABEL[sev]}
        </span>
        <p className={`mt-1 text-[18px] font-bold tabular-nums leading-none ${metric.tone}`}>
          {metric.value}
        </p>
        <p className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
          {metric.sub}
        </p>
      </div>
    </div>
  );
}
