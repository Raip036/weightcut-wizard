import type { JSX } from "react";
import { Leaf } from "lucide-react";

/* ------------------------------------------------------------------ *
 * ProtocolCutChapter: "Chapter 02 · The Cut" StoryCard.
 *
 * Mirrors EXACTLY the cut chapter from WeightProtocolStoryLab.tsx
 * (the approved "weigh-in pivot" story mockup), rebuilt as a real,
 * reusable component with a prop contract so the page can wire it.
 * The StoryCard + ChapterHead markup is replicated INLINE here so this
 * component does not depend on the dev-only lab page.
 *
 * Approach lives in Chapter 1 / The Plan now; it is NOT rendered here.
 * The taper has 4 columns: Carbs · Water · Sodium · Fiber. Same-day
 * weigh-in holds carbs and shows an amber banner; fiber gets its own
 * inset note below the taper.
 * ------------------------------------------------------------------ */

// Per-chapter accents (inline hsl so Tailwind purge never drops them).
const BLUE = "217 91% 58%"; // today accent
const AMBER = "35 92% 58%"; // same-day banner only

// B · Cool palette — desaturated, harmonized.
const C_CARB = "30 70% 62%";
const C_WATER = "200 60% 62%";
const C_SODIUM = "220 22% 64%";
const C_FIBER = "165 38% 56%";

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

const COLS = [
  { label: "Carbs", tint: C_CARB },
  { label: "Water", tint: C_WATER },
  { label: "Sodium", tint: C_SODIUM },
  { label: "Fiber", tint: C_FIBER },
];

const DEFAULT_FIBER_STRATEGY =
  "Keep fiber normal until about 4 days out, then taper over the final days to empty the gut: low-residue 2 days out, minimal the day before, none the morning of weigh-in.";

/** Map sodium milligrams to the short label used in the mockup. */
function sodiumLabel(sodiumMg: number): string {
  if (sodiumMg >= 2000) return "High";
  if (sodiumMg >= 1000) return "Med";
  if (sodiumMg > 0) return "Low";
  return "None";
}

/** Map fiber grams to the qualitative label. Fibre is now a deterministic,
 *  always-present per-day target (research-backed taper), so a missing value
 *  defaults to "Normal" rather than the old misleading "None". */
function fiberLabel(fiberGrams?: number): string {
  if (typeof fiberGrams !== "number") return "Normal";
  if (fiberGrams >= 22) return "Normal";
  if (fiberGrams >= 10) return "Low";
  if (fiberGrams > 0) return "Minimal";
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

  return (
    // StoryCard (blue accent), replicated inline from the mockup.
    <div className="relative rounded-2xl card-surface border overflow-hidden" style={{ borderColor: hsl(BLUE, 0.25) }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${hsl(BLUE, 0.06)}, transparent 60%)` }}
      />
      <div className="relative p-4">
        {/* ChapterHead: eyebrow + title. */}
        <div className="mb-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(BLUE) }}>
            Chapter 02 · The Cut
          </p>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">{title}</h2>
        </div>

        {/* same-day weigh-in banner (amber) */}
        {sameDay && (
          <div
            className="mb-3 rounded-lg px-3 py-2.5 text-[11px] font-semibold text-center"
            style={{
              background: hsl(AMBER, 0.12),
              color: hsl(AMBER),
              border: `1px solid ${hsl(AMBER, 0.22)}`,
            }}
          >
            Same-day weigh-in, no carb cut. Water, sodium &amp; fiber only.
          </div>
        )}

        {/* column header */}
        <div className="flex items-center gap-3 px-3 pb-1.5 mb-0.5">
          <div className="w-9 shrink-0" />
          <div className="flex-1 grid grid-cols-4 gap-1">
            {COLS.map((c) => (
              <div key={c.label} className="flex items-center justify-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hsl(c.tint) }} />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* taper list: 4 columns incl. fiber */}
        <div className="space-y-1.5">
          {days.map((day) => {
            const isToday = day.isToday;
            return (
              <div
                key={day.daysToWeighIn}
                className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{
                  background: isToday ? hsl(BLUE, 0.1) : "transparent",
                  border: isToday ? `1px solid ${hsl(BLUE, 0.35)}` : "1px solid transparent",
                }}
              >
                <div className="w-9 text-center shrink-0">
                  <p
                    className="text-[15px] font-bold tabular-nums leading-none"
                    style={{ color: isToday ? hsl(BLUE) : "hsl(var(--foreground))" }}
                  >
                    D-{day.daysToWeighIn}
                  </p>
                  {isToday && (
                    <p className="mt-0.5 text-[8px] uppercase tracking-wide font-bold" style={{ color: hsl(BLUE) }}>
                      Today
                    </p>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-4 gap-1">
                  <div className="flex items-center justify-center">
                    <span
                      className="text-[13px] font-semibold tabular-nums leading-none"
                      style={{ color: sameDay ? "hsl(var(--muted-foreground))" : hsl(C_CARB) }}
                    >
                      {sameDay ? "Hold" : `${day.carbsGrams}g`}
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-[13px] font-semibold tabular-nums leading-none" style={{ color: hsl(C_WATER) }}>
                      {day.waterLitres.toFixed(1)}L
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-[13px] font-semibold tabular-nums leading-none" style={{ color: hsl(C_SODIUM) }}>
                      {sodiumLabel(day.sodiumMg)}
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-[13px] font-semibold tabular-nums leading-none" style={{ color: hsl(C_FIBER) }}>
                      {fiberLabel(day.fiberGrams)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* fiber inset note */}
        <div className="mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5 surface-inset">
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5"
            style={{ background: hsl(C_FIBER, 0.16) }}
          >
            <Leaf className="h-3 w-3" style={{ color: hsl(C_FIBER) }} />
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">{fiberStrategy ?? DEFAULT_FIBER_STRATEGY}</p>
        </div>
      </div>
    </div>
  );
}
