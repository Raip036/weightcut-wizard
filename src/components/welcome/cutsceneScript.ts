/**
 * Wizard Intro Cutscene — Script
 *
 * Five-act sequence the wizard mascot performs to welcome new users
 * before they hit the auth screen. The data here is intentionally
 * data-driven (not JSX) so designers/copywriters can tune dialogue,
 * timing, and pose without touching the playback engine.
 *
 * Stage coordinates
 * -----------------
 * Position values are normalized to the viewport:
 *   x ∈ [0, 1]  — 0 = left edge, 0.5 = center, 1 = right edge
 *   y ∈ [0, 1]  — 0 = top, 0.5 = mid, 1 = bottom (above safe area)
 * The component multiplies these by container width/height at render
 * time, so the stage stays composed on every device size.
 *
 * Scale baseline is `1.0` (= the natural 140px WizardCharacter). Hero
 * moments scale to 1.15–1.25 for impact; corner cameos drop to 0.55.
 *
 * Bubble tail side
 * ----------------
 * Mirrors `tutorial/SpeechBubble.tsx` — controls which corner the
 * speech-bubble tail points from. Pick the side that "looks at" the
 * wizard so the bubble visually grows out of him.
 *
 * Effects
 * -------
 * Optional flourishes the stage can render alongside the act. Keep this
 * list small + composable — anything more complex should be a separate
 * scene rather than a stacked effect.
 */
import type { WizardPose } from "@/tutorial/types";

export type TailSide = "bottom-left" | "bottom-right" | "left";
export type StageEffect =
  | "sparkles"        // ambient gold sparkles drifting up
  | "spotlight"       // soft radial vignette focused on the wizard
  | "confetti"        // celebration burst (final beat only)
  | "scroll-unroll"   // parchment-style line under the headline
  | "weight-plates"   // floating 2.5kg-plate icons orbiting wizard
  | "pulse-ring";     // expanding ring telegraphs an "important" beat

export interface CutsceneAct {
  /** Stable id — used as the React key + analytics event name. */
  id: string;
  /** Bold 1–4 word title that lands on the bubble. */
  headline: string;
  /** Typewriter body. Keep ≤ 150 chars; this is mobile, not a novel. */
  body: string;
  /** Mascot pose for the duration of this act. */
  pose: WizardPose;
  /** Where the wizard stands during the act, viewport-normalized. */
  position: { x: number; y: number };
  /** Mascot scale at this beat (1 = 140px natural size). */
  scale: number;
  /** Bubble tail side — pick the one that points back at the wizard. */
  tailSide: TailSide;
  /**
   * Where the bubble anchors relative to the wizard:
   *   - "above":      bubble above the mascot's head (hero pose)
   *   - "right":      bubble to the right (mascot at left of stage)
   *   - "left":       bubble to the left (mascot at right of stage)
   *   - "below":      bubble below mascot (rare, for tall hero shots)
   */
  bubbleSide: "above" | "right" | "left" | "below";
  /**
   * Approximate dwell time on this beat AFTER the typewriter completes,
   * in ms. The total visible duration is roughly:
   *   typing_ms + dwell_ms (or until user advances).
   */
  dwellMs: number;
  /** Visual effects to layer behind/around the wizard. */
  effects?: StageEffect[];
  /**
   * Conversion CTA shown ONLY on the final act. Other acts use a "Skip"
   * pill in the corner; the last beat replaces it with the real
   * sign-up/sign-in stack so the user lands on auth with momentum.
   */
  showCta?: boolean;
}

export const CUTSCENE_ACTS: CutsceneAct[] = [
  // ── Act 1 — The reveal ────────────────────────────────────────────
  // Wizard rises into frame center-stage. Big pose, big sparkles. We
  // earn the user's attention BEFORE we ask for anything.
  {
    id: "reveal",
    headline: "Hey, fighter.",
    body: "I'm your camp wizard. I run cuts, plans, and the math nobody else wants to do.",
    pose: "wave",
    position: { x: 0.5, y: 0.42 },
    scale: 1.2,
    tailSide: "bottom-left",
    bubbleSide: "above",
    dwellMs: 1100,
    effects: ["sparkles", "spotlight", "pulse-ring"],
  },

  // ── Act 2 — The promise ────────────────────────────────────────────
  // Wizard slides slightly left, points to the right where the (implied)
  // benefits hang. This is the "what this app does" beat.
  {
    id: "promise",
    headline: "Never miss weight again.",
    body: "Most fighters miss by 1–2 lbs. With one screen for cut, food, and weigh-ins, you won't.",
    pose: "point",
    position: { x: 0.32, y: 0.45 },
    scale: 1.05,
    tailSide: "left",
    bubbleSide: "right",
    dwellMs: 1200,
    effects: ["weight-plates"],
  },

  // ── Act 3 — Differentiator ─────────────────────────────────────────
  // Mirror-flip composition: wizard right, bubble left. Keeps the eye
  // moving so the cutscene doesn't feel like a slideshow.
  {
    id: "differentiator",
    headline: "Built for fighters.",
    body: "Water load. Sodium taper. Dry sauna. We know the names — and the order.",
    pose: "idle",
    position: { x: 0.68, y: 0.45 },
    scale: 1.05,
    tailSide: "bottom-right",
    bubbleSide: "left",
    dwellMs: 1100,
    effects: ["sparkles"],
  },

  // ── Act 4 — Social proof + speed ───────────────────────────────────
  // Wizard returns center, slightly smaller — "we're getting to business."
  // This is the conversion-tactic beat: speed + low friction.
  {
    id: "speed",
    headline: "Sign up in seconds.",
    body: "One tap with Apple — no forms, no passwords, no email verification dance. You're in.",
    pose: "point",
    position: { x: 0.5, y: 0.48 },
    scale: 1.1,
    tailSide: "bottom-left",
    bubbleSide: "above",
    dwellMs: 1300,
    effects: ["spotlight", "pulse-ring"],
  },

  // ── Act 5 — Call to action ─────────────────────────────────────────
  // Big celebration pose. Bubble carries the final line; the real CTAs
  // (Start your cut / I have an account) render OUTSIDE the bubble at
  // the bottom of the stage so the user lands on auth with a clear ask.
  {
    id: "cta",
    headline: "Camp opens when you do.",
    body: "Step on. We'll talk.",
    pose: "celebrate",
    position: { x: 0.5, y: 0.4 },
    scale: 1.25,
    tailSide: "bottom-left",
    bubbleSide: "above",
    dwellMs: 0, // dwell until user taps a CTA
    effects: ["confetti", "sparkles", "spotlight"],
    showCta: true,
  },
];

/**
 * Localstorage key for "user has seen the intro cutscene at least once".
 * We DON'T auto-skip on subsequent visits unless the user already has
 * an account — first-time users get the full performance every time
 * they re-tap "Get Started" until they actually sign up. (The Index
 * page handles the "logged-in user" branch separately.)
 */
export const CUTSCENE_SEEN_KEY = "wcw_cutscene_seen";
