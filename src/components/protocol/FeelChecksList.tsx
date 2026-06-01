// WP-T17 — FeelChecksList
// Checkbox list of subjective feel-checks (urine colour, weigh-back kg,
// energy, headache, no cramps) used during the rehydration window
// (mockup C — H+3). Tap to tick/untick with optimistic UI; writes go
// through `weightProtocols.recordFeelCheck` / `clearFeelCheck`
// (WP-T9 — keyed by (userId, campId, metric)).
//
// Optimistic UI:
//   - localOverrides shadows server state until the mutation resolves
//   - On failure, the override is reverted (silent — no toast for v1)
//   - When fresh server state arrives that already matches the override,
//     we drop the override and defer back to server truth (otherwise we'd
//     freeze the row in the optimistic state forever)
//
// Disabled state:
//   - When `campId === null` rows render at 50% opacity, taps are inert,
//     and no mutation is fired
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";

export type FeelCheckMetric =
  | "urine_colour"
  | "weigh_back_kg"
  | "energy_1to10"
  | "headache"
  | "no_cramps";

export interface FeelCheck {
  metric: FeelCheckMetric;
  /** Display label, e.g. "Pee colour ≤ 3 on chart". */
  label: string;
  /** Target hint, e.g. "pale straw" — display-only, only shown when undone. */
  target: string;
  done: boolean;
  /** Server `checkedAt` — when present we render "(logged HH:mm)". */
  loggedAt?: number;
}

export interface FeelChecksListProps {
  /** Active fight camp id. `null` disables interactions (no active camp). */
  campId: string | null;
  checks: FeelCheck[];
  className?: string;
}

// Format a unix-ms timestamp as HH:mm in the user's local timezone.
// Tabular-nums in the parent classes keeps widths stable as the time ticks.
function formatLoggedAt(ms: number): string {
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

export function FeelChecksList({
  campId,
  checks,
  className = "",
}: FeelChecksListProps) {
  // Track per-metric optimistic overrides. `undefined` ⇒ defer to server
  // `c.done`; `true`/`false` ⇒ render this regardless of server until the
  // server catches up (handled in the useEffect below).
  const [localOverrides, setLocalOverrides] = useState<
    Partial<Record<FeelCheckMetric, boolean>>
  >({});

  // `as any` cast because the generated `api` may not yet expose these
  // mutations in older snapshots — keeps the page render-safe while
  // codegen catches up. Mutations are typed on the server side
  // (see convex/weightProtocols.ts).
  const recordCheck = useMutation(
    (api as any).weightProtocols?.recordFeelCheck,
  );
  const clearCheck = useMutation(
    (api as any).weightProtocols?.clearFeelCheck,
  );

  // When fresh server state arrives, drop any overrides that now match
  // the server — otherwise the optimistic value would be sticky forever.
  // Overrides that DON'T match stay (mutation likely still in-flight).
  useEffect(() => {
    setLocalOverrides((prev) => {
      let mutated = false;
      const next = { ...prev };
      for (const c of checks) {
        if (next[c.metric] !== undefined && next[c.metric] === c.done) {
          delete next[c.metric];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [checks]);

  const isDone = (c: FeelCheck): boolean =>
    localOverrides[c.metric] ?? c.done;

  const disabled = campId === null;

  const onToggle = (c: FeelCheck) => {
    if (disabled) return;
    // Fire haptic immediately so the tap feels responsive even before the
    // mutation resolves. Fire-and-forget — haptics module already swallows
    // platform errors.
    void triggerHapticSelection();

    const next = !isDone(c);
    // Optimistic flip
    setLocalOverrides((prev) => ({ ...prev, [c.metric]: next }));

    const fn = next ? recordCheck : clearCheck;
    if (!fn) {
      // Defensive: if codegen hasn't surfaced the mutation, revert so the
      // UI doesn't lie to the user about persistence.
      setLocalOverrides((prev) => ({ ...prev, [c.metric]: !next }));
      return;
    }

    Promise.resolve(fn({ campId, metric: c.metric })).catch(() => {
      // Silent revert on failure — error toast is intentionally deferred
      // to v2 per the task spec.
      setLocalOverrides((prev) => ({ ...prev, [c.metric]: !next }));
    });
  };

  return (
    <div
      className={`card-surface rounded-2xl border border-border/50 p-4 ${className}`}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
        FEEL CHECKS
      </p>

      {checks.length === 0 ? (
        // Empty state — pre-rehydration window, before any checks are
        // unlocked. Italicised muted copy keeps it visibly subdued.
        <p className="mt-3 text-[13px] text-muted-foreground italic">
          Feel checks unlock during the rehydration window
        </p>
      ) : (
        <div className="mt-2">
          {checks.map((c) => {
            const done = isDone(c);
            return (
              <button
                key={c.metric}
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={`${c.label}, ${done ? "logged" : "not done"}`}
                disabled={disabled}
                onClick={() => onToggle(c)}
                className={`w-full flex items-center gap-3 py-2 text-left ${
                  disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "active:opacity-80"
                }`}
              >
                {/* Checkbox square — no transition on fill so reduced-motion
                    users (and everyone else) get instant feedback. */}
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border/40 ${
                    done ? "bg-func-recovery-green" : "bg-muted/20"
                  }`}
                  aria-hidden="true"
                >
                  {done && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2 5.2L4 7.2L8 3"
                        stroke="white"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>

                {/* Label — strikethrough + muted when done */}
                <span
                  className={`flex-1 text-[13px] leading-snug ${
                    done
                      ? "line-through text-muted-foreground"
                      : "text-foreground"
                  }`}
                >
                  {c.label}
                </span>

                {/* Right column: target hint OR "(logged HH:mm)" */}
                {done ? (
                  c.loggedAt !== undefined && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      (logged {formatLoggedAt(c.loggedAt)})
                    </span>
                  )
                ) : (
                  c.target && (
                    <span className="text-[11px] text-muted-foreground italic">
                      {c.target}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
