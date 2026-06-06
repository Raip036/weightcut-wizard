import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

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
 * A single tappable sparring to-do. The whole row is a button — tapping it
 * flips the todo/done status via `toggleAssignment`. Done rows render the
 * technique struck-through with a filled, accent-coloured checkbox.
 *
 * Convex reactivity drives the visual update once the mutation resolves; a
 * short `pending` guard prevents double-fires on rapid taps.
 */
export function SparringAssignmentRow({
  assignment,
  token,
}: SparringAssignmentRowProps) {
  const toggleAssignment = useMutation(api.sparring_plan.toggleAssignment);
  const [pending, setPending] = useState(false);
  const done = assignment.status === "done";

  const handleToggle = async () => {
    if (pending) return;
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
    <button
      type="button"
      disabled={pending}
      onClick={handleToggle}
      aria-pressed={done}
      aria-label={
        done
          ? `Untick: ${assignment.technique}`
          : `Mark done: ${assignment.technique}`
      }
      className={cn(
        "w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xs text-left",
        "transition-colors active:scale-[0.995]",
        done
          ? "bg-muted/15 active:bg-muted/25"
          : "bg-muted/8 hover:bg-muted/20 active:bg-muted/25",
      )}
    >
      {/* Checkbox — filled with the discipline accent when done. */}
      <span
        className={cn(
          "h-4 w-4 rounded-xs border flex items-center justify-center flex-shrink-0 mt-[1px] transition-colors",
          done ? "" : "border-border",
        )}
        style={
          done
            ? {
                backgroundColor: `hsl(var(${token}))`,
                borderColor: `hsl(var(${token}))`,
              }
            : undefined
        }
        aria-hidden
      >
        {done && (
          <Icon name="checkmarkOutline" size={11} className="text-background" />
        )}
      </span>

      <div className="flex-1 min-w-0 space-y-1">
        {/* Technique name */}
        <p
          className={cn(
            "text-[13px] font-semibold leading-snug break-words",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {assignment.technique}
        </p>

        {/* When to use */}
        {assignment.whenToUse && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            {assignment.whenToUse}
          </p>
        )}

        {/* Setups */}
        {assignment.setups.length > 0 && (
          <div className="space-y-0.5 pt-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              Setups
            </p>
            {assignment.setups.map((s, i) => (
              <p
                key={`setup-${i}`}
                className="text-[11px] text-muted-foreground/90 leading-snug"
              >
                <span className="text-muted-foreground/50">· </span>
                {s}
              </p>
            ))}
          </div>
        )}

        {/* Counters */}
        {assignment.counters.length > 0 && (
          <div className="space-y-0.5 pt-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              Counters
            </p>
            {assignment.counters.map((c, i) => (
              <p
                key={`counter-${i}`}
                className="text-[11px] text-muted-foreground/90 leading-snug"
              >
                <span className="text-muted-foreground/50">· </span>
                {c}
              </p>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
