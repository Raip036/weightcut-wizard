import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { LevelRing } from "./LevelRing";
import { LevelSheet } from "./LevelSheet";

/**
 * Compact at-a-glance card surfacing the user's top 2 disciplines by total XP.
 * Sits above the active-camp banner on `/camp`. Hidden entirely while the
 * query is loading (no skeleton) so the surrounding cards never jump. If the
 * user has no XP rows yet, renders a single nudge line.
 */
export function XpSummaryCard() {
  const rows = useQuery(api.user_discipline_xp.getAllForUser);
  const [levelSheetOpen, setLevelSheetOpen] = useState(false);

  // Loading — don't render anything so the page layout stays stable.
  if (rows === undefined) return null;

  // Empty — render a single nudge line. The empty state is also tappable so
  // first-run users can still discover the LevelSheet's explainer copy.
  if (rows.length === 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLevelSheetOpen(true)}
          className="relative card-surface border border-primary/20 overflow-hidden rounded-2xl p-4 w-full text-left active:scale-[0.99] transition-transform"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
          />
          <p className="relative text-note text-muted-foreground leading-snug">
            Train and log notes to start earning XP
          </p>
        </button>
        <LevelSheet
          open={levelSheetOpen}
          onOpenChange={setLevelSheetOpen}
        />
      </>
    );
  }

  const top = rows.slice(0, 2);

  return (
    <>
      <button
        type="button"
        onClick={() => setLevelSheetOpen(true)}
        className="relative card-surface border border-primary/20 overflow-hidden rounded-2xl p-4 w-full text-left active:scale-[0.99] transition-transform"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
        />
        <p className="relative text-micro uppercase tracking-wider text-muted-foreground/70 font-bold mb-3">
          Your level
        </p>
        <div
          className={
            top.length === 1
              ? "grid grid-cols-1"
              : "grid grid-cols-2 gap-3"
          }
        >
          {top.map((row) => {
            const token = disciplineToken(row.sport);
            const label = disciplineLabel(row.sport);
            return (
              <div
                key={row.sport}
                className="flex items-center gap-3 min-w-0"
              >
                <LevelRing
                  token={token}
                  level={row.level}
                  progress={row.progress}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p
                      className="text-[12px] font-bold uppercase tracking-[0.14em] truncate leading-tight"
                      style={{ color: `hsl(var(${token}))` }}
                    >
                      {label}
                    </p>
                  </div>
                  <p className="text-[11px] tabular-nums text-muted-foreground leading-tight mt-0.5">
                    {row.currentLevelXp}
                    <span className="text-muted-foreground/40"> / </span>
                    {row.nextLevelXp} XP
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </button>
      <LevelSheet
        open={levelSheetOpen}
        onOpenChange={setLevelSheetOpen}
      />
    </>
  );
}
