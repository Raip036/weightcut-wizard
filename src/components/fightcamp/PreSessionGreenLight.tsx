// T16: PreSessionGreenLight — Recovery-page surface that detects an
// imminent calendared session and surfaces a Pro-gated "Go / Modify /
// Bail" call from the T15 action (`api.actions.recovery.preSessionBrief
// .generateBrief`).
//
// Detection model:
//   The `fight_camp_calendar` schema is date-keyed (YYYY-MM-DD) with no
//   time-of-day column. We therefore can't compute a true "within the
//   next 2h" window from the row itself. Per the spec's fallback path,
//   we treat ANY *unsaved* session entry (rpe === 0 AND duration === 0)
//   created today as "upcoming today" and surface the card without a
//   tighter time-bound. Saved sessions (rpe > 0 OR duration > 0) are
//   considered already-trained and never trigger this surface.
//
// States:
//   • no upcoming session in window         → renders nothing
//   • free user, upcoming detected          → amber locked card → paywall
//   • pro user, upcoming, no brief cached   → "Get Today's Green Light" CTA
//   • pro user, action in flight            → spinner + "Reading your body..."
//   • pro user, brief returned              → verdict pill + modification +
//                                              rationale + refresh link
//                                              (rate-limited to 1× / 5 min)
//
// Cache: `AIPersistence.load/save(userId, key, data, 0.5)` (30 min TTL).
// Key shape: `pre_session_green_light_${todayIso}` — one cached brief per
// (userId, sessionDateIso). The (userId, _) prefix is enforced by the
// AIPersistence storage-key format.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { AIPersistence } from "@/lib/aiPersistence";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import { logger } from "@/lib/logger";

interface PreSessionGreenLightProps {
  userId: string | null;
  className?: string;
}

type GreenLightVerdict = "go" | "modify" | "bail";

interface GreenLightResult {
  verdict: GreenLightVerdict;
  modification: string;
  rationale: string;
  cachedAt: number;
}

interface UpcomingSession {
  /** PRIMARY discipline (martial art / "S&C" / "Rest"). */
  sessionType: string;
  /** OPTIONAL activity tag (Sparring, Drilling, Run…); may be null. */
  sessionTag: string | null;
  durationMinutes: number;
  // No time-of-day in schema — best-available timestamp is Date.now()
  // (the row's _creationTime would also work but Date.now lets the
  // model reason about "right now").
  scheduledAtMs: number;
  dateIso: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

const SECTION_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70";

// Per-verdict visuals — colours match the Recovery dashboard's tier system:
// GO = recovery-green, MODIFY = warning-yellow, BAIL = danger-red.
const VERDICT_META: Record<GreenLightVerdict, {
  label: string;
  tone: string;
  bg: string;
  border: string;
  icon: IonIconName;
}> = {
  go: {
    label: "GO",
    tone: "text-func-recovery-green",
    bg: "bg-func-recovery-green/10",
    border: "border-func-recovery-green/40",
    icon: "checkmarkCircleOutline",
  },
  modify: {
    label: "MODIFY",
    tone: "text-func-warning-yellow",
    bg: "bg-func-warning-yellow/10",
    border: "border-func-warning-yellow/40",
    icon: "warningOutline",
  },
  bail: {
    label: "BAIL",
    tone: "text-func-danger-red",
    bg: "bg-func-danger-red/10",
    border: "border-func-danger-red/40",
    icon: "alertCircleOutline",
  },
};

// Cache key shape — single brief per (userId, day). AIPersistence
// already namespaces by userId so we only need the day suffix here.
function cacheKeyFor(dateIso: string): string {
  return `pre_session_green_light_${dateIso}`;
}

// Today's YYYY-MM-DD (local). Mirrors the format used by
// RecoveryDashboard's `todayStr` so the listCalendar window matches.
function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

// A row is "unsaved / upcoming today" iff both rpe and duration are 0 —
// the QuickLog / round-card flows insert a placeholder row at session
// start; the row only gets real numbers when the user logs the session.
function isUpcomingRow(row: {
  rpe?: number | null;
  durationMinutes?: number | null;
}): boolean {
  const rpe = row.rpe ?? 0;
  const dur = row.durationMinutes ?? 0;
  return rpe === 0 && dur === 0;
}

// ── Skeleton ──────────────────────────────────────────────────────────
function GreenLightSkeleton({ className }: { className: string }) {
  return (
    <div
      className={`card-surface rounded-2xl border border-border/50 p-5 space-y-3 ${className}`}
    >
      <div className="h-3 w-32 bg-muted/30 rounded animate-pulse" />
      <div className="h-5 w-3/4 bg-muted/30 rounded animate-pulse" />
      <div className="h-4 w-full bg-muted/30 rounded animate-pulse" />
    </div>
  );
}

// ── Locked (free) ─────────────────────────────────────────────────────
function LockedGreenLight({
  session,
  onUpgrade,
  className,
  prefersReduced,
}: {
  session: UpcomingSession;
  onUpgrade: () => void;
  className: string;
  prefersReduced: boolean | null;
}) {
  const title = session.sessionType
    ? `${session.sessionType} today. See the Green Light?`
    : "Session today. See the Green Light?";

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`relative card-surface rounded-2xl border border-amber-400/30 bg-amber-400/[0.03] p-5 overflow-hidden ${className}`}
    >
      <div className="absolute top-3 right-3 text-amber-400/80">
        <Icon name="lockClosedOutline" size={14} aria-label="Pro feature" />
      </div>

      <div className={SECTION_LABEL}>Pre-session · Pro</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        {title}
      </h3>

      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
        Pro tells you go / modify / bail in one tap.
      </p>

      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onUpgrade();
        }}
        className="mt-4 w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      >
        <Icon name="lockClosedOutline" size={14} />
        Unlock - Pro
      </button>
    </motion.div>
  );
}

// ── Pro CTA (no brief yet) ────────────────────────────────────────────
function GreenLightCTA({
  session,
  loading,
  onFetch,
  className,
  prefersReduced,
}: {
  session: UpcomingSession;
  loading: boolean;
  onFetch: () => void;
  className: string;
  prefersReduced: boolean | null;
}) {
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      <div className={SECTION_LABEL}>Pre-session</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        {session.sessionType
          ? `${session.sessionType} today`
          : "Session today"}
      </h3>
      <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
        Get a fast read: go, modify, or bail.
      </p>

      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onFetch();
        }}
        disabled={loading}
        className="mt-4 w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <span
              aria-hidden
              className="h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin"
            />
            Reading your body...
          </>
        ) : (
          <>
            <Icon name="flameOutline" size={14} />
            Get Today's Green Light
          </>
        )}
      </button>
    </motion.div>
  );
}

// ── Pro filled ────────────────────────────────────────────────────────
function GreenLightResultCard({
  result,
  session,
  refreshDisabled,
  onRefresh,
  refreshing,
  className,
  prefersReduced,
}: {
  result: GreenLightResult;
  session: UpcomingSession;
  refreshDisabled: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  className: string;
  prefersReduced: boolean | null;
}) {
  const meta = VERDICT_META[result.verdict];

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 260 }}
      className={`relative card-surface rounded-2xl border ${meta.border} ${meta.bg} p-5 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className={SECTION_LABEL}>
          Pre-session
          {session.sessionType ? ` · ${session.sessionType}` : ""}
        </div>
      </div>

      <div
        className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-bold uppercase tracking-[0.14em] ${meta.tone}`}
      >
        <Icon name={meta.icon} size={14} />
        {meta.label}
      </div>

      <p className="mt-3 text-[15px] font-semibold leading-snug text-foreground">
        {result.modification}
      </p>

      {result.rationale && (
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-snug">
          {result.rationale}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (refreshDisabled || refreshing) return;
            triggerHapticSelection();
            onRefresh();
          }}
          disabled={refreshDisabled || refreshing}
          aria-label="Refresh Green Light"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Icon
            name="refreshOutline"
            size={12}
            className={refreshing ? "animate-spin" : ""}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </motion.div>
  );
}

// ── Outer ─────────────────────────────────────────────────────────────
export function PreSessionGreenLight({
  userId,
  className = "",
}: PreSessionGreenLightProps) {
  const prefersReduced = useReducedMotion();
  const { isPremium, isSubscriptionResolved, openPaywall } = useSubscription();
  const today = useMemo(todayIso, []);

  // Self-contained reactive query for today's calendar rows.
  const todayRows = useQuery(
    api.fight_camp.listCalendar,
    userId ? { from: today, to: today } : "skip",
  );

  // Pick the first unsaved (upcoming) row for today, if any. We don't
  // try to disambiguate multiple unsaved rows — by spec there should be
  // at most one upcoming session per day on a real calendar.
  const upcoming: UpcomingSession | null = useMemo(() => {
    if (!todayRows || todayRows.length === 0) return null;
    const row = todayRows.find(isUpcomingRow);
    if (!row) return null;
    return {
      // Reference the planned session by its PRIMARY discipline.
      sessionType: row.sessionType,
      // Optional activity tag — drives the action's load/contact reasoning.
      sessionTag: (row as { sessionTag?: string | null }).sessionTag ?? null,
      // Pass the planned duration even if it's zero — the action's
      // `durationMinutes` validator accepts any number and the prompt
      // tolerates "0 min" (model still calls verdict on body signals).
      // If the row was created from a quicklog placeholder, duration
      // is genuinely 0; otherwise the user typed something.
      durationMinutes: row.durationMinutes ?? 0,
      scheduledAtMs: Date.now(),
      dateIso: row.date,
    };
  }, [todayRows]);

  // ── Cached / fetched brief state ────────────────────────────────────
  const [result, setResult] = useState<GreenLightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number>(0);
  const lastFetchAtRef = useRef(0);

  const generateBrief = useAction(
    api.actions.recovery.preSessionBrief.generateBrief,
  );

  // Hydrate from cache on mount / when the target day changes. Cache TTL
  // is 30 min — beyond that AIPersistence.load returns null.
  useEffect(() => {
    if (!userId || !upcoming) {
      setResult(null);
      return;
    }
    const cached = AIPersistence.load(
      userId,
      cacheKeyFor(upcoming.dateIso),
    ) as GreenLightResult | null;
    if (cached) {
      setResult(cached);
      lastFetchAtRef.current = cached.cachedAt ?? 0;
      setLastFetchAt(cached.cachedAt ?? 0);
    } else {
      setResult(null);
    }
  }, [userId, upcoming?.dateIso]);

  // 5-min refresh cool-down. Disabled when we're within the window of
  // the most recent fetch (cache hit OR live call). Uses a ref so the
  // disable check inside the click handler stays in sync.
  const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
  const refreshDisabled =
    lastFetchAt > 0 && Date.now() - lastFetchAt < REFRESH_COOLDOWN_MS;

  const fetchBrief = useCallback(async () => {
    if (!userId || !upcoming) return;
    if (loading) return;
    setLoading(true);
    try {
      const fresh = (await generateBrief({
        plannedSession: {
          sessionType: upcoming.sessionType,
          durationMinutes: upcoming.durationMinutes,
          scheduledAtMs: upcoming.scheduledAtMs,
        },
        // Optional activity tag — backend action accepts `sessionTag`
        // (owned by the recovery-action agent) to scale its verdict to
        // the actual activity (sparring vs. drilling vs. run).
        ...(upcoming.sessionTag ? { sessionTag: upcoming.sessionTag } : {}),
      } as Parameters<typeof generateBrief>[0])) as GreenLightResult;

      const stamped: GreenLightResult = {
        ...fresh,
        cachedAt: fresh.cachedAt ?? Date.now(),
      };
      setResult(stamped);
      lastFetchAtRef.current = stamped.cachedAt;
      setLastFetchAt(stamped.cachedAt);
      AIPersistence.save(
        userId,
        cacheKeyFor(upcoming.dateIso),
        stamped,
        0.5, // 30 min
      );
    } catch (err) {
      // The wrapper / paywall flow handles `PRO_FEATURE_REQUIRED:*`. Anything
      // else is logged and silently dropped — the CTA stays visible so the
      // user can retry.
      logger.warn("PreSessionGreenLight: brief fetch failed", { err });
    } finally {
      setLoading(false);
    }
  }, [userId, upcoming, loading, generateBrief]);

  // ── Render decisions ────────────────────────────────────────────────

  // No userId → nothing to do.
  if (!userId) return null;

  // Detection: no upcoming session → render nothing (per spec).
  // Wait on the query before deciding "nothing"; an in-flight `undefined`
  // would otherwise flicker the surface off then on.
  if (todayRows === undefined) {
    // Subscription not yet resolved either → render skeleton so we don't
    // pop in late. If subscription IS resolved + free, the skeleton is
    // still fine since the locked state replaces it once data arrives.
    if (!isSubscriptionResolved) return <GreenLightSkeleton className={className} />;
    return <GreenLightSkeleton className={className} />;
  }
  if (!upcoming) return null;

  // Subscription unresolved but we know there IS an upcoming session →
  // render skeleton.
  if (!isSubscriptionResolved) {
    return <GreenLightSkeleton className={className} />;
  }

  // Free → locked.
  if (!isPremium) {
    return (
      <LockedGreenLight
        session={upcoming}
        onUpgrade={openPaywall}
        className={className}
        prefersReduced={prefersReduced}
      />
    );
  }

  // Pro, brief present → result card.
  if (result) {
    return (
      <GreenLightResultCard
        result={result}
        session={upcoming}
        refreshDisabled={refreshDisabled}
        onRefresh={fetchBrief}
        refreshing={loading}
        className={className}
        prefersReduced={prefersReduced}
      />
    );
  }

  // Pro, no brief yet → CTA.
  return (
    <GreenLightCTA
      session={upcoming}
      loading={loading}
      onFetch={fetchBrief}
      className={className}
      prefersReduced={prefersReduced}
    />
  );
}
