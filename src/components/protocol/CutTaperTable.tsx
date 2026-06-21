// CutTaperTable
// Single scannable taper TABLE for the cut phase. Replaces the repetitive
// per-day "fight plan" cards with one compact grid: each row is a day from
// D-5 down to D-0, columns Day / Carb / Water / Na / Target.
//
// Pure presentational: no Convex, no business logic. The caller computes
// the per-day projections (carbs / water / sodium / target weight) and
// flags the current day via `isToday`.
//
// Visual conventions mirror the rest of the protocol surface (see
// FightPlanDayCard / OrsRecipeCard / ProtocolHeader):
//   - `card-surface rounded-2xl border border-border/50` wrapper
//   - 10px uppercase tracker for the section label
//   - 10px uppercase muted column headers
//   - 14px body cells, `tabular-nums` on every numeric column
//   - Day column left-aligned; Carb / Water / Na / Target right-aligned
//   - today's row highlighted with `bg-primary/10` + foreground/primary text
import { cn } from "@/lib/utils";

export interface CutTaperDay {
  /** 5..0, rendered as the "D-{n}" label (0 → "D-0"). */
  daysToWeighIn: number;
  /** Daily carb target in grams. Rendered as an integer. */
  carbsGrams: number;
  /** Daily water target in litres. Rendered to 1 decimal. */
  waterLitres: number;
  /** Daily sodium target in milligrams. DISPLAYED in grams (mg / 1000, 1dp). */
  sodiumMg: number;
  /** Projected morning weight in kg for that day. Rendered to 1 decimal. */
  targetWeightKg: number;
  /** Highlights this row as the current day. */
  isToday?: boolean;
}

export interface CutTaperTableProps {
  days: CutTaperDay[];
  /** Final weigh-in target weight (kg), surfaced in the section label. */
  targetWeightKg: number;
  className?: string;
}

// ── Formatting helpers ────────────────────────────────────────────────

/** "D-5" / "D-0" header label. `daysToWeighIn` is non-negative. */
function dayLabel(daysToWeighIn: number): string {
  return `D-${Math.max(0, Math.round(daysToWeighIn))}`;
}

/** Carbs → integer grams, e.g. 250 → "250". */
function formatCarbs(grams: number): string {
  return `${Math.round(grams)}`;
}

/** Water → 1 decimal litre, e.g. 7 → "7.0". */
function formatWater(litres: number): string {
  return litres.toFixed(1);
}

/**
 * Sodium → grams to 1 decimal. The prop arrives in MILLIGRAMS to match the
 * rest of the protocol data model; we divide by 1000 for a compact column
 * value (e.g. 2500 mg → "2.5", 800 mg → "0.8").
 */
function formatSodium(mg: number): string {
  return (mg / 1000).toFixed(1);
}

/** Target weight → 1 decimal kg, e.g. 72.8 → "72.8". */
function formatTarget(kg: number): string {
  return kg.toFixed(1);
}

// ── Component ─────────────────────────────────────────────────────────

export function CutTaperTable({
  days,
  targetWeightKg,
  className,
}: CutTaperTableProps) {
  // Shared column geometry: Day left, the four numeric columns right.
  // Equal-width numeric columns keep the digits aligned down each column.
  const gridCols = "grid grid-cols-[1fr_repeat(4,minmax(0,1fr))] items-center";

  return (
    <section
      aria-label="Cut taper schedule"
      className={cn(
        "card-surface rounded-2xl border border-border/50 p-4",
        className,
      )}
    >
      {/* Section label */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
        The cut · taper to {targetWeightKg.toFixed(1)} kg
      </p>

      <div className="mt-3">
        {/* Header row */}
        <div
          className={cn(
            gridCols,
            "gap-2 px-2 pb-2 border-b border-border/40",
          )}
        >
          <span className="text-left text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Day
          </span>
          <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Carb
          </span>
          <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Water
          </span>
          <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Na
          </span>
          <span className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Target
          </span>
        </div>

        {/* Data rows */}
        <div className="mt-1 space-y-0.5">
          {days.map((day, i) => {
            const isToday = !!day.isToday;
            return (
              <div
                key={`${day.daysToWeighIn}-${i}`}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  gridCols,
                  "gap-2 px-2 py-2 rounded-xl",
                  isToday && "bg-primary/10",
                )}
              >
                {/* Day: left-aligned, the only non-tabular label column */}
                <span
                  className={cn(
                    "text-left text-[14px] font-semibold tabular-nums leading-none",
                    isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {dayLabel(day.daysToWeighIn)}
                </span>

                {/* Carb */}
                <span
                  className={cn(
                    "text-right text-[14px] tabular-nums leading-none",
                    isToday ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatCarbs(day.carbsGrams)}
                </span>

                {/* Water */}
                <span
                  className={cn(
                    "text-right text-[14px] tabular-nums leading-none",
                    isToday ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatWater(day.waterLitres)}
                </span>

                {/* Na (sodium, displayed in grams) */}
                <span
                  className={cn(
                    "text-right text-[14px] tabular-nums leading-none",
                    isToday ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatSodium(day.sodiumMg)}
                </span>

                {/* Target weight */}
                <span
                  className={cn(
                    "text-right text-[14px] font-semibold tabular-nums leading-none",
                    isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {formatTarget(day.targetWeightKg)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
