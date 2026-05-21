import { motion, useReducedMotion } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MedalIcon } from "./MedalIcon";
import type { LeaderboardEntry, MedalTier } from "./types";

const TIER_RING: Record<MedalTier, string> = {
  gold: "ring-2 ring-[hsl(var(--medal-gold))]",
  silver:
    "ring-2 ring-[hsl(var(--medal-silver))]",
  bronze:
    "ring-2 ring-[hsl(var(--medal-bronze))]",
};

const TIER_SIZE: Record<MedalTier, string> = {
  gold: "h-16 w-16",
  silver: "h-12 w-12",
  bronze: "h-12 w-12",
};

export function PodiumPlace({
  entry,
  tier,
}: {
  entry: LeaderboardEntry;
  tier: MedalTier;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex items-center gap-3 py-2"
    >
      <div className="relative">
        <span className="sr-only">
          {tier === "gold"
            ? "1st place"
            : tier === "silver"
              ? "2nd place"
              : "3rd place"}
        </span>
        <Avatar className={`${TIER_SIZE[tier]} ${TIER_RING[tier]}`}>
          <AvatarImage src={entry.avatarUrl ?? undefined} alt={entry.name} />
          <AvatarFallback>{entry.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="absolute -right-1 -top-1">
          <MedalIcon tier={tier} size={tier === "gold" ? 22 : 18} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{entry.name}</div>
        <Badge variant="secondary" className="mt-1 text-[10px]">
          {entry.topDiscipline}
        </Badge>
      </div>
      <div className="text-right tabular-nums">
        <div className="text-lg font-bold">{entry.totalMinutes}</div>
        <div className="text-[10px] text-muted-foreground">min</div>
      </div>
    </motion.div>
  );
}
