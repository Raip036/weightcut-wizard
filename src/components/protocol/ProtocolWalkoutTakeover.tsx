// WP — ProtocolWalkoutTakeover
// Full-screen takeover shown when the athlete finishes the Weight Protocol
// ("I've made weight & refueled"). It TAKES OVER the whole page: a fixed,
// full-viewport overlay above everything (z-[120]) with a dark backdrop.
//
// Sequence:
//   1. Celebratory entry — confetti burst + a haloed, bobbing 3D wizard over
//      an aurora wash with rising motes (blue→green theme). Visual language is
//      shared with ProtocolCompleteCutscene / the "Aurora Wizard" reference.
//      All ambient motion is gated behind `useReducedMotion` (static fallback).
//   2. Once the hero settles, a recap POSTER CARD fades in. That card — a clean,
//      branded, screenshot-worthy 1080×1920 story poster built on the shared
//      `CardShell` — is the thing that gets saved/shared.
//   3. Below the card: "Save to Photos" + "Share" (wired to the existing
//      share-card util so Instagram Story works via the native sheet) and a
//      subtle "Start over".
//
// Save/share reuse: `useShareCard()` (src/hooks/useShareCard.ts), which wraps
// the shared `captureCardAsBlob` / `downloadCardImage` / `shareCardImage`
// utilities in src/lib/shareUtils.ts — identical to the rest of the share-card
// family (ReadinessFlexSheet, ShareCardDialog, etc.).
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { Loader2, Share2 } from "lucide-react";
import { CardShell } from "@/components/share/templates/CardShell";
import { StravaStat } from "@/components/share/templates/StravaStat";
import { useShareCard } from "@/hooks/useShareCard";
import { usePremium } from "@/hooks/usePremium";
import { logger } from "@/lib/logger";
import wizardImg from "@/assets/wizard_3D.png";

export interface ProtocolWalkoutStats {
  madeWeightKg: number | null;
  rehydratedLitres: number | null;
  walkedInKg: number | null;
}

interface ProtocolWalkoutTakeoverProps {
  stats: ProtocolWalkoutStats;
  onReset: () => void;
}

// Full-size source dimensions for the poster (story 9:16). The on-screen
// preview just scales this down so the saved/shared export stays crisp at
// 1080×1920 regardless of device width — same approach as ShareCardDialog.
const CARD_W = 1080;
const CARD_H = 1920;
const MAX_PREVIEW_H = 360;

// Fixed mote positions so they don't re-randomise per render.
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "10%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "26%", size: 3, dur: 9.0, delay: 1.4 },
  { left: "44%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "60%", size: 3, dur: 9.3, delay: 2.0 },
  { left: "78%", size: 4, dur: 7.8, delay: 1.0 },
  { left: "92%", size: 3, dur: 8.6, delay: 0.4 },
];

async function fireConfetti(): Promise<void> {
  try {
    const mod = await import("canvas-confetti");
    const confetti = mod.default;
    // Blue→green burst to match the takeover theme.
    const colors = ["#3b82f6", "#22c55e", "#60a5fa", "#4ade80", "#ffffff"];
    confetti({
      particleCount: 110,
      spread: 78,
      origin: { y: 0.32 },
      ticks: 110,
      scalar: 0.95,
      colors,
    });
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.4 },
      colors,
    });
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.4 },
      colors,
    });
  } catch (err) {
    logger.warn("ProtocolWalkoutTakeover: confetti failed to load", { err });
  }
}

function formatKg(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} kg`;
}

function formatLitres(value: number | null): string {
  return value == null ? "—" : `+${value.toFixed(1)} L`;
}

// ── Poster card ──────────────────────────────────────────────────────────
// Branded recap poster. Built on the shared CardShell so it inherits the app
// watermark + "FightCamp Wizard" brand row and the radial-gradient backdrop
// used across the whole share-card family. This is the element captured for
// Save / Share, so it must read cleanly as a standalone screenshot.
const WalkoutPosterCard = forwardRef<HTMLDivElement, { stats: ProtocolWalkoutStats }>(
  ({ stats }, ref) => {
    const { isPremium } = usePremium();

    return (
      <CardShell ref={ref} aspect="story" isPremium={isPremium}>
        {/* Atmosphere: blue→green energy wash + a warm spotlight pooled under
            the wizard hero (sits behind everything). */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 70% 40% at 50% 24%, rgba(96,165,250,0.22) 0%, transparent 62%), " +
              "radial-gradient(ellipse 80% 45% at 50% 82%, rgba(74,222,128,0.16) 0%, transparent 64%)",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: 620,
            height: 980,
            background:
              "linear-gradient(180deg, rgba(96,165,250,0.10) 0%, transparent 78%)",
            clipPath: "polygon(38% 0%, 62% 0%, 100% 100%, 0% 100%)",
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            height: "100%",
          }}
        >
          {/* ── Wizard hero over a soft glow + grounded spotlight pool ── */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              marginTop: 8,
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                width: 560,
                height: 560,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -54%)",
                background:
                  "radial-gradient(circle, rgba(96,165,250,0.34) 0%, rgba(74,222,128,0.18) 42%, transparent 70%)",
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                bottom: -28,
                left: "50%",
                transform: "translateX(-50%)",
                width: 420,
                height: 90,
                background:
                  "radial-gradient(ellipse, rgba(96,165,250,0.40) 0%, rgba(74,222,128,0.16) 50%, transparent 78%)",
                borderRadius: "50%",
                filter: "blur(6px)",
                pointerEvents: "none",
              }}
            />
            <img
              src={wizardImg}
              alt=""
              draggable={false}
              style={{
                position: "relative",
                width: 420,
                height: 420,
                objectFit: "contain",
                filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.55))",
              }}
            />
          </div>

          {/* ── Headline ── */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "0.30em",
                paddingLeft: "0.30em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.55)",
                marginBottom: 22,
              }}
            >
              Fight Night
            </div>
            <div
              style={{
                fontSize: 80,
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: "-0.025em",
                color: "#ffffff",
              }}
            >
              You made weight
            </div>
            <div
              style={{
                fontSize: 80,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
                background: "linear-gradient(90deg, #60a5fa, #4ade80)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              &amp; refueled
            </div>
          </div>

          {/* Thin gradient divider anchoring the stats. */}
          <div
            aria-hidden
            style={{
              marginTop: 56,
              width: 280,
              height: 3,
              borderRadius: 2,
              background:
                "linear-gradient(90deg, transparent, #60a5fa, #4ade80, transparent)",
              opacity: 0.7,
            }}
          />

          {/* ── Stats: big, bold, no-box (StravaStat, story size) ── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 52,
              marginTop: 60,
            }}
          >
            <StravaStat
              label="Made weight"
              value={formatKg(stats.madeWeightKg)}
              s
              accentColor="#4ade80"
            />
            <StravaStat label="Rehydrated" value={formatLitres(stats.rehydratedLitres)} s />
            <StravaStat label="Walked in" value={formatKg(stats.walkedInKg)} s />
          </div>
        </div>
      </CardShell>
    );
  },
);
WalkoutPosterCard.displayName = "WalkoutPosterCard";

export function ProtocolWalkoutTakeover({
  stats,
  onReset,
}: ProtocolWalkoutTakeoverProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  const { cardRef, isCapturing, captureAndShare } = useShareCard();

  // Stage the reveal: hero plays first, then the poster card + actions fade in.
  // Reduced motion → show everything immediately.
  const [showCard, setShowCard] = useState<boolean>(!!prefersReduced);

  // Preview scale — fit the source 1080×1920 poster into the preview budget.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 200, h: MAX_PREVIEW_H, scale: 0.16 });

  const recalc = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const scaleByW = containerW / CARD_W;
    const scaleByH = MAX_PREVIEW_H / CARD_H;
    const scale = Math.min(scaleByW, scaleByH);
    setDims({
      w: Math.round(CARD_W * scale),
      h: Math.round(CARD_H * scale),
      scale,
    });
  }, []);

  // Lock the page behind the takeover so it can't scroll while open. The
  // overlay itself (rendered via a portal into document.body) handles its own
  // internal scrolling, so the celebration is always what fills the screen.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Fire confetti + schedule the poster reveal on mount.
  useEffect(() => {
    if (prefersReduced) {
      setShowCard(true);
      return;
    }
    void fireConfetti();
    const t = setTimeout(() => setShowCard(true), 1400);
    return () => clearTimeout(t);
  }, [prefersReduced]);

  // Recalculate the preview scale once the card stage is mounted, and on resize.
  useEffect(() => {
    if (!showCard) return;
    const t = setTimeout(recalc, 30);
    window.addEventListener("resize", recalc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", recalc);
    };
  }, [showCard, recalc]);

  const handleShare = useCallback(() => {
    void captureAndShare(
      "I made weight & refueled.",
      "Made weight and refueled — built with FightCamp Wizard",
    );
  }, [captureAndShare]);

  // Render through a portal into document.body so the `fixed inset-0` overlay
  // anchors to the viewport — NOT to any transformed ancestor (e.g. the
  // PageTransition wrapper, which uses CSS `transform`). A transformed ancestor
  // would otherwise become the containing block for `position: fixed`, pinning
  // the takeover wherever the page is scrolled instead of filling the screen.
  const overlay = (
    <motion.div
      className="fixed inset-0 z-[120]"
      role="dialog"
      aria-modal="true"
      aria-label="Weight protocol complete"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReduced ? 0 : 0.4, ease: "easeOut" }}
    >
      {/* Background layer — fills the viewport and stays put BEHIND the scrolling
          content, so the animated background persists across the ENTIRE
          scrollable area. Previously the gradient + aurora + motes lived on the
          scroll container (`absolute inset-0`), so they clipped to the first
          screen and the lower portion scrolled to bare black. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 12%, rgba(59,130,246,0.18) 0%, transparent 55%), " +
            "radial-gradient(ellipse at 50% 92%, rgba(34,197,94,0.16) 0%, transparent 58%), " +
            "#050505",
        }}
      >
      {/* Aurora wash. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(59,130,246,0.08) 50%, rgba(34,197,94,0.14) 100%)",
        }}
        animate={prefersReduced ? undefined : { scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? undefined
            : { duration: 8, ease: "easeInOut", repeat: Infinity }
        }
      />

      {/* Drifting motes. */}
      {!prefersReduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                background: "rgba(134,239,172,0.8)",
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px rgba(74,222,128,0.7)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -380] }}
              transition={{
                duration: m.dur,
                delay: m.delay,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </div>
      )}

      </div>

      {/* Scrollable content layer — transparent, so the fixed background layer
          shows through at every scroll position. `my-auto` centres the content
          when it fits, but lets it flow from the top (scrollable) when the
          poster is taller than the screen, keeping Save/Share/Start over
          reachable. Bottom padding clears the home indicator. */}
      <div
        className="absolute inset-0 flex flex-col items-center overflow-y-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 2rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)",
        }}
      >
      <div className="relative z-10 my-auto flex w-full max-w-md flex-col items-center px-6">
        {/* Haloed, bobbing wizard hero. Stays as the visual anchor above the
            poster card once it reveals. */}
        <div className="relative flex h-44 items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(96,165,250,0.24) 0%, rgba(34,197,94,0.14) 44%, transparent 70%)",
            }}
            animate={
              prefersReduced
                ? { opacity: 0.6 }
                : { opacity: [0.4, 0.72, 0.4], scale: [0.95, 1.06, 0.95] }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
          <motion.img
            src={wizardImg}
            alt=""
            draggable={false}
            className="relative h-[120px] w-[120px] select-none object-contain"
            style={{ pointerEvents: "none" }}
            initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.9 }}
            animate={
              prefersReduced
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 1, y: [0, -10, 0], scale: 1 }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.6, ease: "easeOut" },
                    scale: { type: "spring", stiffness: 220, damping: 18 },
                    y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.6 },
                  }
            }
          />
        </div>

        {/* Headline — also visible before the poster reveals so the hero never
            feels empty. */}
        <motion.p
          className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground"
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.5, delay: prefersReduced ? 0 : 0.5 }}
        >
          You made weight &amp; refueled
        </motion.p>
        <motion.h2
          className="mt-1.5 text-[30px] font-extrabold leading-tight tracking-tight text-foreground"
          initial={prefersReduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.5, delay: prefersReduced ? 0 : 0.62 }}
        >
          Fight{" "}
          <span
            style={{
              background: "linear-gradient(90deg, #60a5fa, #4ade80)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            night
          </span>
        </motion.h2>

        {/* ── Poster card + actions ──────────────────────────────────────── */}
        {showCard && (
          <motion.div
            className="mt-6 flex w-full flex-col items-center"
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReduced ? 0 : 0.55, ease: "easeOut" }}
          >
            {/* Scaled preview of the full-size poster. The off-screen full-size
                card is what `cardRef` captures, so the export stays 1080×1920. */}
            <div ref={wrapperRef} className="flex w-full justify-center">
              <div
                className="overflow-hidden rounded-2xl border border-border/50 bg-black"
                style={{ width: dims.w, height: dims.h }}
              >
                <div
                  style={{
                    transform: `scale(${dims.scale})`,
                    transformOrigin: "top left",
                    width: CARD_W,
                    height: CARD_H,
                  }}
                >
                  <WalkoutPosterCard ref={cardRef} stats={stats} />
                </div>
              </div>
            </div>

            {/* Single "Share to Story" action — on iOS the share sheet lets the
                user save to Photos, so a separate Save button is unnecessary. */}
            <div className="mt-5 flex items-center justify-center">
              <button
                type="button"
                onClick={handleShare}
                disabled={isCapturing}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-8 text-[14px] font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-60"
              >
                {isCapturing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                Share to Story
              </button>
            </div>

            {/* "Start over" — a real ≥44px tap target (not a tiny text link)
                so it's reachable and pressable at the bottom of the scroll,
                clear of the home indicator via the overlay's bottom padding. */}
            <button
              type="button"
              onClick={onReset}
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/15 px-6 text-[13px] font-semibold text-muted-foreground transition-colors active:opacity-80 hover:text-foreground"
            >
              Start over
            </button>
          </motion.div>
        )}
      </div>
      </div>
    </motion.div>
  );

  return createPortal(overlay, document.body);
}
