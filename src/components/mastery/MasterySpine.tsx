import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import type { Doc, Id } from "@/../convex/_generated/dataModel";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { triggerHapticSelection, triggerHapticSuccess } from "@/lib/haptics";
import { isNativePlatform } from "@/hooks/useIsNative";
import { MissionCard } from "@/components/coach/MissionCard";
import { LockedMissionCard } from "@/components/coach/LockedMissionCard";
import { SparringAssignmentRow } from "@/components/sparring/SparringAssignmentRow";
import type { SparringAssignment } from "@/components/sparring/SparringAssignmentRow";
import { StageIndicator } from "./StageIndicator";
import { SealedStage } from "./SealedStage";
import { CompleteCelebration } from "@/components/motion";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mission = Doc<"training_missions"> & {
  items: Doc<"training_mission_items">[];
};

interface MasterySpineProps {
  userId: Id<"users">;
}

// ─── Aurora background (GPU-cheap, iOS-safe) ─────────────────────────────────

/**
 * Premium aurora wash + drifting motes layer.
 *
 * Aurora: a radial-gradient `::before`-equivalent built as an `aria-hidden`
 * `<div>` with a CSS animation. iOS-safe: radial-gradient only, no box-shadow
 * or backdrop-filter.
 *
 * Motes: 7 slowly-rising blue dots. Suppressed when the user prefers reduced
 * motion OR the app is running natively (further perf guard for device).
 */
function AuroraBackground({
  accentToken,
  reducedMotion,
}: {
  accentToken: string;
  reducedMotion: boolean | null;
}) {
  const suppress = reducedMotion || isNativePlatform;

  return (
    <>
      {/* Aurora wash — always rendered but animation respects reduced-motion via CSS */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background: `linear-gradient(180deg,
            transparent 0%,
            hsl(var(${accentToken}) / 0.04) 50%,
            hsl(var(${accentToken}) / 0.10) 80%,
            hsl(var(${accentToken}) / 0.15) 100%)`,
          animation: suppress ? undefined : "wcw-wash-breathe 8s ease-in-out infinite",
        }}
      />
      {/* Drifting motes — omitted on native + reduced-motion */}
      {!suppress && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {MOTE_OFFSETS.map((m, i) => (
            <span
              key={i}
              className="absolute bottom-[-6px] w-[4px] h-[4px] rounded-full"
              style={{
                left: m.l,
                background: "rgba(147,197,253,0.8)",
                // On native we never arrive here (guarded above), so radial-glow
                // is only applied on web where it is safe.
                boxShadow: "0 0 7px rgba(116,185,237,0.75)",
                opacity: 0,
                animation: `wcw-mote-rise ${m.d}s ease-out infinite`,
                animationDelay: `${m.delay}s`,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Mote positions/timings — same values as the mockup. */
const MOTE_OFFSETS = [
  { l: "8%",  d: 7.5, delay: 0   },
  { l: "22%", d: 9,   delay: 1.6 },
  { l: "37%", d: 8,   delay: 0.7 },
  { l: "52%", d: 9.4, delay: 2.3 },
  { l: "66%", d: 8.3, delay: 1.1 },
  { l: "80%", d: 7.8, delay: 0.4 },
  { l: "92%", d: 9.1, delay: 2   },
];

// ─── Per-discipline card ───────────────────────────────────────────────────────

interface DisciplineCardProps {
  discipline: string;
  missions: Mission[];
  assignments: SparringAssignment[];
  reducedMotion: boolean | null;
  /** Called by a child MissionCard when the last drill of this discipline
   *  is ticked, clearing all missions. Receives the XP for the celebration. */
  onAllMissionsComplete: (xp: number) => void;
}

/**
 * One unified discipline card.
 *
 * Phase derivation:
 *   "drill" — any active mission has an incomplete item.
 *   "spar"  — all items cleared (or no missions); show sparring rows.
 *
 * Minimise/expand: toggles the card body. Persisted to
 *   `wcw_mastery_min_${discipline}` (default expanded).
 * Chevron rotation respects prefers-reduced-motion.
 */
function DisciplineCard({
  discipline,
  missions,
  assignments,
  reducedMotion,
  onAllMissionsComplete,
}: DisciplineCardProps) {
  const token = disciplineToken(discipline);
  const label = disciplineLabel(discipline);

  // Graduation celebration state: fires once when allMissionsComplete arrives.
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockXp, setUnlockXp] = useState(0);

  const handleAllMissionsComplete = (_discipline: string, xp: number) => {
    setUnlockXp(xp);
    setUnlockOpen(true);
    onAllMissionsComplete(xp);
  };

  // Fire haptic + auto-dismiss for the graduation celebration.
  useEffect(() => {
    if (!unlockOpen) return;
    void triggerHapticSuccess();
    const t = setTimeout(
      () => setUnlockOpen(false),
      reducedMotion ? 1600 : 2800,
    );
    return () => clearTimeout(t);
  }, [unlockOpen, reducedMotion]);

  // Minimise/expand with localStorage persistence (default: expanded).
  const minKey = `wcw_mastery_min_${discipline}`;
  const [minimised, setMinimised] = useState<boolean>(() => {
    try {
      return localStorage.getItem(minKey) === "1";
    } catch {
      return false;
    }
  });

  const toggleMinimised = () => {
    triggerHapticSelection();
    setMinimised((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(minKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Phase derivation: "drill" if any mission has at least one incomplete item.
  const phase = useMemo<"drill" | "spar">(() => {
    for (const m of missions) {
      if (m.items.some((item) => !item.completed)) return "drill";
    }
    return "spar";
  }, [missions]);

  // Remaining drill items count (used by SealedStage).
  const remainingDrills = useMemo(() => {
    return missions.reduce((acc, m) => {
      return acc + m.items.filter((item) => !item.completed).length;
    }, 0);
  }, [missions]);

  // Total + done counts for the header summary (n/total).
  const totalItems = useMemo(() => missions.reduce((a, m) => a + m.items.length, 0), [missions]);
  const doneItems = useMemo(
    () => missions.reduce((a, m) => a + m.items.filter((i) => i.completed).length, 0),
    [missions],
  );

  // Mission accordion: one card open at a time, keyed by mission._id.
  // Default: first mission open.
  const firstMissionId = missions[0]?._id ?? null;
  const [expandedMissionId, setExpandedMissionId] = useState<
    Id<"training_missions"> | null
  >(firstMissionId);

  return (
    <>
    <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden">
      {/* Aurora wash + motes layer (z-index 0, below content) */}
      <AuroraBackground accentToken={token} reducedMotion={reducedMotion} />

      {/* ── Summary header (always visible) ──────────────────────── */}
      <button
        type="button"
        onClick={toggleMinimised}
        aria-expanded={!minimised}
        aria-label={minimised ? `Expand ${label}` : `Minimise ${label}`}
        className="relative z-10 w-full min-h-[52px] px-4 py-3 flex items-center gap-3 text-left active:bg-muted/15 transition-colors"
      >
        {/* Discipline label + stage count */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: `hsl(var(${token}))` }}
            >
              {label}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground/60">
              {phase === "drill" ? "Stage 1" : "Stage 2"}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
            {phase === "drill"
              ? `${doneItems} of ${totalItems} drills done`
              : `${assignments.filter((a) => a.status === "todo").length} to land in sparring`}
          </p>
        </div>

        {/* Item count badge */}
        {phase === "drill" && totalItems > 0 && (
          <span
            className="text-[12px] tabular-nums font-bold flex-shrink-0"
            style={{
              color:
                doneItems > 0
                  ? `hsl(var(${token}))`
                  : "hsl(var(--muted-foreground))",
            }}
          >
            {doneItems}/{totalItems}
          </span>
        )}

        {/* Chevron - rotate respects reduced motion */}
        <Icon
          name="chevronDownOutline"
          size={16}
          className={cn(
            "text-muted-foreground/60 flex-shrink-0",
            !reducedMotion && "transition-transform",
            minimised && "-rotate-90",
          )}
        />
      </button>

      {/* ── Card body (hidden when minimised) ────────────────────── */}
      {!minimised && (
        <div className="relative z-10 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Stage indicator */}
          <StageIndicator phase={phase} accentToken={token} />

          {/* Stage 1: Mission cards */}
          {missions.length > 0 && (
            <div className="px-3 pb-3 space-y-2">
              {missions.map((mission) => {
                const isOpen = mission._id === expandedMissionId;
                return (
                  <MissionCard
                    key={mission._id}
                    mission={mission}
                    expanded={isOpen}
                    onToggle={() =>
                      setExpandedMissionId(isOpen ? null : mission._id)
                    }
                    onAllMissionsComplete={handleAllMissionsComplete}
                  />
                );
              })}
            </div>
          )}

          {/* Stage 2: Sealed while drilling, sparring rows when cleared */}
          {phase === "drill" ? (
            <SealedStage accentToken={token} remaining={remainingDrills} />
          ) : (
            <div className="px-3 pb-4">
              {assignments.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center py-4">
                  No sparring assignments yet for {label}. Log more sessions to build your list.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {assignments.map((row) => (
                    <SparringAssignmentRow
                      key={row._id}
                      assignment={row}
                      token={token}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>

    {/* Graduation celebration: fires once when all drills for this discipline
        are cleared. Tap or auto-dismiss; sparring reveals on next query tick. */}
    <AnimatePresence>
      {unlockOpen && (
        <button
          type="button"
          onClick={() => setUnlockOpen(false)}
          aria-label="Dismiss"
          className="fixed inset-0 z-[100] cursor-default"
        >
          <CompleteCelebration
            prefersReduced={reducedMotion}
            accentToken={token}
            xp={unlockXp}
            eyebrow="Drills cleared"
            title="Sparring unlocked"
            subtitle={`${label} sparring assignments are ready. Land the techniques live.`}
          />
        </button>
      )}
    </AnimatePresence>
    </>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

/**
 * MasterySpine — the unified Training Missions + Sparring To-Do widget.
 *
 * Replaces the two separate widgets on the Camp page with one per-discipline
 * card that flows the user from drilling through to live sparring.
 *
 * Phase 1: reuses existing queries; no backend changes.
 * Later tasks: mastered shelf + graduation celebrations (leave seam here).
 *
 * Single Pro wall: if isPro is false, render ONE LockedMissionCard for the
 * whole widget. No duplicate upsells.
 *
 * Props: `userId` — the Convex user Id.
 */
export function MasterySpine({ _userId }: MasterySpineProps) {
  const reducedMotion = useReducedMotion();

  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const missions = useQuery(api.training_missions.getActiveMissions);
  const assignments = useQuery(api.sparring_plan.listSparringAssignments, {}) as
    | SparringAssignment[]
    | undefined;

  // All hooks must run unconditionally — group data BEFORE early returns.

  // Group missions by discipline (mission.sport).
  const missionsByDiscipline = useMemo(() => {
    const map = new Map<string, Mission[]>();
    for (const m of missions ?? []) {
      const key = m.sport;
      const existing = map.get(key);
      if (existing) existing.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [missions]);

  // Group sparring assignments by discipline (assignment.discipline).
  const assignmentsByDiscipline = useMemo(() => {
    const map = new Map<string, SparringAssignment[]>();
    if (!assignments) return map;
    for (const a of assignments) {
      const key = a.discipline;
      const existing = map.get(key);
      if (existing) existing.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [assignments]);

  // Collect all disciplines that have missions or assignments (preserve order,
  // missions first, then any assignment-only disciplines).
  const disciplineKeys = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of missionsByDiscipline.keys()) {
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
    if (assignments) {
      for (const a of assignments) {
        if (!seen.has(a.discipline)) { seen.add(a.discipline); out.push(a.discipline); }
      }
    }
    return out;
  }, [missionsByDiscipline, assignments]);

  // ── Guards (after all hooks) ──────────────────────────────────────────────

  // Wait for all queries to resolve before rendering.
  if (feature === undefined || missions === undefined || assignments === undefined) return null;

  // Single Pro wall for the entire widget.
  if (!feature.isPro) return <LockedMissionCard />;

  // Empty state: no missions and no assignments.
  if (disciplineKeys.length === 0) {
    return (
      <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden p-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
        />
        <div className="relative flex items-start gap-3">
          <div className="h-10 w-10 flex items-center justify-center flex-shrink-0">
            <Icon name="listOutline" size={20} className="text-primary" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-foreground leading-tight">
              Mastery Spine
            </p>
            <p className="text-note text-muted-foreground leading-snug mt-0.5">
              Log a session with notes. Your first mission will appear here and guide you through drilling into live sparring.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Keyframe definitions injected once alongside the component tree. */}
      <style>{KEYFRAMES}</style>

      <div className="space-y-3">
        {disciplineKeys.map((discipline) => (
          <DisciplineCard
            key={discipline}
            discipline={discipline}
            missions={missionsByDiscipline.get(discipline) ?? []}
            assignments={assignmentsByDiscipline.get(discipline) ?? []}
            reducedMotion={reducedMotion}
            onAllMissionsComplete={() => {/* celebration owned by DisciplineCard */}}
          />
        ))}
      </div>

      {/* TODO (Phase 3): MasteredShelf — seam left here intentionally. */}
    </>
  );
}

// ─── Keyframes ────────────────────────────────────────────────────────────────

/**
 * CSS keyframes for the aurora wash breathe + mote rise animations.
 * Injected inline alongside the component — avoids adding to the global
 * stylesheet for a feature-flagged widget.
 *
 * prefers-reduced-motion: the keyframes themselves don't override the
 * animation-play-state; instead, we conditionally omit the `animation` prop
 * in React (see AuroraBackground). The @media block below handles any CSS-only
 * path as a belt-and-suspenders guard.
 */
const KEYFRAMES = `
  @keyframes wcw-wash-breathe {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50%       { transform: scale(1.06); opacity: 1; }
  }
  @keyframes wcw-mote-rise {
    0%   { opacity: 0; transform: translateY(0); }
    14%  { opacity: 0.75; }
    86%  { opacity: 0.75; }
    100% { opacity: 0; transform: translateY(-240px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wcw-mastery-aurora { animation: none !important; }
  }
`;
