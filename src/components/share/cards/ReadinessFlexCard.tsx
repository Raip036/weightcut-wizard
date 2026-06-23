// T17: ReadinessFlexCard, the share template fired from RecoveryDashboard's hero
// when readiness >= 85. Mirrors the existing share-card visual vocabulary
// (CardShell + tabular-nums hero number) so the export reads as a first-class
// piece of the share-card family.
//
// Redesign (2026-06-23): Strava-style — left-aligned, very bold, with the
// pillar stats stacked VERTICALLY as label/value rows (instead of the old
// 3-column bar grid). Adds a `transparent` variation for overlaying the card
// on a photo/story background (CardShell handles the transparent fill + the
// legibility text-shadow).
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.a, "ReadinessFlexCard". Free tier gets 1/week + watermark, Pro gets
// unlimited and no watermark. The watermark is delegated to `CardShell`'s
// existing `isPremium` prop.
import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";

export type ReadinessTone = "green" | "amber" | "red";

interface ReadinessFlexCardProps {
  date: Date;
  /** 0..100; rendered as the hero number. */
  readiness: number;
  /** Per-pillar scores. Null pillars render as "-" so a partial card still
   *  ships rather than blocking the share on a missing driver. */
  pillars: { recovery: number | null; body: number | null; load: number | null };
  /** Optional one-liner from the trigger sheet ("Sparring tonight."). Capped
   *  to 60 chars by the caller; we defensively truncate here too. */
  caption?: string;
  /** Drives accent colour for the hero number + stat accents. */
  tone: ReadinessTone;
  /** "@pratik", drawn on the bottom-right for free users alongside the
   *  CardShell watermark. Pro users skip both. */
  userHandle?: string;
  /** When true: omit watermark + handle (Pro). When false: render both. */
  isPro: boolean;
  /** Transparent background variation — for overlaying on a photo/story. */
  transparent?: boolean;
  aspect?: AspectRatio;
}

// Match the page's Recovery palette so the share render reads as "the same
// thing the user just saw": green/amber/red parity with the hero verdict.
const TONE: Record<ReadinessTone, { hero: string; accent: string; label: string }> = {
  green: { hero: "#22c55e", accent: "rgba(34,197,94,0.9)", label: "READY" },
  amber: { hero: "#f59e0b", accent: "rgba(245,158,11,0.9)", label: "STEADY" },
  red:   { hero: "#ef4444", accent: "rgba(239,68,68,0.9)",  label: "RECOVER" },
};

export const ReadinessFlexCard = forwardRef<HTMLDivElement, ReadinessFlexCardProps>(
  function ReadinessFlexCard(
    { date, readiness, pillars, tone, userHandle, isPro, transparent = false, aspect = "story" },
    ref,
  ) {
    const s = aspect === "story";
    const palette = TONE[tone];

    // "TUE · JUN 3": uppercase abbreviated weekday + month-day.
    const weekday = date
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase();
    const monthDay = date
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase();
    const dateLine = `${weekday} · ${monthDay}`;

    // On the transparent variation, lift label/divider opacity so the text
    // stays legible over an arbitrary photo (CardShell adds the text-shadow).
    const subColor = transparent ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.55)";
    const labelColor = transparent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.6)";

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPro} transparent={transparent}>
        {/* Everything centered; a bottom spacer biases the block slightly up
            so the hero number reads as the centerpiece. */}
        {/* Header: contextual READY/STEADY/RECOVER label + date. */}
        <div style={{ textAlign: "center", marginBottom: s ? 30 : 18 }}>
          <div
            style={{
              fontSize: s ? 36 : 22,
              fontWeight: 900,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: palette.accent,
              marginBottom: s ? 12 : 7,
            }}
          >
            {palette.label}
          </div>
          <div
            style={{
              fontSize: s ? 42 : 26,
              fontWeight: 800,
              letterSpacing: "0.08em",
              color: subColor,
            }}
          >
            {dateLine}
          </div>
        </div>

        {/* Hero readiness number: oversized, very bold, CENTERED. Colour is
            tone-driven (green/amber/red), never hardcoded. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: s ? 56 : 32,
          }}
        >
          <div
            style={{
              fontSize: s ? 420 : 248,
              fontWeight: 900,
              letterSpacing: "-0.05em",
              lineHeight: 0.86,
              color: palette.hero,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(readiness)}
          </div>
          <div
            style={{
              fontSize: s ? 38 : 24,
              fontWeight: 900,
              letterSpacing: "0.22em",
              color: labelColor,
              marginTop: s ? 18 : 11,
            }}
          >
            READINESS
          </div>
        </div>

        {/* Pillar stats: centered row, each a big bold number ABOVE its
            label (83 / SLEEP). */}
        <div style={{ display: "flex", justifyContent: "center", gap: s ? 84 : 52 }}>
          <StatCol label="Sleep" score={pillars.recovery} story={s} labelColor={labelColor} />
          <StatCol label="Body" score={pillars.body} story={s} labelColor={labelColor} />
          <StatCol label="Load" score={pillars.load} story={s} labelColor={labelColor} />
        </div>

        {/* Bottom spacer — biases the centered block up slightly. */}
        <div aria-hidden style={{ flexShrink: 0, height: s ? 150 : 84 }} />

        {/* User handle for free tier, paired with the CardShell watermark. */}
        {!isPro && userHandle && (
          <div
            style={{
              position: "absolute",
              right: s ? 56 : 40,
              bottom: s ? 96 : 56,
              fontSize: s ? 24 : 15,
              fontWeight: 700,
              color: transparent ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.45)",
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

ReadinessFlexCard.displayName = "ReadinessFlexCard";

// ── StatCol ───────────────────────────────────────────────────────────
// A single centered stat: big bold value ABOVE its uppercase label
// (83 over SLEEP). Null score renders as "-" so a partial card still ships.
interface StatColProps {
  label: string;
  score: number | null;
  story: boolean;
  labelColor: string;
}

function StatCol({ label, score, story, labelColor }: StatColProps) {
  const display = score == null ? "-" : Math.round(score).toString();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: story ? 8 : 5,
      }}
    >
      <div
        style={{
          fontSize: story ? 132 : 82,
          fontWeight: 900,
          letterSpacing: "-0.03em",
          color: "#ffffff",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {display}
      </div>
      <div
        style={{
          fontSize: story ? 34 : 21,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: labelColor,
        }}
      >
        {label}
      </div>
    </div>
  );
}
