// T17: ReadinessFlexCard — share template fired from RecoveryDashboard's hero
// when readiness ≥ 85. Mirrors the existing share-card visual vocabulary
// (CardShell + StatBlock + tabular-nums hero number) so the export reads as a
// first-class piece of the share-card family.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.a — "ReadinessFlexCard". Free tier gets 1/week + watermark, Pro gets
// unlimited and no watermark. The watermark is delegated to `CardShell`'s
// existing `isPremium` prop (which renders `CardWatermark` when false) — we
// don't roll our own so the chrome stays consistent with every other share
// card. The rate-limit gate lives in the trigger sheet, not the card itself,
// because the sheet owns the share button.
import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";

export type ReadinessTone = "green" | "amber" | "red";

interface ReadinessFlexCardProps {
  date: Date;
  /** 0..100; rendered as the hero number. */
  readiness: number;
  /** Per-pillar scores. Null pillars render as "—" so a partial card still
   *  ships rather than blocking the share on a missing driver. */
  pillars: { recovery: number | null; body: number | null; load: number | null };
  /** Optional one-liner from the trigger sheet ("Sparring tonight."). Capped
   *  to 60 chars by the caller; we defensively truncate here too. */
  caption?: string;
  /** Drives accent colour for the hero number + pillar fills. */
  tone: ReadinessTone;
  /** "@pratik" — drawn on the bottom-right for free users alongside the
   *  CardShell watermark. Pro users skip both. */
  userHandle?: string;
  /** When true: omit watermark + handle (Pro). When false: render both. */
  isPro: boolean;
  aspect?: AspectRatio;
}

// Match the page's Recovery palette so the share render reads as "the same
// thing the user just saw" — green/amber/red parity with the hero verdict.
const TONE: Record<ReadinessTone, { hero: string; accent: string; label: string }> = {
  green: { hero: "#22c55e", accent: "rgba(34,197,94,0.85)", label: "READY" },
  amber: { hero: "#f59e0b", accent: "rgba(245,158,11,0.85)", label: "STEADY" },
  red:   { hero: "#ef4444", accent: "rgba(239,68,68,0.85)",  label: "RECOVER" },
};

const CAPTION_MAX = 60;

export const ReadinessFlexCard = forwardRef<HTMLDivElement, ReadinessFlexCardProps>(
  function ReadinessFlexCard(
    { date, readiness, pillars, caption, tone, userHandle, isPro, aspect = "story" },
    ref,
  ) {
    const s = aspect === "story";
    const palette = TONE[tone];

    // "TUE · JUN 3" — uppercase abbreviated weekday + month-day. Done with
    // Intl rather than date-fns to keep the share-card bundle tight (the
    // other cards already lean on Intl too — see WeighInResultCard).
    const weekday = date
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase();
    const monthDay = date
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase();
    const dateLine = `${weekday} · ${monthDay}`;

    const trimmedCaption = caption?.trim().slice(0, CAPTION_MAX) || null;

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPro}>
        {/* Header strip — replaces the CardShell brand wordmark visual
            weight with a contextual READY/STEADY/RECOVER label so the
            share card communicates the tier at a glance. */}
        <div style={{ marginBottom: s ? 40 : 24 }}>
          <div
            style={{
              fontSize: s ? 22 : 14,
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: palette.accent,
              marginBottom: s ? 12 : 6,
            }}
          >
            {palette.label}
          </div>
          <div
            style={{
              fontSize: s ? 30 : 20,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            {dateLine}
          </div>
        </div>

        {/* Hero readiness number — tabular-nums, oversized; matches the
            in-app hero number's visual hierarchy. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            margin: s ? "20px 0 56px" : "12px 0 32px",
          }}
        >
          <div
            style={{
              fontSize: s ? 280 : 168,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: palette.hero,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(readiness)}
          </div>
          <div
            style={{
              fontSize: s ? 22 : 14,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "rgba(255,255,255,0.5)",
              marginTop: s ? 16 : 10,
            }}
          >
            READINESS
          </div>
        </div>

        {/* Three pillar bars: Sleep (recovery), Body, Load. Each row =
            label + score + filled bar. Bars match the page's pillar
            palette but use a single accent — the share render is a
            celebration, not a diagnostic, so we don't tier each bar. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: s ? 24 : 16,
            marginBottom: s ? 56 : 32,
          }}
        >
          <PillarBar label="Sleep" score={pillars.recovery} accent={palette.hero} story={s} />
          <PillarBar label="Body" score={pillars.body} accent={palette.hero} story={s} />
          <PillarBar label="Load" score={pillars.load} accent={palette.hero} story={s} />
        </div>

        {/* Optional caption — only renders if the user typed something.
            Kept under the pillars and above the watermark so the
            watermark still anchors the bottom on free tier. */}
        {trimmedCaption && (
          <div style={{ marginTop: "auto", marginBottom: s ? 100 : 60 }}>
            <div
              style={{
                fontSize: s ? 20 : 14,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: s ? 10 : 6,
              }}
            >
              ▸ TONIGHT
            </div>
            <div
              style={{
                fontSize: s ? 44 : 28,
                fontWeight: 700,
                color: "#ffffff",
                lineHeight: 1.2,
              }}
            >
              {trimmedCaption}
            </div>
          </div>
        )}

        {/* User handle for free tier — paired with the CardWatermark that
            CardShell already renders (centered, "Made with FightCamp
            Wizard"). The handle sits bottom-right so it doesn't fight
            with the centered watermark. Pro tier omits both. */}
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

ReadinessFlexCard.displayName = "ReadinessFlexCard";

// ── PillarBar ─────────────────────────────────────────────────────────
// Label / numeric / filled bar — sized for both story and square aspects
// because the parent decides aspect. Null score renders as "—" with an
// empty track so the layout doesn't collapse on a missing pillar.
interface PillarBarProps {
  label: string;
  score: number | null;
  accent: string;
  story: boolean;
}

function PillarBar({ label, score, accent, story }: PillarBarProps) {
  const display = score == null ? "—" : Math.round(score).toString();
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));

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
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: story ? 56 : 36,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color: "#ffffff",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {display}
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
            background: accent,
            borderRadius: story ? 6 : 4,
          }}
        />
      </div>
    </div>
  );
}
