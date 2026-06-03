import { Trash2, Star, Zap, Wheat, Droplet, X, ChevronDown } from "lucide-react";
import { useState, useRef, memo } from "react";
import { coerceMealName } from "@/lib/mealName";
import { motion, AnimatePresence, useMotionValue, useReducedMotion } from "motion/react";
import { springs } from "@/lib/motion";
import { MacroDonut } from "./MacroDonut";
import { triggerHapticSelection } from "@/lib/haptics";

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

const DELETE_THRESHOLD = -80;

export const MealCard = memo(function MealCard({ meal, onDelete, onFavorite, isFavorited }: MealCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const dragX = useMotionValue(0);
  const crossedRef = useRef(false);

  const p = meal.protein_g || 0;
  const c = meal.carbs_g || 0;
  const f = meal.fats_g || 0;

  const [isDragging, setIsDragging] = useState(false);
  const canSwipe = !!onDelete && !prefersReducedMotion;

  // Tap-to-expand reveals ingredients / serving / notes / macro split. Only
  // expandable when there's actually detail to show.
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(
    (meal.ingredients && meal.ingredients.length > 0) ||
    meal.portion_size ||
    meal.recipe_notes ||
    p > 0 || c > 0 || f > 0
  );

  const mealTypeLabel = meal.meal_type
    ? meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1).toLowerCase()
    : null;

  return (
    <div className="relative overflow-hidden rounded-xs">
      {/* Delete background — visible during swipe */}
      {canSwipe && isDragging && (
        <div className="absolute inset-0 flex items-center justify-end bg-destructive/90 rounded-xs px-6">
          <Trash2 className="h-5 w-5 text-destructive-foreground" />
        </div>
      )}

      {/* Foreground card — swipe-to-delete */}
      <motion.div
        className="relative rounded-xs card-surface"
        style={{ x: canSwipe ? dragX : undefined }}
        drag={canSwipe ? "x" : false}
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        dragSnapToOrigin
        onDragStart={() => {
          crossedRef.current = false;
          setIsDragging(true);
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
        transition={springs.snappy}
      >
        <div
          className="flex items-stretch gap-3.5 p-3 select-none"
          onClick={() => { if (hasDetails) setExpanded((v) => !v); }}
          role={hasDetails ? "button" : undefined}
          tabIndex={hasDetails ? 0 : undefined}
          aria-expanded={hasDetails ? expanded : undefined}
        >
          {/* Photo / donut */}
          <div className="flex-shrink-0 w-[78px] h-[78px] rounded-xs bg-muted/40 flex items-center justify-center overflow-hidden">
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

          {/* Body — name/type left, action buttons + big kcal right (right column vertically stacked) */}
          <div className="flex-1 min-w-0 flex gap-3">
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div className="min-w-0">
                <div className="min-w-0">
                  <span className="text-[15px] font-semibold leading-snug text-foreground">
                    {coerceMealName(meal.meal_name, meal.meal_type)}
                  </span>
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
                    <Wheat className="h-3 w-3 text-func-carbs-orange" strokeWidth={2.2} />
                    <span className="text-[11px] tabular-nums font-semibold text-foreground/85">{Math.round(c)}g</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Droplet className="h-3 w-3 text-func-fats-purple" strokeWidth={2.4} fill="currentColor" />
                    <span className="text-[11px] tabular-nums font-semibold text-foreground/85">{Math.round(f)}g</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail — star/delete actions above big kcal */}
            <div className="flex flex-col items-end justify-between py-0.5 flex-shrink-0">
              {/* Action cluster — right-aligned; `-mr-1.5` offsets the icon
                  buttons' internal padding so the X lines up flush with the
                  calorie column below. `-mt-1` keeps it level with the name. */}
              <div className="flex items-center gap-1 -mt-1 -mr-1.5">
                {onFavorite && (
                  <button
                    onClick={(e) => { e.stopPropagation(); triggerHapticSelection(); onFavorite?.(); }}
                    aria-label={isFavorited ? "Remove favorite" : "Favorite"}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-full active:scale-90 transition"
                  >
                    <Star
                      className={`h-4 w-4 ${isFavorited ? "fill-func-warning-yellow text-func-warning-yellow" : "text-muted-foreground/60"}`}
                    />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); triggerHapticSelection(); onDelete?.(); }}
                    aria-label="Delete meal"
                    className="h-7 w-7 inline-flex items-center justify-center rounded-full active:scale-90 transition"
                  >
                    <X className="h-4 w-4 text-muted-foreground/60" />
                  </button>
                )}
              </div>
              {/* Calorie readout + expand chevron — every element shares the
                  same right edge so the column reads as cleanly aligned. */}
              <div className="flex flex-col items-end leading-none">
                <span className="text-[18px] font-bold tabular-nums text-foreground leading-none">
                  {meal.calories}
                </span>
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 mt-0.5">
                  kcal
                </p>
                {hasDetails && (
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground/40 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Expandable detail — ingredients / serving / notes / macro split.
            Revealed on tap; only rendered when there's detail to show. */}
        {hasDetails && (
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 pt-2 border-t border-border/40 space-y-3">
                  {/* Macro split */}
                  {(p > 0 || c > 0 || f > 0) && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                        Macro split
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "Protein", val: p, color: "text-blue-500" },
                          { label: "Carbs", val: c, color: "text-func-carbs-orange" },
                          { label: "Fat", val: f, color: "text-func-fats-purple" },
                        ].map((m) => (
                          <div key={m.label} className="rounded-xs bg-muted/30 px-2 py-1.5 text-center">
                            <p className={`text-[13px] font-bold tabular-nums ${m.color}`}>{Math.round(m.val)}g</p>
                            <p className="text-[10px] text-muted-foreground/70">{m.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Serving */}
                  {meal.portion_size && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                        Serving
                      </p>
                      <p className="text-[12px] text-foreground/80">{meal.portion_size}</p>
                    </div>
                  )}

                  {/* Ingredients */}
                  {meal.ingredients && meal.ingredients.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                        Ingredients
                      </p>
                      <ul className="space-y-0.5">
                        {meal.ingredients.map((ing, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="text-foreground/80 min-w-0 break-words">{ing.name}</span>
                            <span className="text-muted-foreground/70 tabular-nums shrink-0">
                              {ing.quantity || `${Math.round(ing.grams)}g`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Notes */}
                  {meal.recipe_notes && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                        Notes
                      </p>
                      <p className="text-[12px] text-foreground/80 leading-snug">{meal.recipe_notes}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
});
