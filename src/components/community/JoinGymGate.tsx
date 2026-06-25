import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";
import { celebrateSuccess, triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";
import { globalLoading } from "@/lib/globalLoading";
import { staggerContainer, staggerItem, springs } from "@/lib/motion";
import { isNativePlatform } from "@/hooks/useIsNative";

/**
 * JoinGymGate: "The Locker Room"
 *
 * The animated, in-page empty state for the Community tab when the user has no
 * gym yet. Replaces the old hard redirect to `/join` with an engaging,
 * belonging-themed screen that mirrors the visual recipe of `CoachProGate`
 * (ambient backdrop + staggered value cards + gradient CTA with shimmer sweep)
 * but warm/social, NOT a Pro paywall.
 *
 * Embeds the live gym-code flow from `JoinGym.tsx`: `getByInviteCode` preview +
 * `joinByInviteCode` mutation. On success it shows the global loading overlay
 * (survives unmount) and routes to `/my-gym`.
 *
 * GPU budget (iOS): all motion is transform/opacity only. The warm glow pulses
 * opacity/scale (no animated blur); polaroid shadows are static. Honors
 * `useReducedMotion` and downgrades on `isNativePlatform`.
 */

const CODE_RE = /^[A-HJ-KMNP-Z2-9]{6}$/i;

const REASONS: { icon: IonIconName; title: string; sub: string }[] = [
  {
    icon: "trophyOutline",
    title: "Climb the leaderboard",
    sub: "See where you rank against your whole gym, week to week.",
  },
  {
    icon: "imagesOutline",
    title: "Share the grind",
    sub: "Drop training photos straight into your gym's feed.",
  },
  {
    icon: "chatbubblesOutline",
    title: "Never roll alone",
    sub: "Comments, reactions, and the crew that has your back.",
  },
];

/** Hero polaroids: fanned "shared photos" dealt out on mount. Gradient fills +
 *  an icon stand in for real snaps so the hero needs no image assets. The
 *  `rest` transform is the fanned resting pose; entrance starts stacked. */
const POLAROIDS: Array<{
  icon: IonIconName;
  caption: string;
  fill: string;
  rest: { x: number; y: number; rotate: number };
}> = [
  {
    icon: "barbellOutline",
    caption: "leg day",
    fill: "linear-gradient(145deg, hsl(225 83% 58%), hsl(231 70% 40%))",
    rest: { x: -58, y: 8, rotate: -11 },
  },
  {
    icon: "cameraOutline",
    caption: "weigh-in",
    fill: "linear-gradient(145deg, hsl(213 94% 66%), hsl(217 91% 48%))",
    rest: { x: 58, y: 6, rotate: 11 },
  },
  {
    icon: "flameOutline",
    caption: "rounds",
    fill: "linear-gradient(145deg, hsl(199 90% 60%), hsl(210 90% 46%))",
    rest: { x: 0, y: -6, rotate: -1 },
  },
];

/** Rising blue "motes": the same drifting-particle field the Recovery Pro gate
 *  (CoachProGate) uses. Fixed positions so they don't re-randomise per render.
 *  Transform/opacity only; the soft glow is a static box-shadow (not animated). */
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "8%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "20%", size: 3, dur: 9.0, delay: 1.6 },
  { left: "32%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "45%", size: 3, dur: 9.5, delay: 2.4 },
  { left: "57%", size: 4, dur: 8.3, delay: 1.1 },
  { left: "69%", size: 3, dur: 9.1, delay: 0.4 },
  { left: "80%", size: 5, dur: 7.8, delay: 2.0 },
  { left: "92%", size: 4, dur: 8.6, delay: 0.5 },
];

export function JoinGymGate(): JSX.Element {
  const prefersReduced = useReducedMotion();
  const navigate = useNavigate();
  const { userId } = useUser();
  // Immune to a stuck `body{pointer-events:none}` left by a badly-closed overlay.
  useClearStuckPointerEvents();
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const joinByInviteCode = useMutation(api.gyms.joinByInviteCode);

  // Pre-warm the MyGym chunk so the post-join navigation doesn't stall on a
  // chunk download (Suspense-fallback flash).
  useEffect(() => {
    void import("@/pages/MyGym");
  }, []);

  // Live preview once a full valid code is entered (mirrors JoinGym).
  const trimmedCode = code.trim().toUpperCase();
  const validCode = CODE_RE.test(trimmedCode);
  const previewData = useQuery(
    api.gyms.getByInviteCode,
    validCode ? { inviteCode: trimmedCode } : "skip",
  );
  const lookingUp = validCode && previewData === undefined;
  const gymPreview = previewData
    ? { id: previewData.id, name: previewData.name, location: previewData.location }
    : null;

  const canJoin = !!gymPreview && !!userId && !joining;

  const handleJoin = async () => {
    if (!gymPreview || !userId) return;
    triggerHaptic(ImpactStyle.Light);
    setJoining(true);
    // Dismiss the keyboard so the overlay reads as "instant".
    (document.activeElement as HTMLElement | null)?.blur?.();
    globalLoading.show(`Joining ${gymPreview.name}…`, "Setting up your gym connection");
    try {
      await joinByInviteCode({ inviteCode: trimmedCode });
      celebrateSuccess();
      toast({ title: `Joined ${gymPreview.name}` });
      navigate("/my-gym", { replace: true });
      globalLoading.hideAfterPaint();
    } catch (err) {
      logger.error("JoinGymGate: failed to join", err);
      globalLoading.hide();
      toast({
        title: "Could not join gym",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setJoining(false);
    }
  };

  return (
    <div className="relative h-full overflow-y-auto overflow-x-hidden overscroll-contain bg-background pointer-events-auto">
      {/* `min-h-full` content sizer: grows with the content AND is always at
          least one full viewport tall, so the absolute backdrop below covers
          the ENTIRE scrollable page. The blue stays premium all the way to the
          bottom when scrolled instead of cutting off after one viewport. */}
      <div className="relative min-h-full">
      {/* Ambient blue backdrop + drifting motes, matches the Recovery Pro gate
          (CoachProGate) visual language. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0 }}
        animate={prefersReduced ? { opacity: 1 } : { opacity: 1, scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 1, ease: "easeOut" },
                scale: { duration: 8, ease: "easeInOut", repeat: Infinity },
              }
        }
      />
      {!prefersReduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -780] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}

      <div
        className="relative z-10 px-6"
        style={{ paddingTop: 12, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}
      >
        {/* ── Hero: fanned polaroid deck ── */}
        <div className="relative mx-auto mt-3 h-[150px] w-full max-w-[340px]">
          {/* Radial pool behind the deck. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(217 91% 58% / 0.12) 45%, transparent 72%)",
            }}
          />
          {POLAROIDS.map((p, i) => {
            const isTop = i === POLAROIDS.length - 1;
            return (
              <motion.div
                key={p.caption}
                className="absolute left-1/2 top-1/2 w-[96px] select-none rounded-sm bg-white p-2 pb-6 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.6)]"
                style={{ marginLeft: -48, marginTop: -64, transformOrigin: "50% 100%" }}
                initial={
                  prefersReduced
                    ? { x: p.rest.x, y: p.rest.y, rotate: p.rest.rotate, opacity: 1 }
                    : { x: 0, y: 0, rotate: 0, scale: 0.9, opacity: 0 }
                }
                animate={{
                  x: p.rest.x,
                  y: p.rest.y,
                  rotate: p.rest.rotate,
                  scale: 1,
                  opacity: 1,
                }}
                transition={{ ...springs.gentle, delay: prefersReduced ? 0 : 0.15 + i * 0.1 }}
              >
                {/* Idle breathe on the top photo only (transform-only). */}
                <motion.div
                  animate={
                    prefersReduced || isNativePlatform || !isTop
                      ? undefined
                      : { y: [0, -3, 0], rotate: [0, 0.8, 0] }
                  }
                  transition={
                    prefersReduced || isNativePlatform || !isTop
                      ? undefined
                      : { duration: 7, ease: "easeInOut", repeat: Infinity }
                  }
                >
                  <div
                    className="flex h-[76px] w-full items-center justify-center rounded-[3px]"
                    style={{ background: p.fill }}
                  >
                    <Icon name={p.icon} size={26} className="text-white/85" />
                  </div>
                  <p className="mt-1.5 text-center font-mono text-[10px] lowercase tracking-tight text-neutral-500">
                    {p.caption}
                  </p>
                </motion.div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Headline ── */}
        <motion.div
          className="mt-5 flex flex-col items-center text-center"
          initial={prefersReduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: prefersReduced ? 0 : 0.5 }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/90">
            Your gym · Community
          </span>
          <h1 className="mt-2 text-2xl font-bold leading-snug text-foreground">
            Find your people.
          </h1>
          <p className="mt-2 max-w-[290px] text-sm leading-relaxed text-muted-foreground">
            Your gym, your crew, your feed, all in one room. Enter your code to step in.
          </p>
        </motion.div>

        {/* ── Code box ── */}
        <motion.div
          className="mt-6"
          initial={prefersReduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.gentle, delay: prefersReduced ? 0 : 0.62 }}
        >
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="ABC123"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            aria-label="Gym invite code"
            className="h-[58px] rounded-2xl border-border/50 bg-card/60 text-center font-mono text-[22px] tabular-nums tracking-[0.4em]"
          />

          {/* Live preview slot: fixed min-height so there's no layout shift. */}
          <div className="mt-3 min-h-[60px]">
            {lookingUp && (
              <div className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Looking up code…
              </div>
            )}
            {!lookingUp && gymPreview && (
              <motion.div
                initial={prefersReduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.gentle}
                className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Icon name="peopleOutline" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-foreground">{gymPreview.name}</p>
                  {gymPreview.location && (
                    <p className="truncate text-[11px] text-muted-foreground">{gymPreview.location}</p>
                  )}
                </div>
                <Icon name="checkmarkCircle" size={20} className="shrink-0 text-primary" />
              </motion.div>
            )}
            {!lookingUp && !gymPreview && validCode && (
              <div className="text-center">
                <p className="text-[13px] font-medium text-foreground">Code not recognised</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Codes are 6 characters · check capitalisation with your coach
                </p>
              </div>
            )}
          </div>

          {/* Join CTA with shimmer sweep (matches CoachProGate / ProUpsellScreen). */}
          <button
            type="button"
            onClick={handleJoin}
            disabled={!canJoin}
            className="relative mt-1 h-12 w-full overflow-hidden rounded-2xl text-[15px] font-bold text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-40"
            style={{
              // Brighter, more saturated blue than `from-primary to-secondary`,
              // with a stronger glow so the CTA pops off the blue backdrop.
              background: "linear-gradient(90deg, hsl(213 94% 64%), hsl(217 91% 54%) 55%, hsl(221 83% 48%))",
              boxShadow: "0 0 30px hsl(213 94% 64% / 0.55), inset 0 1px 0 0 hsl(0 0% 100% / 0.25)",
            }}
          >
            <span className="relative z-10 inline-flex items-center justify-center gap-2">
              {joining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Joining…
                </>
              ) : (
                <>
                  Join gym
                  <Icon name="arrowForwardOutline" size={16} />
                </>
              )}
            </span>
            {!prefersReduced && canJoin && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25"
                style={{ transform: "skewX(-20deg)" }}
                initial={{ x: "-120%" }}
                animate={{ x: "440%" }}
                transition={{ duration: 1.1, ease: "easeOut", repeat: Infinity, repeatDelay: 2.6, delay: 0.4 }}
              />
            )}
          </button>
        </motion.div>

        {/* ── Reason cards (staggered) ── */}
        <motion.ul
          className="mt-6 space-y-3"
          variants={staggerContainer(60, prefersReduced ? 0 : 720)}
          initial={prefersReduced ? false : "hidden"}
          animate="visible"
        >
          {REASONS.map((r) => (
            <motion.li
              key={r.title}
              variants={prefersReduced ? undefined : staggerItem}
              className="flex items-start gap-3.5 rounded-2xl border border-border/50 bg-card/60 p-3.5"
            >
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center">
                <Icon name={r.icon} size={18} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug text-foreground">{r.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.sub}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>

        <p className="mt-5 text-center text-[12px] text-muted-foreground/70">
          No code? Ask your coach for your gym's invite.
        </p>
      </div>
      </div>
    </div>
  );
}
