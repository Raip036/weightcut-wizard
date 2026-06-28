import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { stripDashes } from "@/lib/utils";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

/** XP awarded per sparring assignment completed or landed. */
const SPARRING_XP_PER_ITEM = 15;

/**
 * Number of lands required to master a graduated technique. This is the "of 3"
 * count and the single source of truth for how many AnimatedCheckbox boxes the
 * graduated row renders (the `markLanded` mutation masters at the same
 * threshold server-side). The data contract carries no per-row `required`
 * field, so this constant is the real required-count for every graduated row.
 */
const LAND_THRESHOLD = 3;

/** Shape of a single sparring assignment row, mirroring the
 *  `api.sparring_plan.listSparringAssignments` query contract. */
export interface SparringAssignment {
  _id: string;
  discipline: string;
  technique: string;
  whenToUse: string;
  setups: string[];
  counters: string[];
  status: "todo" | "done";
  updatedAt: number;
  /** Number of times this technique has been logged in sparring (Phase 0 field). */
  timesLogged: number;
  /** Mastery Spine: "graduated" rows use the lands meter; "library" rows use toggle. */
  source?: "graduated" | "library";
  /** How many times landed in live sparring (0-3+). */
  landedCount?: number;
  /** Set when the technique has been mastered (epoch-ms). */
  masteredAt?: number;
}

interface SparringAssignmentRowProps {
  assignment: SparringAssignment;
  /**
   * @deprecated The card now uses a single wizard-blue accent (`--primary`)
   * regardless of discipline. Kept optional for call-site compatibility.
   */
  token?: string;
  /**
   * Called when `markLanded` returns `cycleComplete: true` — the final
   * un-mastered graduated assignment for this discipline was just mastered.
   * Mirrors the `onAllMissionsComplete` callback pattern from MissionCard.
   */
  onCycleComplete?: (discipline: string) => void;
}

/**
 * A single tappable sparring to-do. Interaction splits by `source`:
 *
 * - `source === "graduated"`: lands meter (3 to-do circles). Each tap calls `markLanded`
 *   (+15 XP float). At 3 lands the row animates out (it becomes mastered and
 *   drops from the active list on the next query tick).
 *
 * - all other rows (legacy `source === "library"` or undefined): binary
 *   checkbox via `toggleAssignment` — unchanged behaviour.
 *
 * Setups and counters are always visible as plain-bullet lists under muted
 * labels. Convex reactivity drives the visual update once mutations resolve; a
 * short `pending` guard prevents double-fires on rapid taps.
 */
export function SparringAssignmentRow({
  assignment,
  onCycleComplete,
}: SparringAssignmentRowProps) {
  const reduced = useReducedMotion();
  // Single accent for the whole card: the wizard-blue primary. We deliberately
  // ignore the red discipline `token` for visual accents here so the card reads
  // as one calm blue system (checkbox fill, flash, XP float, technique title)
  // instead of the old red + green + amber + blue mix.
  const accent = "--primary";
  const toggleAssignment = useMutation(api.sparring_plan.toggleAssignment);
  const markLanded = useMutation(api.mastery_spine.markLanded);
  const [pending, setPending] = useState(false);
  const [floatKey, setFloatKey] = useState(0);
  // Optimistic landedCount — starts at the DB value and advances on each tap.
  const [optimisticLanded, setOptimisticLanded] = useState<number | null>(null);

  // Tracks whether this row is still mounted. Internal setState (mastery flash,
  // optimistic revert) is guarded by this to avoid setState-after-unmount
  // warnings — but the parent `onCycleComplete` call is deliberately NOT gated
  // by it, so the cutscene fires even if the row unmounts mid-exit (see below).
  const mountedRef = useRef(true);
  // Per-row guard so `onCycleComplete` can only fire once even on rapid taps or
  // overlapping resolutions.
  const cycleFiredRef = useRef(false);
  // Keep the latest callback in a ref so the resolved `markLanded` promise can
  // call it directly without depending on render-time closures or mounted state.
  const onCycleCompleteRef = useRef(onCycleComplete);
  useEffect(() => {
    onCycleCompleteRef.current = onCycleComplete;
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isGraduated = assignment.source === "graduated";
  const done = assignment.status === "done";
  const hasDetails =
    assignment.setups.length > 0 || assignment.counters.length > 0;

  // For graduated rows: resolve the displayed land count (optimistic takes priority).
  const displayedLanded =
    optimisticLanded !== null
      ? optimisticLanded
      : (assignment.landedCount ?? 0);

  // ── Legacy toggle (library / undefined source) ──────────────────────────
  const handleToggle = async () => {
    if (pending) return;
    if (!done) setFloatKey((k) => k + 1);
    setPending(true);
    triggerHapticSelection();
    try {
      await toggleAssignment({ id: assignment._id as Parameters<typeof toggleAssignment>[0]["id"] });
    } catch (err) {
      console.warn("SparringAssignmentRow: toggleAssignment failed", err);
    } finally {
      setPending(false);
    }
  };

  // ── Graduated land tap ───────────────────────────────────────────────────
  const handleLand = async () => {
    if (pending) return;
    if (displayedLanded >= LAND_THRESHOLD) return; // already mastered, no-op
    // Optimistic: advance the local count immediately.
    const next = displayedLanded + 1;
    setOptimisticLanded(next);
    setFloatKey((k) => k + 1);
    setPending(true);
    triggerHapticSelection();
    try {
      const result = await markLanded({
        assignmentId: assignment._id as Parameters<typeof markLanded>[0]["assignmentId"],
      });

      // ── Cycle-complete: fire FIRST, before starting the exit animation. ──
      // This is the cutscene trigger. We call it synchronously off the resolved
      // promise via a ref so it does NOT depend on this component still being
      // mounted — even if the parent drops the mastered row on the same query
      // tick, the cutscene fires instantly rather than a render late. The
      // `cycleFiredRef` guard makes it idempotent (the per-row double-fire guard
      // from the task), so overlapping resolutions can't fire it twice.
      if (result.cycleComplete && !cycleFiredRef.current) {
        cycleFiredRef.current = true;
        onCycleCompleteRef.current?.(assignment.discipline);
      }

      // On mastery we do NOT self-remove the row. The server drops the mastered
      // assignment from the list on the next query tick; the parent's
      // <AnimatePresence> then plays this row's `exit` (a smooth scale+fade) as
      // it leaves the keyed list. Self-removing here raced that server drop and
      // made the row vanish instantly without the exit ever playing.
    } catch (err) {
      // Revert optimistic update on failure (mounted-guarded).
      if (mountedRef.current) setOptimisticLanded(null);
      console.warn("SparringAssignmentRow: markLanded failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  };

  // ── Graduated row — lands meter layout ──────────────────────────────────
  // The root is a keyed motion element whose EXIT is owned by the parent's
  // <AnimatePresence> around the assignment list (MasterySpine). When the server
  // drops the mastered assignment, the parent removes this key and the exit
  // (scale + fade) plays smoothly instead of the row blinking out.
  if (isGraduated) {
    return (
      <motion.div
        layout
        className="relative rounded-lg overflow-hidden border border-primary/15"
        exit={
          reduced
            ? { opacity: 0 }
            : { opacity: 0, scale: 0.96, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }
        }
      >
        {/* Wizard-blue ambient backdrop (subtle) — replaces the old red
            discipline wash. Absolutely positioned behind content; the
            content sits above via relative + z-10. iOS-safe: the aurora
            component animates transform/opacity only and self-gates on
            reduced motion. */}
        <WizardAuroraBackground intensity="subtle" />

            {/* Mastery flash: brief accent burst when the final land lands. */}
            <AnimatePresence>
              {displayedLanded >= LAND_THRESHOLD && !reduced && (
                <motion.span
                  key="mastery-flash"
                  className="absolute inset-0 pointer-events-none z-10"
                  style={{ background: `hsl(var(${accent}) / 0.28)` }}
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  aria-hidden
                />
              )}
            </AnimatePresence>

            {/* Main tap area: records exactly one land per tap. */}
            <motion.button
              type="button"
              disabled={pending || displayedLanded >= LAND_THRESHOLD}
              onClick={handleLand}
              whileTap={reduced ? undefined : { scale: 0.99 }}
              aria-label={`Land ${assignment.technique}: ${displayedLanded} of ${LAND_THRESHOLD}`}
              className="relative z-10 w-full flex items-start gap-2.5 px-2.5 py-2 text-left"
            >
              {/* N AnimatedCheckbox boxes (N = LAND_THRESHOLD, the "of 3"
                  count) laid in a column — the SAME 20px animated checkbox the
                  drill card uses, so the two cards read as one system. Boxes
                  fill left-to-right (top-to-bottom here): box i is checked when
                  i < displayedLanded. Tapping advances exactly one land. */}
              <div
                className="flex flex-col items-center gap-[5px] flex-none"
                aria-hidden
              >
                {Array.from({ length: LAND_THRESHOLD }).map((_, i) => (
                  <AnimatedCheckbox
                    key={i}
                    done={i < displayedLanded}
                    token={accent}
                    size={20}
                  />
                ))}
              </div>

              <div className="flex-1 min-w-0">
                <span
                  className="block text-[13px] font-semibold leading-snug break-words"
                  style={{ color: `hsl(var(${accent}))` }}
                >
                  {assignment.technique}
                </span>

                {/* Land counter label: "Land 2 of 3". */}
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  {displayedLanded >= LAND_THRESHOLD
                    ? "Mastered"
                    : `Land ${displayedLanded} of ${LAND_THRESHOLD}`}
                </p>

                {assignment.whenToUse && (
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {stripDashes(assignment.whenToUse)}
                  </p>
                )}
              </div>
              <XpFloat floatKey={floatKey} token={accent} amount={SPARRING_XP_PER_ITEM} />
            </motion.button>

            {/* Setups & counters. Left padding aligns bullets under the text
                column: px-2.5 + checkbox column (20px) + gap-2.5. */}
            {hasDetails && (
              <div className="relative z-10 px-2.5 pb-3 pl-[calc(0.625rem+20px+0.625rem)] space-y-2.5">
                {assignment.setups.length > 0 && (
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60 mb-1">
                      Set up
                    </p>
                    {assignment.setups.map((s, i) => (
                      <p
                        key={`setup-${i}`}
                        className="relative text-[11.5px] text-foreground/75 leading-relaxed pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                      >
                        {stripDashes(s)}
                      </p>
                    ))}
                  </div>
                )}
                {assignment.counters.length > 0 && (
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60 mb-1">
                      Watch for
                    </p>
                    {assignment.counters.map((c, i) => (
                      <p
                        key={`counter-${i}`}
                        className="relative text-[11.5px] text-foreground/75 leading-relaxed pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                      >
                        {stripDashes(c)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
      </motion.div>
    );
  }

  // ── Legacy row — binary checkbox ─────────────────────────────────────────
  return (
    <motion.div
      layout
      className="relative rounded-lg overflow-hidden"
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
      animate={{
        // Neutral surface (no red discipline wash) so the legacy row matches
        // the graduated card and the drill card's checkbox-row system.
        backgroundColor: done
          ? "hsla(0,0%,100%,0.05)"
          : "hsla(0,0%,100%,0.03)",
      }}
    >
      {/* Brief accent flash on completion. */}
      <AnimatePresence>
        {done && !reduced && (
          <motion.span
            key="flash"
            className="absolute inset-0 pointer-events-none"
            style={{ background: `hsl(var(${accent}) / 0.18)` }}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {/* Main tap area: toggles done. */}
      <motion.button
        type="button"
        disabled={pending}
        onClick={handleToggle}
        whileTap={{ scale: 0.99 }}
        aria-pressed={done}
        aria-label={
          done
            ? `Untick: ${assignment.technique}`
            : `Mark done: ${assignment.technique}`
        }
        className="relative w-full flex items-start gap-2.5 px-2.5 py-2 text-left"
      >
        <AnimatedCheckbox done={done} token={accent} />
        <div className="flex-1 min-w-0">
          {/* Technique name with a strikethrough sweep on done. */}
          <span className="relative inline-block max-w-full">
            <motion.span
              className="block text-[13px] font-semibold leading-snug break-words"
              animate={{
                color: done
                  ? "hsl(var(--muted-foreground))"
                  : `hsl(var(${accent}))`,
              }}
            >
              {assignment.technique}
            </motion.span>
            <motion.span
              className="absolute left-0 top-1/2 h-[1.5px] origin-left"
              style={{ background: "hsl(var(--muted-foreground))", width: "100%" }}
              initial={false}
              animate={{ scaleX: done ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }}
              aria-hidden
            />
          </span>

          {/* When to use: permanent subtitle — always visible, no clamp. */}
          {assignment.whenToUse && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {stripDashes(assignment.whenToUse)}
            </p>
          )}
        </div>
        <XpFloat
          floatKey={floatKey}
          token={accent}
          amount={SPARRING_XP_PER_ITEM}
        />
      </motion.button>

      {/* Setups & counters: always-visible plain bullets — no disclosure toggle.
          Left padding aligns under the text column: px-2.5 + checkbox (18px) + gap-2.5. */}
      {hasDetails && (
        <div className="px-2.5 pb-3 pl-[calc(0.625rem+18px+0.625rem)] space-y-2.5">
          {assignment.setups.length > 0 && (
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60 mb-1">
                Set up
              </p>
              {assignment.setups.map((s, i) => (
                <p
                  key={`setup-${i}`}
                  className="relative text-[11.5px] text-foreground/75 leading-relaxed pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                >
                  {stripDashes(s)}
                </p>
              ))}
            </div>
          )}
          {assignment.counters.length > 0 && (
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60 mb-1">
                Watch for
              </p>
              {assignment.counters.map((c, i) => (
                <p
                  key={`counter-${i}`}
                  className="relative text-[11.5px] text-foreground/75 leading-relaxed pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                >
                  {stripDashes(c)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
