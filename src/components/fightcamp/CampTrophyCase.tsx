import { useQuery } from "convex/react";
import { Trophy, Share2 } from "lucide-react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { triggerHapticSelection } from "@/lib/haptics";
import { LevelRing } from "@/components/coach/LevelRing";

/** Lands required to master — mirrors the backend constant (see MasteredShelf). */
const LAND_THRESHOLD = 3;

interface CampTrophyCaseProps {
  /** The camp whose XP + mastery badges to display. */
  campId: Id<"fight_camps">;
  /** Opens the camp's Trophy Hero share dialog. Renders a primary CTA when set. */
  onShare?: () => void;
}

/**
 * CampTrophyCase — a read-only snapshot of one camp's discipline XP and the
 * technique-mastery badges earned during it. Rendered on the FightCampDetail
 * route only (never the camp LIST page) so per-camp stats load lazily.
 *
 * Self-contained: no mutations. The only interaction is the optional
 * "Share camp card" CTA, which just opens the parent's share dialog. Visual
 * structure mirrors XpSummaryCard (LevelRing + XP rows) and MasteredShelf
 * (trophy chips) so it reads as native to the dark Apple-Fitness aesthetic.
 */
export function CampTrophyCase({ campId, onShare }: CampTrophyCaseProps) {
  const xp = useQuery(
    api.user_discipline_xp.getAllForUser,
    campId ? { campId } : "skip",
  );
  const mastered = useQuery(
    api.mastery_spine.getMasteredTechniques,
    campId ? { campId } : "skip",
  );

  // Loading: render nothing until both resolve so the page layout stays stable.
  if (xp === undefined || mastered === undefined) return null;

  const hasXp = xp.length > 0;
  const hasBadges = mastered.length > 0;

  return (
    <section>
      <h2 className="px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
        Camp trophy case
      </h2>

      <div className="rounded-2xl border border-border/50 card-surface p-4 space-y-4">
        {!hasXp && !hasBadges ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Trophy className="h-6 w-6 text-muted-foreground/40" aria-hidden />
            <p className="text-[13px] text-muted-foreground">
              No XP earned this camp yet.
            </p>
          </div>
        ) : (
          <>
            {/* Per-discipline XP / level rows */}
            {hasXp && (
              <div className="space-y-3">
                {xp.map((row) => {
                  const token = disciplineToken(row.sport);
                  const label = disciplineLabel(row.sport);
                  const pct = Math.round(
                    Math.max(0, Math.min(1, row.progress)) * 100,
                  );
                  return (
                    <div key={row.sport} className="flex items-center gap-3 min-w-0">
                      <LevelRing
                        token={token}
                        level={row.level}
                        progress={row.progress}
                        size={36}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className="text-[12px] font-bold uppercase tracking-[0.14em] truncate leading-tight"
                            style={{ color: `hsl(var(${token}))` }}
                          >
                            {label}
                          </p>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Lv {row.level}
                          </span>
                        </div>
                        {/* Thin progress bar toward next level. */}
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full surface-inset">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: `hsl(var(${token}))`,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground leading-tight">
                          {row.currentLevelXp}
                          <span className="text-muted-foreground/40"> / </span>
                          {row.nextLevelXp} XP
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mastery badge shelf */}
            {hasBadges && (
              <div className={hasXp ? "border-t border-border/40 pt-3" : ""}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Mastered &middot; {mastered.length}
                </p>
                <div className="flex flex-wrap gap-2">
                  {mastered.map((row) => {
                    const token = disciplineToken(row.discipline);
                    const label = disciplineLabel(row.discipline);
                    const lands = row.landedCount ?? LAND_THRESHOLD;
                    return (
                      <div
                        key={row._id}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1"
                        style={{
                          background: `hsl(var(${token}) / 0.12)`,
                          borderColor: `hsl(var(${token}) / 0.25)`,
                        }}
                        aria-label={`${row.technique}, mastered, ${label}, ${lands} lands`}
                      >
                        <Trophy
                          className="h-3 w-3 shrink-0"
                          style={{ color: `hsl(var(${token}))` }}
                          aria-hidden
                        />
                        <span className="text-[11px] font-semibold text-foreground">
                          {row.technique}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          &middot; {lands} lands
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Primary share CTA: the prompted entry point for the Trophy Hero
            camp share card (the header icon is easy to miss). */}
        {onShare && (
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              onShare();
            }}
            className="w-full h-11 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Share2 className="h-4 w-4" />
            Share camp card
          </button>
        )}
      </div>
    </section>
  );
}
