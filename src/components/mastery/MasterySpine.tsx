import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { MasteryCutscene } from "./MasteryCutscene";
import { MasteryGeneratingCard } from "./MasteryGeneratingCard";
import {
  useMinimumDisplay,
  useCycleCompletionDetector,
  type GenerationJob,
  type GraduatedCounts,
} from "./useMinimumDisplay";
import {
  useMasterySignals,
  clearMasterySignal,
} from "./masteryGenerationSignals";
import { CompleteCelebration } from "@/components/motion";
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
  /** True while this discipline's sparring is in the merged/held generating set
   *  (backend job, optimistic signal, or deterministic spar-derivation). Drives
   *  the in-card sparring loader and its cross-fade to the real rows. Held for
   *  ≥LOADER_MIN_DISPLAY_MS even after assignments arrive. */
  generatingSparring: boolean;
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
  generatingSparring,
}: DisciplineCardProps) {
  const token = disciplineToken(discipline);
  const label = disciplineLabel(discipline);

  // Reconcile the optimistic "sparring" signal once the loader has released AND
  // the real rows exist — clearing it stops the store from re-feeding the latch.
  useEffect(() => {
    if (!generatingSparring && assignments.length > 0) {
      clearMasterySignal(discipline, "sparring");
    }
  }, [generatingSparring, assignments.length, discipline]);

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

          {/* Stage 2: during the drill→spar swap the wizard-aurora loader takes
              over the Stage-2 region WITHIN the card bounds whenever this
              discipline is in the merged/held "generating sparring" set — even
              if assignments have already arrived. The min-display latch keeps it
              up ≥2.5s, then it cross-fades (AnimatePresence) to the sparring
              rows. This wins over both the sealed-while-drilling state and the
              empty-sparring state so the animation always plays through. */}
          {generatingSparring ? (
            <div className="px-3 pb-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key="spar-loader"
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.3 }}
                >
                  <MasteryGeneratingCard kind="sparring" accentToken={token} />
                </motion.div>
              </AnimatePresence>
            </div>
          ) : phase === "drill" ? (
            <SealedStage accentToken={token} remaining={remainingDrills} />
          ) : (
            <div className="px-3 pb-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key="spar-rows"
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reducedMotion ? 0 : 0.3 }}
                >
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
                          onCycleComplete={handleCycleComplete}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
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

// ─── Drill regeneration wrapper ────────────────────────────────────────────────

/**
 * Wraps a DisciplineCard that already exists in the flow but is regenerating
 * its drills. While the held "drills" latch is on, a drills loader cross-fades
 * IN over the card; once it releases, the loader cross-fades OUT to reveal the
 * real card. Once released AND a mission exists, the optimistic "drills" signal
 * is reconciled (cleared) so the store stops re-feeding the latch.
 *
 * When not regenerating, this is a transparent pass-through (renders children).
 */
function DrillRegenWrapper({
  discipline,
  regeneratingDrills,
  reducedMotion,
  children,
}: {
  discipline: string;
  regeneratingDrills: boolean;
  reducedMotion: boolean | null;
  children: ReactNode;
}) {
  // Reconcile once the loader released (the real card is showing again).
  useEffect(() => {
    if (!regeneratingDrills) clearMasterySignal(discipline, "drills");
  }, [regeneratingDrills, discipline]);

  if (!regeneratingDrills) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key="drill-loader"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.3 }}
      >
        <MasteryGeneratingCard kind="drills" accentToken={disciplineToken(discipline)} />
      </motion.div>
    </AnimatePresence>
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

  // Optimistic client signals pushed at the moment generation was kicked off
  // (logging a session, ticking the last drill) — see masteryGenerationSignals.
  const signals = useMasterySignals();

  // ── Merge THREE generating sources into one job set ───────────────────────
  // (a) backend job markers from getGenerationStatus
  // (b) optimistic client signals (useMasterySignals)
  // (c) deterministic spar-derivation: any flow discipline whose phase is
  //     "spar" but has no assignments yet is, by definition, generating its
  //     sparring (drills done, no sparring rows = generating).
  // All three are deduped by discipline+kind and fed through the minimum-display
  // latch so anything that appears holds ≥LOADER_MIN_DISPLAY_MS.
  const generationJobs = useMemo<GenerationJob[]>(() => {
    const byKey = new Map<string, GenerationJob>();
    const add = (discipline: string, kind: GenerationJob["kind"]) => {
      const key = `${discipline.toLowerCase()}|${kind}`;
      if (!byKey.has(key)) byKey.set(key, { discipline, kind });
    };
    // (a) backend markers
    for (const j of generationRaw ?? []) add(j.discipline, j.kind);
    // (b) optimistic signals
    for (const s of signals) add(s.discipline, s.kind);
    // (c) deterministic spar derivation
    for (const e of flow ?? []) {
      if (e.phase === "spar" && e.assignments.length === 0) {
        add(e.discipline, "sparring");
      }
    }
    return Array.from(byKey.values());
  }, [generationRaw, signals, flow]);

  // Latch generating jobs so the wizard-aurora loader always plays for a brief
  // minimum even when generation is instant/cached (see useMinimumDisplay).
  const heldGeneration = useMinimumDisplay(generationJobs);

  // ── Deterministic cycle-complete detection ────────────────────────────────
  // Track per-discipline graduated, un-mastered sparring count; when it falls
  // from >0 to 0 the cycle is complete. This does NOT rely on the imperative
  // onCycleComplete callback bubbling up (which races), but shares its
  // celebrated-Set guard so the two paths can't double-fire.
  const graduatedCounts = useMemo<GraduatedCounts>(() => {
    const counts: GraduatedCounts = {};
    for (const e of flow ?? []) {
      counts[e.discipline] = e.assignments.filter(
        (a) =>
          (a as { source?: string }).source === "graduated" &&
          (a as { masteredAt?: number }).masteredAt == null,
      ).length;
    }
    return counts;
  }, [flow]);

  const cycleDetector = useCycleCompletionDetector(graduatedCounts);

  // Full-screen congrats cutscene for a discipline that just finished its
  // whole cycle (drills + sparring). The discipline stays "hidden" on the
  // trophy shelf until the cutscene is dismissed, so the reveal feels earned.
  const [cutscene, setCutscene] = useState<{ discipline: string; xp: number } | null>(null);

  // Imperative path (SparringAssignmentRow → DisciplineCard → here). Shares the
  // detector's celebrated-Set guard so it can't double-fire with the
  // deterministic detection below.
  const handleCycleComplete = (discipline: string, xp: number) => {
    if (cycleDetector.isCelebrated(discipline)) return;
    cycleDetector.markCelebrated(discipline);
    void triggerHapticSuccess();
    setCutscene({ discipline, xp });
  };

  // Deterministic path: fire the cutscene for any discipline the detector
  // flagged as newly-complete this render (and not already celebrated).
  useEffect(() => {
    if (cycleDetector.completions.length === 0) return;
    const next = cycleDetector.completions[0];
    void triggerHapticSuccess();
    setCutscene((prev) => prev ?? { discipline: next.discipline, xp: next.xp });
  }, [cycleDetector.completions]);

  // All hooks must run unconditionally — guards come after.

  // ── Guards (after all hooks) ──────────────────────────────────────────────

  // Wait for queries to resolve before rendering.
  if (feature === undefined || flow === undefined) return null;

  // Single Pro wall for the entire widget.
  if (!feature.isPro) return <LockedMissionCard />;

  const flowDisciplines = new Set(flow.map((e) => e.discipline.toLowerCase()));

  // All disciplines currently held in the "drills" generating set (active OR
  // within the min-display window). Standalone loader cards render for those
  // with no card in the flow yet; for disciplines that ALREADY have a card
  // (regeneration) the loader is shown over the card via the `generatingDrills`
  // flag passed down (it cross-fades back into the real card when released).
  const heldDrillsDisciplines = Array.from(
    new Map(
      heldGeneration.jobs
        .filter((g) => g.kind === "drills")
        .map((g) => [g.discipline.toLowerCase(), g.discipline] as const),
    ).values(),
  );

  // Standalone loader cards (top of list) for disciplines generating their
  // FIRST drills — no card in the flow yet. Keep showing until the latch
  // releases even after the first mission appears (the flow check is only used
  // to decide standalone-vs-in-card placement, not to hide mid-window).
  const generatingDrills = heldDrillsDisciplines.filter(
    (disc) => !flowDisciplines.has(disc.toLowerCase()),
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
        {generatingDrills.map((disc) => (
          <MasteryGeneratingCard
            key={`gen-${disc}`}
            kind="drills"
            accentToken={disciplineToken(disc)}
          />
        ))}

        {flow.map((entry) => {
          // Regenerating drills for a discipline that already has a card: show
          // the drills loader OVER the card for the held min-window, then it
          // cross-fades back into the real card once the latch releases.
          const regeneratingDrills = heldGeneration.has(entry.discipline, "drills");
          return (
            <DrillRegenWrapper
              key={entry.discipline}
              discipline={entry.discipline}
              regeneratingDrills={regeneratingDrills}
              reducedMotion={reducedMotion}
            >
              <DisciplineCard
                discipline={entry.discipline}
                missions={entry.missions as Mission[]}
                assignments={entry.assignments as SparringAssignment[]}
                serverPhase={entry.phase}
                reducedMotion={reducedMotion}
                onAllMissionsComplete={() => {/* drills-cleared celebration owned by DisciplineCard */}}
                onCycleComplete={handleCycleComplete}
                generatingSparring={heldGeneration.has(entry.discipline, "sparring")}
              />
            </DrillRegenWrapper>
          );
        })}
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
