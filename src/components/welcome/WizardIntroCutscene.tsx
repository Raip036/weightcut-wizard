/**
 * WizardIntroCutscene — animated welcome sequence before sign-up.
 *
 * Flow
 * ----
 * 1. Mount at full-screen, dark stage. Wizard rises into frame.
 * 2. 5 acts (see `cutsceneScript.ts`) play in order. Each beat:
 *      - Wizard transitions to its new stage position + pose + scale
 *      - SpeechBubble types out the line
 *      - Effects layer kicks in (sparkles, confetti, spotlight, etc.)
 *      - After dwell, auto-advance (or user can tap to skip ahead)
 * 3. Final act swaps the "Skip" pill for two CTAs:
 *      - "Start your cut"  → /auth?mode=signup    (primary)
 *      - "I have an account" → /auth              (secondary)
 *
 * Interaction
 * -----------
 * - Tap anywhere on the stage: if typewriter is running, complete it;
 *   else advance to the next act (or fire primary CTA on final act).
 * - Swipe left: advance. Swipe right: go back one act.
 * - "Skip" pill (top-right) jumps straight to auth signup.
 * - Reduced-motion users get a static composition with the same copy.
 *
 * Design notes
 * ------------
 * - Single mascot instance — we animate position/scale/pose between
 *   acts instead of mounting/unmounting. Keeps the wizard feeling
 *   continuous and live.
 * - Effects render in their own absolutely-positioned layer behind the
 *   mascot so they never block taps on the CTA layer.
 * - Bubble + CTA stack live above the mascot on z so they're always
 *   readable when the wizard is mid-celebrate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useAuthActions } from "@convex-dev/auth/react";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { SpeechBubble } from "@/tutorial/SpeechBubble";
import { useToast } from "@/hooks/use-toast";
import { mapAuthError, isAppleCancelError } from "@/lib/authErrors";
import { logger } from "@/lib/logger";

/**
 * Apple Inc. brand mark — solid silhouette per Apple's HIG for "Sign in
 * with Apple" buttons. lucide's `Apple` icon is the *fruit* outline and
 * is not approved for sign-in buttons.
 */
function AppleLogo({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
import { CUTSCENE_ACTS, CUTSCENE_SEEN_KEY, type CutsceneAct, type StageEffect } from "./cutsceneScript";

// ── Tuning constants ──────────────────────────────────────────────────
// Pre-tuned for an iPhone 12-class viewport. The script's normalized
// coordinates scale linearly with the stage, so these only need to
// move if the *base* mascot size or padding changes.
const MASCOT_BASE_PX = 140; // matches WizardCharacter's intrinsic size
const BUBBLE_GAP_PX = 16;   // visible gap between bubble (incl. tail) and mascot
const BUBBLE_TAIL_OVERHANG_PX = 14; // SpeechBubble tail SVG extends ~14px past the bubble box edge
const BUBBLE_EDGE_PADDING_PX = 12; // min gap between bubble and screen edge
const BUBBLE_HARD_MAX_PX = 360;    // matches SpeechBubble's own max-w cap
const ADVANCE_SWIPE_PX = 50;

async function lightHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod = await import("@capacitor/haptics");
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch {
    // Plugin missing or denied — silent.
  }
}

async function reactionHaptic(style: "Light" | "Medium" | "Heavy"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod = await import("@capacitor/haptics");
    const map = {
      Light: mod.ImpactStyle.Light,
      Medium: mod.ImpactStyle.Medium,
      Heavy: mod.ImpactStyle.Heavy,
    };
    await mod.Haptics.impact({ style: map[style] });
  } catch {
    // Plugin missing or denied — silent.
  }
}

// Variable-reward micro reactions when the user taps the wizard. Each
// reaction is a small position/scale/rotation tween layered on top of
// the wizard's stage-position animation. Picked randomly per tap so the
// behavior feels alive instead of scripted — see `handleWizardTap`.
interface WizardReaction {
  id: string;
  transform: { rotate?: number[]; scale?: number[]; y?: number[] };
  durationMs: number;
  haptic: "Light" | "Medium" | "Heavy";
}

const WIZARD_REACTIONS: ReadonlyArray<WizardReaction> = [
  { id: "jump",     transform: { y: [0, -20, 0] },                          durationMs: 400, haptic: "Medium" },
  { id: "spin",     transform: { rotate: [0, 360] },                        durationMs: 600, haptic: "Medium" },
  { id: "shake",    transform: { rotate: [0, -8, 8, -6, 6, 0] },            durationMs: 500, haptic: "Light"  },
  { id: "bounce",   transform: { scale: [1, 1.15, 0.95, 1.05, 1] },         durationMs: 500, haptic: "Medium" },
  { id: "wiggle",   transform: { rotate: [0, 5, -5, 3, -3, 0] },            durationMs: 400, haptic: "Light"  },
  { id: "puff",     transform: { scale: [1, 0.9, 1.1, 1] },                 durationMs: 350, haptic: "Light"  },
  { id: "stretch",  transform: { scale: [1, 1.2, 1], y: [0, -8, 0] },       durationMs: 450, haptic: "Medium" },
  { id: "moonwalk", transform: { y: [0, -4, 0], rotate: [0, -15, 15, 0] },  durationMs: 700, haptic: "Heavy"  },
];

interface StageDims {
  width: number;
  height: number;
}

/**
 * Resolve the wizard's pixel position + bubble anchor for a given act.
 * The bubble is anchored to the wizard's bounding box edge so the tail
 * always lands on him regardless of where he stands on the stage.
 */
function layoutForAct(act: CutsceneAct, dims: StageDims): {
  mascotLeft: number;
  mascotTop: number;
  mascotSize: number;
  bubbleStyle: React.CSSProperties;
  /**
   * Static transform values handed to motion's `x`/`y` props. We deliberately
   * keep these OFF of `bubbleStyle.transform` because motion overwrites
   * `style.transform` with its own composed transform when you animate
   * `scale`/`opacity`, which used to silently drop the `-100%` Y shift and
   * dump the "above" bubble on top of the wizard.
   */
  bubbleX: string | number;
  bubbleY: string | number;
} {
  const mascotSize = MASCOT_BASE_PX * act.scale;
  // act.position is the CENTER of the mascot.
  const centerX = act.position.x * dims.width;
  const centerY = act.position.y * dims.height;
  const mascotLeft = centerX - mascotSize / 2;
  const mascotTop = centerY - mascotSize / 2;

  // Bubble: positioned RELATIVE to the stage (absolute). Compute the
  // anchor point depending on `bubbleSide` so the tail naturally lands
  // on the wizard. We also clamp `maxWidth` against the room available
  // on the chosen side so the bubble can never escape the stage —
  // SpeechBubble itself uses `w-fit` and respects this cap.
  const bubbleStyle: React.CSSProperties = { position: "absolute" };
  let bubbleX: string | number = 0;
  let bubbleY: string | number = 0;
  const centeredMax = Math.min(
    BUBBLE_HARD_MAX_PX,
    Math.max(0, dims.width - 2 * BUBBLE_EDGE_PADDING_PX),
  );
  switch (act.bubbleSide) {
    case "above": {
      // The "bottom-*" tail extends BUBBLE_TAIL_OVERHANG_PX below the
      // bubble's box. Push the bubble up by that much so the tail's tip
      // clears the wizard with a real BUBBLE_GAP_PX of breathing room.
      bubbleStyle.left = "50%";
      bubbleStyle.top = `${mascotTop - BUBBLE_GAP_PX - BUBBLE_TAIL_OVERHANG_PX}px`;
      bubbleX = "-50%";
      bubbleY = "-100%";
      bubbleStyle.maxWidth = `${centeredMax}px`;
      break;
    }
    case "below": {
      bubbleStyle.left = "50%";
      bubbleStyle.top = `${mascotTop + mascotSize + BUBBLE_GAP_PX + BUBBLE_TAIL_OVERHANG_PX}px`;
      bubbleX = "-50%";
      bubbleY = 0;
      bubbleStyle.maxWidth = `${centeredMax}px`;
      break;
    }
    case "right": {
      const leftPx = mascotLeft + mascotSize + BUBBLE_GAP_PX;
      const room = Math.max(0, dims.width - leftPx - BUBBLE_EDGE_PADDING_PX);
      bubbleStyle.left = `${leftPx}px`;
      bubbleStyle.top = `${centerY}px`;
      bubbleX = 0;
      bubbleY = "-50%";
      bubbleStyle.maxWidth = `${Math.min(BUBBLE_HARD_MAX_PX, room)}px`;
      break;
    }
    case "left": {
      const rightPx = dims.width - mascotLeft + BUBBLE_GAP_PX;
      const room = Math.max(0, dims.width - rightPx - BUBBLE_EDGE_PADDING_PX);
      bubbleStyle.right = `${rightPx}px`;
      bubbleStyle.top = `${centerY}px`;
      bubbleX = 0;
      bubbleY = "-50%";
      bubbleStyle.maxWidth = `${Math.min(BUBBLE_HARD_MAX_PX, room)}px`;
      break;
    }
  }
  return { mascotLeft, mascotTop, mascotSize, bubbleStyle, bubbleX, bubbleY };
}

// ── Effect layers ─────────────────────────────────────────────────────

function SparklesLayer({ count = 12 }: { count?: number }) {
  // Pseudo-random but stable positions per sparkle.
  const sparkles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${(i * 73) % 100}%`,
        top: `${(i * 41 + 20) % 90}%`,
        delay: (i % 5) * 0.3,
        size: 3 + ((i * 7) % 4),
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {sparkles.map((s) => (
        <motion.span
          key={s.id}
          className="absolute rounded-full bg-amber-200"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            boxShadow: "0 0 12px rgba(255, 220, 130, 0.85)",
            mixBlendMode: "screen",
          }}
          animate={{ opacity: [0, 1, 0], y: [0, -22, -44], scale: [0.6, 1.1, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, delay: s.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function SpotlightLayer({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background: `radial-gradient(circle at ${x}px ${y}px, rgba(255,200,90,0.18) 0%, rgba(255,200,90,0.08) 28%, rgba(0,0,0,0) 60%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    />
  );
}

function PulseRingLayer({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute z-0"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-amber-300/50"
          style={{ left: -90, top: -90, width: 180, height: 180 }}
          animate={{ scale: [0.6, 1.8], opacity: [0.7, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function ConfettiLayer() {
  // 22 streamers fan out from center-top. Deterministic angles so the
  // burst reads as a designed moment, not noise.
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2;
        const dist = 200 + (i % 5) * 30;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 80,
          rot: (i * 47) % 360,
          color: ["#FFD166", "#EF476F", "#06D6A0", "#118AB2", "#F4A261"][i % 5],
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-1/3"
          style={{ width: 8, height: 14, background: p.color, borderRadius: 2 }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function WeightPlatesLayer({ x, y }: { x: number; y: number }) {
  // Six plates orbit the wizard. Pure visual nicety — tells the user
  // "we know weight" without any copy doing the work.
  const plates = [0, 60, 120, 180, 240, 300];
  return (
    <div
      className="pointer-events-none absolute z-0"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      {plates.map((deg, i) => (
        <motion.div
          key={i}
          className="absolute flex items-center justify-center rounded-full bg-zinc-700/70 text-[9px] font-bold text-amber-200 ring-1 ring-amber-400/30"
          style={{ left: -14, top: -14, width: 28, height: 28 }}
          animate={{
            rotate: 360,
            x: [Math.cos((deg * Math.PI) / 180) * 110, Math.cos(((deg + 360) * Math.PI) / 180) * 110],
            y: [Math.sin((deg * Math.PI) / 180) * 110, Math.sin(((deg + 360) * Math.PI) / 180) * 110],
          }}
          transition={{
            rotate: { duration: 6, repeat: Infinity, ease: "linear", delay: i * 0.1 },
            x: { duration: 8, repeat: Infinity, ease: "linear", delay: i * 0.1 },
            y: { duration: 8, repeat: Infinity, ease: "linear", delay: i * 0.1 },
          }}
        >
          2.5
        </motion.div>
      ))}
    </div>
  );
}

function renderEffect(effect: StageEffect, dims: StageDims, mascotCenter: { x: number; y: number }) {
  switch (effect) {
    case "sparkles":
      return <SparklesLayer key="sparkles" />;
    case "spotlight":
      return <SpotlightLayer key="spotlight" x={mascotCenter.x} y={mascotCenter.y} />;
    case "pulse-ring":
      return <PulseRingLayer key="pulse-ring" x={mascotCenter.x} y={mascotCenter.y} />;
    case "confetti":
      return <ConfettiLayer key="confetti" />;
    case "weight-plates":
      return <WeightPlatesLayer key="weight-plates" x={mascotCenter.x} y={mascotCenter.y} />;
    case "scroll-unroll":
      // Reserved for future use — script doesn't currently summon it.
      return null;
    default:
      return null;
  }
}

// ── Main component ────────────────────────────────────────────────────

export function WizardIntroCutscene(): JSX.Element {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const { signIn } = useAuthActions();
  const { toast } = useToast();

  const [actIndex, setActIndex] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const [forceComplete, setForceComplete] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [reactionAnim, setReactionAnim] = useState<WizardReaction | null>(null);
  const [dims, setDims] = useState<StageDims>(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 390,
    height: typeof window !== "undefined" ? window.innerHeight : 844,
  }));

  const stageRef = useRef<HTMLDivElement>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = CUTSCENE_ACTS[actIndex];
  const isFinal = actIndex === CUTSCENE_ACTS.length - 1;

  // Track viewport so the script's normalized coords stay correct on rotate
  // / split-view / iPad multitasking.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // Mark cutscene as seen on mount — once a user lands here we don't want
  // to gate any other UI on "have they seen it." (Index.tsx still routes
  // them through it for the "Get Started" tap; this flag is for analytics
  // / future variations.)
  useEffect(() => {
    try {
      window.localStorage.setItem(CUTSCENE_SEEN_KEY, "true");
    } catch {
      // Storage blocked — fine, not load-bearing.
    }
  }, []);

  // Step transition side-effects: reset typewriter, schedule auto-advance.
  useEffect(() => {
    setTypingDone(false);
    setForceComplete(false);
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    void lightHaptic();
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, [actIndex]);

  // No auto-advance. The cutscene is self-paced — typing complete just
  // unlocks the "tap to continue" affordance; the user controls when to
  // move on. Prevents the "it ran past me before I could read it" complaint
  // earlier copy beats were getting. The act script's dwellMs values are
  // now informational only (kept for future variations).
  //
  // Reduced-motion exception: typewriter is suppressed in that mode, so
  // we honour the user's accessibility preference with a slow time-based
  // advance — they're not reading character-by-character, just letting
  // the beats sweep past.
  useEffect(() => {
    if (!prefersReduced) return;
    if (isFinal) return;
    const t = setTimeout(() => {
      setActIndex((i) => Math.min(i + 1, CUTSCENE_ACTS.length - 1));
    }, 5200);
    return () => clearTimeout(t);
  }, [actIndex, prefersReduced, isFinal]);

  // ── Handlers ──────────────────────────────────────────────────────
  const advance = useCallback((): void => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setActIndex((i) => Math.min(i + 1, CUTSCENE_ACTS.length - 1));
  }, []);

  const goBack = useCallback((): void => {
    setActIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleStageTap = useCallback((): void => {
    if (!typingDone) {
      // First tap during typing — complete it instantly.
      setForceComplete(true);
      return;
    }
    if (isFinal) return; // final act: rely on CTA buttons
    advance();
  }, [typingDone, isFinal, advance]);

  const handlePanEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.x < -ADVANCE_SWIPE_PX) advance();
      else if (info.offset.x > ADVANCE_SWIPE_PX) goBack();
    },
    [advance, goBack],
  );

  const handleSkip = useCallback((): void => {
    navigate("/auth?mode=signup");
  }, [navigate]);

  const handleContinueWithApple = useCallback(async (): Promise<void> => {
    if (appleLoading) return;
    void lightHaptic();
    setAppleLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Native iOS path — mirrors Auth.tsx's handleAppleSignIn so users
        // who tap "Continue with Apple" from the cutscene get the exact
        // same first-class native experience and avoid a redirect bounce.
        const rawNonce = crypto.randomUUID();
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawNonce));
        const hashedNonce = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
        if (!convexSiteUrl) {
          throw new Error("VITE_CONVEX_SITE_URL not set — cannot build Apple redirect URI");
        }
        const redirectURI = `${convexSiteUrl}/api/auth/callback/apple`;
        logger.debug("[cutscene-apple-signin] starting native authorize", { redirectURI });
        const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
        const result = await SignInWithApple.authorize({
          clientId: "com.weightcutwizard.app",
          redirectURI,
          scopes: "email",
          nonce: hashedNonce,
        });
        // Cutscene is fighter-only — coaches enter via the dedicated
        // CoachLogin screen, so we never need a role selector here.
        await signIn("apple-native", {
          idToken: result.response.identityToken,
          nonce: rawNonce,
          ...(result.response.email ? { email: result.response.email } : {}),
          ...(result.response.givenName ? { givenName: result.response.givenName } : {}),
          ...(result.response.familyName ? { familyName: result.response.familyName } : {}),
          role: "fighter",
        });
      } else {
        // Web fallback — Convex Auth handles the redirect dance.
        await signIn("apple", { redirectTo: `${window.location.origin}/dashboard` });
      }
      navigate("/dashboard");
    } catch (error: any) {
      // Silent cancel — user backed out of the Apple sheet, nothing to do.
      // Stays on the cutscene so they can try again or pick the other CTA.
      if (isAppleCancelError(error)) {
        setAppleLoading(false);
        return;
      }
      logger.error("[cutscene-apple-signin] failed", error, {
        message: error?.message,
        code: error?.code,
        name: error?.name,
      });
      toast({
        variant: "destructive",
        title: "Apple Sign-In Failed",
        description: mapAuthError(error, "oauth"),
      });
      // Fall back to the full auth screen so the user isn't dead-ended.
      navigate("/auth?mode=signup");
    } finally {
      setAppleLoading(false);
    }
  }, [appleLoading, navigate, signIn, toast]);

  const handleHaveAccount = useCallback((): void => {
    navigate("/auth");
  }, [navigate]);

  const handleWizardTap = useCallback((): void => {
    // Variable-reward: most taps roll a normal reaction, ~1-in-20 lands
    // the rare "moonwalk" so the wizard feels alive and unpredictable.
    const normalReactions = WIZARD_REACTIONS.filter((r) => r.id !== "moonwalk");
    const moonwalk = WIZARD_REACTIONS.find((r) => r.id === "moonwalk");
    const isMoonwalk = moonwalk && Math.random() < 0.05;
    const picked: WizardReaction = isMoonwalk
      ? moonwalk
      : normalReactions[Math.floor(Math.random() * normalReactions.length)];
    void reactionHaptic(picked.haptic);
    setReactionAnim(picked);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = setTimeout(() => {
      setReactionAnim(null);
      reactionTimerRef.current = null;
    }, picked.durationMs);
  }, []);

  // Clean up any pending reaction timeout on unmount so we don't try to
  // set state after the cutscene has been dismissed.
  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, []);

  // Layout for this act
  const layout = useMemo(() => layoutForAct(act, dims), [act, dims]);
  const mascotCenter = {
    x: layout.mascotLeft + layout.mascotSize / 2,
    y: layout.mascotTop + layout.mascotSize / 2,
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-[9999] overflow-hidden bg-[#020204] text-white"
      // Cosmic vignette — matches the dark-mode Apple-Fitness aesthetic
      // of the app shell. Subtle radial so the wizard pops without
      // looking like we slapped him on a black rectangle.
      style={{
        background:
          "radial-gradient(ellipse at 50% 30%, rgba(40, 28, 60, 0.7) 0%, rgba(8, 8, 14, 0.95) 55%, #020204 100%)",
      }}
    >
      {/* Skip pill — top-right, screen-relative */}
      <button
        type="button"
        onClick={handleSkip}
        aria-label="Skip introduction"
        className="absolute z-30 flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-white/85"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          right: "calc(env(safe-area-inset-right, 0px) + 14px)",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.10)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        Skip
      </button>

      {/* Progress dots — top-center, one per act */}
      <div
        className="absolute z-30 flex items-center gap-1.5"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 22px)",
          left: "50%",
          transform: "translateX(-50%)",
        }}
        aria-hidden
      >
        {CUTSCENE_ACTS.map((_, i) => (
          <motion.span
            key={i}
            className="h-1.5 rounded-full bg-white"
            animate={{
              width: i === actIndex ? 22 : 6,
              opacity: i === actIndex ? 1 : i < actIndex ? 0.55 : 0.25,
            }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          />
        ))}
      </div>

      {/* Tap/swipe surface — covers the whole stage. Children above use
          higher z-index so the buttons still take precedence. */}
      <motion.div
        className="absolute inset-0 z-10"
        onClick={handleStageTap}
        drag={prefersReduced ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onPanEnd={handlePanEnd}
      />

      {/* Effects layer (sparkles, spotlight, confetti, etc.) */}
      <AnimatePresence>
        {act.effects?.map((effect) => (
          <motion.div
            key={`${act.id}-${effect}`}
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {renderEffect(effect, dims, mascotCenter)}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Wizard — single instance, animates between stage positions.
          Tappable: each tap rolls a random micro-reaction (see
          WIZARD_REACTIONS) for variable-reward engagement. */}
      <motion.div
        className="absolute z-20 pointer-events-auto cursor-pointer"
        animate={{
          left: layout.mascotLeft,
          top: layout.mascotTop,
          width: layout.mascotSize,
          height: layout.mascotSize,
        }}
        initial={false}
        transition={
          prefersReduced
            ? { duration: 0.18 }
            : { type: "spring", stiffness: 110, damping: 18, mass: 1.1 }
        }
        onClick={(e) => {
          // Don't bubble to the stage tap handler — the reaction IS the
          // response; we don't also want to advance the act.
          e.stopPropagation();
          handleWizardTap();
        }}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {/* Inner wrapper carries the reaction animation so it composes
            with — instead of fighting — the outer position tween. */}
        <motion.div
          style={{ width: "100%", height: "100%" }}
          animate={
            reactionAnim
              ? reactionAnim.transform
              : { rotate: 0, scale: 1, y: 0 }
          }
          transition={
            reactionAnim
              ? { duration: reactionAnim.durationMs / 1000, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <div
            style={{
              width: MASCOT_BASE_PX,
              height: MASCOT_BASE_PX,
              transform: `scale(${layout.mascotSize / MASCOT_BASE_PX})`,
              transformOrigin: "top left",
            }}
          >
            <WizardCharacter pose={act.pose} />
          </div>
        </motion.div>
      </motion.div>

      {/* Speech bubble — anchored to mascot via `bubbleSide` */}
      <div className="absolute inset-0 z-30 pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={act.id}
            className="pointer-events-auto"
            style={layout.bubbleStyle}
            initial={
              prefersReduced
                ? { opacity: 0, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 0, scale: 0.85, x: layout.bubbleX, y: layout.bubbleY }
            }
            animate={
              prefersReduced
                ? { opacity: 1, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 1, scale: 1, x: layout.bubbleX, y: layout.bubbleY }
            }
            exit={
              prefersReduced
                ? { opacity: 0, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 0, scale: 0.85, x: layout.bubbleX, y: layout.bubbleY }
            }
            transition={prefersReduced ? { duration: 0.15 } : { type: "spring", stiffness: 360, damping: 26 }}
          >
            <SpeechBubble
              headline={act.headline}
              body={act.body}
              revealKey={act.id}
              forceComplete={forceComplete}
              onTypingComplete={() => setTypingDone(true)}
              tailSide={act.tailSide}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* "Tap to continue" affordance — fades in once the typewriter
          finishes on a non-final act. The whole stage is already a tap
          target via the swipe surface above; this is just a hint so users
          don't sit waiting for an auto-advance that never comes. */}
      <AnimatePresence>
        {typingDone && !isFinal && (
          <motion.div
            key="tap-hint"
            className="absolute inset-x-0 z-30 flex items-center justify-center pointer-events-none"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <motion.span
              className="text-[12px] font-medium tracking-wide text-white/55"
              animate={prefersReduced ? undefined : { opacity: [0.55, 0.95, 0.55] }}
              transition={prefersReduced ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              Tap to continue
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Final-act CTA stack — anchored bottom, pinned above safe-area.
          Renders only on the final beat so prior acts feel cinematic,
          not cluttered. */}
      <AnimatePresence>
        {isFinal && (
          <motion.div
            key="cta"
            className="absolute z-40 w-full px-5"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}
            // Lands at the same beat the wizard hits his celebrate pose
            // — no dead pause = no doubt window before the CTA.
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={prefersReduced ? { duration: 0.18 } : { type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="mx-auto w-full max-w-[420px] space-y-2.5">
              <button
                type="button"
                onClick={() => { void handleContinueWithApple(); }}
                disabled={appleLoading}
                aria-label="Continue with Apple"
                className={`no-tap-select w-full h-[54px] rounded-2xl bg-white text-black font-bold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform shadow-lg shadow-black/30 ${appleLoading ? "opacity-50" : ""}`}
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                <AppleLogo className="h-[18px] w-[18px]" />
                Continue with Apple
              </button>
              <button
                type="button"
                onClick={handleHaveAccount}
                className="no-tap-select w-full h-[46px] rounded-2xl border border-white/15 text-white/90 font-semibold text-[14px] flex items-center justify-center active:scale-[0.98] transition-transform hover:bg-white/5"
                style={{ WebkitTapHighlightColor: "transparent", background: "rgba(255,255,255,0.04)" }}
              >
                I already have an account
              </button>
              <p className="text-center text-[11px] text-white/45 pt-1">
                No credit card. No emails. Just Apple.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default WizardIntroCutscene;
