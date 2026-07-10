import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
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
import {
  useMinimumDisplay,
  useCycleCompletionDetector,
  resolveCycleXp,
  type GenerationJob,
  type GraduatedCounts,
  type LoaderMinDisplay,
} from "./useMinimumDisplay";
import {
  useMasterySignals,
  clearMasterySignal,
} from "./masteryGenerationSignals";
import type { MasteryFlowEntry } from "@/../convex/mastery_spine";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mission = Doc<"training_missions"> & {
  items: Doc<"training_mission_items">[];
};

/**
 * Server-derived flow phase.
 *
 * "graduating" is the window between the last drill tick (the missions are
 * archived immediately) and the sparring assignments landing. Aliased straight
 * off the query's own type: if the server ever stops emitting a phase this file
 * branches on, that must be a compile error here, not a silent dead branch.
 */
type MasteryPhase = MasteryFlowEntry["phase"];

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

/** Duration of the one height animation that releases the frozen card body. */
const HEIGHT_RELEASE_S = 0.34;

/** How long a discipline must sit continuously in "graduating" before the
 *  client nudges the server to re-schedule it. Comfortably longer than a
 *  healthy graduation, so a normal one is never nudged. */
const STUCK_GRADUATION_DELAY_MS = 20_000;

// ─── Height freeze ─────────────────────────────────────────────────────────────

/**
 * Locks the discipline card body's height across the drill → graduating swap.
 *
 * Ticking the last drill replaces a tall mission list with a 56px loader. Left
 * alone the body collapses on that frame and every card below it on the page
 * jumps up. This box pins itself to the last settled height of the UNFROZEN
 * content for the whole frozen window, so the cross-fade plays inside a box
 * that never changes size. Once the sparring rows mount it animates once, from
 * the pin to their natural height, then releases back to `auto` so the box
 * tracks its content again.
 *
 * Three modes:
 *   "auto":      no pin, `height: auto`, box tracks content.
 *   "pinned":    inline `height: <pin>px`, written by React in the same
 *                 pre-paint commit as the content swap, so nothing ever moves.
 *   "releasing": motion animates `height: auto` from the pin.
 *
 * Measurement is a ResizeObserver writing a ref (zero renders), read only at
 * the two transition edges. Nothing is measured on the render path.
 *
 * Reduced motion: no pin, no cross-fade, no animation. The content just swaps.
 */
function HeightFreezeBox({
  frozen,
  reducedMotion,
  children,
}: {
  frozen: boolean;
  reducedMotion: boolean | null;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  /** Last settled height (px) of the content while UNFROZEN. */
  const lastUnfrozenPx = useRef<number | null>(null);
  const wasFrozenRef = useRef(frozen);

  const [mode, setMode] = useState<"auto" | "pinned" | "releasing">("auto");
  const [pinPx, setPinPx] = useState<number | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (reducedMotion || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // While pinned the content is the 56px loader. Never let it overwrite the
      // drill list's height, which is the height we are about to freeze at.
      if (wasFrozenRef.current) return;
      lastUnfrozenPx.current = el.offsetHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reducedMotion]);

  // useLayoutEffect, not useEffect: this runs after the swap has been committed
  // to the DOM but BEFORE the browser paints, and its setState re-renders
  // synchronously in the same commit. The collapsed frame is never shown.
  useLayoutEffect(() => {
    const was = wasFrozenRef.current;
    wasFrozenRef.current = frozen;
    if (reducedMotion || was === frozen) return;

    if (frozen) {
      const pin = lastUnfrozenPx.current;
      // A zero pin is never a real measurement: `offsetHeight` reads 0 for an
      // element that is display:none, inside a collapsed card, or not yet laid
      // out. Pinning to it would collapse the card, which is the exact jump this
      // box exists to prevent. Treat it like "never measured" and skip the
      // freeze; an unfrozen swap is imperfect but never destructive.
      if (pin == null || pin <= 0) return;
      setPinPx(pin);
      setMode("pinned");
    } else {
      // The sparring rows have mounted. Animate the pin out to their natural
      // height; `onAnimationComplete` then hands the box back to `auto`.
      setMode("releasing");
    }
  }, [frozen, reducedMotion]);

  if (reducedMotion) {
    return (
      <div ref={innerRef} className="relative">
        {children}
      </div>
    );
  }

  return (
    <motion.div
      // "pinned" keeps `animate` off entirely so the inline style below is the
      // only thing setting height: no animation, no chance of a stray frame.
      animate={mode === "releasing" ? { height: "auto" } : undefined}
      transition={{ duration: HEIGHT_RELEASE_S, ease: EASE_IOS }}
      // Only the release animation hands the box back to `auto`. Guarded so a
      // stray completion callback can never drop the pin mid-freeze.
      onAnimationComplete={() => setMode((m) => (m === "releasing" ? "auto" : m))}
      style={
        mode === "auto"
          ? // `flow-root` establishes a block formatting context, exactly as the
            // `overflow: hidden` of the pinned state does. Without it the two
            // states have different box semantics: unpinned, a child's bottom
            // margin escapes the box and pads the card by ~14px; pinned, the BFC
            // contains it and the card silently loses those pixels at the swap.
            // Same containment in both states means zero movement. It does not
            // clip, so nothing inside can be cut off.
            { height: "auto", display: "flow-root" }
          : // "releasing" keeps the pin in the style prop so motion reads the
            // pin as its from-value; it then owns height for the animation.
            //
            // Centred column: the frozen box holds the tall drill list's height
            // while the 56px loader occupies it. Pinned to the top, the loader
            // would sit above ~450px of dead space. Centring makes the held
            // height read as a deliberate panel for the beat it is up. A flex
            // container also contains child margins, so the box geometry stays
            // identical to the `flow-root` of the unfrozen state.
            {
              height: pinPx ?? undefined,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }
      }
    >
      {/* relative: the popLayout'd exiting branch positions against this box.
          flow-root: this element is what we MEASURE, and the outer box is what
          we PIN. If a descendant's bottom margin escapes this div, the two
          differ (the outer contains the margin, `offsetHeight` here does not)
          and the card loses exactly that many pixels the moment it pins. Making
          both a block formatting context keeps measurement and pin identical. */}
      <div ref={innerRef} className="relative" style={{ display: "flow-root" }}>
        {children}
      </div>
    </motion.div>
  );
}

// ─── Per-discipline card ───────────────────────────────────────────────────────

interface DisciplineCardProps {
  discipline: string;
  missions: Mission[];
  assignments: SparringAssignment[];
  /** Phase derived by the server (getMasteryFlow), the source of truth. */
  serverPhase: MasteryPhase;
  reducedMotion: boolean | null;
  /** Called by a child SparringAssignmentRow when the final un-mastered
   *  graduated assignment for this discipline is mastered (cycleComplete).
   *  The parent owns the full-screen congrats cutscene + XP. */
  onCycleComplete: (discipline: string, xp: number) => void;
  /** True while this discipline's sparring is in the merged/held generating set
   *  (backend job, optimistic signal, or the "graduating" phase). Drives the
   *  in-card sparring loader and its cross-fade to the real rows. Held for
   *  ≥SPARRING_LOADER_MIN_DISPLAY_MS even after assignments arrive. */
  generatingSparring: boolean;
}

/**
 * One unified discipline card.
 *
 * Phase (server-derived):
 *   "drill":      an active mission still has an incomplete item.
 *   "graduating": the last drill was ticked, the missions are archived, the
 *                  sparring assignments do not exist yet. `missions` is empty.
 *   "spar":       graduated assignments to land.
 *   "idle":       nothing outstanding (treated as "spar" for display).
 *
 * Minimise/expand: toggles the card body. Persisted to
 *   `wcw_mastery_min_${discipline}` (default expanded).
 * Chevron rotation respects prefers-reduced-motion.
 *
 * Exported for `__tests__/graduatingCard.test.tsx`, which renders it directly.
 */
export function DisciplineCard({
  discipline,
  missions,
  assignments,
  serverPhase,
  reducedMotion,
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

  // Cycle complete: the final graduated assignment for this discipline is
  // mastered. We hand off to the PARENT, which owns the full-screen congrats
  // cutscene + XP and the per-discipline trophy reveal. Double-fire guarded.
  const cycleFiredRef = useMemo(() => ({ current: false }), []);

  const handleCycleComplete = (disc: string, cycleXp?: number) => {
    if (cycleFiredRef.current) return; // double-fire guard
    cycleFiredRef.current = true;
    onCycleComplete(disc, resolveCycleXp(cycleXp));
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

  // Phase: the server-derived value from getMasteryFlow. Only "drill" keeps the
  // drill list up; "idle" falls through with "spar" (a defensive fallback:
  // idle entries are normally excluded from results).
  const phase = serverPhase;
  const isDrill = phase === "drill";

  // The sparring loader owns the Stage-2 region from the moment the last drill
  // is ticked until the rows land. "graduating" is the server's own name for
  // that window; `generatingSparring` additionally covers the optimistic client
  // signal (which fires a render earlier) and sparring regeneration.
  const showSparLoader = phase === "graduating" || generatingSparring;

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

  // Cross-fade shared by the three body branches. Opacity only: a transform
  // here would fight the frozen box's height pin.
  const bodyFade = {
    initial: reducedMotion ? false : { opacity: 0 },
    animate: { opacity: 1 },
    exit: {
      opacity: 0,
      transition: { duration: reducedMotion ? 0 : BRANCH_EXIT_S, ease: EASE_IOS },
    },
    transition: { duration: reducedMotion ? 0 : BRANCH_ENTER_S, ease: EASE_IOS },
  } as const;

  return (
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
              {isDrill ? "Stage 1" : "Stage 2"}
            </span>
          </div>
          <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
            {isDrill
              ? `${doneItems} of ${totalItems} drills done`
              : showSparLoader
                ? "Unlocking your sparring"
                : `${assignments.filter((a) => a.status === "todo").length} to land in sparring`}
          </p>
        </div>

        {/* Item count badge */}
        {isDrill && totalItems > 0 && (
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
          {/* Stage indicator. "graduating" has already cleared Stage 1, so it
              reads as Stage 2 active, same as "spar". */}
          <StageIndicator phase={isDrill ? "drill" : "spar"} accentToken="--primary" />

          {/* The three body branches swap INSIDE a height-frozen box: ticking
              the last drill trades a tall mission list for a 56px loader
              without moving a single pixel of the page below. popLayout
              cross-fades the outgoing and incoming branches concurrently. */}
          <HeightFreezeBox frozen={showSparLoader} reducedMotion={reducedMotion}>
            <AnimatePresence mode="popLayout" initial={false}>
              {showSparLoader ? (
                /* The wizard-aurora loader takes over the whole body whenever
                   this discipline is graduating or in the merged/held
                   "generating sparring" set, even if assignments have already
                   arrived. The min-display latch keeps it up ~3s so graduation
                   plays as one continuous process. */
                <motion.div key="spar-loader" {...bodyFade}>
                  <div className="px-3 pb-4">
                    <MasteryGeneratingCard kind="sparring" accentToken="--primary" />
                  </div>
                </motion.div>
              ) : isDrill ? (
                <motion.div key="drill" {...bodyFade}>
                  {/* Stage 1: mission cards. The inner AnimatePresence owns each
                      card's exit so a single completed drill card (auto-archived
                      server-side) collapses smoothly while its siblings remain. */}
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
                            />
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  )}
                  <SealedStage accentToken="--primary" remaining={remainingDrills} />
                </motion.div>
              ) : (
                <motion.div key="spar-rows" {...bodyFade}>
                  <div className="px-3 pb-4">
                    {assignments.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground text-center py-4">
                        No sparring assignments yet for {label}. Log more sessions to build your list.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {/* AnimatePresence owns each row's exit: when a mastered
                            assignment drops from the list on the next query tick,
                            the row plays its fade + height collapse instead of
                            blinking out, and the rows below slide up. */}
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
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </HeightFreezeBox>
        </div>
      )}
    </div>
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
  // (c) the server "graduating" phase: the drills are archived and the sparring
  //     assignments do not exist yet, so by definition this discipline is
  //     generating its sparring.
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
    // (c) the graduating phase
    for (const e of flow ?? []) {
      const p: MasteryPhase = e.phase;
      if (p === "graduating") add(e.discipline, "sparring");
    }
    return Array.from(byKey.values());
  }, [generationRaw, signals, flow]);

  // Latch generating jobs so the wizard-aurora loader always plays for a brief
  // minimum even when generation is instant/cached (see useMinimumDisplay).
  // Per-kind floors: sparring holds ~3s (SPARRING_LOADER_MIN_DISPLAY_MS) so
  // graduation plays as one continuous process; reduced motion drops the forced
  // sparring window so the reward shows without the long animation.
  const loaderFloors = useMemo<LoaderMinDisplay | undefined>(
    () => (reducedMotion ? { sparring: 0 } : undefined),
    [reducedMotion],
  );
  const heldGeneration = useMinimumDisplay(generationJobs, loaderFloors);

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

  // Camp-scope the detector: a camp switch swaps graduatedCounts wholesale, so
  // pass the active camp id as the resetKey. The third arg is a stability flag:
  // graduatedCounts is derived from `latchedFlow`, which holds the OLD camp's
  // counts while `flow` is briefly undefined during a camp switch. Passing
  // `flow !== undefined` tells the detector to ignore those blip renders and
  // only (re)baseline / detect against settled data, so the swap never reads
  // as a batch of false completions.
  const cycleDetector = useCycleCompletionDetector(
    graduatedCounts,
    activeCamp?._id,
    flow !== undefined,
  );

  // Full-screen congrats cutscene for a discipline that just finished its
  // whole cycle (drills + sparring). The discipline stays "hidden" on the
  // trophy shelf until the cutscene is dismissed, so the reveal feels earned.
  const [cutscene, setCutscene] = useState<{ discipline: string; xp: number } | null>(null);

  // Imperative path (SparringAssignmentRow → DisciplineCard → here), carrying
  // the server's real `cycleXp` off the resolved markLanded. Shares the
  // detector's celebrated-Set guard so it can't double-fire with the
  // deterministic detection below, which only has an estimate to offer.
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

  // ── Graduation self-heal nudge ────────────────────────────────────────────
  // A discipline stuck in "graduating" has cleared its drills but never got its
  // sparring rows: if the last drill tick's scheduled graduation threw (e.g. a
  // Groq outage), nothing re-schedules it and the discipline sits there. Prompt
  // an immediate server re-schedule rather than waiting for the 15-minute cron.
  //
  // "graduating" is also the NORMAL state for the few seconds a healthy
  // graduation takes, so the nudge waits out an uninterrupted staleness window
  // before firing, otherwise every graduation would race a duplicate schedule
  // against the one already in flight. A per-discipline Set then caps it at one
  // nudge per stuck discipline per mount. Best-effort: the cron covers failures.
  const retryStuckGraduation = useMutation(
    api.training_missions.retryStuckGraduation,
  );
  const nudgedStuckRef = useRef<Set<string>>(new Set());
  const stuckTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    if (!flow) return;
    const timers = stuckTimersRef.current;
    const nudged = nudgedStuckRef.current;

    const graduating = new Set<string>();
    for (const e of flow) {
      const p: MasteryPhase = e.phase;
      if (p === "graduating") graduating.add(e.discipline.toLowerCase());
    }

    // Arm the staleness window for each newly-graduating discipline.
    for (const key of graduating) {
      if (nudged.has(key) || timers.has(key)) continue;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          nudged.add(key);
          void retryStuckGraduation({}).catch(() => {
            /* best-effort self-heal; the cron backstop covers failures */
          });
        }, STUCK_GRADUATION_DELAY_MS),
      );
    }

    // A discipline that graduated normally disarms its pending nudge.
    for (const [key, t] of timers) {
      if (!graduating.has(key)) {
        clearTimeout(t);
        timers.delete(key);
      }
    }
  }, [flow, retryStuckGraduation]);

  // Never let a pending nudge fire after teardown.
  useEffect(() => {
    const timers = stuckTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

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

  // Branch key for the top-level cross-fade. Exactly one branch renders at a
  // time; the AnimatePresence in the return cross-fades on key change. A Pro
  // user with no drills and nothing generating falls through to "content" (an
  // empty list renders nothing) — there is no dedicated first-run empty card.
  const branch: "loading" | "locked" | "content" = !isReady
    ? "loading"
    : !isPro
      ? "locked"
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
  } else {
    branchContent = (
      <div className="space-y-3">
        {/* A discipline that leaves the flow (its whole cycle is mastered) must
            play an exit, not hard-unmount: fade + height/margin collapse, so the
            cards below slide up in one continuous motion instead of jumping.
            House idiom, same as MissionCard and SparringAssignmentRow. */}
        <AnimatePresence initial={false}>
          {renderEntries.map(({ key, discipline, entry }) => {
            // The held "drills" latch covers BOTH first generation (entry null,
            // wrapper shows the loader) and regeneration (loader over the card
            // for the held min-window, then a cross-fade back to the real card).
            const regeneratingDrills = heldGeneration.has(discipline, "drills");
            return (
              <motion.div
                key={key}
                layout="position"
                className="overflow-hidden"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={
                  reducedMotion
                    ? { opacity: 0, transition: { duration: 0.15 } }
                    : {
                        opacity: 0,
                        height: 0,
                        marginTop: 0,
                        marginBottom: 0,
                        transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
                      }
                }
                transition={{
                  duration: reducedMotion ? 0 : BRANCH_ENTER_S,
                  ease: EASE_IOS,
                }}
              >
                <DrillRegenWrapper
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
                      onCycleComplete={handleCycleComplete}
                      generatingSparring={heldGeneration.has(entry.discipline, "sparring")}
                    />
                  ) : null}
                </DrillRegenWrapper>
              </motion.div>
            );
          })}
        </AnimatePresence>
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
                  // Small rise for the data-bearing branch only; loading and
                  // locked fade in place.
                  y: branch === "content" ? 8 : 0,
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
