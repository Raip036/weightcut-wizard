import { motion, useReducedMotion } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import wizardMascot from "@/assets/thoughtful_wizard.png";
import type { LeaderboardEntry, MedalTier } from "./types";

/**
 * A single slot on the 3D-feeling podium. Renders an avatar with an animated
 * rotating tier-coloured ring, a wizard mascot peeking from behind the #1
 * champion, a medal emoji, the display name, the score, and a coloured
 * pedestal sized according to tier.
 *
 * Reduced-motion gates every animation (ring spin, mascot bob, viewer pulse,
 * mount reveal) to a static render.
 */

type TierStyle = {
  ringStrong: string;
  ringSoft: string;
  pedestalGradient: string;
  badgeText: string;
  badgeBg: string;
  medalEmoji: string;
  pedestalHeight: number;
  avatarSize: number;
  pedestalWidth: number;
};

// Tier-color rings use the existing `--medal-*` HSL tokens defined in
// `src/index.css`. The bronze pedestal uses a warm amber-orange custom mix
// to read distinct from gold under low light.
const TIER_STYLE: Record<MedalTier, TierStyle> = {
  gold: {
    ringStrong: "hsl(var(--medal-gold))",
    ringSoft: "hsl(var(--medal-gold) / 0.35)",
    pedestalGradient:
      "linear-gradient(to bottom, hsl(var(--medal-gold) / 0.32), hsl(var(--medal-gold) / 0.08))",
    badgeText: "text-[hsl(var(--medal-gold))]",
    badgeBg: "bg-[hsl(var(--medal-gold)/0.18)]",
    medalEmoji: "🥇",
    pedestalHeight: 90,
    avatarSize: 56,
    pedestalWidth: 88,
  },
  silver: {
    ringStrong: "hsl(var(--medal-silver))",
    ringSoft: "hsl(var(--medal-silver) / 0.35)",
    pedestalGradient:
      "linear-gradient(to bottom, hsl(var(--medal-silver) / 0.3), hsl(var(--medal-silver) / 0.08))",
    badgeText: "text-[hsl(var(--medal-silver))]",
    badgeBg: "bg-[hsl(var(--medal-silver)/0.18)]",
    medalEmoji: "🥈",
    pedestalHeight: 60,
    avatarSize: 50,
    pedestalWidth: 80,
  },
  bronze: {
    ringStrong: "hsl(var(--medal-bronze))",
    ringSoft: "hsl(var(--medal-bronze) / 0.35)",
    pedestalGradient:
      "linear-gradient(to bottom, hsl(25 70% 55% / 0.32), hsl(25 70% 55% / 0.08))",
    badgeText: "text-[hsl(var(--medal-bronze))]",
    badgeBg: "bg-[hsl(var(--medal-bronze)/0.18)]",
    medalEmoji: "🥉",
    pedestalHeight: 45,
    avatarSize: 50,
    pedestalWidth: 76,
  },
};

const TIER_RANK: Record<MedalTier, number> = { gold: 1, silver: 2, bronze: 3 };

export function PodiumPlace({
  entry,
  tier,
  isViewer = false,
}: {
  entry: LeaderboardEntry;
  tier: MedalTier;
  isViewer?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const style = TIER_STYLE[tier];
  const rank = TIER_RANK[tier];
  const isChampion = tier === "gold";

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={
        prefersReducedMotion
          ? { opacity: 1, y: 0 }
          : isViewer
            ? { opacity: 1, y: 0, scale: [1, 1.005, 1] }
            : { opacity: 1, y: 0 }
      }
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : isViewer
            ? {
                opacity: { duration: 0.32 },
                y: { duration: 0.32 },
                scale: {
                  duration: 3.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                },
              }
            : { duration: 0.32 }
      }
      className="flex flex-col items-center"
      aria-label={`${rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"} place: ${entry.name}`}
    >
      {/* Mascot column — only the #1 slot reserves vertical room for the
          wizard so the silver/bronze slots align cleanly at the avatar. */}
      <div
        className="relative flex flex-col items-center"
        style={{ width: style.pedestalWidth }}
      >
        {/* Wizard mascot peeks BEHIND the champion's avatar */}
        {isChampion && (
          <motion.img
            src={wizardMascot}
            alt=""
            aria-hidden
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-3 z-0"
            style={{ width: 48, height: 48, objectFit: "contain" }}
            animate={
              prefersReducedMotion ? undefined : { y: [0, -4, 0] }
            }
            transition={
              prefersReducedMotion
                ? undefined
                : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            }
          />
        )}

        {/* Avatar with animated medal rings */}
        <div
          className="relative z-10"
          style={{ width: style.avatarSize + 12, height: style.avatarSize + 12 }}
        >
          {/* Outer rotating ring (gradient feel via dual-tone border) */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from 0deg, ${style.ringStrong}, ${style.ringSoft}, ${style.ringStrong})`,
              padding: 2,
              WebkitMask:
                "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
            animate={prefersReducedMotion ? undefined : { rotate: 360 }}
            transition={
              prefersReducedMotion
                ? undefined
                : { duration: 12, repeat: Infinity, ease: "linear" }
            }
            aria-hidden
          />
          {/* Static inner accent ring */}
          <div
            className="absolute rounded-full"
            style={{
              inset: 4,
              boxShadow: `0 0 0 1.5px ${style.ringStrong}`,
            }}
            aria-hidden
          />
          {/* Avatar centred inside the rings */}
          <div
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <Avatar
              style={{ width: style.avatarSize, height: style.avatarSize }}
            >
              <AvatarImage
                src={entry.avatarUrl ?? undefined}
                alt={entry.name}
              />
              <AvatarFallback>{entry.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Medal emoji under the avatar */}
        <div
          className={`mt-1 inline-flex items-center justify-center rounded-full ${style.badgeBg} px-1.5 leading-none`}
          style={{ height: 18 }}
          aria-hidden
        >
          <span style={{ fontSize: 13 }}>{style.medalEmoji}</span>
        </div>

        {/* Name + score */}
        <div className="mt-1 flex w-full flex-col items-center">
          {isViewer && (
            <span className="mb-1 inline-flex h-4 items-center rounded-full bg-primary/15 px-1.5 text-[9px] font-bold uppercase tracking-wider text-primary">
              You
            </span>
          )}
          <div
            className="w-full truncate text-center text-[13px] font-semibold"
            title={entry.name}
          >
            {entry.name}
          </div>
          <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
            {entry.totalMinutes} min
          </div>
        </div>

        {/* Pedestal */}
        <div
          className={`relative mt-2 w-full overflow-hidden rounded-t-xl ${
            isViewer ? "ring-1 ring-primary/40" : ""
          }`}
          style={{
            height: style.pedestalHeight,
            background: style.pedestalGradient,
          }}
          aria-hidden
        >
          {/* Embossed rank number near the bottom */}
          <div
            className={`absolute inset-x-0 bottom-1 text-center text-[18px] font-black tabular-nums ${style.badgeText} opacity-80`}
          >
            #{rank}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
