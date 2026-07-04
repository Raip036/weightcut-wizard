import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { MasteryCutscene } from "./MasteryCutscene";
import { MasteryGeneratingCard } from "./MasteryGeneratingCard";
import { MasteryEmptyCard } from "./MasteryEmptyCard";
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

// ─── Shared cross-fade transitions ───────────────────────────────────────────
// House pattern (see Community.tsx feed branches): AnimatePresence
// mode="popLayout" + short opacity cross-fades on the iOS system ease.
// Cheap on native: opacity/translate only — no scale, no blur, no layout anims.
const EASE_IOS: [number, number, number, number] = [0.32, 0.72, 0, 1];
const BRANCH_ENTER_S = 0.25;
const BRANCH_EXIT_S = 0.15;

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
      {/* Aurora wash + motes layer (z-index 0, below content). Wizard-blue
          primary so the whole card reads blue; only the discipline name below
          carries its discipline colour. */}
      <AuroraBackground accentToken="--primary" reducedMotion={reducedMotion} />

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
                  ? "hsl(var(--primary))"
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
          <StageIndicator phase={phase} accentToken="--primary" />

          {/* Stage 1: Mission cards. AnimatePresence owns each card's exit so a
              completed drill card (auto-archived server-side → dropped from the
              flow) plays a smooth scale+fade instead of vanishing instantly. */}
          {missions.length > 0 && (
            <div className="px-3 pb-3 space-y-2">
              <AnimatePresence initial={false}>
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
              </AnimatePresence>
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
                  <MasteryGeneratingCard kind="sparring" accentToken="--primary" />
                </motion.div>
              </AnimatePresence>
            </div>
          ) : phase === "drill" ? (
            <SealedStage accentToken="--primary" remaining={remainingDrills} />
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
                      {/* AnimatePresence owns each row's exit: when a mastered
                          assignment drops from the list on the next query tick,
                          the row plays its scale+fade `exit` instead of blinking
                          out. `layout` lets the remaining rows slide up smoothly. */}
                      <AnimatePresence initial={false}>
                        {assignments.map((row) => (
                          <SparringAssignmentRow
                            key={row._id}
                            assignment={row}
                            token={token}
                            onCycleComplete={handleCycleComplete}
                          />
                        ))}
                      </AnimatePresence>
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
 * The ONE stable per-discipline wrapper. Owns the loader ↔ card swap for a
 * discipline, whether that's:
 *   - FIRST generation (no card in the flow yet → children is null, the drills
 *     loader shows), or
 *   - REGENERATION (card exists, the held "drills" latch puts the loader up).
 *
 * The parent keys this wrapper by discipline (lowercased), so the element
 * identity NEVER changes across "no card yet" → "first card arrived". The
 * AnimatePresence stays mounted in BOTH states (it used to unmount wholesale
 * when not regenerating, which made loader → card a hard cut); popLayout
 * cross-fades the outgoing loader and incoming card concurrently — one
 * continuous transition, no flash, no dead gap.
 *
 * Once the latch releases, the optimistic "drills" signal is reconciled
 * (cleared) so the store stops re-feeding the latch.
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

  const fade = {
    initial: reducedMotion ? false : { opacity: 0 },
    animate: { opacity: 1 },
    exit: {
      opacity: 0,
      transition: { duration: reducedMotion ? 0 : BRANCH_EXIT_S, ease: EASE_IOS },
    },
    transition: { duration: reducedMotion ? 0 : BRANCH_ENTER_S, ease: EASE_IOS },
  } as const;

  return (
    // relative: the popLayout'd exiting element positions against this box, so
    // the loader fades out exactly where it stood while the card fades in.
    <div className="relative">
      <AnimatePresence mode="popLayout" initial={false}>
        {regeneratingDrills ? (
          <motion.div key="drill-loader" {...fade}>
            <MasteryGeneratingCard kind="drills" accentToken={disciplineToken(discipline)} />
          </motion.div>
        ) : (
          // Opacity-only on the card branch: a lingering transform here would
          // turn the card's `fixed` celebration overlay into a mis-anchored
          // child, so no y/scale on this inner swap.
          <motion.div key="drill-content" {...fade}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
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
  // Scope the flow to the active camp so missions/sparring reset per camp.
  // Skip while the active camp resolves to avoid a flash of cross-camp flow.
  const activeCamp = useQuery(api.fight_camp.getActiveCamp);
  const flow = useQuery(
    api.mastery_spine.getMasteryFlow,
    activeCamp === undefined ? "skip" : { campId: activeCamp?._id },
  ) as MasteryFlowEntry[] | undefined;
  // Camp-scope the generation markers too (sibling of getMasteryFlow above) so a
  // "generating…" marker from another camp can't leak into this camp's flow.
  const generationRaw = useQuery(
    api.mastery_spine.getGenerationStatus,
    activeCamp === undefined ? "skip" : { campId: activeCamp?._id },
  ) as GenerationJob[] | undefined;

  // ── Data latch: never re-blank once we've had data ────────────────────────
  // The camp-scoped `flow` query (`{ campId: activeCamp?._id }`) briefly
  // resolves back to `undefined` whenever getActiveCamp re-resolves. Previously
  // that collapsed the whole widget to the loading branch mid-view (a visible
  // re-blank). Keep the last non-undefined result in a ref and render from it
  // through the blip; the fresh result replaces it the moment it lands. Only a
  // TRUE first load (nothing ever latched) shows the loading branch.
  const lastFlowRef = useRef<MasteryFlowEntry[] | null>(null);
  if (flow !== undefined) lastFlowRef.current = flow;
  const latchedFlow = flow ?? lastFlowRef.current;

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
  // Derived from the LATCHED flow: during a flow blip the raw query goes
  // undefined, which would collapse counts to {} and read to the detector as
  // "every >0 count just fell to 0" — a false cycle-complete cutscene. The
  // latch keeps the counts steady through the blip.
  const graduatedCounts = useMemo<GraduatedCounts>(() => {
    const counts: GraduatedCounts = {};
    for (const e of latchedFlow ?? []) {
      counts[e.discipline] = e.assignments.filter(
        (a) =>
          (a as { source?: string }).source === "graduated" &&
          (a as { masteredAt?: number }).masteredAt == null,
      ).length;
    }
    return counts;
  }, [latchedFlow]);

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

  // Stable dismiss so the cutscene's auto-dismiss timer effect doesn't re-run
  // (and reset / re-fire) on every MasterySpine re-render. An inline arrow here
  // gets a new identity each render, which thrashed that timer.
  const handleDismissCutscene = useCallback(() => setCutscene(null), []);

  // Deterministic path: fire the cutscene for any discipline the detector
  // flagged as newly-complete this render (and not already celebrated).
  useEffect(() => {
    if (cycleDetector.completions.length === 0) return;
    const next = cycleDetector.completions[0];
    void triggerHapticSuccess();
    setCutscene((prev) => prev ?? { discipline: next.discipline, xp: next.xp });
  }, [cycleDetector.completions]);

  // ── Reactive reconciliation: clear the optimistic "generating" signal the
  // MOMENT the real drills/sparring land in the live `flow` query (a discipline
  // gains its first missions / first assignments). Without this the signal rode
  // its full 15s TTL — the existing per-card "reconcile" effects gate on the
  // loader's own held-state, which the signal itself keeps true, so they never
  // fire early. The result was a loader held over already-arrived data until a
  // manual pull-to-refresh reset the in-memory signal store. This is a pure
  // reactive handoff to Convex's push (no polling); the 2.5s min-display latch
  // still guarantees the loader animation plays. We track 0→≥1 transitions per
  // discipline so REGENERATION loaders (count already ≥1) are unaffected.
  const dataPresenceRef = useRef<Map<string, { drills: boolean; sparring: boolean }>>(
    new Map(),
  );
  useEffect(() => {
    if (!flow) return;
    for (const e of flow) {
      const key = e.discipline.toLowerCase();
      const prev = dataPresenceRef.current.get(key) ?? { drills: false, sparring: false };
      const hasDrills = e.missions.length > 0;
      const hasSparring = e.assignments.length > 0;
      if (hasDrills && !prev.drills) clearMasterySignal(e.discipline, "drills");
      if (hasSparring && !prev.sparring) clearMasterySignal(e.discipline, "sparring");
      dataPresenceRef.current.set(key, { drills: hasDrills, sparring: hasSparring });
    }
  }, [flow]);

  // All hooks must run unconditionally — guards come after.

  // ── Guards (after all hooks) ──────────────────────────────────────────────

  // ── Null-safe derivations (NO early returns) ─────────────────────────────
  // CRITICAL: the <MasteryCutscene> at the bottom must NEVER unmount while it's
  // open, or the camp page flashes through and it re-enters (the reported
  // flicker). So instead of early-returning for loading / not-Pro / empty, we
  // compute a `body` that varies while the return STRUCTURE stays constant
  // (<style>, then {body}, then <MasteryCutscene> — the cutscene always at the
  // same child slot). Re-blank blips are handled by the `latchedFlow` ref
  // above: when the camp-scoped `flow` momentarily resolves back to undefined,
  // we keep rendering the last-known data, so `isReady` only goes false on a
  // TRUE first load.
  const isReady = feature !== undefined && latchedFlow !== null;
  const isPro = feature?.isPro === true;
  const flowList = latchedFlow ?? [];

  const flowDisciplines = new Set(flowList.map((e) => e.discipline.toLowerCase()));

  // All disciplines currently held in the "drills" generating set (active OR
  // within the min-display window). Disciplines with no card in the flow yet
  // get a loader-only DrillRegenWrapper (entry = null); disciplines that
  // ALREADY have a card (regeneration) show the loader over the card via the
  // same wrapper, cross-fading back to the real card when the latch releases.
  const heldDrillsDisciplines = Array.from(
    new Map(
      heldGeneration.jobs
        .filter((g) => g.kind === "drills")
        .map((g) => [g.discipline.toLowerCase(), g.discipline] as const),
    ).values(),
  );

  // Disciplines generating their FIRST drills — no card in the flow yet.
  const generatingDrills = heldDrillsDisciplines.filter(
    (disc) => !flowDisciplines.has(disc.toLowerCase()),
  );

  // First-run empty state — rendered as the BODY (never an early return).
  const showEmpty =
    isReady && isPro && flowList.length === 0 && generatingDrills.length === 0 && !cutscene;

  // Branch key for the top-level cross-fade. Exactly one branch renders at a
  // time; the AnimatePresence in the return cross-fades on key change.
  const branch: "loading" | "locked" | "empty" | "content" = !isReady
    ? "loading"
    : !isPro
      ? "locked"
      : showEmpty
        ? "empty"
        : "content";

  // Unified per-discipline render list. Disciplines generating their FIRST
  // drills (entry = null → wrapper shows the loader) render at the top; the
  // flow is ordered by recent activity, so that's where the new card lands.
  // Keyed by LOWERCASED discipline so the SAME DrillRegenWrapper element
  // carries a discipline across "loader only" → "card arrived". (The old
  // `gen-${disc}` / `entry.discipline` key split changed element identity at
  // exactly that moment — an unmount/remount flash right as the first drill
  // appeared.)
  const renderEntries: Array<{
    key: string;
    discipline: string;
    entry: MasteryFlowEntry | null;
  }> = [
    ...generatingDrills.map((disc) => ({
      key: disc.toLowerCase(),
      discipline: disc,
      entry: null as MasteryFlowEntry | null,
    })),
    ...flowList.map((entry) => ({
      key: entry.discipline.toLowerCase(),
      discipline: entry.discipline,
      entry: entry as MasteryFlowEntry | null,
    })),
  ];

  // The varying part of the tree. Rendered inside a keyed motion.div so branch
  // swaps cross-fade instead of hard-cutting.
  let branchContent: ReactNode = null;
  if (branch === "loading") {
    // Reserved-height invisible placeholder: holds the widget's slot on TRUE
    // first load so the card doesn't cause a layout jump when it arrives.
    // (Previously this branch rendered nothing — 0px — and the whole widget
    // popped in abruptly once the queries resolved.)
    branchContent = <div aria-hidden className="h-24" />;
  } else if (branch === "locked") {
    branchContent = cutscene ? null : <LockedMissionCard />;
  } else if (branch === "empty") {
    branchContent = <MasteryEmptyCard />;
  } else {
    branchContent = (
      <div className="space-y-3">
        {renderEntries.map(({ key, discipline, entry }) => {
          // The held "drills" latch covers BOTH first generation (entry null,
          // wrapper shows the loader) and regeneration (loader over the card
          // for the held min-window, then a cross-fade back to the real card).
          const regeneratingDrills = heldGeneration.has(discipline, "drills");
          return (
            <DrillRegenWrapper
              key={key}
              discipline={discipline}
              regeneratingDrills={regeneratingDrills}
              reducedMotion={reducedMotion}
            >
              {entry ? (
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
              ) : null}
            </DrillRegenWrapper>
          );
        })}
      </div>
    );
  }

  // Stable structure: <style>, the body AnimatePresence, <MasteryCutscene> —
  // the cutscene is ALWAYS the third child at the same slot, so swapping the
  // body branch (loading / locked / empty / content) can never unmount it.
  // THIS is what kills the "camp page flashes then the cutscene comes back"
  // flicker for good. The AnimatePresence occupies the old `{body}` slot: it
  // never unmounts itself; only the keyed branch inside it swaps, with
  // popLayout cross-fading old and new branches concurrently (house pattern,
  // see Community.tsx). Reduced motion renders branch swaps instantly.
  return (
    <>
      {/* Keyframe definitions injected once alongside the component tree. */}
      <style>{KEYFRAMES}</style>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={branch}
          className="w-full"
          initial={
            reducedMotion
              ? false
              : {
                  opacity: 0,
                  // Small rise for the data-bearing branches only; loading and
                  // locked fade in place.
                  y: branch === "content" || branch === "empty" ? 8 : 0,
                }
          }
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            transition: {
              duration: reducedMotion ? 0 : BRANCH_EXIT_S,
              ease: EASE_IOS,
            },
          }}
          transition={{
            duration: reducedMotion ? 0 : BRANCH_ENTER_S,
            ease: EASE_IOS,
          }}
        >
          {branchContent}
        </motion.div>
      </AnimatePresence>

      {/* Mastered "trophy" shelf moved to the bottom of the Camp page (below
          Recent activity) and made collapsible — see <MasteredShelf> in Camp.tsx. */}

      {/* Full-screen congrats cutscene + XP, fired on whole-cycle completion. */}
      <MasteryCutscene
        open={!!cutscene}
        accentToken={cutscene ? disciplineToken(cutscene.discipline) : "--coach-default"}
        xp={cutscene?.xp ?? 0}
        disciplineLabel={cutscene ? disciplineLabel(cutscene.discipline) : ""}
        techniqueCount={
          cutscene
            ? (flowList.find((e) => e.discipline === cutscene.discipline)?.assignments.length ?? 3)
            : 0
        }
        onDismiss={handleDismissCutscene}
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
