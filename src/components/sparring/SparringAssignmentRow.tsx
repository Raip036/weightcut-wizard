import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { stripDashes } from "@/lib/utils";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";
import { disciplineToken } from "@/lib/coachColors";

/** XP awarded per sparring assignment completed (mirrors the
 *  `toggleAssignment` mutation's `awardXp` amount). */
const SPARRING_XP_PER_ITEM = 15;

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
}

interface SparringAssignmentRowProps {
  assignment: SparringAssignment;
  /** Discipline accent CSS custom-property name (e.g. `--coach-sparring`). */
  token: string;
}

/** Number of filled pips shown in the confidence meter (0–5). */
const PIP_COUNT = 5;

/**
 * A single tappable sparring to-do. The main tap area (checkbox + technique +
 * when-to-use) flips the todo/done status via `toggleAssignment`. Setups and
 * counters are always visible as plain-bullet lists under muted labels — no
 * disclosure toggle needed.
 *
 * A 5-pip confidence meter to the left of the content fills based on
 * `timesLogged` (capped at 5) in the discipline color token.
 *
 * Convex reactivity drives the visual update once the mutation resolves; a
 * short `pending` guard prevents double-fires on rapid taps. On a tick-on we
 * bump a local `floatKey` so the "+XP" float retriggers.
 */
export function SparringAssignmentRow({
  assignment,
  token,
}: SparringAssignmentRowProps) {
  const reduced = useReducedMotion();
  const toggleAssignment = useMutation(api.sparring_plan.toggleAssignment);
  const [pending, setPending] = useState(false);
  const [floatKey, setFloatKey] = useState(0);
  const done = assignment.status === "done";
  const hasDetails =
    assignment.setups.length > 0 || assignment.counters.length > 0;

  /** Pip color comes from the row's discipline, not a fixed purple. */
  const pipToken = disciplineToken(assignment.discipline);
  const filledPips = Math.min(PIP_COUNT, assignment.timesLogged ?? 0);

  const handleToggle = async () => {
    if (pending) return;
    if (!done) setFloatKey((k) => k + 1);
    setPending(true);
    triggerHapticSelection();
    try {
      await toggleAssignment({ id: assignment._id });
    } catch (err) {
      console.warn("SparringAssignmentRow: toggleAssignment failed", err);
    } finally {
      setPending(false);
    }
  };

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
