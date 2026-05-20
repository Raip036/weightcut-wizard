import { Edit2, Trash2, Star, Flame, Zap, Wheat, Droplet, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, memo } from "react";
import { coerceMealName } from "@/lib/mealName";
import { motion, AnimatePresence, useMotionValue, useReducedMotion } from "motion/react";
import { springs } from "@/lib/motion";
import { MacroDonut } from "./MacroDonut";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

interface Ingredient {
  name: string;
  grams: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
  quantity?: string;
}

interface MealCardProps {
  meal: {
    id?: string;
    meal_name: string;
    calories: number;
    protein_g?: number;
    carbs_g?: number;
    fats_g?: number;
    meal_type?: string;
    portion_size?: string;
    recipe_notes?: string;
    is_ai_generated?: boolean;
    ingredients?: Ingredient[];
    created_at?: string;
    photo_url?: string | null;
  };
  onEdit?: () => void;
  onDelete?: () => void;
  onFavorite?: () => void;
  isFavorited?: boolean;
}

function formatMealTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")}${ampm}`;
}

const DELETE_THRESHOLD = -80;
const LONG_PRESS_MS = 550;

export const MealCard = memo(function MealCard({ meal, onEdit, onDelete, onFavorite, isFavorited }: MealCardProps) {
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("wcw_swipe_hint_shown"));

  useEffect(() => {
    if (showHint) {
      const timer = setTimeout(() => {
        setShowHint(false);
        localStorage.setItem("wcw_swipe_hint_shown", "true");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showHint]);

  const [expanded, setExpanded] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const dragX = useMotionValue(0);
  const crossedRef = useRef(false);

  const p = meal.protein_g || 0;
  const c = meal.carbs_g || 0;
  const f = meal.fats_g || 0;

  const [isDragging, setIsDragging] = useState(false);
  const canSwipe = !!onDelete && !prefersReducedMotion;

  // Macro split (largest-remainder rounding to sum 100%)
  const proteinCal = p * 4;
  const carbsCal = c * 4;
  const fatsCal = f * 9;
  const macroTotal = proteinCal + carbsCal + fatsCal || 1;
  const raw = [proteinCal, carbsCal, fatsCal].map((v) => (v / macroTotal) * 100);
  const floors = raw.map((v) => Math.floor(v));
  let rem = 100 - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  const pcts = [...floors];
  for (let k = 0; k < order.length && rem > 0; k++, rem--) pcts[order[k].i] += 1;
  const [pPct, cPct, fPct] = pcts;

  const mealTypeLabel = meal.meal_type
    ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1).toLowerCase()
    : null;
  const timeLabel = formatMealTime(meal.created_at);

  // Long-press → favorite. Track press timer + cancel if pointer moves
  // far (intent was a swipe-to-delete or scroll, not a hold).
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressMovedRef = useRef(false);
  const pressedRef = useRef(false);
  const startPress = () => {
    if (!onFavorite) return;
    pressedRef.current = true;
    pressMovedRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      if (pressedRef.current && !pressMovedRef.current) {
        triggerHaptic(ImpactStyle.Medium);
        onFavorite();
      }
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    pressedRef.current = false;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  const markPressMoved = () => {
    pressMovedRef.current = true;
    cancelPress();
  };

  const handleTap = () => {
    triggerHaptic(ImpactStyle.Light);
    setExpanded((v) => !v);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl">
      {/* Delete background — visible during swipe */}
      {canSwipe && isDragging && (
        <div className="absolute inset-0 flex items-center justify-end bg-destructive/90 rounded-3xl px-6">
          <Trash2 className="h-5 w-5 text-destructive-foreground" />
        </div>
      )}

      {/* Foreground card — drag, long-press, tap-to-expand */}
      <motion.div
        className="relative rounded-3xl card-surface"
        style={{ x: canSwipe ? dragX : undefined }}
        drag={canSwipe ? "x" : false}
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        dragSnapToOrigin
        onDragStart={() => {
          crossedRef.current = false;
          setIsDragging(true);
          markPressMoved();
        }}
        onDrag={() => {
          if (!crossedRef.current && dragX.get() < DELETE_THRESHOLD) {
            crossedRef.current = true;
          }
          if (crossedRef.current && dragX.get() > DELETE_THRESHOLD) {
            crossedRef.current = false;
          }
        }}
        onDragEnd={() => {
          setIsDragging(false);
          if (dragX.get() < DELETE_THRESHOLD) {
            onDelete?.();
          }
        }}
        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
        transition={springs.snappy}
      >
        <div
          className="flex items-stretch gap-3.5 p-3 cursor-pointer select-none"
          onClick={handleTap}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onPointerMove={markPressMoved}
          role="button"
          aria-label={`${coerceMealName(meal.meal_name, meal.meal_type)} — tap to ${expanded ? "collapse" : "expand"}, long-press to favorite`}
        >
          {/* Photo / donut */}
          <div className="flex-shrink-0 w-[78px] h-[78px] rounded-2xl bg-muted/40 flex items-center justify-center overflow-hidden">
            {meal.photo_url ? (
              <img
                src={meal.photo_url}
                alt={coerceMealName(meal.meal_name, meal.meal_type)}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <MacroDonut protein={p} carbs={c} fat={f} calories={meal.calories} size={64} />
            )}
          </div>

          {/* Body — name/type left, time + big kcal right (right column vertically stacked) */}
          <div className="flex-1 min-w-0 flex gap-3">
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[15px] font-semibold leading-snug text-foreground line-clamp-1">
                    {coerceMealName(meal.meal_name, meal.meal_type)}
                  </span>
                  {isFavorited && (
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                  )}
                </div>
                {mealTypeLabel && (
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60 mt-0.5">
                    {mealTypeLabel}
                  </p>
                )}
              </div>

              {/* Macros inline — 3 small chips */}
              {(p > 0 || c > 0 || f > 0) && (
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex items-center gap-1">
                    <Zap className="h-3 w-3 text-blue-500" strokeWidth={2.4} fill="currentColor" />
                    <span className="text-[11px] tabular-nums font-semibold text-foreground/85">{Math.round(p)}g</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Wheat className="h-3 w-3 text-orange-500" strokeWidth={2.2} />
                    <span className="text-[11px] tabular-nums font-semibold text-foreground/85">{Math.round(c)}g</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Droplet className="h-3 w-3 text-purple-500" strokeWidth={2.4} fill="currentColor" />
                    <span className="text-[11px] tabular-nums font-semibold text-foreground/85">{Math.round(f)}g</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail — time pill above big kcal */}
            <div className="flex flex-col items-end justify-between py-0.5 flex-shrink-0">
              {timeLabel ? (
                <span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums whitespace-nowrap bg-muted/50 px-2 py-0.5 rounded-full">
                  {timeLabel}
                </span>
              ) : (
                <span aria-hidden />
              )}
              <div className="text-right leading-none mt-0.5">
                <div className="flex items-baseline justify-end gap-1">
                  <Flame className="h-3 w-3 text-orange-500" strokeWidth={2.4} />
                  <span className="text-[18px] font-bold tabular-nums text-foreground leading-none">
                    {meal.calories}
                  </span>
                </div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 mt-0.5">
                  kcal
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Inline expand — ingredients, notes, edit/delete actions.
            Replaces the modal dialog that used to open on tap. */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-border/30"
            >
              <div className="px-3 py-3 space-y-3">
                {/* Macro split bar */}
                {(p > 0 || c > 0 || f > 0) && (
                  <div>
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                      <span className="bg-blue-500" style={{ width: `${pPct}%` }} aria-hidden />
                      <span className="bg-orange-500" style={{ width: `${cPct}%` }} aria-hidden />
                      <span className="bg-purple-500" style={{ width: `${fPct}%` }} aria-hidden />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] tabular-nums">
                      <span className="text-blue-400 font-semibold">P {pPct}%</span>
                      <span className="text-orange-400 font-semibold">C {cPct}%</span>
                      <span className="text-purple-400 font-semibold">F {fPct}%</span>
                    </div>
                  </div>
                )}

                {meal.portion_size && (
                  <div className="rounded-xl bg-muted/20 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Serving</p>
                    <p className="text-[12px] text-foreground/90 leading-snug mt-0.5">{meal.portion_size}</p>
                  </div>
                )}

                {meal.ingredients && meal.ingredients.length > 0 && (
                  <div className="rounded-xl bg-muted/20 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1">
                      Ingredients
                    </p>
                    <div className="divide-y divide-border/20">
                      {meal.ingredients.map((ing, idx) => (
                        <div key={idx} className="flex items-start justify-between gap-2 py-1 text-[12px]">
                          <span className="flex-1 min-w-0 text-foreground/90">
                            {ing.quantity ? `${ing.quantity} ` : ""}{ing.name}
                          </span>
                          <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                            {ing.calories != null
                              ? <>{ing.calories} kcal</>
                              : <>{ing.grams}g</>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {meal.recipe_notes && (
                  <div className="rounded-xl bg-muted/20 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Notes</p>
                    <p className="text-[12px] text-foreground/90 leading-snug whitespace-pre-wrap mt-0.5">
                      {meal.recipe_notes}
                    </p>
                  </div>
                )}

                {/* Actions */}
                {(onEdit || onDelete || onFavorite) && (
                  <div className="flex items-center gap-1.5 pt-1">
                    {onFavorite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerHapticSelection(); onFavorite(); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-muted/40 border border-border/40 text-[12px] font-semibold active:scale-[0.97] transition"
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${isFavorited ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                          strokeWidth={2.4}
                        />
                        {isFavorited ? "Saved" : "Favorite"}
                      </button>
                    )}
                    {onEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-muted/40 border border-border/40 text-[12px] font-semibold active:scale-[0.97] transition"
                      >
                        <Edit2 className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-destructive/10 border border-destructive/30 text-[12px] font-semibold text-destructive active:scale-[0.97] transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
                  </div>
                )}

                {/* Collapse cue */}
                <div className="flex justify-center text-muted-foreground/40">
                  <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {showHint && (
        <p className="text-[10px] text-muted-foreground/50 text-center mt-1 animate-[fadeSlideUp_0.3s_ease-out_both]">
          ← Swipe to delete · long-press to favorite
        </p>
      )}
    </div>
  );
});
