import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useAction, useQuery } from "convex/react";
import { motion } from "motion/react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useKeyboardAware } from "@/hooks/useKeyboardAware";
import { localCache } from "@/lib/localCache";
import { logger } from "@/lib/logger";
import { triggerHapticSelection } from "@/lib/haptics";

import { api } from "../../../../../convex/_generated/api";
import type { MealTemplate } from "@/pages/nutrition/types";
import type { MealType } from "./MealTypeSelector";
import type { SaveManualMeal } from "./types";

/**
 * Manual-logging sub-panel for the "Add a meal" sheet. Search-first (USDA via
 * `api.actions.foodSearch.run`, 300ms debounce) with Recent (today's
 * `api.meals.listWithTotals`) and Favorites (local cache key "meal_favorites",
 * shared with useQuickMealActions) chip rows above an editable macro grid.
 * Save commits via `api.meals.createMealWithItems` with an idempotency key,
 * matching the pattern in useMealOperations.
 */

interface ManualLogPanelProps {
  mealTime: MealType;
  onClose: () => void;
  onBackToAi: () => void;
  /**
   * Commits the meal. Wired to `useMealOperations.saveMealToDb` (via
   * QuickAddDialog → NutritionPage) so the save runs through the shared
   * optimistic-update + cache orchestration and the new meal immediately
   * appears in the day's list. Resolves to the meal id, or null on failure
   * (the orchestrator surfaces its own error toast in that case).
   */
  onSaveMeal: SaveManualMeal;
}

interface FoodSearchResult {
  id: string;
  name: string;
  brand: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fats_per_100g: number;
  serving_size?: string;
  serving_grams?: number | null;
}

interface MacroForm {
  calories: string;
  protein_g: string;
  carbs_g: string;
  fats_g: string;
  description: string;
  source_name: string | null;
}

const EMPTY_MACROS: MacroForm = {
  calories: "",
  protein_g: "",
  carbs_g: "",
  fats_g: "",
  description: "",
  source_name: null,
};

const FAVORITES_KEY = "meal_favorites";
const RECENT_CHIP_LIMIT = 8;

const INPUT_CLASS =
  "h-11 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[15px] text-foreground placeholder:text-muted-foreground/50 px-4 focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function fmtNum(n: number | undefined | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "";
  const factor = Math.pow(10, digits);
  return (Math.round(n * factor) / factor).toString();
}

function roundedKcal(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} kcal`;
}

export function ManualLogPanel({
  mealTime,
  onClose,
  onBackToAi,
  onSaveMeal,
}: ManualLogPanelProps) {
  const { userId } = useUser();
  const { toast } = useToast();
  const { keyboardHeight } = useKeyboardAware();
  const todayStr = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const foodSearch = useAction(api.actions.foodSearch.run);

  // ── Today's meals → drives the "Recent" chip row. listWithTotals is the
  // same reactive query the rest of the nutrition surface consumes, so this
  // row stays in sync without a separate cross-day query.
  const todaysMeals = useQuery(api.meals.listWithTotals, { date: todayStr });

  // ── Favorites: stored locally under the same key as useQuickMealActions.
  // Read once on mount; this dialog doesn't need to react to writes since
  // adding favorites happens on the meal-list surface, not in here.
  const favorites = useMemo<MealTemplate[]>(() => {
    if (!userId) return [];
    return localCache.get<MealTemplate[]>(userId, FAVORITES_KEY) ?? [];
  }, [userId]);

  // ── Search state ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Macro form ──
  const [macros, setMacros] = useState<MacroForm>(EMPTY_MACROS);
  const [saving, setSaving] = useState(false);

  // Refs for keyboard-aware scroll. Each input scrolls itself to center on
  // focus once iOS finishes its keyboard animation (~220ms).
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  const handleInputFocus = useCallback(
    (ref: React.RefObject<HTMLElement>) => () => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      });
    },
    [],
  );

  // Macro field config (label + inputMode + step). Refs are colocated so the
  // 2×2 grid render is a single .map.
  const macroFields = useMemo(
    () => [
      { key: "calories" as const, label: "Calories", mode: "numeric" as const, step: undefined, ref: { current: null as HTMLInputElement | null } },
      { key: "protein_g" as const, label: "Protein (g)", mode: "decimal" as const, step: "0.1", ref: { current: null as HTMLInputElement | null } },
      { key: "carbs_g" as const, label: "Carbs (g)", mode: "decimal" as const, step: "0.1", ref: { current: null as HTMLInputElement | null } },
      { key: "fats_g" as const, label: "Fats (g)", mode: "decimal" as const, step: "0.1", ref: { current: null as HTMLInputElement | null } },
    ],
    [],
  );

  // ── Search: 300ms debounce, abortable. Empty query = clear results. ──
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const result = (await Promise.race([
          foodSearch({ query: query.trim() }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
        ])) as { results?: FoodSearchResult[] };
        if (!controller.signal.aborted) {
          setResults(result.results ?? []);
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name !== "AbortError") {
          logger.error("ManualLogPanel: food search failed", err);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, foodSearch]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Prefill from any source (search result, recent chip, favorite chip).
  // After applying we snap the Save button into view.
  const prefill = useCallback((m: MacroForm) => {
    triggerHapticSelection();
    setMacros(m);
    setQuery("");
    setResults([]);
    requestAnimationFrame(() => {
      saveButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // ── Recent (today's meals so far) — dedupe by name and cap. ──
  const recent = useMemo(() => {
    if (!todaysMeals || todaysMeals.length === 0) return [];
    const seen = new Set<string>();
    const out: typeof todaysMeals = [];
    for (let i = todaysMeals.length - 1; i >= 0; i--) {
      const m = todaysMeals[i];
      const key = (m.meal_name ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
      if (out.length >= RECENT_CHIP_LIMIT) break;
    }
    return out;
  }, [todaysMeals]);

  // ── Save ──
  const canSave =
    !saving &&
    userId !== null &&
    macros.calories.trim().length > 0 &&
    num(macros.calories) > 0;

  const handleSave = useCallback(async () => {
    if (!userId || !canSave) return;
    setSaving(true);
    try {
      const calories = num(macros.calories);
      const protein = num(macros.protein_g);
      const carbs = num(macros.carbs_g);
      const fats = num(macros.fats_g);
      const description = macros.description.trim();
      const name =
        macros.source_name?.trim() ||
        (description.length > 0 ? description.slice(0, 40) : "");

      // Route through the shared insert orchestration (saveMealToDb →
      // runInsertFlow). This is what makes the meal show up: it fires the
      // optimistic `setMeals` update and writes the day's caches. Calling the
      // Convex mutation directly from here persisted the meal but never
      // touched the page's state/cache, so the entry silently never appeared.
      const result = await onSaveMeal({
        meal_name: name,
        calories,
        protein_g: protein,
        carbs_g: carbs,
        fats_g: fats,
        meal_type: mealTime,
        portion_size: null,
        recipe_notes: description.length > 0 ? description : null,
        ingredients: null,
        is_ai_generated: false,
      });

      // `saveMealToDb` resolves to null when the insert failed — the
      // orchestrator has already surfaced a destructive toast and rolled back
      // the optimistic row, so leave the sheet open for a retry without
      // double-toasting or falsely celebrating.
      if (result == null) return;

      toast({
        title: "Meal logged",
        description: `${Math.round(calories)} kcal`,
      });
      onClose();
    } catch (err) {
      logger.error("ManualLogPanel: save failed", err);
      toast({
        title: "Couldn't save meal",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [
    userId,
    canSave,
    macros,
    mealTime,
    onSaveMeal,
    toast,
    onClose,
  ]);

  const showSearchResults = query.trim().length >= 2;
  const showFavorites = favorites.length > 0;
  const showRecent = recent.length > 0;

  return (
    <div
      className="flex flex-col"
      // Pad the bottom by keyboardHeight so the focused input can scroll into
      // view without being eaten by the on-screen keyboard. The parent sheet
      // also clips with its own max-height; this is the per-panel safety net.
      style={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0 }}
    >
      {/* ── "Use AI instead" back link ───────────────────────────────── */}
      <div className="px-5 pt-1 pb-2">
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            onBackToAi();
          }}
          className="inline-flex items-center gap-1 -ml-1 px-1 py-1 text-[13px] font-semibold text-muted-foreground active:text-foreground transition-colors"
        >
          <Icon name="chevronBackOutline" size={14} />
          Use AI instead
        </button>
      </div>

      {/* ── Search box ──────────────────────────────────────────────── */}
      <div className="px-5">
        <div className="relative">
          <Icon
            name="searchOutline"
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods or saved meals"
            className={`${INPUT_CLASS} pl-10 pr-10`}
            inputMode="search"
            autoComplete="off"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-muted/50 active:bg-muted/70 flex items-center justify-center text-muted-foreground"
            >
              <Icon name="closeOutline" size={11} />
            </button>
          )}
        </div>

        {showSearchResults && (
          <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl border border-border bg-card divide-y divide-border/50">
            {searching && (
              <div className="flex items-center justify-center py-4 text-[12px] text-muted-foreground">
                <Icon name="syncOutline" size={14} className="animate-spin mr-2" />
                Searching…
              </div>
            )}
            {!searching && results.length === 0 && (
              <p className="text-center py-4 text-[12px] text-muted-foreground/70">
                No results — try a different name
              </p>
            )}
            {!searching &&
              results.slice(0, 12).map((food) => (
                <SearchResultRow key={food.id} food={food} onPick={prefill} />
              ))}
          </div>
        )}
      </div>

      {/* ── Recent + Favorites chip rows ───────────────────────────── */}
      {!showSearchResults && (showRecent || showFavorites) && (
        <div className="pt-4 space-y-3">
          {showRecent && (
            <ChipRow label="Recent">
              {recent.map((m) => (
                <Chip
                  key={m.id}
                  name={m.meal_name}
                  kcal={m.calories}
                  onClick={() =>
                    prefill({
                      calories: fmtNum(m.calories, 0),
                      protein_g: fmtNum(m.protein_g ?? 0, 1),
                      carbs_g: fmtNum(m.carbs_g ?? 0, 1),
                      fats_g: fmtNum(m.fats_g ?? 0, 1),
                      description: m.notes ?? "",
                      source_name: m.meal_name,
                    })
                  }
                />
              ))}
            </ChipRow>
          )}
          {showFavorites && (
            <ChipRow label="Favorites">
              {favorites.slice(0, 10).map((f, i) => (
                <Chip
                  key={`${f.meal_name}-${i}`}
                  name={f.meal_name}
                  kcal={f.calories}
                  favorite
                  onClick={() =>
                    prefill({
                      calories: fmtNum(f.calories, 0),
                      protein_g: fmtNum(f.protein_g ?? 0, 1),
                      carbs_g: fmtNum(f.carbs_g ?? 0, 1),
                      fats_g: fmtNum(f.fats_g ?? 0, 1),
                      description: f.recipe_notes ?? "",
                      source_name: f.meal_name,
                    })
                  }
                />
              ))}
            </ChipRow>
          )}
        </div>
      )}

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-2 flex items-center gap-3">
        <div className="flex-1 h-px bg-border/40" />
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/60">
          Or enter macros directly
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {/* ── Macro grid 2×2 ──────────────────────────────────────────── */}
      <div className="px-5 grid grid-cols-2 gap-2.5">
        {macroFields.map((f) => (
          <div key={f.key}>
            <label
              htmlFor={`manual-log-${f.key}`}
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1 block"
            >
              {f.label}
            </label>
            <Input
              id={`manual-log-${f.key}`}
              ref={f.ref as React.RefObject<HTMLInputElement>}
              type="number"
              inputMode={f.mode}
              step={f.step}
              placeholder="0"
              value={macros[f.key]}
              onChange={(e) =>
                setMacros((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              onFocus={handleInputFocus(f.ref as React.RefObject<HTMLElement>)}
              className={INPUT_CLASS}
            />
          </div>
        ))}
      </div>

      {/* ── Description ─────────────────────────────────────────────── */}
      <div className="px-5 pt-3">
        <label
          htmlFor="manual-log-description"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1 block"
        >
          Description (optional)
        </label>
        <Textarea
          id="manual-log-description"
          ref={descriptionRef}
          value={macros.description}
          onChange={(e) =>
            setMacros((prev) => ({ ...prev, description: e.target.value }))
          }
          onFocus={handleInputFocus(descriptionRef)}
          placeholder="Chicken bowl with rice and avocado"
          rows={2}
          className="min-h-[60px] text-[14px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 px-3.5 py-2.5 placeholder:text-muted-foreground/50 resize-none"
        />
      </div>

      {/* ── Save ────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-5">
        <button
          ref={saveButtonRef}
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="w-full h-12 rounded-xs text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Icon name="syncOutline" size={16} className="animate-spin" />
              Saving…
            </span>
          ) : (
            "Save meal"
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-5 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70 mb-1.5">
        {label}
      </p>
      <div className="px-5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

function SearchResultRow({
  food,
  onPick,
}: {
  food: FoodSearchResult;
  onPick: (m: MacroForm) => void;
}) {
  const grams = food.serving_grams && food.serving_grams > 0 ? food.serving_grams : 100;
  const ratio = grams / 100;
  return (
    <button
      type="button"
      onClick={() =>
        onPick({
          calories: fmtNum(food.calories_per_100g * ratio, 0),
          protein_g: fmtNum(food.protein_per_100g * ratio, 1),
          carbs_g: fmtNum(food.carbs_per_100g * ratio, 1),
          fats_g: fmtNum(food.fats_per_100g * ratio, 1),
          description: "",
          source_name: food.brand ? `${food.name} (${food.brand})` : food.name,
        })
      }
      className="w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left active:bg-muted/40 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold tracking-tight text-foreground truncate leading-tight">{food.name}</p>
        {food.brand && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{food.brand}</p>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          <MacroDot color="bg-func-protein-blue" value={Math.round(food.protein_per_100g)} label="P" />
          <MacroDot color="bg-func-carbs-orange" value={Math.round(food.carbs_per_100g)} label="C" />
          <MacroDot color="bg-func-fats-purple" value={Math.round(food.fats_per_100g)} label="F" />
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="display-number text-[18px] font-extrabold tabular-nums leading-none tracking-tight text-foreground">
          {Math.round(food.calories_per_100g)}
        </p>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          kcal /100g
        </p>
      </div>
    </button>
  );
}

function MacroDot({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-[12px] font-bold tabular-nums text-foreground">{value}g</span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </span>
  );
}

function Chip({
  name,
  kcal,
  favorite,
  onClick,
}: {
  name: string;
  kcal: number;
  favorite?: boolean;
  onClick: () => void;
}) {
  const base =
    "shrink-0 h-9 px-3 rounded-full text-[12px] font-semibold text-foreground/90 inline-flex items-center gap-1.5 transition-colors";
  const skin = favorite
    ? "bg-func-warning-yellow/12 ring-1 ring-func-warning-yellow/25 active:bg-func-warning-yellow/20"
    : "bg-muted/40 active:bg-muted/60";
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`${base} ${skin}`}
    >
      {favorite && <Icon name="star" size={11} className="text-func-warning-yellow" />}
      <span className="max-w-[140px] truncate">{name}</span>
      <span className="text-muted-foreground/70 tabular-nums">{roundedKcal(kcal)}</span>
    </motion.button>
  );
}
