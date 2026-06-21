/**
 * RoundedFeedCard: Instagram-story-styled alternative to PolaroidCard.
 * Mirrors the EXACT prop interface so PolaroidStack can be retargeted
 * in a one-line import swap (Phase 2).
 *
 * Visual: no white polaroid frame / no bottom caption strip; the card
 * IS the image with `rounded-2xl` corners. Author overlay top-left over
 * a top gradient mask, optional caption bottom-left over the inverse.
 *
 * Behaviour mirrored from PolaroidCard: STACK_OFFSETS table, progress
 * MotionValue transform for position-1 promotion, `useReducedMotion`-
 * aware develop animation (blur 20→0, ±4° shake, metadata fade-in),
 * LQIP blur-up, top-card-only `layoutId` for shared-element transition.
 * Drag is owned by the parent (PolaroidStack.TopCard).
 */
import React, { useMemo } from "react";
import { useImageReady } from "@/hooks/useImageReady";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { formatDistanceToNowStrict } from "date-fns";
import type { FeedPost } from "@/hooks/community/useGymFeed";

// Develop timing: mirrored from PolaroidCard for ReviewSheet parity.
const DEVELOP_BLUR_DURATION_MS = 600;
const DEVELOP_SHAKE_DURATION_MS = 200;
const DEVELOP_META_DELAY_MS = 100;
const DEVELOP_META_END_MS = 700;
const DEVELOP_REDUCED_DURATION_MS = 200;
const EASE_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];

// Promotion easing: must MATCH the exit card's fly-off curve (FLY_EASE in
// PolaroidStack) so the revealed card and the departing card move on the
// same curve, eliminating the spring-vs-ease double-motion stutter.
const PROMOTE_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const PROMOTE_DURATION_MS = 280;
const PROMOTE_REDUCED_DURATION_MS = 110;

export function streakRingClass(days: number): string {
  if (days >= 60) return "ring-2 ring-yellow-300";
  if (days >= 30) return "ring-2 ring-pink-500";
  if (days >= 14) return "ring-2 ring-red-500";
  if (days >= 7) return "ring-2 ring-orange-500";
  return "ring-1 ring-white/40";
}

export function streakEmoji(days: number): string {
  if (days >= 60) return "🏆";
  if (days >= 30) return "🔥🔥";
  return "🔥";
}

interface RoundedFeedCardProps {
  post: FeedPost;
  /** 0 = top card, 1 = middle, 2 = bottom. */
  stackPosition: 0 | 1 | 2;
  /** True when this card is the top of the stack (gesture-bound). */
  isTop: boolean;
  /** Deterministic per-card rotation from the parent (post-id hash). */
  rotationDeg: number;
  /** Long-press the author overlay → enter profile. */
  onAuthorLongPress?: () => void;
  /** Suppress the on-photo caption overlay. The Community deck renders the
   *  caption itself (so it can clear the floating heart button), but other
   *  consumers (story templates) keep the baked-in caption. Default false. */
  hideCaption?: boolean;
  /** Plays the develop effect once on mount (ReviewSheet hand-off). */
  developing?: boolean;
  /** Drag-progress driver from the parent (position-1 background only). */
  progress?: MotionValue<number>;
  /** True while this card is being promoted to top during an advance,
   *  match the exit card's easing/duration so the reveal completes in
   *  lockstep, no stutter. */
  promoting?: boolean;
  /** Accepted for parity with PolaroidCard; this variant ignores it so
   *  the PolaroidStack → RoundedFeedCard import swap is zero-touch. */
  gymBrand?: {
    name: string;
    logoUrl?: string | null;
  } | null;
}

const STACK_OFFSETS: Record<0 | 1 | 2, { scale: number; y: number; opacity: number; z: number }> = {
  0: { scale: 1, y: 0, opacity: 1, z: 30 },
  // Tightened so the promotion travel (pos 1 → pos 0) is subtle, reducing
  // any residual mismatch with the exit card's curve.
  1: { scale: 0.97, y: 8, opacity: 0.85, z: 20 },
  2: { scale: 0.93, y: 16, opacity: 0.5, z: 10 },
};

function RoundedFeedCardBase({
  post,
  stackPosition,
  isTop,
  rotationDeg,
  onAuthorLongPress,
  developing = false,
  progress,
  hideCaption = false,
  promoting = false,
}: RoundedFeedCardProps) {
  // Use the SAME source for background and top cards. The stack already
  // preloads every visible card's full URL, so a background card has already
  // decoded this exact image, keeping the src stable across promotion means
  // the newly-promoted top card shows it instantly with no re-decode flash
  // (the thumb→full swap was the "little refresh flash" after a swipe).
  const effectiveSrc = post.url ?? post.thumbUrl ?? null;
  const img = useImageReady(effectiveSrc);
  const offsets = STACK_OFFSETS[stackPosition];
  const prefersReducedMotion = useReducedMotion() ?? false;
  const reducedDevelop = developing && prefersReducedMotion;
  const fullDevelop = developing && !prefersReducedMotion;

  // Static layout per stack position. For the top card we explicitly
  // animate back to {scale:1, y:0, opacity:1} so Framer doesn't leave a
  // promoted card stuck at the previous non-top opacity (0.7 / 0.4); the
  // root cause of the "transparent next card" bug after a swipe.
  const staticTransform = useMemo(
    () =>
      developing
        ? undefined
        : isTop
          ? { scale: 1, y: 0, opacity: 1, rotate: 0 }
          : { scale: offsets.scale, y: offsets.y, opacity: offsets.opacity, rotate: rotationDeg },
    [isTop, developing, offsets.scale, offsets.y, offsets.opacity, rotationDeg],
  );

  // Live progress wiring for position-1 background card. Hooks must run
  // unconditionally so a fallback MotionValue feeds the transforms when
  // no parent progress is wired; `useProgress` gates actual consumption.
  const fallbackZero = useMotionValue(0);
  const sourceProgress = progress ?? fallbackZero;
  const animatedScale = useTransform(sourceProgress, [0, 1], [offsets.scale, 1]);
  const animatedY = useTransform(sourceProgress, [0, 1], [offsets.y, 0]);
  const animatedOpacity = useTransform(sourceProgress, [0, 1], [offsets.opacity, 1]);
  const useProgress = !isTop && !developing && progress !== undefined && stackPosition === 1;

  // Develop animation on the OUTER wrapper (full / reduced variants).
  let developWrapperAnimate: TargetAndTransition | undefined;
  let developWrapperTransition: Transition | undefined;
  if (fullDevelop) {
    developWrapperAnimate = { rotate: [-4, 4, -2, 0], opacity: 1 };
    developWrapperTransition = {
      rotate: { duration: DEVELOP_SHAKE_DURATION_MS / 1000, times: [0, 0.4, 0.75, 1], ease: EASE_OUT },
      opacity: { duration: 0 },
    };
  } else if (reducedDevelop) {
    developWrapperAnimate = { opacity: 1 };
    developWrapperTransition = {
      opacity: { duration: DEVELOP_REDUCED_DURATION_MS / 1000, ease: "linear" },
    };
  }

  const streakDays = post.author.streakDays ?? 0;
  const showStreak = streakDays >= 7;
  // Author has left/been removed from this gym. The post stays in the
  // feed so the conversation remains continuous, but the avatar is
  // greyscaled + dimmed and a small "(former member)" label sits next
  // to the display name so viewers know the author is no longer here.
  const isFormerMember = post.authorState === "former_member";

  // Shared metadata fade-in (author overlay + caption). Mirrors the
  // PolaroidCard caption-strip timing for cross-variant develop parity.
  const metaFadeProps = fullDevelop
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: {
          duration: (DEVELOP_META_END_MS - DEVELOP_META_DELAY_MS) / 1000,
          delay: DEVELOP_META_DELAY_MS / 1000,
          ease: EASE_OUT,
        },
      }
    : {};

  return (
    <motion.div
      aria-label={`Post by ${post.author.displayName}`}
      className={`absolute inset-0 ${isTop || developing ? "" : "pointer-events-none"}`}
      style={
        useProgress
          ? {
              zIndex: offsets.z,
              scale: animatedScale,
              y: animatedY,
              opacity: animatedOpacity,
              rotate: rotationDeg,
              willChange: "transform, opacity",
            }
          : { zIndex: offsets.z }
      }
      initial={
        developing
          ? { opacity: reducedDevelop ? 0 : 1, rotate: fullDevelop ? -4 : 0 }
          : staticTransform
      }
      animate={developing ? developWrapperAnimate : useProgress ? undefined : staticTransform}
      transition={
        developing
          ? developWrapperTransition
          : useProgress
            ? undefined
            : promoting
              ? {
                  // Match the exit card's curve so the reveal lands in lockstep.
                  duration:
                    (prefersReducedMotion
                      ? PROMOTE_REDUCED_DURATION_MS
                      : PROMOTE_DURATION_MS) / 1000,
                  ease: prefersReducedMotion ? "linear" : PROMOTE_EASE,
                }
              : { type: "spring", stiffness: 220, damping: 28, mass: 1 }
      }
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-black select-none">
        {/* LQIP backdrop. */}
        {post.thumbDataUrl && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${post.thumbDataUrl})`,
              filter: "blur(12px)",
              transform: "scale(1.1)",
            }}
          />
        )}

        {effectiveSrc && !img.errored ? (
          <motion.img
            ref={img.ref}
            layoutId={isTop ? `post-${post.id}-image` : undefined}
            src={effectiveSrc}
            alt={post.caption ?? "Training media"}
            draggable={false}
            onLoad={img.onLoad}
            onError={img.onError}
            // Top AND the immediate-next card (stackPosition 1, promoted on
            // the very next tap) load eagerly so the lazy heuristic can't
            // defer the next photo's fetch until the moment it's promoted,
            // that deferral was a source of the on-advance flash. Only the
            // deep card (position 2) stays lazy to bound bandwidth.
            loading={isTop || stackPosition === 1 ? "eager" : "lazy"}
            decoding="async"
            width={1000}
            height={1000}
            className={`absolute inset-0 h-full w-full object-cover ${developing ? "" : "transition-opacity duration-300"}`}
            {...(fullDevelop
              ? {
                  initial: { filter: "blur(20px)", opacity: img.ready ? 1 : 0 },
                  animate: { filter: "blur(0px)", opacity: img.ready ? 1 : 0 },
                  transition: { filter: { duration: DEVELOP_BLUR_DURATION_MS / 1000, ease: EASE_OUT } },
                }
              : reducedDevelop
                ? {
                    initial: { opacity: 0, filter: "blur(0px)" },
                    animate: { opacity: img.ready ? 1 : 0, filter: "blur(0px)" },
                    transition: { opacity: { duration: DEVELOP_REDUCED_DURATION_MS / 1000, ease: "linear" } },
                  }
                : { style: { opacity: img.ready ? 1 : 0 } })}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-xs">
            Media unavailable
          </div>
        )}

        {/* Top gradient mask: gives the author overlay legibility. */}
        {isTop && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[30%] bg-gradient-to-b from-black/60 to-transparent pointer-events-none"
          />
        )}

        {/* Author overlay: top-left, top card only. */}
        {isTop && (
          <motion.button
            type="button"
            aria-label={`View ${post.author.displayName}'s profile`}
            className="absolute top-3 left-3 flex items-center gap-2 pr-2"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              onAuthorLongPress?.();
            }}
            {...metaFadeProps}
          >
            {post.author.avatarUrl ? (
              <img
                src={post.author.avatarUrl}
                alt=""
                className={`h-7 w-7 rounded-full object-cover ${streakRingClass(streakDays)} ${isFormerMember ? "opacity-60 grayscale" : ""}`}
              />
            ) : (
              <div
                className={`h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-[12px] font-bold text-white ${streakRingClass(streakDays)} ${isFormerMember ? "opacity-60 grayscale" : ""}`}
              >
                {post.author.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-[13px] font-semibold text-white drop-shadow-sm">
                {post.author.displayName}
              </span>
              {isFormerMember && (
                <span
                  className="text-[10px] font-medium text-white/70 italic"
                  title="No longer a member of this gym"
                >
                  (former member)
                </span>
              )}
              {showStreak && !isFormerMember && (
                <span
                  aria-label={`${streakDays}-day streak`}
                  title={`${streakDays}-day streak`}
                  className="text-[11px] leading-none"
                >
                  {streakEmoji(streakDays)}
                </span>
              )}
              <span className="text-[11px] font-medium text-white/70 tabular-nums">
                {formatRelativeShort(post.createdAt)}
              </span>
            </div>
          </motion.button>
        )}

        {/* Bottom caption overlay + gradient. Only when caption exists
            and the consumer hasn't opted to render it itself. */}
        {isTop && post.caption && !hideCaption && (
          <>
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/60 to-transparent pointer-events-none"
            />
            <motion.p
              className="absolute bottom-3 left-3 right-3 text-[13px] font-medium text-white leading-snug line-clamp-2 drop-shadow-sm"
              {...metaFadeProps}
            >
              {post.caption}
            </motion.p>
          </>
        )}
      </div>
    </motion.div>
  );
}

/** Custom equality: only re-render when the visible bits change. */
function areEqual(prev: RoundedFeedCardProps, next: RoundedFeedCardProps): boolean {
  return (
    prev.post.id === next.post.id &&
    prev.isTop === next.isTop &&
    prev.stackPosition === next.stackPosition &&
    prev.rotationDeg === next.rotationDeg &&
    prev.post.url === next.post.url &&
    prev.post.thumbUrl === next.post.thumbUrl &&
    prev.post.thumbDataUrl === next.post.thumbDataUrl &&
    prev.post.caption === next.post.caption &&
    prev.post.createdAt === next.post.createdAt &&
    prev.post.author.displayName === next.post.author.displayName &&
    prev.post.author.avatarUrl === next.post.author.avatarUrl &&
    (prev.post.author.streakDays ?? 0) === (next.post.author.streakDays ?? 0) &&
    (prev.post.authorState ?? "active") === (next.post.authorState ?? "active") &&
    prev.developing === next.developing &&
    prev.progress === next.progress &&
    prev.hideCaption === next.hideCaption &&
    prev.promoting === next.promoting
  );
}

export const RoundedFeedCard = React.memo(RoundedFeedCardBase, areEqual);

/* ─── helpers ─── */

/**
 * Compact relative timestamp like "4h", "2d", "3w". Falls back to "now"
 * for sub-minute deltas and an empty string on invalid dates so the
 * overlay never renders broken text.
 */
function formatRelativeShort(epochMs: number): string {
  try {
    const diffMs = Date.now() - epochMs;
    if (diffMs < 60_000) return "now";
    const raw = formatDistanceToNowStrict(new Date(epochMs), { addSuffix: false });
    // date-fns returns e.g. "4 hours" / "2 days" / "1 minute".
    // Compress to "4h" / "2d" / "1m" for the overlay.
    return raw
      .replace(/\sseconds?/, "s")
      .replace(/\sminutes?/, "m")
      .replace(/\shours?/, "h")
      .replace(/\sdays?/, "d")
      .replace(/\sweeks?/, "w")
      .replace(/\smonths?/, "mo")
      .replace(/\syears?/, "y");
  } catch {
    return "";
  }
}
