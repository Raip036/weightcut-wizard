// T18: ComebackCard, the share template fired by useComebackTrigger when the
// user's readiness jumps +20 within 48h. Celebrates the bounce-back
// narrative (low to high) rather than a single high score, so the layout
// emphasises the THEN to NOW delta rather than a hero number.
//
// Mirrors ReadinessFlexCard's visual vocabulary (CardShell + tabular-nums,
// uppercase eyebrows, story aspect, watermark via CardShell.isPremium) so
// the export reads as a sibling of the existing share-card family.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.b, "ComebackCard". Free tier gets 1/month + watermark, Pro gets
// unlimited and no watermark. The monthly rate-limit lives in the trigger
// sheet (ComebackSheet), not the card itself, because the sheet owns the
// share button.
import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";

interface ComebackCardProps {
  oldDate: Date;
  oldScore: number;
  newDate: Date;
  newScore: number;
  /** Deterministic "things you did to get here" count, 0-10. Calculator
   *  lives in useComebackTrigger so the card stays presentational. */
  protocolsCompleted: number;
  /** Optional 80-char one-liner ("I was cooked Sunday. Back in the lab.") */
  caption?: string;
  /** "@pratik", drawn on the bottom-right for free users alongside the
   *  CardShell watermark. Pro users skip both. */
  userHandle?: string;
  /** When true: omit watermark + handle (Pro). When false: render both. */
  isPro: boolean;
  aspect?: AspectRatio;
}

const CAPTION_MAX = 80;

// Two accents: muted ash for THEN, vivid green for NOW, so the eye reads
// the delta as a story rather than two numbers of equal weight.
const COLOR_THEN = "rgba(255,255,255,0.42)";
const COLOR_NOW = "#22c55e";
const COLOR_BAR_THEN = "rgba(255,255,255,0.18)";
const COLOR_BAR_NOW = "#22c55e";

export const ComebackCard = forwardRef<HTMLDivElement, ComebackCardProps>(
  function ComebackCard(
    {
      oldDate,
      oldScore,
      newDate,
      newScore,
      protocolsCompleted,
      caption,
      userHandle,
      isPro,
      aspect = "story",
    },
    ref,
  ) {
    const s = aspect === "story";

    // "SUN 48 → TUE 87" rendered as two side-by-side blocks. Weekday-only
    // since the delta is always within 48h, month/day adds noise without
    // information. Done with Intl rather than date-fns to keep the share
    // bundle tight (other cards lean on Intl too).
    const oldWeekday = oldDate
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase();
    const newWeekday = newDate
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase();

    const oldRounded = Math.round(oldScore);
    const newRounded = Math.round(newScore);
    const deltaRounded = newRounded - oldRounded;

    // Hours between old and new, almost always 48ish but render the actual
    // gap so a 36h bounce reads honestly rather than rounded up.
    const hoursDelta = Math.max(
      1,
      Math.round((newDate.getTime() - oldDate.getTime()) / 3_600_000),
    );
    const hoursLabel = hoursDelta <= 48 ? `${hoursDelta}h` : `${Math.round(hoursDelta / 24)}d`;

    const trimmedCaption = caption?.trim().slice(0, CAPTION_MAX) || null;

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPro}>
        {/* ── Header eyebrow ──────────────────────────────────────────
            Wide-tracked "COMEBACK" word replaces the FightCamp brand
            wordmark's visual weight (CardShell already renders the
            brand at top). Lives as the topmost contextual label so
            the share reads as a narrative tag at a glance. */}
        <div style={{ marginBottom: s ? 56 : 32 }}>
          <div
            style={{
              fontSize: s ? 28 : 18,
              fontWeight: 800,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: COLOR_NOW,
            }}
          >
            Comeback
          </div>
        </div>

        {/* ── THEN → NOW dual block ──────────────────────────────────
            Two columns separated by an arrow. Each column is a
            weekday eyebrow + big number + filled bar. Bar widths
            reflect the absolute scores (oldScore/100, newScore/100)
            so the visual delta matches the numeric delta. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: s ? 24 : 14,
            marginBottom: s ? 28 : 16,
          }}
        >
          <ScoreBlock
            weekday={oldWeekday}
            score={oldRounded}
            color={COLOR_THEN}
            barColor={COLOR_BAR_THEN}
            story={s}
          />

          <div
            aria-hidden
            style={{
              fontSize: s ? 56 : 36,
              fontWeight: 800,
              color: "rgba(255,255,255,0.4)",
              lineHeight: 1,
              // Nudge the arrow down to baseline with the big numbers.
              transform: s ? "translateY(-6px)" : "translateY(-4px)",
            }}
          >
            ►
          </div>

          <ScoreBlock
            weekday={newWeekday}
            score={newRounded}
            color={COLOR_NOW}
            barColor={COLOR_BAR_NOW}
            story={s}
          />
        </div>

        {/* ── Delta line ─────────────────────────────────────────────
            "+39 in 48h": the storyline distilled into one phrase.
            Centred under the dual block so the eye lands on it after
            scanning THEN to NOW. */}
        <div
          style={{
            textAlign: "center",
            fontSize: s ? 36 : 22,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            color: COLOR_NOW,
            fontVariantNumeric: "tabular-nums",
            marginBottom: s ? 56 : 32,
          }}
        >
          +{deltaRounded} in {hoursLabel}
        </div>

        {/* ── Optional caption ───────────────────────────────────────
            User-written, capped at 80 chars. Rendered as a quote
            block so it reads as the athlete's voice rather than a
            system message. */}
        {trimmedCaption && (
          <div
            style={{
              marginBottom: s ? 48 : 28,
            }}
          >
            <div
              style={{
                fontSize: s ? 36 : 22,
                fontWeight: 700,
                color: "#ffffff",
                lineHeight: 1.3,
                fontStyle: "italic",
                // Quote marks rendered with text rather than glyphs so the
                // captured PNG ships consistent typography.
                paddingLeft: s ? 24 : 14,
                borderLeft: `${s ? 4 : 3}px solid ${COLOR_NOW}`,
              }}
            >
              "{trimmedCaption}"
            </div>
          </div>
        )}

        {/* ── Protocols completed ────────────────────────────────────
            "3 protocols completed": the deterministic, no-AI count
            of things the user did in the window (rest days, check-ins,
            sleep targets, mobility). 0 still renders, but as "ready
            to bounce" copy so the card doesn't shame an empty window. */}
        <div
          style={{
            marginTop: "auto",
            marginBottom: s ? 100 : 56,
            display: "flex",
            flexDirection: "column",
            gap: s ? 8 : 4,
          }}
        >
          <div
            style={{
              fontSize: s ? 22 : 14,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            ▸ The work
          </div>
          <div
            style={{
              fontSize: s ? 40 : 24,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-0.01em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {protocolsCompleted === 0
              ? "Ready to bounce"
              : `${protocolsCompleted} protocol${protocolsCompleted === 1 ? "" : "s"} completed`}
          </div>
        </div>

        {/* ── User handle (free tier only) ───────────────────────────
            Bottom-right pairing with the CardWatermark CardShell
            already renders. Pro tier omits both. */}
        {!isPro && userHandle && (
          <div
            style={{
              position: "absolute",
              right: s ? 56 : 40,
              bottom: s ? 96 : 56,
              fontSize: s ? 22 : 14,
              fontWeight: 600,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.04em",
              pointerEvents: "none",
            }}
          >
            {userHandle}
          </div>
        )}
      </CardShell>
    );
  },
);

ComebackCard.displayName = "ComebackCard";

// ── ScoreBlock ────────────────────────────────────────────────────────
// Weekday eyebrow + big tabular-nums score + filled track. Used twice
// (THEN / NOW), colour parameterised so the layout stays mirrored.
interface ScoreBlockProps {
  weekday: string;
  score: number;
  color: string;
  barColor: string;
  story: boolean;
}

function ScoreBlock({ weekday, score, color, barColor, story }: ScoreBlockProps) {
  const pct = Math.max(0, Math.min(1, score / 100));
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: story ? 12 : 8,
      }}
    >
      <div
        style={{
          fontSize: story ? 22 : 14,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {weekday}
      </div>
      <div
        style={{
          fontSize: story ? 140 : 88,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score}
      </div>
      <div
        style={{
          width: "100%",
          height: story ? 12 : 8,
          borderRadius: story ? 6 : 4,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: barColor,
            borderRadius: story ? 6 : 4,
          }}
        />
      </div>
    </div>
  );
}
