import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Combat-sports terms worth emphasising inside setup/counter prose. Listed
// longest-first so multi-word techniques win over their single-word parts
// (e.g. "roundhouse kick" before "kick") during ordered regex alternation.
const SPARRING_KEYWORDS = [
  // Grappling (multi-word first)
  "rear naked choke", "front headlock", "side control", "back control",
  "closed guard", "half guard", "open guard", "guard pass", "wrist control",
  "collar tie", "level change", "double leg", "single leg", "back take",
  "duck under", "snap down", "arm drag", "ankle lock", "heel hook",
  "leg lock", "takedown", "guillotine", "kimura", "triangle", "armbar",
  "kneebar", "sprawl", "underhook", "overhook", "hip escape", "shrimp",
  "guard", "mount", "bridge", "frame", "grip", "shot",
  // Strikes
  "question mark kick", "straight punch", "roundhouse kick", "switch kick",
  "head kick", "body kick", "leg kick", "low kick", "push kick",
  "front kick", "roundhouse", "lead hook", "rear hook", "body hook",
  "overhand", "uppercut", "flying knee", "straight knee", "1-2",
  "combination", "combo", "teep", "hook", "cross", "jab", "kick", "knee",
  // Elbows
  "horizontal elbow", "spinning elbow", "rear elbow", "elbow",
  // Clinch / defense / movement
  "off-balance", "pummeling", "pummel", "clinch", "plum", "sweep", "dump",
  "check", "shin", "feint", "slip", "parry", "block", "counter", "pivot",
  "angle",
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEYWORD_REGEX = new RegExp(
  `\\b(${SPARRING_KEYWORDS.map(escapeRegExp).join("|")})\\b`,
  "gi",
);

/**
 * Splits a setup/counter line into plain text + bolded technique keywords so
 * the important moves stand out from the connective prose. Returns React nodes
 * ready to render; matching is case-insensitive and whole-word.
 */
function highlightKeywords(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  KEYWORD_REGEX.lastIndex = 0;
  while ((match = KEYWORD_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <strong key={match.index} className="font-semibold text-foreground/90">
        {match[0]}
      </strong>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
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
            {highlightKeywords(assignment.whenToUse)}
          </p>
        )}

        {/* Setups */}
        {assignment.setups.length > 0 && (
          <div className="space-y-1 pt-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              Setups
            </p>
            {assignment.setups.map((s, i) => (
              <div
                key={`setup-${i}`}
                className="flex gap-1.5 text-[11px] text-muted-foreground/90 leading-snug"
              >
                <span className="text-muted-foreground/50 select-none" aria-hidden>
                  ·
                </span>
                <span className="flex-1 min-w-0">{highlightKeywords(s)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Counters */}
        {assignment.counters.length > 0 && (
          <div className="space-y-1 pt-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
              Counters
            </p>
            {assignment.counters.map((c, i) => (
              <div
                key={`counter-${i}`}
                className="flex gap-1.5 text-[11px] text-muted-foreground/90 leading-snug"
              >
                <span className="text-muted-foreground/50 select-none" aria-hidden>
                  ·
                </span>
                <span className="flex-1 min-w-0">{highlightKeywords(c)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
