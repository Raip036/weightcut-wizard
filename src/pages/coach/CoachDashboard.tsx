/**
 * Coach Dashboard — Apple Fitness dark-mode rewrite.
 *
 * Layout (single scroll, tight bento):
 *   1. Header strip — "Coach" eyebrow + gym name + refresh / settings
 *   2. KPI strip   — Athletes / Sessions / Fights / Alerts (4 tiles)
 *   3. Athlete list (dominant element)
 *        - Sort selector
 *        - One AthleteListRow per fighter; all 4 signals visible inline
 *   4. Recent activity feed (existing CampActivityFeed)
 *
 * The previous version had a per-gym stats grid, gym-feed widget, fight
 * offers tile, and leaderboard interleaved between roster sections. Those
 * have been pushed elsewhere in the IA — the dashboard now exists for
 * triage and triage only. Multi-gym coaches still see all their athletes
 * (they're sorted into one combined list with the gym name visible in the
 * row when needed via a future enhancement; current rows show the
 * athlete-side data only).
 */
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Megaphone, RefreshCw } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import {
  useCoachData,
  type AthleteOverviewRow,
  type GymRow,
} from "@/hooks/coach/useCoachData";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { CoachSettingsSheet } from "@/components/coach/CoachSettingsSheet";
import { AnnouncementComposeSheet } from "@/components/coach/AnnouncementComposeSheet";
import { CampActivityFeed } from "@/components/coach/CampActivityFeed";
import { KpiStrip } from "@/components/coach/dashboard/KpiStrip";
import {
  AthleteListSort,
  type AthleteSort,
} from "@/components/coach/dashboard/AthleteListSort";
import { AthleteListRow } from "@/components/coach/dashboard/AthleteListRow";
import {
  buildAlerts,
  trainingHoursThisWeek,
} from "@/components/coach/dashboard/athleteRowHelpers";
import { EmptyDashboardState } from "@/components/coach/dashboard/EmptyDashboardState";
import { registerPullRefresh } from "@/lib/pullRefreshRegistry";
import ErrorBoundary from "@/components/ErrorBoundary";
import type { Id } from "../../../convex/_generated/dataModel";

// ── Helpers ──────────────────────────────────────────────────────────

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function readinessScore(a: AthleteOverviewRow): number | null {
  if (a.fight_form && a.fight_form.state === "ok") return a.fight_form.score;
  return null;
}

// Count distinct training days this week by scanning the strain_7d
// bucket array — any non-zero bucket means at least one logged session
// that day. The query already populates this for every athlete.
function sessionsThisWeekFor(a: AthleteOverviewRow): number {
  return (a.strain_7d ?? []).filter((v) => (v ?? 0) > 0).length;
}

// ── Sorters ──────────────────────────────────────────────────────────
// Each sorter returns a comparator that yields a stable ordering. Every
// comparator falls back to alphabetical name ordering on ties so the
// list is deterministic regardless of upstream order. Nulls always sink
// to the bottom — coaches should see real data first, blanks last.

/** Most recent activity timestamp across the signals we ship on the row. */
function lastActiveMs(a: AthleteOverviewRow): number | null {
  let best: number | null = null;
  for (const iso of [a.last_weight_at, a.last_meal_at]) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

/** Stable alphabetical tie-breaker shared by every sorter. */
function byName(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  return a.display_name.localeCompare(b.display_name);
}

function sortByRank(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  // Rank = "who needs you most": more alerts first, then lower readiness
  // first (most depleted on top). Athletes with no readiness score sit
  // mid-pack at 50 so they don't dominate either end purely from missing
  // data.
  const sa = buildAlerts(a).length;
  const sb = buildAlerts(b).length;
  if (sa !== sb) return sb - sa;
  const ra = readinessScore(a) ?? 50;
  const rb = readinessScore(b) ?? 50;
  if (ra !== rb) return ra - rb;
  return byName(a, b);
}

function sortByReadiness(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  // Highest readiness first; nulls (still calibrating) sink to bottom.
  // -Infinity as the null sentinel keeps the descending compare correct.
  const ra = readinessScore(a) ?? Number.NEGATIVE_INFINITY;
  const rb = readinessScore(b) ?? Number.NEGATIVE_INFINITY;
  if (ra !== rb) return rb - ra;
  return byName(a, b);
}

function sortByFight(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  // Soonest upcoming fight first; nulls (no fight scheduled) and fights
  // already in the past sink to the bottom — the dashboard is for
  // urgency triage and past fights are no longer actionable.
  const da = daysUntil(a.target_date);
  const db = daysUntil(b.target_date);
  const va = da == null || da < 0 ? Number.POSITIVE_INFINITY : da;
  const vb = db == null || db < 0 ? Number.POSITIVE_INFINITY : db;
  if (va !== vb) return va - vb;
  return byName(a, b);
}

function sortByActive(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  // Most recently active first; never-active athletes sink to bottom.
  // We use the freshest timestamp out of last_weight_at + last_meal_at
  // since either signals the athlete is engaged. Missing timestamps map
  // to -Infinity so they always lose a descending compare.
  const ta = lastActiveMs(a) ?? Number.NEGATIVE_INFINITY;
  const tb = lastActiveMs(b) ?? Number.NEGATIVE_INFINITY;
  if (ta !== tb) return tb - ta;
  return byName(a, b);
}

function sortByTrained(a: AthleteOverviewRow, b: AthleteOverviewRow): number {
  // Highest weekly training hours first; zero-hour athletes naturally
  // sink to the bottom. trainingHoursThisWeek already returns 0 for
  // missing strain data so no extra null guard needed.
  const ha = trainingHoursThisWeek(a);
  const hb = trainingHoursThisWeek(b);
  if (ha !== hb) return hb - ha;
  return byName(a, b);
}

const SORTERS: Record<AthleteSort, (a: AthleteOverviewRow, b: AthleteOverviewRow) => number> = {
  rank: sortByRank,
  readiness: sortByReadiness,
  fight: sortByFight,
  active: sortByActive,
  trained: sortByTrained,
};

// ── Page ─────────────────────────────────────────────────────────────

export default function CoachDashboard() {
  const { userId, userName } = useUser();
  const navigate = useNavigate();
  const { gyms, athletes, loading, refresh } = useCoachData(userId);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composingForGym, setComposingForGym] = useState<GymRow | null>(null);
  const [sort, setSort] = useState<AthleteSort>("rank");

  // One-shot cleanup of the role-intent flag that survives a fresh
  // /coach-onboarding flow — same behaviour as the old dashboard.
  useEffect(() => {
    try {
      localStorage.removeItem("wcw_intended_role");
    } catch {
      // Storage unavailable (Safari private, etc.) — fine to ignore.
    }
  }, []);

  useEffect(() => registerPullRefresh(() => refresh()), [refresh]);

  // ── Sorted athlete list ────────────────────────────────────────────
  const sortedAthletes = useMemo(
    () => athletes.slice().sort(SORTERS[sort]),
    [athletes, sort],
  );

  // ── KPI strip data ─────────────────────────────────────────────────
  // Sessions this week = sum of distinct training days across the roster;
  // Fights this month = athletes whose target_date falls inside the
  // calendar month *and* hasn't passed yet; Alerts = athletes flagged with
  // ≥1 alert chip. All computed locally from data already in `athletes`.
  const kpis = useMemo(() => {
    const sessionsThisWeek = athletes.reduce(
      (sum, a) => sum + sessionsThisWeekFor(a),
      0,
    );

    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const fightsThisMonth = athletes.filter((a) => {
      if (!a.target_date) return false;
      const d = new Date(a.target_date);
      return (
        d.getFullYear() === year &&
        d.getMonth() === month &&
        d.getTime() >= todayMs
      );
    }).length;

    const alerts = athletes.filter((a) => buildAlerts(a).length > 0).length;

    return {
      activeAthletes: athletes.length,
      sessionsThisWeek,
      fightsThisMonth,
      alerts,
    };
  }, [athletes]);

  // ── Loading / empty redirects ─────────────────────────────────────
  if (loading && athletes.length === 0) return <DashboardSkeleton />;
  if (!loading && gyms.length === 0) {
    return <Navigate to="/coach/onboarding" replace />;
  }

  const primaryGym = gyms[0];
  const hasAnyAthletes = athletes.length > 0;

  return (
    <ErrorBoundary>
      <div
        className="dashboard-enter-stagger space-y-4 px-5 pt-3 pb-36 sm:px-5 sm:pt-5 max-w-2xl mx-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 9rem)",
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-bold">
              Coach
            </p>
            <h1 className="text-[22px] font-bold leading-tight truncate tracking-tight">
              {primaryGym?.name ?? userName ?? "Dashboard"}
            </h1>
            {gyms.length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {gyms.length} gyms · {athletes.length} fighters
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                void refresh();
              }}
              disabled={loading}
              aria-label="Refresh"
              className="h-9 w-9 rounded-full bg-muted/40 active:bg-muted/60 transition-colors flex items-center justify-center disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 text-muted-foreground ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="h-9 w-9 rounded-full bg-muted/40 active:bg-muted/60 transition-colors flex items-center justify-center"
            >
              <span className="text-[12px] font-bold text-muted-foreground">
                {(userName || "C").charAt(0).toUpperCase()}
              </span>
            </button>
          </div>
        </header>

        {/* ── KPI strip ──────────────────────────────────────────── */}
        <KpiStrip
          activeAthletes={kpis.activeAthletes}
          sessionsThisWeek={kpis.sessionsThisWeek}
          fightsThisMonth={kpis.fightsThisMonth}
          alerts={kpis.alerts}
        />

        {/* ── Athletes (dominant) ────────────────────────────────── */}
        {hasAnyAthletes ? (
          <section className="space-y-2.5" aria-label="My fighters">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground/80">
                My fighters
              </p>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 font-bold tabular-nums">
                {athletes.length}
              </span>
            </div>
            <AthleteListSort value={sort} onChange={setSort} />
            <div className="space-y-2">
              {sortedAthletes.map((a, i) => (
                <AthleteListRow
                  key={a.user_id}
                  athlete={a}
                  index={i}
                  onOpen={() => navigate(`/coach/athletes/${a.user_id}`)}
                />
              ))}
            </div>
          </section>
        ) : (
          primaryGym && (
            <EmptyDashboardState
              gymName={primaryGym.name}
              inviteCode={primaryGym.invite_code}
            />
          )
        )}

        {/* ── Recent activity feed ───────────────────────────────── */}
        {hasAnyAthletes && (
          <section className="pt-1">
            <CampActivityFeed userId={userId as Id<"users"> | null} limit={6} />
          </section>
        )}
      </div>

      {/* Floating Announce — only when there's a roster to announce to */}
      {hasAnyAthletes && primaryGym && (
        <button
          type="button"
          onClick={() => {
            triggerHaptic(ImpactStyle.Medium);
            setComposingForGym(primaryGym);
          }}
          className="fixed z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform shadow-lg shadow-primary/20"
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
          onOpenChange={(o) => {
            if (!o) setComposingForGym(null);
          }}
          gymId={composingForGym.id}
          gymName={composingForGym.name}
          athletes={athletes.filter((a) => a.gym_id === composingForGym.id)}
        />
      )}
    </ErrorBoundary>
  );
}
