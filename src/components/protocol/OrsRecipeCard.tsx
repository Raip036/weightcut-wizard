// WP-T15: OrsRecipeCard
// Clean recipe-card layout for the DIY Oral Rehydration Solution (combat-
// adapted WHO ORS formula). Renders the per-litre ingredients as tidy
// chip-left rows, an optional "make N L total" subtitle, a soft-chip
// shopping list, and bordered-chip commercial equivalents.
//
// Pure presentational: no Convex, no business logic. The caller computes
// the ingredient amounts (see spec §6.2) and gates Pro visibility one
// level up. The big "litres hero" is rendered separately by the page
// ABOVE this card, so it is intentionally absent here.
//
// Visual language mirrors the approved Rehydrate-chapter mockup in
// CutLab.tsx: blue eyebrow, `card-surface border-primary/20` wrapper,
// chip-left ingredient rows, and rounded chips.
import { motion, useReducedMotion } from "motion/react";

// Blue accent for the ORS / rehydrate surface. Kept as a raw HSL triplet
// so it can be fed to the local `hsl()` helper for both solid colours and
// translucent tints.
const BLUE = "217 91% 58%";
const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

export interface RecipeIngredient {
  /** Display name, e.g. "Water", "Glucose (sugar / dextrose)". */
  ingredient: string;
  /** Numeric amount; rendered with tabular-nums alongside `unit`. */
  amount: number;
  /** Unit suffix. Kept narrow to avoid display drift between rows. */
  unit: "g" | "mg" | "ml";
  /** Physiological role, e.g. "energy + Na cotransport". */
  role: string;
  /** Practical note for the athlete, e.g. "≈¼ tsp". May be empty. */
  note: string;
}

export interface OrsRecipeCardProps {
  /** Per-1L recipe rows. Empty array renders a "loading…" placeholder. */
  perLitre: RecipeIngredient[];
  /** Total litres the athlete should drink (e.g. 4.5 for a 3kg cut). */
  totalLitresTarget: number;
  /** Pantry shopping list. Empty array omits the section entirely. */
  diyShoppingList: string[];
  /** Commercial equivalents shown as bordered chips. */
  commercialEquivalents: string[];
  className?: string;
}

// Format the numeric part of an amount without its unit. Numbers are rendered
// via toLocaleString so we get sensible separators across locales without
// leaking trailing zeros (e.g. `3.5` not `3.50`).
function formatNumber(amount: number): string {
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "-";
}

export function OrsRecipeCard({
  perLitre,
  totalLitresTarget,
  diyShoppingList,
  commercialEquivalents,
  className = "",
}: OrsRecipeCardProps) {
  const prefersReduced = useReducedMotion();

  const hasIngredients = perLitre.length > 0;
  const hasShoppingList = diyShoppingList.length > 0;
  const hasCommercial = commercialEquivalents.length > 0;
  const hasBottomSection = hasShoppingList || hasCommercial;
  // Only render the subtitle when the caller actually has a target:
  // a zero/negative value usually means the upstream cut plan hasn't
  // computed yet, in which case the line would be misleading.
  const showSummary = totalLitresTarget > 0;
  const targetLabel = showSummary ? totalLitresTarget.toFixed(1) : "";

  return (
    <motion.section
      role="region"
      aria-label="DIY oral rehydration solution recipe"
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={`rounded-2xl card-surface border border-primary/20 p-5 ${className}`}
    >
      {/* Eyebrow */}
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.16em]${showSummary ? "" : " mb-3.5"}`}
        style={{ color: hsl(BLUE) }}
      >
        DIY ORS · per litre
      </p>

      {/* Subtitle: total-litres target folded directly under the eyebrow */}
      {showSummary && (
        <p className="text-[11px] text-muted-foreground/70 mt-1 mb-3.5">
          Mix this ratio, then make{" "}
          <b className="text-foreground/80 tabular-nums">{targetLabel} L</b>{" "}
          total over the first 6 hours.
        </p>
      )}

      {/* Per-litre ingredients: chip-left rows */}
      {hasIngredients ? (
        <div className="space-y-1">
          {perLitre.map((row, i) => {
            // Prefer the practical note as the sub line; fall back to the
            // physiological role so the row still carries useful context.
            const sub = row.note.trim() || row.role.trim();
            return (
              <div key={`${row.ingredient}-${i}`} className="flex items-center gap-3">
                {/* Fixed-width qty chip */}
                <div className="w-[3.25rem] shrink-0 rounded-lg surface-inset py-1.5 text-center leading-none">
                  <span className="text-[15px] font-bold tabular-nums text-foreground">
                    {formatNumber(row.amount)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/55 ml-0.5">
                    {row.unit}
                  </span>
                </div>
                {/* Ingredient name + sub line */}
                <div className="min-w-0 py-1">
                  <p className="text-[13px] font-medium text-foreground leading-tight">
                    {row.ingredient}
                  </p>
                  {sub && (
                    <p className="text-[10.5px] text-muted-foreground/55 leading-tight mt-0.5">
                      {sub}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Fallback when the upstream recipe hasn't landed yet. Single
        // muted line keeps card height close to its populated state so
        // we avoid layout shift when data arrives.
        <p className="text-[13px] text-muted-foreground/70 italic">
          Recipe loading…
        </p>
      )}

      {/* Shopping list + commercial equivalents, separated by a hairline */}
      {hasBottomSection && (
        <div className="mt-4 pt-3.5 border-t border-border/40">
          {hasShoppingList && (
            <div className="mt-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
                Shopping list
              </p>
              <div className="flex flex-wrap gap-1.5">
                {diyShoppingList.map((item, i) => (
                  <span
                    key={`${item}-${i}`}
                    className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}
          {hasCommercial && (
            <div className="mt-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/55 mb-1.5">
                Or use commercial
              </p>
              <div className="flex flex-wrap gap-1.5">
                {commercialEquivalents.map((label, i) => (
                  <span
                    key={`${label}-${i}`}
                    className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-foreground/80"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
