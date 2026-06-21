// WP-T15: OrsRecipeCard
// Clean recipe-card layout for the DIY Oral Rehydration Solution (combat-
// adapted WHO ORS formula). Renders the per-litre ingredients as tidy
// 2-column rows separated by hairline dividers, a "make N L total" line,
// a soft-chip shopping list, and bordered-chip commercial equivalents.
//
// Pure presentational: no Convex, no business logic. The caller computes
// the ingredient amounts (see spec §6.2) and gates Pro visibility one
// level up. The big "litres hero" is rendered separately by the page
// ABOVE this card, so it is intentionally absent here.
//
// Visual language mirrors the approved Rehydrate-chapter mockup in
// WeightProtocolStoryLab.tsx: cyan eyebrow, `card-surface rounded-2xl
// border` with a soft accent border, clean rows, and rounded chips.
import { motion, useReducedMotion } from "motion/react";

// Cyan accent for the ORS / rehydrate surface. Kept as a raw HSL triplet
// so it can be fed to the local `hsl()` helper for both solid colours and
// translucent borders/tints.
const CYAN = "190 90% 55%";
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

// Format the amount + unit pair. Numbers are rendered via toLocaleString
// so we get sensible separators across locales without leaking trailing
// zeros (e.g. `3.5` not `3.50`).
function formatAmount(amount: number, unit: RecipeIngredient["unit"]): string {
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "-";
  return `${formatted} ${unit}`;
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
  // Only render the summary line when the caller actually has a target:
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
      className={`relative rounded-2xl card-surface border overflow-hidden ${className}`}
      style={{ borderColor: hsl(CYAN, 0.25) }}
    >
      {/* Soft diagonal accent wash, matching the mockup's StoryCard. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${hsl(CYAN, 0.06)}, transparent 60%)` }}
      />

      <div className="relative p-5">
        {/* Eyebrow */}
        <p
          className="text-[10px] font-bold uppercase tracking-wide mb-2"
          style={{ color: hsl(CYAN) }}
        >
          DIY ORS · per litre
        </p>

        {/* Per-litre ingredients: clean 2-column rows, hairline dividers */}
        {hasIngredients ? (
          <div className="divide-y divide-border/40">
            {perLitre.map((row, i) => {
              // Prefer the practical note as the sub line; fall back to the
              // physiological role so the row still carries useful context.
              const sub = row.note.trim() || row.role.trim();
              return (
                <div
                  key={`${row.ingredient}-${i}`}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="text-[13px] text-foreground leading-snug">
                    {row.ingredient}
                  </span>
                  <span className="text-right shrink-0">
                    <b className="text-[14px] tabular-nums text-foreground">
                      {formatAmount(row.amount, row.unit)}
                    </b>
                    {sub && (
                      <span className="block text-[10px] text-muted-foreground/60">
                        {sub}
                      </span>
                    )}
                  </span>
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

        {/* Total-litres line (cyan, semibold) */}
        {showSummary && (
          <p className="mt-3 text-[13px] font-semibold leading-snug" style={{ color: hsl(CYAN) }}>
            Make {targetLabel} L total over the first 6 hours
          </p>
        )}

        {/* Shopping list: soft rounded chips */}
        {hasShoppingList && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60 mb-1.5">
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

        {/* Commercial equivalents: bordered chips */}
        {hasCommercial && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60 mb-1.5">
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
    </motion.section>
  );
}
