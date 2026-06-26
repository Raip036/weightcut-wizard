/**
 * Emoji reaction bar: 5 curated reactions sit below the top polaroid in
 * the swipe deck. Tapping an emoji fires a transient burst animation
 * (the emoji scales up, drifts upward, and fades) instead of mutating
 * an inline count or highlight chip. The reaction still posts to the
 * server (auto-likes the post + records the reaction); the count is
 * surfaced elsewhere (likeCount on the post, activity feed entry).
 *
 * Wire format note: Convex rejects emoji characters as object/record
 * keys, so the server stores ASCII SLUGS (`heart` / `fire` / `muscle` /
 * `praise` / `clap`) on the wire. The slug to emoji mapping is the
 * shared module `./reactionEmoji` (`REACTION_EMOJI`) so the bar and the
 * activity feed share one source of truth. `onReact` is called with the
 * SLUG, never the emoji character.
 *
 * Lives OUTSIDE the draggable area so taps don't fight the swipe
 * gesture.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { REACTION_EMOJI, REACTION_KEYS_IN_ORDER } from "./reactionEmoji";

const KEYS_IN_ORDER = REACTION_KEYS_IN_ORDER;

interface EmojiReactionBarProps {
  /** Server-cached slug → count map. Rendered inline on each pill (count
   *  shown only when > 0). */
  reactionCounts: Record<string, number>;
  /** Slugs the calling viewer has personally placed on this post. Drives
   *  the primary-tinted "you reacted" fill on each pill. May already
   *  include an optimistic overlay (see `useFeedEngagement`). */
  viewerReactions: string[];
  /** Called with the ASCII SLUG (never the emoji character). */
  onReact: (key: string) => void;
}

type Burst = { id: number; emoji: string; x: number };

export function EmojiReactionBar({
  reactionCounts,
  viewerReactions,
  onReact,
}: EmojiReactionBarProps) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Cache the container's bounding rect — it doesn't move while the card is
  // mounted, so reading it on every tap is wasted layout work. Refreshed on
  // mount and on resize only.
  const containerRectRef = useRef<DOMRect | null>(null);

  const refreshRect = useCallback(() => {
    containerRectRef.current =
      containerRef.current?.getBoundingClientRect() ?? null;
  }, []);

  useLayoutEffect(() => {
    refreshRect();
    window.addEventListener("resize", refreshRect);
    return () => window.removeEventListener("resize", refreshRect);
  }, [refreshRect]);

  function fireBurst(emoji: string, anchor: HTMLElement) {
    // Fall back to a fresh read if the cache hasn't populated yet.
    const containerRect = containerRectRef.current ?? (refreshRect(), containerRectRef.current);
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
      className="relative flex items-center justify-center gap-2 py-1"
    >
      {/* Transient burst overlay: each tap spawns an emoji that scales up,
          drifts upward, and fades out. Pointer-events-none so it never
          blocks subsequent taps. Uses a pure scale/opacity pop (no
          drop-shadow filter, which iOS strips on `.native-app`). */}
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
              }}
            >
              {b.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {KEYS_IN_ORDER.map((key) => {
        const emoji = REACTION_EMOJI[key];
        const active = viewerReactions.includes(key);
        const count = reactionCounts[key] ?? 0;
        return (
          <motion.button
            key={key}
            type="button"
            whileTap={{ scale: 0.88 }}
            onClick={(e) => {
              triggerHaptic(ImpactStyle.Medium);
              fireBurst(emoji, e.currentTarget);
              onReact(key);
            }}
            className={`relative inline-flex items-center justify-center gap-1 h-9 rounded-full transition-colors [-webkit-tap-highlight-color:transparent] ${
              count > 0 ? "px-3" : "px-2.5"
            } ${
              active
                ? "bg-primary/15 ring-1 ring-primary/40 text-primary"
                : "bg-card/60 ring-1 ring-border/40 text-foreground"
            }`}
            aria-label={`React with ${emoji}`}
            aria-pressed={active}
          >
            <motion.span
              className="text-[19px] leading-none"
              animate={active ? { scale: [1, 1.18, 1] } : { scale: 1 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              {emoji}
            </motion.span>
            {count > 0 && (
              <span className="text-[12px] font-semibold tabular-nums leading-none">
                {count}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
