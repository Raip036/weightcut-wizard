import type { JSX } from "react";
import { Leaf } from "lucide-react";

/* ------------------------------------------------------------------ *
 * ProtocolCutChapter — "Chapter 02 · The Cut" StoryCard.
 *
 * Mirrors EXACTLY the cut chapter from WeightProtocolStoryLab.tsx
 * (the approved "weigh-in pivot" story mockup), rebuilt as a real,
 * reusable component with a prop contract so the page can wire it.
 * The StoryCard + ChapterHead markup is replicated INLINE here so this
 * component does not depend on the dev-only lab page.
 *
 * Approach lives in Chapter 1 / The Plan now — it is NOT rendered here.
 * The taper has 4 columns: Carbs · Water · Sodium · Fiber. Same-day
 * weigh-in holds carbs and shows an amber banner; fiber gets its own
 * green callout below the taper.
 * ------------------------------------------------------------------ */

// Per-chapter accents (inline hsl so Tailwind purge never drops them).
const BLUE = "217 91% 58%"; // the cut
const AMBER = "35 92% 58%"; // carbs / energy
const CYAN = "190 90% 55%"; // hydration
const GREEN = "152 64% 47%"; // fiber
const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

const DEFAULT_FIBER_STRATEGY =
  "Cut fiber from 2 days out to empty the gut and shed gut weight. Clean carbs, sodium citrate to hold water early then taper.";

/** Map sodium milligrams to the short label used in the mockup. */
function sodiumLabel(sodiumMg: number): string {
  if (sodiumMg >= 2000) return "High";
  if (sodiumMg >= 1000) return "Med";
  if (sodiumMg > 0) return "Low";
  return "None";
}

/** Map fiber grams to the qualitative label used in the mockup. */
function fiberLabel(fiberGrams?: number): string {
  if (typeof fiberGrams !== "number") return "None";
  if (fiberGrams >= 25) return "Normal";
  if (fiberGrams >= 10) return "Low";
  if (fiberGrams > 0) return "Low";
  return "None";
}

export function ProtocolCutChapter(props: {
  targetKg: number | null;
  sameDay: boolean;
  fiberStrategy?: string;
  days: Array<{
    daysToWeighIn: number;
    carbsGrams: number;
    waterLitres: number;
    sodiumMg: number;
    fiberGrams?: number;
    isToday: boolean;
  }>;
}): JSX.Element {
  const { targetKg, sameDay, fiberStrategy, days } = props;

  const title = targetKg != null ? `The cut · taper to ${targetKg.toFixed(1)} kg` : "The cut";
  const sub = sameDay
    ? "Carbs held — water, sodium & fiber only. Today is highlighted."
    : "Carbs down, water loaded then flushed, sodium & fiber tapered. Today is highlighted.";

  return (
    // StoryCard (blue accent) — replicated inline from the mockup.
    <div className="relative rounded-2xl card-surface border overflow-hidden" style={{ borderColor: hsl(BLUE, 0.25) }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${hsl(BLUE, 0.06)}, transparent 60%)` }}
      />
      <div className="relative p-4">
        {/* ChapterHead — eyebrow + title + sub, replicated inline. */}
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(BLUE) }}>
            Chapter 02 · The Cut
          </p>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground leading-snug mt-1">{sub}</p>
        </div>

        {/* same-day weigh-in banner — amber */}
        {sameDay && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-[11px] font-medium"
            style={{ background: hsl(AMBER, 0.12), color: hsl(AMBER) }}
          >
            Same-day weigh-in — no carb cut. Water, sodium &amp; fiber only.
          </div>
        )}

        {/* taper list — 4 columns incl. fiber */}
        <div className="space-y-1.5">
          {days.map((day) => {
            const isToday = day.isToday;
            return (
              <div
                key={day.daysToWeighIn}
                className="rounded-lg px-2.5 py-2 flex items-center gap-2.5"
                style={{
                  background: isToday ? hsl(BLUE, 0.12) : "hsla(0,0%,100%,0.03)",
                  border: isToday ? `1px solid ${hsl(BLUE, 0.4)}` : "1px solid transparent",
                }}
              >
                <div className="w-8 text-center shrink-0">
                  <p
                    className="text-[14px] font-bold tabular-nums leading-none"
                    style={{ color: isToday ? hsl(BLUE) : "hsl(var(--foreground))" }}
                  >
                    D-{day.daysToWeighIn}
                  </p>
                  {isToday && (
                    <p className="text-[8px] uppercase tracking-wide font-bold" style={{ color: hsl(BLUE) }}>
                      Today
                    </p>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-4 gap-1 text-center">
                  <span className="text-[10px]">
                    <b
                      className="tabular-nums"
                      style={{ color: sameDay ? "hsl(var(--muted-foreground))" : hsl(AMBER) }}
                    >
                      {sameDay ? "Hold" : `${day.carbsGrams}g`}
                    </b>
                    <br />
                    <span className="text-[8px] text-muted-foreground/60">carbs</span>
                  </span>
                  <span className="text-[10px]">
                    <b className="tabular-nums" style={{ color: hsl(CYAN) }}>
                      {day.waterLitres.toFixed(1)}L
                    </b>
                    <br />
                    <span className="text-[8px] text-muted-foreground/60">water</span>
                  </span>
                  <span className="text-[10px]">
                    <b className="tabular-nums text-foreground/90">{sodiumLabel(day.sodiumMg)}</b>
                    <br />
                    <span className="text-[8px] text-muted-foreground/60">sodium</span>
                  </span>
                  <span className="text-[10px]">
                    <b className="tabular-nums" style={{ color: hsl(GREEN) }}>
                      {fiberLabel(day.fiberGrams)}
                    </b>
                    <br />
                    <span className="text-[8px] text-muted-foreground/60">fiber</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* fiber callout */}
        <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: hsl(GREEN, 0.1) }}>
          <Leaf className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: hsl(GREEN) }} />
          <p className="text-[11px] text-foreground/90 leading-snug">{fiberStrategy ?? DEFAULT_FIBER_STRATEGY}</p>
        </div>
      </div>
    </div>
  );
}
