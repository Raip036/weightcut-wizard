import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";
import type { FightFormLabel, ScoringPhase, SubScore, SubScoreKey } from "@/scoring/types";

interface FightFormScoreCardProps {
  score: number;
  label: FightFormLabel;
  phase: ScoringPhase | null;
  daysToFight: number | null;
  /** Retained for call-site compatibility; the card no longer renders a camp
   *  pace footer. */
  campAge?: { weeksAhead: number } | null;
  subScores: Record<SubScoreKey, SubScore> | null;
  /** Camp name shown in the top banner, e.g. "FightZumi". Optional. */
  campName?: string;
  aspect?: AspectRatio;
  transparent?: boolean;
}

const LABEL_DISPLAY: Record<FightFormLabel, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

// Status color for the ring arc, label, bars + value numbers. Mirrors the
// dashboard hero ring so a screenshot recipient sees the same emotional
// palette they'd see in-app. Keep in sync with FightFormRing.LABEL_RGB.
const LABEL_COLOR: Record<FightFormLabel, string> = {
  sharp: "#10B981",       // emerald-500
  sharpening: "#FBBF24",  // amber-400
  off_pace: "#F97316",    // orange-500
  at_risk: "#F43F5E",     // rose-500
};

// `wellness` is the user-facing "Recovery" pillar, driven by the check-in.
const SUBSCORE_LABEL: Record<SubScoreKey, string> = {
  trainingLoad: "Training",
  sleep: "Sleep",
  weightCut: "Weight Cut",
  wellness: "Recovery",
  nutritionAdherence: "Nutrition",
};

const PHASE_DISPLAY: Record<ScoringPhase, string> = {
  build: "Build phase",
  peak: "Peak phase",
  fightWeek: "Fight week",
};

// Premium accent for the ambient aura + phase sub-line. Dream-cyan blue, reads
// premium on the near-black base (the house blue, per the aurora style guide).
const BLUE = "#4AB4ED";

function topBannerText(campName: string | undefined, daysToFight: number | null, phase: ScoringPhase | null): string {
  const days = daysToFight != null && daysToFight > 0 ? `${daysToFight} DAYS TO WEIGH-IN` : null;
  if (campName && days) return `${campName.toUpperCase()} · ${days}`;
  if (campName) return campName.toUpperCase();
  if (days) return days;
  return phase ? PHASE_DISPLAY[phase].toUpperCase() : "FIGHT FORM SCORE";
}

/** "#RRGGBB" + alpha (0..1) → "rgba(r,g,b,a)". */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Premium gauge ring: status-colored gradient arc + rounded cap + a soft status
// glow behind it (CSS radial, not an SVG filter, so html-to-image captures it
// cleanly). No animation — capture must be deterministic.
function RefinedRing({
  score,
  color,
  diameter,
  stroke,
  gradientId,
}: {
  score: number;
  color: string;
  diameter: number;
  stroke: number;
  gradientId: string;
}) {
  const radius = (diameter - stroke) / 2;
  const cx = diameter / 2;
  const cy = diameter / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, score / 100));
  const dash = circumference * progress;

  return (
    <div style={{ position: "relative", width: diameter, height: diameter, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          inset: "6%",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${hexA(color, 0.3)} 0%, ${hexA(color, 0.08)} 46%, transparent 70%)`,
        }}
      />
      <svg width={diameter} height={diameter} style={{ transform: "rotate(-90deg)", position: "relative" }}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="55%" stopColor={color} stopOpacity={0.9} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={radius} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
    </div>
  );
}

// ~40 short radial tick marks just inside the hero ring. Hairline white; every
// 5th tick brighter + longer. Static SVG (no animation, no filters) so
// html-to-image captures it cleanly.
function TickRing({ diameter, stroke, gap }: { diameter: number; stroke: number; gap: number }) {
  const cx = diameter / 2;
  const cy = diameter / 2;
  const ringRadius = (diameter - stroke) / 2;
  const outerR = ringRadius - stroke / 2 - gap;
  const TICK_COUNT = 40;
  const minorLen = stroke * 0.38;
  const majorLen = stroke * 0.7;

  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const isMajor = i % 5 === 0;
    const angle = (i / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
    const len = isMajor ? majorLen : minorLen;
    const innerR = outerR - len;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      key: i,
      x1: cx + cos * outerR,
      y1: cy + sin * outerR,
      x2: cx + cos * innerR,
      y2: cy + sin * innerR,
      stroke: isMajor ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.12)",
      width: isMajor ? 2.5 : 1.5,
    };
  });

  return (
    <svg width={diameter} height={diameter} style={{ position: "absolute", top: 0, left: 0 }}>
      {ticks.map((t) => (
        <line key={t.key} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.stroke} strokeWidth={t.width} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export const FightFormScoreCard = forwardRef<HTMLDivElement, FightFormScoreCardProps>(
  ({ score, label, phase, daysToFight, subScores, campName, aspect = "story", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";
    const accent = LABEL_COLOR[label];

    // Sort subscores by impact (value × weight) so the strongest signals
    // appear first, matching the bottom-sheet order users see in-app.
    // Paused sub-scores (weight === 0) naturally sink to the bottom.
    const sortedSubs = subScores
      ? (Object.entries(subScores) as Array<[SubScoreKey, SubScore]>)
          .sort(([, a], [, b]) => b.value * b.weight - a.value * a.weight)
      : [];

    const ringDiameter = s ? 680 : 460;
    const ringStroke = s ? 34 : 24;
    const scoreSize = s ? 300 : 200;
    const labelSize = s ? 50 : 34;
    const MUTED = "rgba(255,255,255,0.5)";
    const SEGMENTS = 10;

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Banner: camp · days-to-weigh-in. */}
          <div
            style={{
              textAlign: "center",
              fontSize: s ? 30 : 19,
              fontWeight: 800,
              letterSpacing: "0.05em",
              color: "#ffffff",
              marginBottom: s ? 6 : 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {topBannerText(campName, daysToFight, phase)}
          </div>
          {/* Phase sub-line. */}
          <div
            style={{
              textAlign: "center",
              fontSize: s ? 19 : 12,
              fontWeight: 600,
              letterSpacing: "0.18em",
              color: hexA(BLUE, 0.85),
              marginBottom: s ? 18 : 10,
              textTransform: "uppercase",
            }}
          >
            {phase ? PHASE_DISPLAY[phase] : "Fight Form Score"}
          </div>

          {/* Hero gauge: refined ring + inline tick-mark dial + giant center number. */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              position: "relative",
              marginBottom: s ? 30 : 16,
            }}
          >
            {/* Ambient blue aura behind the whole gauge. */}
            <div
              style={{
                position: "absolute",
                width: ringDiameter * 1.25,
                height: ringDiameter * 1.25,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${hexA(BLUE, 0.18)} 0%, ${hexA(BLUE, 0.05)} 45%, transparent 70%)`,
              }}
            />
            <div style={{ position: "relative", width: ringDiameter, height: ringDiameter }}>
              <RefinedRing score={score} color={accent} diameter={ringDiameter} stroke={ringStroke} gradientId="ff-ring-grad" />
              <TickRing diameter={ringDiameter} stroke={ringStroke} gap={s ? 16 : 11} />
              {/* Center readout. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: s ? 6 : 4,
                }}
              >
                <div
                  style={{
                    fontSize: scoreSize,
                    fontWeight: 900,
                    lineHeight: 0.92,
                    letterSpacing: "-0.05em",
                    color: "#ffffff",
                    fontVariantNumeric: "tabular-nums",
                    textShadow: `0 0 ${s ? 70 : 46}px ${hexA(accent, 0.4)}`,
                  }}
                >
                  {Math.round(score)}
                </div>
                <div
                  style={{
                    fontSize: labelSize,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    color: accent,
                    textTransform: "uppercase",
                  }}
                >
                  {LABEL_DISPLAY[label]}
                </div>
              </div>
            </div>
          </div>

          {/* Pillars — all 5 as big instrument rows, FLOATING (no box). Flexes
              to FILL the lower half so the segmented bars are the dominant
              element. */}
          {sortedSubs.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                justifyContent: "space-between",
                gap: s ? 20 : 12,
                paddingTop: s ? 8 : 4,
              }}
            >
              {sortedSubs.map(([key, sub]) => {
                const isPaused = sub.weight === 0;
                const pct = Math.max(0, Math.min(100, sub.value));
                const filled = isPaused ? 0 : Math.round(pct / 10);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: s ? 16 : 9,
                      flex: 1,
                      justifyContent: "center",
                      opacity: isPaused ? 0.35 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <span style={{ fontSize: s ? 34 : 19, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>
                        {SUBSCORE_LABEL[key]}
                      </span>
                      <span
                        style={{
                          fontSize: s ? 44 : 26,
                          fontWeight: 900,
                          color: isPaused ? MUTED : accent,
                          fontVariantNumeric: "tabular-nums",
                          lineHeight: 1,
                        }}
                      >
                        {isPaused ? "PAUSED" : Math.round(pct)}
                      </span>
                    </div>
                    {/* Big segmented instrument bar — full width, chunky. */}
                    <div style={{ display: "flex", gap: s ? 8 : 4 }}>
                      {Array.from({ length: SEGMENTS }, (_, i) => (
                        <div
                          key={i}
                          style={{
                            flex: 1,
                            height: s ? 38 : 22,
                            borderRadius: s ? 10 : 6,
                            background:
                              i < filled
                                ? `linear-gradient(180deg, ${hexA(accent, 0.85)} 0%, ${accent} 100%)`
                                : "rgba(255,255,255,0.07)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardShell>
    );
  },
);

FightFormScoreCard.displayName = "FightFormScoreCard";
