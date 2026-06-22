import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
import { MasteredShelf } from "./MasteredShelf";
import { CompleteCelebration } from "@/components/motion";
import { ProtocolGeneratingOverlay } from "@/components/protocol/ProtocolGeneratingOverlay";
import type { MasteryFlowEntry } from "@/../convex/mastery_spine";

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

/** XP bonus awarded when a whole discipline cycle is completed. */
const CYCLE_COMPLETE_XP = 50;

// ─── Wizard overlay copy ──────────────────────────────────────────────────────

const GRADUATING_STEPS: ReadonlyArray<string> = [
  "Reading your completed drills",
  "Building live-sparring reads",
  "Adding setups and counters",
];

const GENERATING_STEPS: ReadonlyArray<string> = [
  "Reading your session notes",
  "Diagnosing what to fix",
  "Designing your drills",
];

const LOADING_FOOTNOTE = "This usually takes 5 to 15 seconds.";

// ─── Per-discipline card ───────────────────────────────────────────────────────

interface DisciplineCardProps {
  discipline: string;
  missions: Mission[];
  assignments: SparringAssignment[];
  /** Phase derived by the server (getMasteryFlow). Used as the source of
   *  truth. "graduating" and "generating" render the wizard loader while the
   *  async Groq window is open; the card stays mounted throughout. */
  serverPhase: "drill" | "graduating" | "spar" | "generating" | "idle";
  reducedMotion: boolean | null;
  /** Called by a child MissionCard when the last drill of this discipline
   *  is ticked, clearing all missions. Receives the discipline key and XP. */
  onAllMissionsComplete: (discipline: string, xp: number) => void;
  /** Called by a child SparringAssignmentRow when the final un-mastered
   *  graduated assignment for this discipline is mastered (cycleComplete). */
  onCycleComplete: (discipline: string) => void;
}

/**
 * One unified discipline card.
 *
 * Phase derivation:
 *   "generating" — session logged but first drills not yet produced; wizard loader.
 *   "drill"      — any active mission has an incomplete item.
 *   "graduating" — drills cleared, sparring scenarios being generated; wizard loader.
 *   "spar"       — sparring assignments ready; show sparring rows.
 *
 * Celebrations (unlock + cycle-complete) are rendered at the MasterySpine root,
 * not here, so they survive phase transitions without unmounting.
 *
 * Minimise/expand: toggles the card body. Persisted to
 *   `wcw_mastery_min_${discipline}` (default expanded).
 * Chevron rotation respects prefers-reduced-motion.
 */
function DisciplineCard({
  discipline,
  missions,
  assignments,
  serverPhase,
  reducedMotion,
  onAllMissionsComplete,
  onCycleComplete,
}: DisciplineCardProps) {
  const token = disciplineToken(discipline);
  const label = disciplineLabel(discipline);

  const handleAllMissionsComplete = (disc: string, xp: number) => {
    onAllMissionsComplete(disc, xp);
  };

  const handleCycleComplete = (disc: string) => {
    onCycleComplete(disc);
  };

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

  // Phase: use the server-derived value from getMasteryFlow.
  // Treat "idle" as "spar" for display purposes (defensive fallback — "idle"
  // entries are normally excluded from results but may appear in edge cases).
  // Note: "graduating" and "generating" are handled by the early-return below;
  // this cast is only reached for "drill" | "spar" | "idle".
  const phase: "drill" | "spar" = serverPhase === "drill" ? "drill" : "spar";

  // Remaining drill items count (used by SealedStage).
  // All useMemo/useState hooks MUST be declared before any early-return.
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

  // Wizard-loading phases: render the Aurora overlay, no normal card body.
  // This early-return is placed AFTER all hooks to satisfy the Rules of Hooks.
  if (serverPhase === "graduating" || serverPhase === "generating") {
    const isGraduating = serverPhase === "graduating";
    return (
      <ProtocolGeneratingOverlay
        label={isGraduating ? "Forging your sparring scenarios" : "Building your first drills"}
        steps={isGraduating ? GRADUATING_STEPS : GENERATING_STEPS}
        footnote={LOADING_FOOTNOTE}
      />
    );
  }

  return (
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

          {/* Stage 1: Mission cards — entrance animation when first appearing */}
          {missions.length > 0 && (
            <div className="px-3 pb-3 space-y-2">
              {missions.map((mission, idx) => {
                const isOpen = mission._id === expandedMissionId;
                return (
                  <motion.div
                    key={mission._id}
                    initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: reducedMotion ? 0 : idx * 0.06 }}
                  >
                    <MissionCard
                      mission={mission}
                      expanded={isOpen}
                      onToggle={() =>
                        setExpandedMissionId(isOpen ? null : mission._id)
                      }
                      onAllMissionsComplete={handleAllMissionsComplete}
                    />
                  </motion.div>
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
                  {assignments.map((row, idx) => (
                    <motion.div
                      key={row._id}
                      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: reducedMotion ? 0 : idx * 0.05 }}
                    >
                      <SparringAssignmentRow
                        assignment={row}
                        token={token}
                        onCycleComplete={handleCycleComplete}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

/**
 * MasterySpine — the unified Training Missions + Sparring To-Do widget.
 *
 * Replaces the two separate widgets on the Camp page with one per-discipline
 * card that flows the user from drilling through to live sparring.
 *
 * Single Pro wall: if isPro is false, render ONE LockedMissionCard for the
 * whole widget. No duplicate upsells.
 *
 * Celebrations (unlock + cycle-complete) are owned HERE at the root so they
 * are never unmounted mid-animation when the discipline card transitions phases.
 *
 * Props: `userId` — the Convex user Id.
 */
export function MasterySpine(_props: MasterySpineProps) {
  const reducedMotion = useReducedMotion();

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const flow = useQuery(api.mastery_spine.getMasteryFlow) as
    | MasteryFlowEntry[]
    | undefined;

  // ── Root-level celebration state ──────────────────────────────────────────
  // Hoisted out of DisciplineCard so overlays survive phase transitions and
  // discipline-list mutations without unmounting mid-animation.
  const [celebration, setCelebration] = useState<{
    kind: "unlock" | "cycle";
    discipline: string;
    xp: number;
  } | null>(null);

  // Double-fire guard: stored in a ref-like object via useMemo so it persists
  // across renders without causing re-renders itself.
  const cycleFireGuard = useMemo(() => new Set<string>(), []);

  // Haptic + auto-dismiss for whichever celebration is active.
  useEffect(() => {
    if (!celebration) return;
    void triggerHapticSuccess();
    const ms =
      celebration.kind === "cycle"
        ? reducedMotion ? 1600 : 3200
        : reducedMotion ? 1600 : 2800;
    const t = setTimeout(() => {
      if (celebration.kind === "cycle") {
        cycleFireGuard.delete(celebration.discipline);
      }
      setCelebration(null);
    }, ms);
    return () => clearTimeout(t);
  }, [celebration, reducedMotion, cycleFireGuard]);

  const handleAllMissionsComplete = (discipline: string, xp: number) => {
    setCelebration({ kind: "unlock", discipline, xp });
  };

  const handleCycleComplete = (discipline: string) => {
    if (cycleFireGuard.has(discipline)) return; // double-fire guard
    cycleFireGuard.add(discipline);
    setCelebration({ kind: "cycle", discipline, xp: CYCLE_COMPLETE_XP });
  };

  // All hooks must run unconditionally — guards come after.

  // ── Guards (after all hooks) ──────────────────────────────────────────────

  if (feature === undefined || flow === undefined) return null;

  if (!feature.isPro) return <LockedMissionCard />;

  // Empty state: no disciplines with missions or assignments.
  if (flow.length === 0) {
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
              Drill & Spar
            </p>
            <p className="text-note text-muted-foreground leading-snug mt-0.5">
              Log a session with notes. Your first mission will appear here and guide you through drilling into live sparring.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Derive celebration accent token.
  const celebrationToken = celebration
    ? disciplineToken(celebration.discipline)
    : undefined;
  const celebrationLabel = celebration
    ? disciplineLabel(celebration.discipline)
    : "";

  return (
    <>
      {/* Keyframe definitions injected once alongside the component tree. */}
      <style>{KEYFRAMES}</style>

      <div className="space-y-3">
        {flow.map((entry) => (
          <DisciplineCard
            key={entry.discipline}
            discipline={entry.discipline}
            missions={entry.missions as Mission[]}
            assignments={entry.assignments as SparringAssignment[]}
            serverPhase={entry.phase}
            reducedMotion={reducedMotion}
            onAllMissionsComplete={handleAllMissionsComplete}
            onCycleComplete={handleCycleComplete}
          />
        ))}
      </div>

      {/* Phase 3: MasteredShelf — horizontal embla strip of mastered techniques. */}
      <MasteredShelf />

      {/* ── Root-level celebrations (hoisted from DisciplineCard) ───────────
          Rendered here so they survive discipline phase transitions / list
          mutations without unmounting mid-animation. One overlay at a time. */}
      <AnimatePresence>
        {celebration && (
          <button
            type="button"
            onClick={() => {
              if (celebration.kind === "cycle") {
                cycleFireGuard.delete(celebration.discipline);
              }
              setCelebration(null);
            }}
            aria-label="Dismiss"
            className="fixed inset-0 z-[100] cursor-default"
          >
            {celebration.kind === "unlock" ? (
              <CompleteCelebration
                prefersReduced={reducedMotion}
                accentToken={celebrationToken}
                xp={celebration.xp}
                eyebrow="Drills cleared"
                title="Sparring unlocked"
                subtitle={`${celebrationLabel} sparring assignments are ready. Land the techniques live.`}
              />
            ) : (
              <CompleteCelebration
                prefersReduced={reducedMotion}
                accentToken={celebrationToken}
                xp={CYCLE_COMPLETE_XP}
                eyebrow="Cycle complete"
                title="Discipline mastered"
                subtitle={`You have mastered every technique in your ${celebrationLabel} sparring cycle.`}
              />
            )}
          </button>
        )}
      </AnimatePresence>
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
