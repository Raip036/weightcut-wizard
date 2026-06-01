import { useMemo, useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Search, Plus, Loader2, ChevronRight, Sparkles, History, Star, SlidersHorizontal, X, Check } from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { CATEGORIES, EQUIPMENT_OPTIONS } from "@/data/exerciseDatabase";
import type { Exercise, ExerciseCategory, Equipment } from "@/pages/gym/types";

interface ExercisePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercises: Exercise[];
  loading?: boolean;
  onSelect: (exercise: Exercise) => void;
  onCreateCustom: () => void;
  /** Exercise ids most-recently logged across past workouts (newest-first),
   *  from a server query. Drives the "Recent" tab so it spans all sessions. */
  recentExerciseIds?: string[];
}

type SmartTab = "all" | "recent" | "favorites";
const RECENT_KEY = "wcw_recent_exercises";
const FAV_KEY = "wcw_favorite_exercises";

function loadIdList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function saveIdList(key: string, ids: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(ids.slice(0, 50))); } catch { /* noop */ }
}

// Tile color per muscle group for the row icon — same palette as ExerciseBlock.
const MUSCLE_BG: Record<string, string> = {
  chest: "bg-func-danger-red/15 text-func-danger-red",
  back: "bg-blue-500/15 text-blue-300",
  shoulders: "bg-func-fats-purple/15 text-func-fats-purple",
  biceps: "bg-pink-500/15 text-pink-300",
  triceps: "bg-func-carbs-orange/15 text-func-carbs-orange",
  quads: "bg-func-recovery-green/15 text-func-recovery-green",
  hamstrings: "bg-func-recovery-green/15 text-func-recovery-green",
  glutes: "bg-lime-500/15 text-lime-300",
  calves: "bg-teal-500/15 text-teal-300",
  abs: "bg-func-warning-yellow/15 text-func-warning-yellow",
  forearms: "bg-func-hydration-cyan/15 text-func-hydration-cyan",
  traps: "bg-indigo-500/15 text-indigo-300",
  full_body: "bg-func-fats-purple/15 text-func-fats-purple",
  cardio: "bg-func-danger-red/15 text-func-danger-red",
};

export function ExercisePickerSheet({
  open,
  onOpenChange,
  exercises,
  loading,
  onSelect,
  onCreateCustom,
  recentExerciseIds,
}: ExercisePickerSheetProps) {
  const [search, setSearch] = useState("");
  const [smartTab, setSmartTab] = useState<SmartTab>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<ExerciseCategory | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<Equipment | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>(() => loadIdList(RECENT_KEY));
  const [favIds, setFavIds] = useState<string[]>(() => loadIdList(FAV_KEY));

  // Reset transient state when the sheet closes so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSmartTab("all");
      setCategoryFilter(null);
      setEquipmentFilter(null);
    }
  }, [open]);

  // Smart filtering — search first, then smart-tab, then explicit filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool = exercises.filter((ex) => {
      if (q && !ex.name.toLowerCase().includes(q) && !ex.muscle_group.toLowerCase().includes(q)) {
        return false;
      }
      if (categoryFilter && ex.category !== categoryFilter) return false;
      if (equipmentFilter && ex.equipment !== equipmentFilter) return false;
      return true;
    });
    if (smartTab === "recent") {
      // Prefer server history (spans all past workouts, survives reinstalls);
      // fall back to the local tap-list before the query resolves.
      const sourceIds = recentExerciseIds && recentExerciseIds.length > 0 ? recentExerciseIds : recentIds;
      const idSet = new Set(sourceIds);
      pool = pool.filter((ex) => idSet.has(ex.id));
      // preserve recent order
      pool.sort((a, b) => sourceIds.indexOf(a.id) - sourceIds.indexOf(b.id));
    } else if (smartTab === "favorites") {
      const idSet = new Set(favIds);
      pool = pool.filter((ex) => idSet.has(ex.id));
    }
    return pool;
  }, [exercises, search, smartTab, categoryFilter, equipmentFilter, recentIds, recentExerciseIds, favIds]);

  // Group by muscle for "all" tab; recent/favorites stay flat (user-ordered).
  const grouped = useMemo(() => {
    if (smartTab !== "all") {
      return new Map<string, Exercise[]>([["", filtered]]);
    }
    const map = new Map<string, Exercise[]>();
    for (const ex of filtered) {
      const key = ex.muscle_group;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ex);
    }
    return map;
  }, [filtered, smartTab]);

  const activeFilters = (categoryFilter ? 1 : 0) + (equipmentFilter ? 1 : 0);

  const toggleFavorite = (id: string) => {
    setFavIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      saveIdList(FAV_KEY, next);
      return next;
    });
  };

  const handleSelect = (exercise: Exercise) => {
    // Bump to top of recents.
    setRecentIds((prev) => {
      const next = [exercise.id, ...prev.filter((x) => x !== exercise.id)].slice(0, 50);
      saveIdList(RECENT_KEY, next);
      return next;
    });
    onSelect(exercise);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[88vh] rounded-t-3xl border-0 bg-card/95 backdrop-blur-xl p-0 flex flex-col"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <SheetHeader>
            <SheetTitle className="text-[17px] font-bold tracking-tight text-center">
              Add Exercise
            </SheetTitle>
          </SheetHeader>
        </div>

        {/* Tall search pill */}
        <div className="px-4 pb-2 shrink-0">
          <div className="group relative h-[50px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search exercises…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="h-[50px] w-full pl-12 pr-12 text-[15px] font-medium rounded-full border-border/40 bg-muted/25 dark:bg-white/[0.04] focus:bg-card focus:border-primary/40 focus:ring-4 focus:ring-primary/15 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-muted/50 hover:bg-muted/70 flex items-center justify-center text-muted-foreground hover:text-foreground transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Smart tabs + filters chip */}
        <div className="px-4 pb-3 shrink-0 flex items-center gap-2">
          <LayoutGroup id="ex-picker-smart">
            <div className="relative flex flex-1 gap-1 rounded-full bg-muted/30 p-1 border border-border/30">
              {(
                [
                  { id: "all" as const, label: "All", Icon: Sparkles },
                  { id: "recent" as const, label: "Recent", Icon: History },
                  { id: "favorites" as const, label: "Favorites", Icon: Star },
                ]
              ).map((t) => {
                const active = smartTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSmartTab(t.id)}
                    aria-pressed={active}
                    className="relative flex-1 h-8 text-[12px] font-bold transition-colors"
                  >
                    {active && (
                      <motion.span
                        layoutId="ex-picker-smart-pill"
                        className="absolute inset-0 rounded-full bg-primary"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className={`relative z-10 inline-flex items-center justify-center gap-1.5 ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                      <t.Icon className="h-3 w-3" />
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={`shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition relative ${
              activeFilters > 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 border border-border/30 text-muted-foreground"
            }`}
            aria-label="Filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary-foreground text-primary text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* Exercise list */}
        <div className="overflow-y-auto flex-1 px-4 pb-2">
          <motion.div
            variants={staggerContainer(30)}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {Array.from(grouped.entries()).map(([muscle, exs]) => (
              <motion.div key={muscle || "_all"} variants={staggerItem}>
                {muscle && (
                  <h4 className="px-1 mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {muscle.replace(/_/g, " ")}
                  </h4>
                )}
                <div className="rounded-xs border border-border/40 bg-card/50 overflow-hidden divide-y divide-border/20">
                  {exs.map((ex) => {
                    const isFav = favIds.includes(ex.id);
                    const tile = MUSCLE_BG[ex.muscle_group] || "bg-muted/40 text-muted-foreground";
                    return (
                      <div key={ex.id} className="flex items-center gap-2 pr-2">
                        <button
                          onClick={() => handleSelect(ex)}
                          className="flex-1 flex items-center gap-3 px-3 py-2.5 active:bg-muted/30 transition-colors text-left min-w-0"
                        >
                          <div className={`h-9 w-9 shrink-0 rounded-xs flex items-center justify-center text-[11px] font-black uppercase ${tile}`}>
                            {ex.name.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[14px] font-semibold truncate text-foreground">{ex.name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {ex.equipment || "bodyweight"}
                              {ex.is_custom ? " · Custom" : ""}
                            </div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFavorite(ex.id)}
                          aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                          className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground/50 active:bg-muted/40 transition"
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${isFav ? "fill-func-warning-yellow text-func-warning-yellow" : ""}`}
                            strokeWidth={2}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}

            {loading && filtered.length === 0 && (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-[13px]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="text-center py-10">
                {smartTab === "favorites" ? (
                  <>
                    <Star className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-[13px] text-muted-foreground">No favorites yet</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">Tap the star on any exercise to add it</p>
                  </>
                ) : smartTab === "recent" ? (
                  <>
                    <History className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-[13px] text-muted-foreground">No recent exercises</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">Exercises you log will appear here</p>
                  </>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No exercises found</p>
                )}
              </div>
            )}
          </motion.div>
        </div>

        {/* Create custom — anchored bottom */}
        <div
          className="px-4 border-t border-border/30 shrink-0"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
        >
          <button
            onClick={() => { onCreateCustom(); onOpenChange(false); }}
            className="w-full py-3 text-[14px] font-semibold text-primary active:bg-muted/30 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Create custom exercise
          </button>
        </div>
      </SheetContent>

      {/* Filters bottom-sheet — category + equipment in one polished surface */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[78vh] overflow-y-auto [&>button]:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
          </div>
          <div className="px-5 pt-2 pb-5 space-y-5">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-[17px] font-bold tracking-tight">Filters</SheetTitle>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2">Category</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const active = categoryFilter === c.value;
                  return (
                    <button
                      key={c.value}
                      onClick={() => setCategoryFilter(active ? null : (c.value as ExerciseCategory))}
                      className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-[0.97] ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 text-foreground border border-border/40"
                      }`}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2">Equipment</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map((e) => {
                  const active = equipmentFilter === e.value;
                  return (
                    <button
                      key={e.value}
                      onClick={() => setEquipmentFilter(active ? null : (e.value as Equipment))}
                      className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-[0.97] ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 text-foreground border border-border/40"
                      }`}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {e.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setCategoryFilter(null); setEquipmentFilter(null); }}
                disabled={activeFilters === 0}
                className="flex-1 h-11 rounded-xs bg-muted/40 border border-border/40 text-[13px] font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-11 rounded-xs bg-primary text-primary-foreground font-bold text-[13px] active:scale-[0.98] transition-transform"
              >
                Apply
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Sheet>
  );
}
