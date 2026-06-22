import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { stripDashes } from "@/lib/utils";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";
import { disciplineToken } from "@/lib/coachColors";

/** XP awarded per sparring assignment completed or landed. */
const SPARRING_XP_PER_ITEM = 15;

/** Number of lands required to master a graduated technique. */
const LAND_THRESHOLD = 3;

/** Diameter of a single land circle. Larger than the legacy checkbox (18px)
 *  so the 3 lands read as a chunky to-do list column. */
const LAND_CIRCLE_SIZE = 22;

/**
 * A single to-do-list land circle. Mirrors `AnimatedCheckbox` from
 * TickReward.tsx exactly (same border/fill/scale-pop behaviour and the same
 * drawn check path) but rendered as a `rounded-full` circle and driven by a
 * `filled` flag rather than the binary `done` of a checkbox. A filled circle
 * reads as a ticked to-do item; empty reads as an unchecked circle.
 */
function LandCircle({
  filled,
  token,
  size = LAND_CIRCLE_SIZE,
}: {
  filled: boolean;
  token: string;
  size?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="relative rounded-full border flex items-center justify-center flex-shrink-0"
      style={{ height: size, width: size }}
      animate={{
        backgroundColor: filled ? `hsl(var(${token}))` : "hsla(0,0%,100%,0)",
        borderColor: filled ? `hsl(var(${token}))` : "hsl(var(--border))",
        scale: filled && !reduced ? [1, 1.3, 1] : 1,
      }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        className="text-background"
      >
        <motion.path
          d="M5 12.5 L10 17.5 L19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: filled ? 1 : 0 }}
          transition={{
            duration: reduced ? 0 : 0.28,
            ease: "easeOut",
            delay: filled ? 0.08 : 0,
          }}
        />
      </svg>
    </motion.span>
  );
}

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
  /** Discipline accent CSS custom-property name (e.g. `--coach-sparring`). */
  token: string;
  /**
   * Called when `markLanded` returns `cycleComplete: true` — the final
   * un-mastered graduated assignment for this discipline was just mastered.
   * Mirrors the `onAllMissionsComplete` callback pattern from MissionCard.
   */
  onCycleComplete?: (discipline: string) => void;
}

/** Number of filled pips shown in the legacy confidence meter (0–5). */
const PIP_COUNT = 5;

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
  token,
  onCycleComplete,
}: SparringAssignmentRowProps) {
  const reduced = useReducedMotion();
  const toggleAssignment = useMutation(api.sparring_plan.toggleAssignment);
  const markLanded = useMutation(api.mastery_spine.markLanded);
  const [pending, setPending] = useState(false);
  const [floatKey, setFloatKey] = useState(0);
  // Optimistic landedCount — starts at the DB value and advances on each tap.
  const [optimisticLanded, setOptimisticLanded] = useState<number | null>(null);
  const [mastering, setMastering] = useState(false);

  const isGraduated = assignment.source === "graduated";
  const done = assignment.status === "done";
  const hasDetails =
    assignment.setups.length > 0 || assignment.counters.length > 0;

  /** Pip color comes from the row's discipline, not a fixed purple. */
  const pipToken = disciplineToken(assignment.discipline);
  const filledPips = Math.min(PIP_COUNT, assignment.timesLogged ?? 0);

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
      if (result.mastered) {
        setMastering(true);
      }
      if (result.cycleComplete && onCycleComplete) {
        onCycleComplete(assignment.discipline);
      }
    } catch (err) {
      // Revert optimistic update on failure.
      setOptimisticLanded(null);
      console.warn("SparringAssignmentRow: markLanded failed", err);
    } finally {
      setPending(false);
    }
  };

  // ── Graduated row — lands meter layout ──────────────────────────────────
  if (isGraduated) {
    return (
      <AnimatePresence>
        {!mastering && (
          <motion.div
            layout
            key={assignment._id}
            className="relative rounded-lg overflow-hidden"
            exit={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, transition: { duration: 0.35 } }
            }
          >
            {/* Mastery flash: brief accent burst when the 3rd land lands. */}
            <AnimatePresence>
              {displayedLanded >= LAND_THRESHOLD && !reduced && (
                <motion.span
                  key="mastery-flash"
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: `hsl(var(${token}) / 0.28)` }}
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  aria-hidden
                />
              )}
            </AnimatePresence>

            {/* Main tap area: records one land. */}
            <motion.button
              type="button"
              disabled={pending || displayedLanded >= LAND_THRESHOLD}
              onClick={handleLand}
              whileTap={reduced ? undefined : { scale: 0.99 }}
              aria-label={`Land ${assignment.technique}: ${displayedLanded} of ${LAND_THRESHOLD}`}
              className="relative w-full flex items-start gap-2.5 px-2.5 py-2 text-left"
            >
              {/* 3 to-do-list land circles. Styled to match the drill card's
                  AnimatedCheckbox exactly (border/fill/scale-pop + drawn check),
                  just larger and circular. filled = displayedLanded of 3. */}
              <div
                className="flex flex-col items-center gap-[5px] pt-[1px] flex-none"
                aria-hidden
              >
                {Array.from({ length: LAND_THRESHOLD }).map((_, i) => (
                  <LandCircle key={i} filled={i < displayedLanded} token={token} />
                ))}
              </div>

              <div className="flex-1 min-w-0">
                <span
                  className="block text-[13px] font-semibold leading-snug break-words"
                  style={{ color: `hsl(var(${token}))` }}
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
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 italic">
                    {stripDashes(assignment.whenToUse)}
                  </p>
                )}
              </div>
              <XpFloat floatKey={floatKey} token={token} amount={SPARRING_XP_PER_ITEM} />
            </motion.button>

            {/* Setups & counters. Left padding aligns bullets under the text
                column: px-2.5 + land-circle column (22px) + gap-2.5. */}
            {hasDetails && (
              <div className="px-2.5 pb-3 pl-[calc(0.625rem+22px+0.625rem)] space-y-2">
                {assignment.setups.length > 0 && (
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-emerald-400/80 mb-1">
                      Set up
                    </p>
                    {assignment.setups.map((s, i) => (
                      <p
                        key={`setup-${i}`}
                        className="relative text-[11.5px] text-muted-foreground leading-snug pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                      >
                        {stripDashes(s)}
                      </p>
                    ))}
                  </div>
                )}
                {assignment.counters.length > 0 && (
                  <div className="min-w-0">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-amber-400/80 mb-1">
                      Watch for
                    </p>
                    {assignment.counters.map((c, i) => (
                      <p
                        key={`counter-${i}`}
                        className="relative text-[11.5px] text-muted-foreground leading-snug pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                      >
                        {stripDashes(c)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // ── Legacy row — binary checkbox ─────────────────────────────────────────
  return (
    <motion.div
      layout
      className="relative rounded-lg overflow-hidden"
      animate={{
        backgroundColor: done
          ? `hsl(var(${token}) / 0.06)`
          : "hsla(0,0%,100%,0.03)",
      }}
    >
      {/* Brief accent flash on completion. */}
      <AnimatePresence>
        {done && !reduced && (
          <motion.span
            key="flash"
            className="absolute inset-0 pointer-events-none"
            style={{ background: `hsl(var(${token}) / 0.18)` }}
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
        {/* 5-pip confidence meter: filled = min(5, timesLogged), discipline-colored. */}
        <div className="flex flex-col items-center gap-[3px] pt-[3px] flex-none" aria-hidden>
          {Array.from({ length: PIP_COUNT }).map((_, i) => (
            <span
              key={i}
              className="block w-1.5 h-1.5 rounded-full"
              style={
                i < filledPips
                  ? { backgroundColor: `hsl(var(${pipToken}))` }
                  : { backgroundColor: `hsl(var(${pipToken}) / 0.18)` }
              }
            />
          ))}
        </div>

        <AnimatedCheckbox done={done} token={token} />
        <div className="flex-1 min-w-0">
          {/* Technique name with a strikethrough sweep on done. */}
          <span className="relative inline-block max-w-full">
            <motion.span
              className="block text-[13px] font-semibold leading-snug break-words"
              animate={{
                color: done
                  ? "hsl(var(--muted-foreground))"
                  : "hsl(var(--foreground))",
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

          {/* When to use: permanent italic subtitle — always visible, no clamp. */}
          {assignment.whenToUse && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 italic">
              {stripDashes(assignment.whenToUse)}
            </p>
          )}
        </div>
        <XpFloat
          floatKey={floatKey}
          token={token}
          amount={SPARRING_XP_PER_ITEM}
        />
      </motion.button>

      {/* Setups & counters: always-visible plain bullets — no disclosure toggle. */}
      {hasDetails && (
        <div className="px-2.5 pb-3 pl-[calc(0.625rem+6px+0.625rem+20px+0.625rem)] space-y-2">
          {assignment.setups.length > 0 && (
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-emerald-400/80 mb-1">
                Set up
              </p>
              {assignment.setups.map((s, i) => (
                <p
                  key={`setup-${i}`}
                  className="relative text-[11.5px] text-muted-foreground leading-snug pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
                >
                  {stripDashes(s)}
                </p>
              ))}
            </div>
          )}
          {assignment.counters.length > 0 && (
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-amber-400/80 mb-1">
                Watch for
              </p>
              {assignment.counters.map((c, i) => (
                <p
                  key={`counter-${i}`}
                  className="relative text-[11.5px] text-muted-foreground leading-snug pl-3.5 min-w-0 break-words before:content-['•'] before:absolute before:left-1 before:top-0 before:text-muted-foreground/40"
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
