// WP-T15 — OrsRecipeCard
// Recipe-card layout for the DIY Oral Rehydration Solution (combat-
// adapted WHO ORS formula). Renders the per-litre ingredient table with
// each row's role + practical note, plus a shopping list of pantry
// ingredients and a horizontally-scrollable chip row of commercial
// equivalents (LMNT, Liquid I.V., DripDrop, Pedialyte, etc.).
//
// Pure presentational — no Convex, no business logic. The caller is
// responsible for computing the ingredient amounts (see spec §6.2) and
// for gating Pro visibility one level up.
//
// Visual conventions mirror the rest of the protocol surface and
// RecoveryDashboard's card chrome:
//   - `card-surface rounded-2xl border border-border/50 p-5`
//   - 10px uppercase tracker for section headers
//   - 14px ingredient labels, tabular-nums on amounts
//   - 11–13px muted body copy
//   - mount: fade + slide-up (16px, 320ms spring); ingredient rows
//     stagger fade-in 40ms each (capped at 5 staggered rows so very long
//     recipes still feel snappy)
//   - all motion respects `prefers-reduced-motion`
import { motion, useReducedMotion } from "motion/react";

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
  /** Commercial equivalents shown as a horizontal chip row. */
  commercialEquivalents: string[];
  className?: string;
}

// Cap on how many ingredient rows get staggered entrance animation. Past
// this index every row lands at the same beat so a long recipe doesn't
// drag the mount feel out beyond ~400ms.
const MAX_STAGGERED_ROWS = 5;

// Format the amount + unit pair. Numbers are rendered via toLocaleString
// so we get sensible separators across locales without leaking trailing
// zeros (e.g. `3.5` not `3.50`).
function formatAmount(amount: number, unit: RecipeIngredient["unit"]): string {
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "—";
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
  // Only render the summary line when the caller actually has a target —
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
      className={`card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      {/* Header row: section tracker + scaled target sub-label */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
          DIY ORS Recipe
        </p>
        {showSummary && (
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 tabular-nums text-right">
            (scaled for {targetLabel} L target)
          </p>
        )}
      </div>

      {/* Recipe table */}
      <div className="mt-4">
        <p className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          Per 1 L
        </p>

        {hasIngredients ? (
          <ul className="mt-2 space-y-2">
            {perLitre.map((ingredient, i) => (
              <IngredientRow
                key={`${ingredient.ingredient}-${i}`}
                ingredient={ingredient}
                index={i}
                prefersReduced={!!prefersReduced}
              />
            ))}
          </ul>
        ) : (
          // Fallback when the upstream recipe hasn't landed yet. Single
          // muted line keeps card height close to its populated state so
          // we avoid layout shift when data arrives.
          <p className="mt-2 text-[13px] text-muted-foreground/70 italic">
            Recipe loading…
          </p>
        )}

        {showSummary && hasIngredients && (
          <p className="mt-3 text-[13px] font-semibold text-primary/90 leading-snug">
            → make {targetLabel} L total over the first 6 hours
          </p>
        )}
      </div>

      {/* Shopping list */}
      {hasShoppingList && (
        <div className="mt-5 pt-4 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
            Shopping List
          </p>
          <ul className="mt-2 space-y-1.5">
            {diyShoppingList.map((item, i) => (
              <li
                key={`${item}-${i}`}
                className="flex items-start gap-2 text-[13px] text-foreground/90 leading-snug"
              >
                <span aria-hidden className="text-muted-foreground/60 mt-[2px]">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Commercial equivalents */}
      {hasCommercial && (
        <div className="mt-5 pt-4 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
            Or use commercial
          </p>
          <div
            className="mt-2 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide"
            role="list"
            aria-label="Commercial rehydration drink equivalents"
          >
            {commercialEquivalents.map((label, i) => (
              <span
                key={`${label}-${i}`}
                role="listitem"
                className="shrink-0 inline-flex items-center rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
}

// ── Internal: IngredientRow ────────────────────────────────────────────

interface IngredientRowProps {
  ingredient: RecipeIngredient;
  index: number;
  prefersReduced: boolean;
}

function IngredientRow({ ingredient, index, prefersReduced }: IngredientRowProps) {
  // Stagger rows 40ms apart up to MAX_STAGGERED_ROWS so the table reads
  // as building beneath the "Per 1 L" header. Rows beyond the cap land
  // at the cap's delay so we don't drag the mount feel out.
  const staggerIndex = Math.min(index, MAX_STAGGERED_ROWS);
  const delay = prefersReduced ? 0 : 0.12 + staggerIndex * 0.04;

  const hasNote = ingredient.note.trim().length > 0;

  return (
    <motion.li
      initial={prefersReduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.24, ease: "easeOut" }}
      className="grid grid-cols-[1fr_80px_1fr] items-baseline gap-3"
    >
      {/* Left column — ingredient name */}
      <span className="text-[14px] text-foreground leading-snug">
        {ingredient.ingredient}
      </span>

      {/* Middle column — amount + unit (right-aligned, tabular) with
          optional practical note stacked beneath. */}
      <span className="text-right">
        <span className="block text-[14px] tabular-nums text-foreground">
          {formatAmount(ingredient.amount, ingredient.unit)}
        </span>
        {hasNote && (
          <span className="block text-[11px] text-muted-foreground/70 tabular-nums">
            {ingredient.note}
          </span>
        )}
      </span>

      {/* Right column — physiological role (muted, slightly smaller) */}
      <span className="text-[12px] text-muted-foreground leading-snug">
        {ingredient.role}
      </span>
    </motion.li>
  );
}
