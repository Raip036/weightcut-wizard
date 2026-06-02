import { motion, useReducedMotion } from "motion/react";
import { PodiumPlace } from "./PodiumPlace";
import type { LeaderboardEntry, MedalTier } from "./types";

const TIER_ORDER: MedalTier[] = ["gold", "silver", "bronze"];

/**
 * Top-3 podium hero. Renders a 3D-feeling podium with the #1 champion on the
 * tallest centre pedestal (with a wizard mascot peeking from behind), #2 on
 * the left, and #3 on the right. A one-shot gold shimmer sweeps across the
 * whole card on mount, then settles.
 *
 * Ties are flattened: within a tier, all tied entries render side-by-side in
 * the same slot so a coach can still see everyone who actually qualified.
 */
export function PodiumHero({
  podium,
  viewerUserId,
  disciplineLabel,
}: {
  podium: LeaderboardEntry[];
  viewerUserId?: string | null;
  disciplineLabel?: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  if (podium.length === 0) return null;

  // Group entries by rank so ties share a tier
  const byRank = new Map<number, LeaderboardEntry[]>();
  for (const entry of podium) {
    const list = byRank.get(entry.rank) ?? [];
    list.push(entry);
    byRank.set(entry.rank, list);
  }
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b).slice(0, 3);

  // tier -> entries[]
  const tierEntries: Partial<Record<MedalTier, LeaderboardEntry[]>> = {};
  sortedRanks.forEach((rank, idx) => {
    const tier = TIER_ORDER[idx] ?? "bronze";
    tierEntries[tier] = byRank.get(rank)!;
  });

  return (
    <div className="glass-card relative overflow-hidden rounded-2xl border border-border/50 p-5">
      {/* Background flourish — subtle radial wash so the podium pops */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, rgba(var(--primary-rgb, 250 193 70) / 0.06), transparent 60%)",
        }}
        aria-hidden
      />

      {/* One-shot gold shimmer sweep on mount */}
      {!prefersReducedMotion && (
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, transparent 30%, rgba(255,215,100,0.18) 50%, transparent 70%)",
            backgroundSize: "200% 100%",
          }}
          initial={{ backgroundPositionX: "-100%" }}
          animate={{ backgroundPositionX: "200%" }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          aria-hidden
        />
      )}

      {/* Eyebrow */}
      <div className="relative flex items-center justify-center gap-2 text-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
          This week
        </span>
        {disciplineLabel && disciplineLabel !== "All" && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
              {disciplineLabel}
            </span>
          </>
        )}
      </div>

      {/* Podium: 2 — 1 — 3, end-aligned so the tallest pedestal lifts #1 */}
      <div className="relative mt-4 flex items-end justify-center gap-4">
        {/* Silver */}
        <div className="flex flex-col items-center">
          {tierEntries.silver?.map((entry) => (
            <PodiumPlace
              key={entry.userId}
              entry={entry}
              tier="silver"
              isViewer={
                !!viewerUserId && entry.userId === viewerUserId
              }
            />
          ))}
        </div>
        {/* Gold (champion, centred) */}
        <div className="flex flex-col items-center">
          {tierEntries.gold?.map((entry) => (
            <PodiumPlace
              key={entry.userId}
              entry={entry}
              tier="gold"
              isViewer={
                !!viewerUserId && entry.userId === viewerUserId
              }
            />
          ))}
        </div>
        {/* Bronze */}
        <div className="flex flex-col items-center">
          {tierEntries.bronze?.map((entry) => (
            <PodiumPlace
              key={entry.userId}
              entry={entry}
              tier="bronze"
              isViewer={
                !!viewerUserId && entry.userId === viewerUserId
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
