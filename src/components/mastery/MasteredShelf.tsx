import { useQuery } from "convex/react";
import { useReducedMotion } from "motion/react";
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
 * - 108px-wide chips with a per-discipline gradient background and border.
 * - Trophy icon (amber) + technique name + discipline/lands subtitle.
 * - iOS-safe: no backdrop-filter or box-shadow on the chip itself.
 * - Reduced-motion safe: embla scroll is pointer-driven, no auto-play.
 * - Renders nothing when the user has no mastered techniques.
 */
export function MasteredShelf() {
  const reducedMotion = useReducedMotion();
  const mastered = useQuery(api.mastery_spine.getMasteredTechniques);

  // Loading or empty: render nothing.
  if (!mastered || mastered.length === 0) return null;

  return (
    <div className="mt-3">
      {/* Section header */}
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground mb-2 px-1">
        Mastered this camp
      </p>

      <Carousel
        opts={{ dragFree: true, align: "start" }}
        aria-label="Mastered techniques"
      >
        <CarouselContent className="-ml-2">
          {mastered.map((row) => {
            const token = disciplineToken(row.discipline);
            const label = disciplineLabel(row.discipline);
            const lands = row.landedCount ?? LAND_THRESHOLD;

            return (
              <CarouselItem
                key={row._id}
                className="pl-2 basis-auto"
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
    </div>
  );
}

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
      className="w-[108px] rounded-[14px] border p-[13px_11px] text-center select-none"
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
      {/* Trophy icon — amber per mockup */}
      <div
        className="mx-auto mb-[7px] flex h-[26px] w-[26px] items-center justify-center"
        style={{ color: accentRgb }}
        aria-hidden
      >
        <Icon name="trophyOutline" size={22} />
      </div>

      {/* Technique name */}
      <p
        className="text-[11px] font-semibold leading-snug line-clamp-2 text-foreground"
        title={technique}
      >
        {technique}
      </p>

      {/* Discipline + lands */}
      <p className="mt-[3px] text-[9.5px] text-muted-foreground leading-snug">
        {disciplineLabel} &middot; {lands} lands
      </p>
    </div>
  );
}
