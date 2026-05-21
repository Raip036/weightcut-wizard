/**
 * A single polaroid in the stack — pure presentational shell with no
 * gesture logic of its own. The parent (`PolaroidStack`) is responsible
 * for binding drag/tap handlers to the top card; this component just
 * renders the polaroid look + the LQIP blur-up and exposes a
 * `layoutId` on the image for the shared-element transition into
 * `Profile.tsx`.
 *
 * Why React.memo with a hand-written equality check: motion's
 * `style.rotate` motion-value reference is stable across renders of
 * the same top card, but the parent stack re-renders every time the
 * deck advances (which would otherwise re-render every visible
 * polaroid). The custom comparator scopes the re-render to changes
 * that actually affect the rendered tree.
 *
 * Visual details locked in the spec:
 *   - White frame: `bg-white p-4 pb-10` (16px border on top/L/R, 44px
 *     caption strip on the bottom).
 *   - Image: square `aspect-square` inside `overflow-hidden`. Falls
 *     back to a neutral-200 swatch if `url` is null.
 *   - Author overlay (avatar + name) sits top-left of the image and
 *     is ONLY visible on the top card — peeked cards are deliberately
 *     anonymous so the eye is drawn to the active card.
 *   - LQIP `thumbDataUrl` is rendered as a background image on the
 *     `<img>`'s parent so the blur-up is instant; the full `<img>`
 *     fades in via opacity on its `onLoad` event.
 */
import React, { useMemo, useState } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { format } from "date-fns";
import type { FeedPost } from "@/hooks/community/useGymFeed";

// ── Develop animation timing (spec §4) ─────────────────────────────────
// All values are in ms (converted to seconds where motion expects sec).
// `DEVELOP_*` constants are scoped to this file because they describe a
// single, self-contained effect — no need to surface them through props.
const DEVELOP_BLUR_DURATION_MS = 600; // blur(20px) → blur(0px)
const DEVELOP_SHAKE_DURATION_MS = 200; // ±4° wiggle, settles to 0°
const DEVELOP_META_DELAY_MS = 100; // metadata fade-in starts
const DEVELOP_META_END_MS = 700; // metadata fade-in completes
const DEVELOP_REDUCED_DURATION_MS = 200; // reduced-motion cross-fade
// Material standard "ease-out" curve from the spec.
const EASE_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];

interface PolaroidCardProps {
  post: FeedPost;
  /** 0 = top card, 1 = middle, 2 = bottom. Drives z-index + offsets. */
  stackPosition: 0 | 1 | 2;
  /** True when this card is the top of the stack (gesture-bound). */
  isTop: boolean;
  /** Deterministic per-card rotation from the parent (post-id hash). */
  rotationDeg: number;
  /** Long-press the author overlay → enter profile. Wired by parent so
   *  the same handler can also intercept tap-vs-long-press in one place. */
  onAuthorLongPress?: () => void;
  /** When true, plays the "polaroid developing" effect once on mount:
   *  image blur 20px → 0px over 600ms, a brief ±4° rotational wiggle on
   *  the whole frame for the first 200ms, and a metadata fade-in that
   *  finishes flush with the blur. Honours `prefers-reduced-motion` by
   *  collapsing to a 200ms opacity cross-fade. Designed for the
   *  ReviewSheet "Log & post" tap (spec §3.5 / §4). Defaults to `false`
   *  so existing call sites (PolaroidStack) are untouched. */
  developing?: boolean;
  /** Drag-progress driver from the parent stack. 0 = at rest behind the
   *  top card; 1 = top card has fully crossed its commit threshold and
   *  this card has fully risen to the foreground. Only the IMMEDIATE
   *  next card (position 1) is expected to receive this — the deeper
   *  card (position 2) keeps its static resting transform. When
   *  `undefined`, this card falls back to the existing static
   *  `animate`-based path for full backwards compat. `MotionValue`
   *  identity is stable across re-renders (parent uses `useMotionValue`
   *  once), so the `areEqual` reference check is correct. */
  progress?: MotionValue<number>;
  /** Optional gym branding for the white bottom strip. When provided,
   *  the strip renders a small circular logo + bold black gym name in
   *  place of the date/caption. When undefined/null, the polaroid
   *  renders exactly as before — zero change for existing consumers. */
  gymBrand?: {
    name: string;
    logoUrl?: string | null;
  } | null;
}

// Position table — same numbers as `StackSkeleton`. Kept duplicated
// rather than imported because the skeleton's positions are purely
// visual and may drift from the live stack's behaviour later.
const STACK_OFFSETS: Record<0 | 1 | 2, { scale: number; y: number; opacity: number; z: number }> = {
  0: { scale: 1, y: 0, opacity: 1, z: 30 },
  1: { scale: 0.96, y: 10, opacity: 0.7, z: 20 },
  2: { scale: 0.92, y: 20, opacity: 0.4, z: 10 },
};

function PolaroidCardBase({
  post,
  stackPosition,
  isTop,
  rotationDeg,
  onAuthorLongPress,
  developing = false,
  progress,
  gymBrand,
}: PolaroidCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  // Track logo load errors so we can swap to the letter-circle fallback
  // without leaving a broken-image icon in the strip. Reset to false
  // whenever the URL changes (a new brand should get a fresh attempt).
  const [logoErrored, setLogoErrored] = useState(false);
  const logoUrl = gymBrand?.logoUrl ?? null;
  React.useEffect(() => {
    setLogoErrored(false);
  }, [logoUrl]);
  const offsets = STACK_OFFSETS[stackPosition];
  // `useReducedMotion` matches what PolaroidStack already uses — same
  // import surface, same null/false semantics. We coerce to a boolean
  // so the conditional below stays readable.
  const prefersReducedMotion = useReducedMotion() ?? false;
  const reducedDevelop = developing && prefersReducedMotion;
  const fullDevelop = developing && !prefersReducedMotion;

  // For non-top cards, we bake the rotation into the static layout
  // value so they don't compete with the top card's live drag rotate.
  // The top card's rotation is owned by the parent stack (rotate
  // motion value bound on the wrapping motion.div).
  //
  // When `developing` is true, the polaroid is rendered outside the
  // stack (e.g. ReviewSheet preview) and the shake takes ownership of
  // the `rotate` animation for its first 200ms. We don't run the
  // staticTransform spring in that case — it would fight the shake.
  // Memoised so framer doesn't see a new object identity for the
  // animate target every parent re-render — that would otherwise force
  // the background-card spring to re-evaluate mid-drag, causing
  // redundant work on the iOS WebKit raster thread.
  const staticTransform = useMemo(
    () =>
      isTop || developing
        ? undefined
        : {
            scale: offsets.scale,
            y: offsets.y,
            opacity: offsets.opacity,
            rotate: rotationDeg,
          },
    [isTop, developing, offsets.scale, offsets.y, offsets.opacity, rotationDeg],
  );

  // ── Drag-progress wiring (spec §3.x — live background scale-up) ──────
  // Hooks must run unconditionally. We always create a fallback
  // `MotionValue(0)` and feed whichever is current (the parent's
  // `progress` when wired, the zero fallback otherwise) into the three
  // `useTransform` calls. When `progress` is undefined the derived
  // values stay pinned to the resting offsets — but we only actually
  // *consume* them on the position-1 background-card branch (see the
  // `useProgress` flag below). Position 2 keeps the existing static
  // `animate={staticTransform}` path, and the top/developing branches
  // are unchanged.
  const fallbackZero = useMotionValue(0);
  const sourceProgress = progress ?? fallbackZero;
  const animatedScale = useTransform(sourceProgress, [0, 1], [offsets.scale, 1]);
  const animatedY = useTransform(sourceProgress, [0, 1], [offsets.y, 0]);
  const animatedOpacity = useTransform(sourceProgress, [0, 1], [offsets.opacity, 1]);
  // Only the immediate next card (position 1, with a real progress MV)
  // animates live. Position 2 — and any card whose parent hasn't wired
  // progress — keeps the existing static path for full backwards compat.
  const useProgress = !isTop && !developing && progress !== undefined && stackPosition === 1;

  // Develop animation on the OUTER wrapper.
  //
  //  - Full motion: a damped wiggle from ±4° back to 0° across 200ms.
  //    Keyframe arrays in motion accept their own `times` so we can
  //    weight the peaks correctly (overshoot at 25%, return at 75%).
  //  - Reduced motion: a 200ms opacity cross-fade with no rotation
  //    change — the whole point of the reduced-motion branch is to
  //    avoid the shake entirely.
  let developWrapperAnimate: TargetAndTransition | undefined;
  let developWrapperTransition: Transition | undefined;
  if (fullDevelop) {
    developWrapperAnimate = {
      rotate: [-4, 4, -2, 0],
      opacity: 1,
    };
    developWrapperTransition = {
      rotate: {
        duration: DEVELOP_SHAKE_DURATION_MS / 1000,
        times: [0, 0.4, 0.75, 1],
        ease: EASE_OUT,
      },
      opacity: { duration: 0 },
    };
  } else if (reducedDevelop) {
    developWrapperAnimate = { opacity: 1 };
    developWrapperTransition = {
      opacity: {
        duration: DEVELOP_REDUCED_DURATION_MS / 1000,
        ease: "linear",
      },
    };
  }

  return (
    <motion.div
      className={`absolute inset-0 ${isTop || developing ? "" : "pointer-events-none"}`}
      // When `useProgress` is true (position-1 background card with a
      // wired progress MV), Motion reads `scale`/`y`/`opacity` directly
      // from MotionValues — no React re-render per drag frame. Otherwise
      // we fall back to the existing `animate={staticTransform}` spring
      // path (position 2, or any caller that hasn't wired `progress`).
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
      // When developing, ignore the stack's static spring and run the
      // shake (or reduced-motion fade) instead. Otherwise behave exactly
      // as before for existing call sites.
      initial={developing ? { opacity: reducedDevelop ? 0 : 1, rotate: fullDevelop ? -4 : 0 } : false}
      animate={developing ? developWrapperAnimate : useProgress ? undefined : staticTransform}
      transition={
        developing
          ? developWrapperTransition
          : useProgress
            ? undefined
            : { type: "spring", stiffness: 220, damping: 28, mass: 1 }
      }
    >
      <div className="bg-white p-4 pb-10 rounded-sm select-none">
        {/* Image well */}
        <div className="relative aspect-square overflow-hidden bg-neutral-200">
          {/* LQIP backdrop — visible until the full image loads. */}
          {post.thumbDataUrl && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${post.thumbDataUrl})`,
                filter: "blur(12px)",
                transform: "scale(1.1)", // hide blur edges
              }}
            />
          )}

          {post.url ? (
            <motion.img
              // Shared-element transition target: only bind layoutId on
              // the top card. Binding it on all three cards triggers
              // framer's shared-layout measurement pipeline every render
              // (perf P0 — flagged 2026-05-18). The grid → polaroid
              // back-nav still works because the destination card is
              // always the top of the stack at restore time.
              layoutId={isTop ? `post-${post.id}-image` : undefined}
              // For the top card we load the full-res image immediately.
              // For background cards (positions 1/2) the 256-px thumb is
              // visually indistinguishable at their scale — use it when
              // available so the initial network cost is ~70% lower. Fall
              // back to the full URL when thumbUrl is absent.
              src={isTop ? post.url : (post.thumbUrl ?? post.url)}
              alt={post.caption ?? "Training media"}
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              loading={isTop ? "eager" : "lazy"}
              decoding="async"
              // Intrinsic dimensions give the browser an aspect-ratio
              // hint so it can pre-allocate the layout box before the
              // image decodes — eliminates CLS without changing the
              // rendered size (the parent's `aspect-square` +
              // `object-cover` still own actual layout).
              width={1000}
              height={1000}
              className={`absolute inset-0 h-full w-full object-cover ${developing ? "" : "transition-opacity duration-300"}`}
              // Default (non-developing) path is unchanged — Tailwind's
              // opacity transition drives the LQIP-to-full crossfade.
              //
              // Developing path: motion owns both filter (blur 20→0) and
              // opacity (0→1 for the reduced-motion fade). `style`
              // declares the initial frame so there's no flash on mount.
              {...(fullDevelop
                ? {
                    initial: { filter: "blur(20px)", opacity: imgLoaded ? 1 : 0 },
                    animate: { filter: "blur(0px)", opacity: imgLoaded ? 1 : 0 },
                    transition: {
                      filter: {
                        duration: DEVELOP_BLUR_DURATION_MS / 1000,
                        ease: EASE_OUT,
                      },
                    },
                  }
                : reducedDevelop
                  ? {
                      initial: { opacity: 0, filter: "blur(0px)" },
                      animate: { opacity: imgLoaded ? 1 : 0, filter: "blur(0px)" },
                      transition: {
                        opacity: {
                          duration: DEVELOP_REDUCED_DURATION_MS / 1000,
                          ease: "linear",
                        },
                      },
                    }
                  : {
                      style: { opacity: imgLoaded ? 1 : 0 },
                    })}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-xs">
              Media unavailable
            </div>
          )}

          {/* Author overlay — top card only. The pointer-events scope
              lets the parent stack absorb drag/tap on the rest of the
              card while still routing long-press here. */}
          {isTop && (
            <button
              type="button"
              aria-label={`View ${post.author.displayName}'s profile`}
              className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md"
              // Suppress click so the polaroid's tap-to-flick doesn't fire.
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                onAuthorLongPress?.();
              }}
            >
              {post.author.avatarUrl ? (
                <img
                  src={post.author.avatarUrl}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover ring-1 ring-white/40"
                />
              ) : (
                <div className="h-5 w-5 rounded-full bg-white/30 flex items-center justify-center text-[10px] font-bold text-white">
                  {post.author.displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-[11px] font-medium text-white">
                {post.author.displayName}
              </span>
            </button>
          )}
        </div>

        {/* Caption strip — 44px bottom region of the polaroid. The
            spec leans on date + relative time only; the session
            metadata + caption belong on the info-card below.
            When developing, this strip fades in from +100ms and lands
            at full opacity at +700ms — flush with the blur finish.
            Reduced-motion: appears statically (no transition).

            When `gymBrand` is set, the strip renders the gym logo + name
            INSTEAD of the date — two competing labels on a 28px strip
            looks cluttered, so the brand fully replaces the date.
            Same h-7 height + same fade-in transition keep layout +
            develop-animation parity. */}
        <motion.div
          className={
            gymBrand
              ? "h-7 flex items-center gap-2 px-1"
              : "h-7 flex items-center justify-center text-[11px] text-neutral-700 tabular-nums tracking-wide"
          }
          {...(fullDevelop
            ? {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: {
                  duration: (DEVELOP_META_END_MS - DEVELOP_META_DELAY_MS) / 1000,
                  delay: DEVELOP_META_DELAY_MS / 1000,
                  ease: EASE_OUT,
                },
              }
            : {})}
        >
          {gymBrand ? (
            <>
              {logoUrl && !logoErrored ? (
                <img
                  src={logoUrl}
                  alt=""
                  width={24}
                  height={24}
                  draggable={false}
                  onError={() => setLogoErrored(true)}
                  className="h-6 w-6 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-6 w-6 rounded-full bg-neutral-300 text-neutral-700 font-bold flex items-center justify-center text-[12px] shrink-0"
                >
                  {gymBrand.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-[15px] font-bold text-black truncate">
                {gymBrand.name}
              </span>
            </>
          ) : (
            formatPolaroidDate(post.createdAt)
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Custom equality — only re-render when the visible bits change.
 *  This is the hot path while the stack animates, so dropping refs
 *  (`onAuthorLongPress`) from the compare is worth it. */
function areEqual(prev: PolaroidCardProps, next: PolaroidCardProps): boolean {
  return (
    prev.post.id === next.post.id &&
    prev.isTop === next.isTop &&
    prev.stackPosition === next.stackPosition &&
    prev.rotationDeg === next.rotationDeg &&
    // url + thumb can mutate while the post stays the same id (Convex
    // re-hydration on the storage URL). Compare so we trigger the
    // fade-in animation when the real image arrives.
    prev.post.url === next.post.url &&
    prev.post.thumbUrl === next.post.thumbUrl &&
    prev.post.thumbDataUrl === next.post.thumbDataUrl &&
    // `developing` flips when ReviewSheet hands the polaroid off to the
    // stack (true → false). The render tree needs to re-evaluate so the
    // blur/shake props clear and the static stack transform takes over.
    prev.developing === next.developing &&
    // `progress` is a MotionValue created once in the parent via
    // `useMotionValue` and reused across renders — its identity is
    // stable, so a reference check is sufficient. We need this in the
    // compare so that when the parent rewires which card receives the
    // progress driver (top advances, position-1 becomes position-0,
    // etc.), the memoized child re-renders to pick up the new branch.
    prev.progress === next.progress &&
    // `gymBrand` is an optional object — most call sites will pass
    // undefined/null. Compare by-value on the two visible fields so a
    // newly-resolved logoUrl (or a rename) triggers a re-render without
    // requiring the parent to memoize the object literal.
    (prev.gymBrand?.name ?? null) === (next.gymBrand?.name ?? null) &&
    (prev.gymBrand?.logoUrl ?? null) === (next.gymBrand?.logoUrl ?? null) &&
    // Distinguish "no brand" (undefined/null) from "brand present" even
    // when both name + logoUrl happen to be null/empty.
    Boolean(prev.gymBrand) === Boolean(next.gymBrand)
  );
}

export const PolaroidCard = React.memo(PolaroidCardBase, areEqual);

/* ─── caption helpers ─── */

function formatPolaroidDate(epochMs: number): string {
  try {
    return format(new Date(epochMs), "MMM d · h:mm a");
  } catch {
    return "";
  }
}
