import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  triggerHapticSelection,
  triggerHapticSuccess,
} from "@/lib/haptics";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { LockedSparringCard } from "./LockedSparringCard";
import { CompleteCelebration } from "@/components/motion";
import {
  SparringAssignmentRow,
  type SparringAssignment,
} from "./SparringAssignmentRow";

interface SparringPlanCardProps {
  /** Active user id from `UserContext`; queries are skipped while null. */
  userId: string | null;
}

// Default number of "todo" rows shown per discipline before the user has to
// tap "Show all"; keeps the surface scoped to "this session's focus".
const DEFAULT_TODO_VISIBLE = 4;

// XP awarded per assignment completed (mirrors the `toggleAssignment`
// mutation's `awardXp` amount). Used for the all-clear celebration splash.
const SPARRING_XP_PER_ITEM = 15;

/**
 * Per-discipline block: an accent header pill (with an optional refresh
 * affordance) followed by its sparring assignment rows. By default it shows
 * the first {@link DEFAULT_TODO_VISIBLE} "todo" rows; when more rows exist
 * (todo or done) a "Show all (N)" toggle expands the full list including
 * completed (struck-through) rows.
 */
function DisciplineGroup({
  discipline,
  rows,
}: {
  discipline: string;
  rows: SparringAssignment[];
}) {
  const token = disciplineToken(discipline);
  const label = disciplineLabel(discipline);
  const regenerate = useMutation(api.sparring_plan.regenerateDiscipline);

  // Persist collapse state per-discipline so it survives navigation.
  const minKey = `wcw_sparring_min_${discipline}`;
  const showAllKey = `wcw_sparring_showall_${discipline}`;
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(showAllKey) === "1";
    } catch {
      return false;
    }
  });
  const [minimised, setMinimised] = useState<boolean>(() => {
    try {
      return localStorage.getItem(minKey) === "1";
    } catch {
      return false;
    }
  });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(minKey, minimised ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [minimised, minKey]);
  useEffect(() => {
    try {
      localStorage.setItem(showAllKey, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expanded, showAllKey]);

  // Default view = the first N todo rows (this session's focus). Expanded =
  // everything, todo first then done so completed work sinks to the bottom.
  const todos = useMemo(() => rows.filter((r) => r.status === "todo"), [rows]);
  const dones = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);
  const orderedAll = useMemo(() => [...todos, ...dones], [todos, dones]);

  const collapsedRows = todos.slice(0, DEFAULT_TODO_VISIBLE);
  const visibleRows = expanded ? orderedAll : collapsedRows;
  const hasMore = orderedAll.length > collapsedRows.length;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    triggerHapticSelection();
    try {
      await regenerate({ discipline });
    } catch (err) {
      console.warn("DisciplineGroup: regenerateDiscipline failed", err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Discipline header: plain coloured label + refresh affordance. */}
      <div className="flex items-center gap-2">
        <span
          className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: `hsl(var(${token}))` }}
        >
          {label}
        </span>
        <span className="text-micro tabular-nums font-bold text-muted-foreground/60">
          {todos.length} to go
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label={`Refresh ${label} sparring plan`}
          className="ml-auto h-7 w-7 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/25 transition-colors"
        >
          <Icon
            name="refreshOutline"
            size={14}
            className={refreshing ? "animate-spin" : undefined}
          />
        </button>
        {/* Minimise / expand the whole discipline's list. */}
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            setMinimised((m) => !m);
          }}
          aria-expanded={!minimised}
          aria-label={
            minimised ? `Expand ${label} list` : `Minimise ${label} list`
          }
          className="h-7 w-7 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/25 transition-colors"
        >
          <Icon
            name="chevronDownOutline"
            size={14}
            className={cn(
              "transition-transform",
              minimised ? "-rotate-90" : "rotate-0",
            )}
          />
        </button>
      </div>

      {/* Body: hidden when the group is minimised. */}
      {!minimised && (
        <>
          {/* Assignment rows */}
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            {visibleRows.map((row) => (
              <SparringAssignmentRow
                key={row._id}
                assignment={row}
                token={token}
              />
            ))}
          </div>

          {/* Show all / collapse toggle */}
          {hasMore && (
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setExpanded((e) => !e);
              }}
              className="w-full min-h-[32px] flex items-center justify-center gap-1.5 text-note font-semibold text-muted-foreground/80 active:text-foreground"
            >
              {expanded ? "Show fewer" : `Show all (${orderedAll.length})`}
              <Icon
                name="chevronForwardOutline"
                size={14}
                className={
                  expanded
                    ? "rotate-90 transition-transform"
                    : "transition-transform"
                }
              />
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Sparring To-Do List: a Pro feature that turns logged techniques into a
 * tickable per-discipline checklist for the next sparring session.
 *
 * States:
 *   - userId null / queries resolving → null or skeleton.
 *   - not Pro                         → compact upsell row (opens paywall).
 *   - Pro, no rows                    → friendly empty state.
 *   - Pro, with rows                  → grouped-by-discipline checklist.
 */
export function SparringPlanCard({ userId }: SparringPlanCardProps) {

  const featureStatus = useQuery(
    api.sparring_plan.getSparringFeatureStatus,
    userId ? {} : "skip",
  );

  const isPro = featureStatus?.isPro ?? false;

  const assignments = useQuery(
    api.sparring_plan.listSparringAssignments,
    userId && isPro ? {} : "skip",
  ) as SparringAssignment[] | undefined;

  // Group rows by discipline, preserving first-seen discipline order.
  const grouped = useMemo(() => {
    if (!assignments) return [];
    const map = new Map<string, SparringAssignment[]>();
    for (const row of assignments) {
      const existing = map.get(row.discipline);
      if (existing) existing.push(row);
      else map.set(row.discipline, [row]);
    }
    return Array.from(map.entries());
  }, [assignments]);

  // All-complete celebration: fire once when the outstanding "todo" count drops
  // from >0 to 0 (a real completion, not the initial load). Mirrors the
  // Training Missions behaviour.
  const prefersReduced = useReducedMotion();
  const [celebrating, setCelebrating] = useState(false);
  // Total XP splashed in the celebration, captured at clear-time so the
  // count-up is stable. Mirrors the 15-XP-per-assignment award in
  // `sparring_plan.toggleAssignment`.
  const [celebrationXp, setCelebrationXp] = useState(0);
  const prevTodoCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (assignments === undefined) return;
    const count = assignments.filter((a) => a.status === "todo").length;
    const prev = prevTodoCountRef.current;
    prevTodoCountRef.current = count;
    if (prev != null && prev > 0 && count === 0) {
      setCelebrationXp(assignments.length * SPARRING_XP_PER_ITEM);
      setCelebrating(true);
      void triggerHapticSuccess();
    }
  }, [assignments]);

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(
      () => setCelebrating(false),
      prefersReduced ? 1600 : 2600,
    );
    return () => clearTimeout(t);
  }, [celebrating, prefersReduced]);

  // Wait for auth + feature gate before deciding what to render.
  if (!userId || featureStatus === undefined) return null;

  // ── Non-Pro: full Pro wall, mirrors the Training Missions LockedMissionCard. ──
  if (!isPro) {
    return <LockedSparringCard />;
  }

  // ── Pro: section heading + body ─────────────────────────────────────────
  return (
    <>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80 pt-2">
        Sparring to-do list
      </h2>

      {/* Loading skeleton */}
      {assignments === undefined ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="card-surface rounded-xs border border-border p-3 space-y-2"
            >
              <div className="h-2.5 rounded shimmer-skeleton w-1/3" />
              <div className="h-2.5 rounded shimmer-skeleton w-full" />
              <div className="h-2.5 rounded shimmer-skeleton w-4/5" />
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        /* Empty state */
        <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden p-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
          />
          <div className="relative flex items-start gap-3">
            <div className="h-10 w-10 flex items-center justify-center flex-shrink-0">
              <ShimmerCrownBadge size={28} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-semibold text-foreground leading-tight">
                Sparring to-do list
              </p>
              <p className="text-note text-muted-foreground leading-snug mt-0.5">
                Log techniques in your training calendar and your sparring
                to-do list builds itself.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Grouped checklist */
        <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
          />
          <div className="relative p-4 space-y-4">
            {grouped.map(([discipline, rows]) => (
              <DisciplineGroup
                key={discipline}
                discipline={discipline}
                rows={rows}
              />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {celebrating && (
          <CompleteCelebration
            prefersReduced={prefersReduced}
            accentToken="--coach-sparring"
            xp={celebrationXp}
            eyebrow="Sparring ready"
            title="To-do list cleared"
            subtitle="Every sparring focus ticked off. Log more techniques to refresh your list."
          />
        )}
      </AnimatePresence>
    </>
  );
}
