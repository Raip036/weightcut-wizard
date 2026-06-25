import { useState } from "react";
import { useQuery } from "convex/react";
import { useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { isNativePlatform } from "@/hooks/useIsNative";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";

/**
 * MasteredShelf — a horizontal embla strip of trophy chips, one per mastered
 * sparring assignment for the current user.
 *
 * Design matches the `.shelf` / `.trophy` section in docs/mockups/mastery-spine.html:
 * - Uniform square chips with a per-discipline gradient background and border.
 * - Trophy icon (amber) + technique name + discipline/lands subtitle.
 * - iOS-safe: no backdrop-filter or box-shadow on the chip itself.
 * - Reduced-motion safe: embla scroll is pointer-driven, no auto-play.
 * - Renders nothing when the user has no mastered techniques.
 *
 * @param visibleDisciplines When `null`/`undefined`, every mastered technique
 *   is shown (default). When an array, only techniques whose discipline maps
 *   (case-insensitively, via `disciplineToken`) to one of the provided values
 *   are rendered — used to gate per-discipline reveals after a cutscene. If the
 *   filtered list is empty, the whole section hides (returns null).
 */
interface MasteredShelfProps {
  visibleDisciplines?: string[] | null;
  /**
   * Disciplines to HIDE (denylist) — used to gate trophies for a discipline
   * that is still mid-cycle (drills/sparring not all done) or whose
   * completion cutscene is still playing. Matched case-insensitively via
   * `disciplineToken`. Trophies reveal once the discipline leaves this list.
   */
  hiddenDisciplines?: string[] | null;
}

export function MasteredShelf({
  visibleDisciplines,
  hiddenDisciplines,
}: MasteredShelfProps = {}) {
  const reducedMotion = useReducedMotion();
  const mastered = useQuery(api.mastery_spine.getMasteredTechniques);

  // Collapsible: the user can hide the trophies. Preference persists across
  // sessions. Hook runs before any early return so order stays stable.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable (private mode) — keep in-memory only */
      }
      return next;
    });
  };

  // Loading or empty: render nothing.
  if (!mastered || mastered.length === 0) return null;

  // Optional per-discipline visibility gate. Match case-insensitively by
  // normalising both sides through disciplineToken so e.g. "Boxing" / "box"
  // resolve to the same canonical token.
  const allowed =
    visibleDisciplines == null
      ? null
      : new Set(visibleDisciplines.map(disciplineToken));
  const denied =
    hiddenDisciplines == null
      ? null
      : new Set(hiddenDisciplines.map(disciplineToken));

  const visible = mastered.filter((row) => {
    const tok = disciplineToken(row.discipline);
    if (allowed && !allowed.has(tok)) return false;
    if (denied && denied.has(tok)) return false;
    return true;
  });

  // Nothing visible after filtering: hide the section entirely.
  if (visible.length === 0) return null;

  return (
    <div className="mt-3">
      {/* Section header — tappable to hide/show the trophies. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show mastered techniques" : "Hide mastered techniques"}
        className="mb-2 flex w-full items-center justify-between px-1 transition active:opacity-70"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Mastered this camp · {visible.length}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            collapsed ? "-rotate-90" : ""
          }`}
          aria-hidden
        />
      </button>

      {!collapsed && (
        <Carousel
          opts={{ dragFree: true, align: "start" }}
          aria-label="Mastered techniques"
        >
          <CarouselContent className="-ml-2">
            {visible.map((row) => {
              const token = disciplineToken(row.discipline);
              const label = disciplineLabel(row.discipline);
              const lands = row.landedCount ?? LAND_THRESHOLD;

              return (
                <CarouselItem
                  key={row._id}
                  className="pl-2 basis-auto shrink-0"
                >
                  <TrophyChip
                    technique={row.technique}
                    token={token}
                    disciplineLabel={label}
                    lands={lands}
                    reducedMotion={reducedMotion}
                  />
                </CarouselItem>
              );
            })}
          </CarouselContent>
        </Carousel>
      )}
    </div>
  );
}

/** localStorage key persisting the user's hide/show preference for the shelf. */
const COLLAPSE_KEY = "wcw_mastered_shelf_collapsed";

// ── Internal chip ──────────────────────────────────────────────────────────────

/** Number of lands required to master — mirrors backend constant. */
const LAND_THRESHOLD = 3;

interface TrophyChipProps {
  technique: string;
  token: string;
  disciplineLabel: string;
  lands: number;
  reducedMotion: boolean | null;
}

/**
 * Single mastery trophy chip.
 *
 * Uses inline `style` for the per-discipline gradient + border so that the
 * accent colour is dynamic. No box-shadow on native (isNativePlatform guard).
 */
function TrophyChip({
  technique,
  token,
  disciplineLabel,
  lands,
  reducedMotion: _reducedMotion,
}: TrophyChipProps) {
  const accentRgb = `hsl(var(${token}))`;

  return (
    <div
      className="flex h-[144px] w-[144px] flex-col items-center justify-between rounded-[14px] border p-3 text-center select-none"
      style={{
        background: `linear-gradient(180deg, hsl(var(${token}) / 0.12) 0%, hsl(var(--card)) 100%)`,
        borderColor: `hsl(var(${token}) / 0.25)`,
        // No box-shadow on native (performance guard).
        ...(!isNativePlatform && {
          boxShadow: `0 0 0 0 transparent`,
        }),
      }}
      aria-label={`${technique}, mastered, ${disciplineLabel}, ${lands} lands`}
    >
      {/* Trophy icon — discipline-coloured */}
      <div
        className="flex h-[24px] w-[24px] shrink-0 items-center justify-center"
        style={{ color: accentRgb }}
        aria-hidden
      >
        <Icon name="trophyOutline" size={22} />
      </div>

      {/* Technique name — wraps, never truncates; sized to fit the square.
          flex-1 centres the name in the remaining space; overflow-visible
          guarantees no clipping/ellipsis even for the longest realistic names. */}
      <p
        className="flex flex-1 items-center justify-center overflow-visible px-0.5 text-[10px] font-semibold leading-[1.18] text-foreground break-words [text-wrap:balance]"
        title={technique}
      >
        {technique}
      </p>

      {/* Discipline + lands */}
      <p className="shrink-0 text-[8.5px] text-muted-foreground leading-snug">
        {disciplineLabel} &middot; {lands} lands
      </p>
    </div>
  );
}
