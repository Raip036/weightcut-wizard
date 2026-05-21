import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Search, Loader2, Mic, ChevronRight, Minus, Plus, X, PlusCircle, Trash2 } from "lucide-react";
import { motion, LayoutGroup, AnimatePresence } from "motion/react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { logger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection } from "@/lib/haptics";

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

interface FoodSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFoodSelected: (food: {
    meal_name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fats_g: number;
    serving_size: string;
    portion_size: string;
    meal_type?: string;
  }) => void;
  mealType?: string;
}

const SERVING_PRESETS = [50, 100, 150, 200, 250];
const SWIPE_THRESHOLD = 70;
const HIDDEN_RECENTS_KEY = "wcw_hidden_recent_meals";

const MEAL_TYPE_OPTIONS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
] as const;

type MealTypeValue = (typeof MEAL_TYPE_OPTIONS)[number]["value"];

function normalizeMealType(v: string | undefined): MealTypeValue {
  const lower = (v || "").toLowerCase();
  return MEAL_TYPE_OPTIONS.some((o) => o.value === lower) ? (lower as MealTypeValue) : "snack";
}

function getHiddenRecents(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_RECENTS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function setHiddenRecents(names: Set<string>) {
  localStorage.setItem(HIDDEN_RECENTS_KEY, JSON.stringify([...names]));
}

/** Swipeable row — swipe left to reveal delete action */
function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const [offsetX, setOffsetX] = useState(0);
  const startX = useRef(0);
  const swiping = useRef(false);

  const onTouchStart = (e: ReactTouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = false;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const dx = e.touches[0].clientX - startX.current;
    if (dx < -10) swiping.current = true;
    if (swiping.current) setOffsetX(Math.min(0, dx));
  };
  const onTouchEnd = () => {
    if (offsetX < -SWIPE_THRESHOLD) onDelete();
    setOffsetX(0);
    swiping.current = false;
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 bg-destructive"
        style={{ width: Math.max(0, -offsetX) }}>
        <Trash2 className="h-4 w-4 text-destructive-foreground" />
      </div>
      <div
        style={{ transform: `translateX(${offsetX}px)`, transition: offsetX === 0 ? "transform 0.2s ease" : "none" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

// ── Animated macro ring (for the detail sheet) ─────────────────────────
function MacroRing({
  value,
  goalApprox,
  label,
  color,
}: {
  value: number;
  goalApprox: number;
  label: string;
  color: string;
}) {
  const pct = Math.min(1, value / Math.max(1, goalApprox));
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-14 w-14">
        <svg viewBox="0 0 56 56" className="absolute inset-0">
          <circle cx="28" cy="28" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="5" className="text-muted-foreground" />
          <motion.circle
            cx="28" cy="28" r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c}` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            transform="rotate(-90 28 28)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-[14px] font-bold tabular-nums" style={{ color }}>
            {Math.round(value)}
          </span>
          <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">g</span>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
    </div>
  );
}

// ── Result row (card-style) ────────────────────────────────────────────
function ResultRow({
  food,
  onSelect,
  onQuickAdd,
}: {
  food: FoodSearchResult;
  onSelect: () => void;
  onQuickAdd?: () => void;
}) {
  const kcal = Math.round(food.calories_per_100g);
  const p = Math.round(food.protein_per_100g);
  const c = Math.round(food.carbs_per_100g);
  const f = Math.round(food.fats_per_100g);
  return (
    <motion.button
      onClick={onSelect}
      whileTap={{ scale: 0.985 }}
      className="w-full text-left rounded-xs border border-border/40 bg-card/50 px-3 py-2.5 active:bg-muted/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug text-foreground line-clamp-1">
            {food.name}
          </p>
          {food.brand && (
            <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
              {food.brand}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="display-number text-[18px] font-bold tabular-nums leading-none text-primary">
            {kcal}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            kcal · /100g
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-baseline gap-0.5 rounded-full bg-blue-500/12 ring-1 ring-blue-500/25 px-2 py-0.5 text-[10px] font-bold text-blue-300">
            <span className="tabular-nums">{p}</span>
            <span className="opacity-70">P</span>
          </span>
          <span className="inline-flex items-baseline gap-0.5 rounded-full bg-func-carbs-orange/12 ring-1 ring-func-carbs-orange/25 px-2 py-0.5 text-[10px] font-bold text-func-carbs-orange">
            <span className="tabular-nums">{c}</span>
            <span className="opacity-70">C</span>
          </span>
          <span className="inline-flex items-baseline gap-0.5 rounded-full bg-func-fats-purple/12 ring-1 ring-func-fats-purple/25 px-2 py-0.5 text-[10px] font-bold text-func-fats-purple">
            <span className="tabular-nums">{f}</span>
            <span className="opacity-70">F</span>
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onQuickAdd && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onQuickAdd(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onQuickAdd(); } }}
              className="h-7 w-7 rounded-full bg-primary/15 hover:bg-primary/25 flex items-center justify-center text-primary transition-colors"
              aria-label="Quick add 100g"
              title="Quick add 100g"
            >
              <PlusCircle className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>
      </div>
    </motion.button>
  );
}

export function FoodSearchDialog({ open, onOpenChange, onFoodSelected, mealType }: FoodSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | null>(null);
  const [servingGrams, setServingGrams] = useState(100);
  const [recentMeals, setRecentMeals] = useState<(FoodSearchResult & { lastPortionGrams: number })[]>([]);
  const [chosenMealType, setChosenMealType] = useState<MealTypeValue>(() => normalizeMealType(mealType));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const foodSearchAction = useAction(api.actions.foodSearch.run);

  useEffect(() => {
    if (open) setChosenMealType(normalizeMealType(mealType));
  }, [open, mealType]);

  useEffect(() => {
    if (!open) return;
    setRecentMeals([]);
  }, [open]);

  const searchFoods = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutTimer = setTimeout(() => controller.abort(), 8000);
    setSearching(true);
    try {
      const result = (await Promise.race([
        foodSearchAction({ query: searchQuery }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      ])) as { results?: any[] };
      setResults(result.results || []);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        logger.error("Food search error", err);
        if (controller.signal.aborted) {
          toast({
            title: "Search timed out",
            description: "Try again in a moment.",
            variant: "destructive",
          });
        }
      }
    } finally {
      clearTimeout(timeoutTimer);
      setSearching(false);
    }
  }, [toast, foodSearchAction]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchFoods(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, searchFoods]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelectedFood(null);
      setServingGrams(100);
    }
  }, [open]);

  const scaledCalories = selectedFood ? Math.round(selectedFood.calories_per_100g * servingGrams / 100) : 0;
  const scaledProtein = selectedFood ? Math.round(selectedFood.protein_per_100g * servingGrams / 100 * 10) / 10 : 0;
  const scaledCarbs = selectedFood ? Math.round(selectedFood.carbs_per_100g * servingGrams / 100 * 10) / 10 : 0;
  const scaledFats = selectedFood ? Math.round(selectedFood.fats_per_100g * servingGrams / 100 * 10) / 10 : 0;

  const handleLogFood = () => {
    if (!selectedFood) return;
    triggerHapticSelection();
    const mainEl = document.querySelector("main");
    const scrollY = mainEl?.scrollTop ?? 0;
    onFoodSelected({
      meal_name: selectedFood.name + (selectedFood.brand ? ` (${selectedFood.brand})` : ""),
      calories: scaledCalories,
      protein_g: scaledProtein,
      carbs_g: scaledCarbs,
      fats_g: scaledFats,
      serving_size: `${servingGrams}g`,
      portion_size: `${servingGrams}g`,
      meal_type: chosenMealType,
    });
    onOpenChange(false);
    requestAnimationFrame(() => { if (mainEl) mainEl.scrollTop = scrollY; });
  };

  const handleQuickAddFromResult = (food: FoodSearchResult, grams = 100) => {
    triggerHapticSelection();
    const mainEl = document.querySelector("main");
    const scrollY = mainEl?.scrollTop ?? 0;
    const scale = grams / 100;
    onFoodSelected({
      meal_name: food.name + (food.brand ? ` (${food.brand})` : ""),
      calories: Math.round(food.calories_per_100g * scale),
      protein_g: Math.round(food.protein_per_100g * scale * 10) / 10,
      carbs_g: Math.round(food.carbs_per_100g * scale * 10) / 10,
      fats_g: Math.round(food.fats_per_100g * scale * 10) / 10,
      serving_size: `${grams}g`,
      portion_size: `${grams}g`,
      meal_type: chosenMealType,
    });
    onOpenChange(false);
    requestAnimationFrame(() => { if (mainEl) mainEl.scrollTop = scrollY; });
  };

  // When a food is selected, hide the search dialog so the detail sheet
  // has the screen to itself. The dialog state is preserved (query,
  // scroll, meal-type) — closing the sheet returns to the search list.
  const dialogVisible = open && !selectedFood;

  return (
    <>
      <Dialog open={dialogVisible} onOpenChange={(v) => { if (!v) onOpenChange(false); }}>
        <DialogContent className="sm:max-w-[380px] w-[94vw] max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden rounded-3xl border-0 bg-card/95 backdrop-blur-xl shadow-2xl">
          <VisuallyHidden>
            <DialogTitle>Search Food</DialogTitle>
          </VisuallyHidden>

          {/* Header — title + close */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-[17px] font-bold tracking-tight">Search Food</h2>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="h-8 w-8 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tall iOS-style search pill with focus glow */}
          <div className="px-4 pb-2.5">
            <div className="group relative h-[52px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="Search foods…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                className="h-[52px] w-full pl-12 pr-12 text-[15px] font-medium rounded-full border-border/40 bg-muted/30 dark:bg-white/[0.05] focus:bg-card focus:border-primary/40 focus:ring-4 focus:ring-primary/15 transition-all"
              />
              {query ? (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-muted/50 hover:bg-muted/70 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span
                  aria-hidden
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                  title="Voice search coming soon"
                >
                  <Mic className="h-[18px] w-[18px]" />
                </span>
              )}
            </div>
          </div>

          {/* Meal-type segmented control — compact, no truncation */}
          <div className="px-4 pb-3">
            <LayoutGroup id="food-search-meal-type">
              <div className="relative grid grid-cols-4 gap-1 rounded-full bg-muted/30 p-1 border border-border/30">
                {MEAL_TYPE_OPTIONS.map((opt) => {
                  const active = chosenMealType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { triggerHapticSelection(); setChosenMealType(opt.value); }}
                      aria-pressed={active}
                      className="relative h-8 text-[12px] font-semibold transition-colors"
                    >
                      {active && (
                        <motion.span
                          layoutId="meal-type-pill"
                          className="absolute inset-0 rounded-full bg-primary"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className={`relative z-10 ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </LayoutGroup>
          </div>

          {/* Results list — card-style rows */}
          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[60vh] px-4 pb-4">
            {searching && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="ml-2 text-[13px] text-muted-foreground">Searching…</span>
              </div>
            )}

            {!searching && query.length >= 2 && results.length === 0 && (
              <div className="text-center py-12">
                <p className="text-[14px] text-muted-foreground">No results</p>
                <p className="text-[12px] text-muted-foreground/60 mt-1">Try a different name or brand</p>
              </div>
            )}

            {!searching && query.length < 2 && recentMeals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Recent</span>
                  <button
                    onClick={() => {
                      const hidden = getHiddenRecents();
                      recentMeals.forEach((m) => hidden.add(m.name.toLowerCase()));
                      setHiddenRecents(hidden);
                      setRecentMeals([]);
                    }}
                    className="text-[11px] font-semibold text-muted-foreground/70 active:text-destructive transition-colors"
                  >
                    Clear
                  </button>
                </div>
                {recentMeals.map((food) => (
                  <SwipeToDelete
                    key={food.id}
                    onDelete={() => {
                      const hidden = getHiddenRecents();
                      hidden.add(food.name.toLowerCase());
                      setHiddenRecents(hidden);
                      setRecentMeals((prev) => prev.filter((m) => m.id !== food.id));
                    }}
                  >
                    <ResultRow
                      food={food}
                      onSelect={() => {
                        setSelectedFood(food);
                        setServingGrams(food.lastPortionGrams);
                      }}
                      onQuickAdd={() => handleQuickAddFromResult(food, food.lastPortionGrams)}
                    />
                  </SwipeToDelete>
                ))}
              </div>
            )}

            {!searching && query.length < 2 && recentMeals.length === 0 && (
              <div className="text-center py-12">
                <Search className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-[13px] text-muted-foreground">Type to search foods</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">USDA + brand database</p>
              </div>
            )}

            {!searching && results.length > 0 && (
              <motion.div
                className="space-y-2"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}
              >
                {results.map((food) => (
                  <motion.div
                    key={food.id}
                    variants={{
                      hidden: { opacity: 0, y: 6 },
                      show: { opacity: 1, y: 0 },
                    }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  >
                    <ResultRow
                      food={food}
                      onSelect={() => {
                        triggerHapticSelection();
                        setSelectedFood(food);
                        setServingGrams(food.serving_grams || 100);
                      }}
                      onQuickAdd={() => handleQuickAddFromResult(food, 100)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Premium detail bottom sheet — opens over the search results */}
      <FoodDetailSheet
        open={!!selectedFood}
        onClose={() => setSelectedFood(null)}
        food={selectedFood}
        servingGrams={servingGrams}
        setServingGrams={setServingGrams}
        scaledCalories={scaledCalories}
        scaledProtein={scaledProtein}
        scaledCarbs={scaledCarbs}
        scaledFats={scaledFats}
        onLog={handleLogFood}
      />
    </>
  );
}

// ── Premium detail bottom sheet ────────────────────────────────────────
function FoodDetailSheet({
  open,
  onClose,
  food,
  servingGrams,
  setServingGrams,
  scaledCalories,
  scaledProtein,
  scaledCarbs,
  scaledFats,
  onLog,
}: {
  open: boolean;
  onClose: () => void;
  food: FoodSearchResult | null;
  servingGrams: number;
  setServingGrams: (g: number) => void;
  scaledCalories: number;
  scaledProtein: number;
  scaledCarbs: number;
  scaledFats: number;
  onLog: () => void;
}) {
  if (!food) return null;

  // Approximate goals just for the ring fill — purely visual. We use
  // typical daily targets (150g P / 250g C / 80g F) scaled to a single
  // meal-portion so the rings look reasonable at any grams setting.
  const approxP = 50;
  const approxC = 80;
  const approxF = 30;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[88vh] overflow-y-auto [&>button]:hidden"
        style={{ paddingBottom: 0 }}
      >
        <VisuallyHidden><SheetTitle>{food.name}</SheetTitle></VisuallyHidden>

        {/* Grabber */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-2 pb-3">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="text-[18px] font-bold tracking-tight leading-tight line-clamp-2">{food.name}</h2>
            {food.brand && (
              <p className="text-[12px] text-muted-foreground mt-0.5">{food.brand}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hero — big calorie number, animates on serving change */}
        <div className="px-5 py-4 text-center border-b border-border/20">
          <motion.p
            key={scaledCalories}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="display-number text-[56px] font-black tabular-nums leading-none text-primary"
          >
            {scaledCalories}
          </motion.p>
          <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            kcal · {servingGrams}g
          </p>
        </div>

        {/* Macro rings — animated */}
        <div className="px-5 py-4 grid grid-cols-3 gap-2">
          {/* Design System v1 FUNCTIONAL palette */}
          <MacroRing value={scaledProtein} goalApprox={approxP} label="Protein" color="rgb(42 91 221)" />
          <MacroRing value={scaledCarbs} goalApprox={approxC} label="Carbs" color="rgb(240 132 57)" />
          <MacroRing value={scaledFats} goalApprox={approxF} label="Fats" color="rgb(123 49 234)" />
        </div>

        {/* Serving slider + stepper */}
        <div className="px-5 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground/80">Serving</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { triggerHapticSelection(); setServingGrams(Math.max(10, servingGrams - 10)); }}
                aria-label="Decrease 10g"
                className="h-8 w-8 rounded-full bg-muted/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition-all"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-baseline gap-0.5 min-w-[100px] justify-center">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={servingGrams}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v > 0) setServingGrams(v);
                  }}
                  className="w-[72px] text-center text-[15px] h-8 font-bold tabular-nums rounded-xs border-border/40 bg-muted/20 px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[13px] font-semibold text-muted-foreground">g</span>
              </div>
              <button
                onClick={() => { triggerHapticSelection(); setServingGrams(servingGrams + 10); }}
                aria-label="Increase 10g"
                className="h-8 w-8 rounded-full bg-muted/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition-all"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Slider */}
          <div className="relative">
            <input
              type="range"
              min={10}
              max={500}
              step={5}
              value={Math.min(500, servingGrams)}
              onChange={(e) => setServingGrams(parseInt(e.target.value))}
              className="w-full h-2 appearance-none rounded-full bg-muted/40 accent-primary cursor-pointer"
              aria-label="Serving size slider"
            />
          </div>

          {/* Preset chips */}
          <div className="flex gap-1.5 flex-wrap">
            {SERVING_PRESETS.map((g) => (
              <button
                key={g}
                onClick={() => { triggerHapticSelection(); setServingGrams(g); }}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all active:scale-[0.96] ${
                  servingGrams === g
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "bg-muted/40 text-foreground hover:bg-muted/60"
                }`}
              >
                {g}g
              </button>
            ))}
            {food.serving_grams && food.serving_grams !== 100 && (
              <button
                onClick={() => { triggerHapticSelection(); setServingGrams(food.serving_grams!); }}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all active:scale-[0.96] ${
                  servingGrams === food.serving_grams
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                    : "bg-muted/40 text-foreground hover:bg-muted/60"
                }`}
              >
                1 srv ({food.serving_size ?? `${food.serving_grams}g`})
              </button>
            )}
          </div>
        </div>

        {/* Sticky log button */}
        <div
          className="sticky bottom-0 px-5 pt-2 pb-5 bg-gradient-to-t from-card via-card to-transparent"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
        >
          <button
            onClick={onLog}
            className="w-full h-12 rounded-xs bg-primary text-primary-foreground font-bold text-[15px] active:scale-[0.98] transition-transform shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
          >
            Log Food · {scaledCalories} kcal
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
