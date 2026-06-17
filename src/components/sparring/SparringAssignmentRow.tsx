import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { stripDashes } from "@/lib/utils";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";

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
}

interface SparringAssignmentRowProps {
  assignment: SparringAssignment;
  /** Discipline accent CSS custom-property name (e.g. `--coach-sparring`). */
  token: string;
}

/**
 * A single tappable sparring to-do. The main tap area (checkbox + technique +
 * when-to-use) flips the todo/done status via `toggleAssignment`. A separate
 * "Setups & counters" disclosure (collapsed by default) reveals the detail
 * without it ever toggling the row's done state.
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const done = assignment.status === "done";
  const hasDetails =
    assignment.setups.length > 0 || assignment.counters.length > 0;

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

      {/* Main tap area — toggles done. */}
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

          {/* When to use — single muted line. */}
          {assignment.whenToUse && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-1">
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

      {/* Per-row disclosure for setups / counters — collapsed by default and
          fully independent of the done toggle. */}
      {hasDetails && (
        <div className="px-2.5 pb-2 -mt-1">
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            aria-expanded={detailsOpen}
            className="ml-[28px] inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 active:text-foreground"
          >
            Setups &amp; counters
            <ChevronDown
              className={`h-3 w-3 transition-transform ${
                detailsOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden ml-[28px] mt-1.5 space-y-1.5"
              >
                {assignment.setups.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-0.5">
                      Setups
                    </p>
                    {assignment.setups.map((s, i) => (
                      <p
                        key={`setup-${i}`}
                        className="text-[11px] text-muted-foreground/90 leading-snug"
                      >
                        · {stripDashes(s)}
                      </p>
                    ))}
                  </div>
                )}
                {assignment.counters.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-0.5">
                      Counters
                    </p>
                    {assignment.counters.map((c, i) => (
                      <p
                        key={`counter-${i}`}
                        className="text-[11px] text-muted-foreground/90 leading-snug"
                      >
                        · {stripDashes(c)}
                      </p>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
