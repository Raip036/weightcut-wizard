import { Plus, Star, ChevronDown } from "lucide-react";
import type { Meal } from "@/pages/nutrition/types";

interface FavoritesSheetProps {
  favorites: Meal[];
  collapsed: boolean;
  onToggle: () => void;
  onLogFavorite: (fav: Meal) => void;
}

/**
 * Collapsible favorites list shown under the meal sections.
 * Named "Sheet" per spec — in the current UI it renders inline.
 */
export function FavoritesSheet({ favorites, collapsed, onToggle, onLogFavorite }: FavoritesSheetProps) {
  if (favorites.length === 0) return null;

  return (
    <div className="card-surface overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 active:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
          <h3 className="text-[13px] font-semibold">Favorites</h3>
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
        </div>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{favorites.length}</span>
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-0.5">
          {favorites.slice(0, 10).map((fav, i) => (
            <button
              key={`${fav.meal_name}-${i}`}
              onClick={() => onLogFavorite(fav)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-xs hover:bg-muted/30 active:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400 flex-shrink-0" />
                <span className="text-[13px] font-semibold truncate">{fav.meal_name}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[13px] tabular-nums text-muted-foreground">{fav.calories} kcal</span>
                <Plus className="h-3 w-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
