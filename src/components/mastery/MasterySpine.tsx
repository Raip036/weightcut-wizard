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
import { MasteredShelf } from "./MasteredShelf";
import { MasteryCutscene } from "./MasteryCutscene";
import { MasteryGeneratingCard } from "./MasteryGeneratingCard";
import { CompleteCelebration } from "@/components/motion";
import type { MasteryFlowEntry } from "@/../convex/mastery_spine";

/** One in-flight generation job surfaced by `getGenerationStatus`. */
type GenerationJob = { discipline: string; kind: "drills" | "sparring" };

// ─── Types ────────────────────────────────────────────────────────────────────

type Mission = Doc<"training_missions"> & {
  items: Doc<"training_mission_items">[];
};

interface MasterySpineProps {
  userId: Id<"users">;
}

// ─── Aurora background (GPU-cheap, iOS-safe) ─────────────────────────────────

/**
 * Card background: an animated BLUE "Pro Gate wall" wash + a slow diagonal
 * shimmer sweep. Discipline colour is intentionally NOT used here — the
 * martial-art accent lives on the card's text, pills and rings instead, so
 * every card shares the same premium blue surface.
 *
 * iOS-safe: radial-gradient + transform only, no box-shadow/backdrop-filter.
 * Shimmer + breathe are suppressed under reduced-motion or on native.
 */
function AuroraBackground({
  accentToken,
  reducedMotion,
}: {
  accentToken: string;
  reducedMotion: boolean | null;
}) {
  void accentToken; // background is always blue; accent is applied to content
  const suppress = reducedMotion || isNativePlatform;

  return (
    <>
      {/* Soft blue radial wash, gently breathing. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background: `radial-gradient(130% 90% at 50% 0%,
            hsl(var(--primary) / 0.16) 0%,
            hsl(var(--primary) / 0.07) 42%,
            transparent 72%)`,
          animation: suppress ? undefined : "wcw-wash-breathe 8s ease-in-out infinite",
        }}
      />
      {/* Diagonal shimmer sweep — the Pro-gate-wall signature. */}
      {!suppress && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
          <span
            className="absolute inset-y-0 -left-1/2 w-1/3"
            style={{
              transform: "skewX(-18deg)",
              background:
                "linear-gradient(90deg, transparent, hsl(var(--primary) / 0.14), transparent)",
              animation: "wcw-card-shimmer 5.2s ease-in-out infinite",
            }}
          />
        </div>
      )}
    </>
  );
}

/** XP bonus awarded when a whole discipline cycle is completed. */
const CYCLE_COMPLETE_XP = 50;

// ─── Per-discipline card ───────────────────────────────────────────────────────

interface DisciplineCardProps {
  discipline: string;
  missions: Mission[];
  assignments: SparringAssignment[];
  /** Phase derived by the server (getMasteryFlow). Used as the source of
   *  truth; client falls back to local derivation only for the "drill" guard
   *  on remaining-drills count. */
  serverPhase: "drill" | "spar" | "idle";
  reducedMotion: boolean | null;
  /** Called by a child MissionCard when the last drill of this discipline
   *  is ticked, clearing all missions. Receives the XP for the celebration. */
  onAllMissionsComplete: (xp: number) => void;
  /** Called by a child SparringAssignmentRow when the final un-mastered
   *  graduated assignment for this discipline is mastered (cycleComplete).
   *  The parent owns the full-screen congrats cutscene + XP. */
  onCycleComplete: (discipline: string, xp: number) => void;
  /** When this discipline is mid-generation, show the wizard loader card
   *  instead of the empty sparring state. */
  generating: "drills" | "sparring" | null;
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
  serverPhase,
  reducedMotion,
  onAllMissionsComplete,
  onCycleComplete,
  generating,
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

  // Cycle complete: the final graduated assignment for this discipline is
  // mastered. We hand off to the PARENT, which owns the full-screen congrats
  // cutscene + XP and the per-discipline trophy reveal. Double-fire guarded.
  const cycleFiredRef = useMemo(() => ({ current: false }), []);

  const handleCycleComplete = (disc: string) => {
    if (cycleFiredRef.current) return; // double-fire guard
    cycleFiredRef.current = true;
    onCycleComplete(disc, CYCLE_COMPLETE_XP);
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
  const phase: "drill" | "spar" = serverPhase === "drill" ? "drill" : "spar";

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
                generating === "sparring" ? (
                  <MasteryGeneratingCard kind="sparring" accentToken={token} />
                ) : (
                  <p className="text-[12px] text-muted-foreground text-center py-4">
                    No sparring assignments yet for {label}. Log more sessions to build your list.
                  </p>
                )
              ) : (
                <div className="space-y-1.5">
                  {assignments.map((row) => (
                    <SparringAssignmentRow
                      key={row._id}
                      assignment={row}
                      token={token}
                      onCycleComplete={handleCycleComplete}
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
export function MasterySpine(_props: MasterySpineProps) {
  const reducedMotion = useReducedMotion();

  // ── Subscriptions ─────────────────────────────────────────────────────────
  // getMissionFeatureStatus: Pro wall gate (kept separate — free users see it
  //   before any data loads).
  // getMasteryFlow: unified per-discipline missions + assignments + phase.
  // getGenerationStatus: in-flight drill/sparring generation jobs (drives the
  //   wizard loader cards).
  // getMasteredTechniques: the mastered shelf (its own subscription inside
  //   MasteredShelf so it stays self-contained).
  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const flow = useQuery(api.mastery_spine.getMasteryFlow) as
    | MasteryFlowEntry[]
    | undefined;
  const generationRaw = useQuery(api.mastery_spine.getGenerationStatus) as
    | GenerationJob[]
    | undefined;

  // Full-screen congrats cutscene for a discipline that just finished its
  // whole cycle (drills + sparring). The discipline stays "hidden" on the
  // trophy shelf until the cutscene is dismissed, so the reveal feels earned.
  const [cutscene, setCutscene] = useState<{ discipline: string; xp: number } | null>(null);

  const handleCycleComplete = (discipline: string, xp: number) => {
    void triggerHapticSuccess();
    setCutscene({ discipline, xp });
  };

  // All hooks must run unconditionally — guards come after.

  // ── Guards (after all hooks) ──────────────────────────────────────────────

  // Wait for queries to resolve before rendering.
  if (feature === undefined || flow === undefined) return null;

  // Single Pro wall for the entire widget.
  if (!feature.isPro) return <LockedMissionCard />;

  const generation = generationRaw ?? [];
  const flowDisciplines = new Set(flow.map((e) => e.discipline.toLowerCase()));

  // Disciplines generating their FIRST drills (no card in the flow yet) get a
  // standalone loader card at the top. Sparring-generation is shown inside the
  // owning discipline card instead.
  const generatingDrills = generation.filter(
    (g) => g.kind === "drills" && !flowDisciplines.has(g.discipline.toLowerCase()),
  );
  const sparringGenByDiscipline = new Set(
    generation.filter((g) => g.kind === "sparring").map((g) => g.discipline.toLowerCase()),
  );

  // Trophies stay hidden for any discipline still in the active flow (cycle not
  // yet complete) and for the discipline whose cutscene is currently playing.
  const hiddenDisciplines = [
    ...flow.map((e) => e.discipline),
    ...(cutscene ? [cutscene.discipline] : []),
  ];

  // Nothing in flight and nothing in the flow → first-run empty state.
  if (flow.length === 0 && generatingDrills.length === 0) {
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
              Technique Mastery
            </p>
            <p className="text-note text-muted-foreground leading-snug mt-0.5">
              Log a session with notes. Your first drills will appear here and guide you through drilling into live sparring.
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
        {/* Loader cards for disciplines generating their first drills. */}
        {generatingDrills.map((g) => (
          <MasteryGeneratingCard
            key={`gen-${g.discipline}`}
            kind="drills"
            accentToken={disciplineToken(g.discipline)}
          />
        ))}

        {flow.map((entry) => (
          <DisciplineCard
            key={entry.discipline}
            discipline={entry.discipline}
            missions={entry.missions as Mission[]}
            assignments={entry.assignments as SparringAssignment[]}
            serverPhase={entry.phase}
            reducedMotion={reducedMotion}
            onAllMissionsComplete={() => {/* drills-cleared celebration owned by DisciplineCard */}}
            onCycleComplete={handleCycleComplete}
            generating={
              sparringGenByDiscipline.has(entry.discipline.toLowerCase())
                ? "sparring"
                : null
            }
          />
        ))}
      </div>

      {/* Mastered shelf — a discipline's trophies reveal only once it leaves
          the active flow AND its congrats cutscene has been dismissed. */}
      <MasteredShelf hiddenDisciplines={hiddenDisciplines} />

      {/* Full-screen congrats cutscene + XP, fired on whole-cycle completion. */}
      <MasteryCutscene
        open={!!cutscene}
        accentToken={cutscene ? disciplineToken(cutscene.discipline) : "--coach-default"}
        xp={cutscene?.xp ?? 0}
        disciplineLabel={cutscene ? disciplineLabel(cutscene.discipline) : ""}
        techniqueCount={
          cutscene
            ? (flow.find((e) => e.discipline === cutscene.discipline)?.assignments.length ?? 3)
            : 0
        }
        onDismiss={() => setCutscene(null)}
      />
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
  @keyframes wcw-card-shimmer {
    0%   { transform: translateX(0) skewX(-18deg); opacity: 0; }
    12%  { opacity: 1; }
    60%  { opacity: 1; }
    100% { transform: translateX(420%) skewX(-18deg); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wcw-mastery-aurora { animation: none !important; }
  }
`;
