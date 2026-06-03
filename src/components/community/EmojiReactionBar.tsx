/**
 * Emoji reaction bar — 5 curated reactions sit below the top polaroid in
 * the swipe deck. Tapping an emoji fires a transient burst animation
 * (the emoji scales up, drifts upward, and fades) instead of mutating
 * an inline count or highlight chip. The reaction still posts to the
 * server (auto-likes the post + records the reaction); the count is
 * surfaced elsewhere (likeCount on the post, activity feed entry).
 *
 * Wire format note: Convex rejects emoji characters as object/record
 * keys, so the server stores ASCII SLUGS (`heart` / `fire` / `muscle` /
 * `praise` / `clap`) on the wire. This component owns the single source
 * of truth for the slug → emoji mapping (`REACTION_KEYS` below) — the
 * emoji is purely a presentation concern. `onReact` is called with the
 * SLUG, never the emoji character.
 *
 * Lives OUTSIDE the draggable area so taps don't fight the swipe
 * gesture.
 */
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

const REACTION_KEYS = {
  heart: "❤️",
  fire: "🔥",
  muscle: "💪",
  praise: "🙌",
  clap: "👏",
} as const;
type ReactionKey = keyof typeof REACTION_KEYS;
const KEYS_IN_ORDER: ReactionKey[] = ["heart", "fire", "muscle", "praise", "clap"];

interface EmojiReactionBarProps {
  /** Server-cached slug → count map. Currently unused in the UI but kept
   *  on the prop interface so a future "tap to see counts" affordance
   *  can surface them without re-plumbing. */
  reactionCounts: Record<string, number>;
  /** Slugs the calling viewer has personally placed on this post. Drives
   *  the persistent "you reacted" ring on each emoji button. */
  viewerReactions: string[];
  /** Called with the ASCII SLUG (never the emoji character). */
  onReact: (key: string) => void;
}

type Burst = { id: number; emoji: string; x: number };

export function EmojiReactionBar({
  reactionCounts: _reactionCounts,
  viewerReactions,
  onReact,
}: EmojiReactionBarProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  function fireBurst(emoji: string, anchor: HTMLElement) {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const buttonRect = anchor.getBoundingClientRect();
    const x = containerRect
      ? buttonRect.left + buttonRect.width / 2 - containerRect.left
      : buttonRect.width / 2;
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, emoji, x }]);
    // Auto-clean after the animation completes (matches the 900ms anim).
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 950);
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-around gap-1 px-2 py-2.5 rounded-2xl card-surface"
    >
      {/* Transient burst overlay — each tap spawns an emoji that scales
          up, drifts upward, and fades out. Overlay is pointer-events-none
          so it never blocks subsequent taps. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible">
        <AnimatePresence>
          {bursts.map((b) => (
            <motion.span
              key={b.id}
              initial={{ opacity: 0, y: 0, scale: 0.6 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [-4, -32, -78, -110],
                scale: [0.6, 1.4, 1.2, 1.0],
                rotate: [0, -8, 8, -4],
              }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], times: [0, 0.2, 0.7, 1] }}
              className="absolute select-none"
              style={{
                left: b.x,
                top: 0,
                transform: "translate(-50%, 0)",
                fontSize: 36,
                lineHeight: 1,
                filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))",
              }}
            >
              {b.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {KEYS_IN_ORDER.map((key) => {
        const emoji = REACTION_KEYS[key];
        const active = viewerReactions.includes(key);
        return (
          <motion.button
            key={key}
            type="button"
            whileTap={{ scale: 0.82 }}
            onClick={(e) => {
              triggerHaptic(ImpactStyle.Medium);
              fireBurst(emoji, e.currentTarget);
              onReact(key);
            }}
            className="relative flex items-center justify-center w-10 h-10 rounded-full transition-colors [-webkit-tap-highlight-color:transparent]"
            aria-label={`React with ${emoji}`}
            aria-pressed={active}
          >
            <motion.span
              className="text-[22px] leading-none"
              animate={active ? { scale: [1, 1.18, 1] } : { scale: 1 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              {emoji}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
