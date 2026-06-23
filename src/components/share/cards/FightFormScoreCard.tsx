import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";
import type { FightFormLabel, ScoringPhase, SubScore, SubScoreKey } from "@/scoring/types";

interface FightFormScoreCardProps {
  score: number;
  label: FightFormLabel;
  phase: ScoringPhase | null;
  daysToFight: number | null;
  campAge: { weeksAhead: number } | null;
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

// Color tokens for the label and ring stroke. Mirrors the dashboard hero
// ring so a screenshot recipient sees the same emotional palette they'd see
// in-app. Keep these in sync with FightFormRing.LABEL_RGB.
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

function phaseSubLine(phase: ScoringPhase | null): string {
  if (!phase) return "Fight Form Score";
  return PHASE_DISPLAY[phase];
}

function topBannerText(campName: string | undefined, daysToFight: number | null, phase: ScoringPhase | null): string {
  const days = daysToFight != null && daysToFight > 0
    ? `${daysToFight} DAYS TO WEIGH-IN`
    : null;
  if (campName && days) return `${campName.toUpperCase()} · ${days}`;
  if (campName) return campName.toUpperCase();
  if (days) return days;
  // Final fallback: existing phase line
  return phase ? PHASE_DISPLAY[phase].toUpperCase() : "FIGHT FORM SCORE";
}

function campPaceLine(campAge: { weeksAhead: number } | null): string | null {
  if (!campAge) return null;
  if (campAge.weeksAhead === 0) return "On schedule";
  const n = Math.abs(campAge.weeksAhead);
  const unit = n === 1 ? "week" : "weeks";
  return campAge.weeksAhead > 0
    ? `${n} ${unit} ahead of schedule`
    : `${n} ${unit} behind schedule`;
}

// Inline SVG ring renderer matching FightFormRing's visual proportions but
// blown up to share-card scale. No animation: capture must be deterministic.
function ShareRing({
  score,
  color,
  diameter,
  stroke,
}: {
  score: number;
  color: string;
  diameter: number;
  stroke: number;
}) {
  const radius = (diameter - stroke) / 2;
  const cx = diameter / 2;
  const cy = diameter / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, score / 100));
  const dash = circumference * progress;
  // Strava-black: hairline white track regardless of transparent variant.
  const trackColor = "rgba(255,255,255,0.08)";

  return (
    <svg
      width={diameter}
      height={diameter}
      style={{ transform: "rotate(-90deg)" }}
    >
      <circle cx={cx} cy={cy} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
      />
    </svg>
  );
}

export const FightFormScoreCard = forwardRef<HTMLDivElement, FightFormScoreCardProps>(
  ({ score, label, phase, daysToFight, campAge, subScores, campName, aspect = "square", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";
    const labelColor = LABEL_COLOR[label];

    // Sort subscores by impact (value × weight) so the strongest signals
    // appear first, matching the bottom-sheet order users see in-app.
    // Paused sub-scores (weight === 0) naturally sink to the bottom.
    const sortedSubs = subScores
      ? (Object.entries(subScores) as Array<[SubScoreKey, SubScore]>)
          .sort(([, a], [, b]) => b.value * b.weight - a.value * a.weight)
      : [];

    const ringDiameter = s ? 720 : 480;
    const ringStroke = s ? 40 : 28;
    const scoreSize = s ? 240 : 160;
    const labelSize = s ? 56 : 36;

    // Strava-black hairlines + muted tokens.
    const HAIRLINE = "rgba(255,255,255,0.08)";
    const MUTED = "rgba(255,255,255,0.5)";

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Top banner: camp · days-to-weigh-in (bold, prominent). */}
          <div
            style={{
              textAlign: "center",
              fontSize: s ? 32 : 20,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "#ffffff",
              marginBottom: s ? 8 : 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {topBannerText(campName, daysToFight, phase)}
          </div>
          {/* Phase sub-line: smaller, muted, sits directly under the banner. */}
          <div
            style={{
              textAlign: "center",
              fontSize: s ? 20 : 12,
              fontWeight: 500,
              letterSpacing: "0.04em",
              color: MUTED,
              marginBottom: s ? 24 : 12,
              textTransform: "uppercase",
            }}
          >
            {phaseSubLine(phase)}
          </div>

          {/* Hero ring: centered, with score + label stacked inside. */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", position: "relative", marginBottom: s ? 28 : 14 }}>
            <ShareRing
              score={score}
              color={labelColor}
              diameter={ringDiameter}
              stroke={ringStroke}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: s ? 16 : 10,
              }}
            >
              <div
                style={{
                  fontSize: scoreSize,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  color: "#ffffff",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(score)}
              </div>
              <div
                style={{
                  fontSize: labelSize,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: labelColor,
                  textTransform: "uppercase",
                }}
              >
                {LABEL_DISPLAY[label]}
              </div>
              {/* "Fight Form Score" caption removed; banner above handles context. */}
            </div>
          </div>

          {/* Sub-score strip: five compact rows so the recipient sees the
              full breakdown, not just the headline number. */}
          {sortedSubs.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: s ? 18 : 10,
                background: "#0a0a0a",
                border: `1px solid ${HAIRLINE}`,
                borderRadius: s ? 20 : 12,
                padding: s ? "28px 34px" : "14px 18px",
                marginBottom: s ? 32 : 14,
              }}
            >
              {sortedSubs.map(([key, sub]) => {
                const isPaused = sub.weight === 0;
                const pct = Math.max(0, Math.min(100, sub.value));
                const rowOpacity = isPaused ? 0.35 : 1;

                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: s ? 8 : 4,
                      opacity: rowOpacity,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span
                        style={{
                          fontSize: s ? 26 : 16,
                          fontWeight: 700,
                          color: "#ffffff",
                        }}
                      >
                        {SUBSCORE_LABEL[key]}
                      </span>
                      {isPaused ? (
                        <span
                          style={{
                            fontSize: s ? 18 : 11,
                            fontWeight: 700,
                            letterSpacing: "0.1em",
                            color: MUTED,
                            textTransform: "uppercase",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          PAUSED
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: s ? 28 : 17,
                            fontWeight: 800,
                            color: labelColor,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {Math.round(pct)}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        height: s ? 8 : 5,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: isPaused ? "0%" : `${pct}%`,
                          borderRadius: 999,
                          background: labelColor,
                        }}
                      />
                    </div>
                    {sub.reason && (
                      <div
                        style={{
                          fontSize: s ? 18 : 11,
                          color: "rgba(255,255,255,0.45)",
                          marginTop: s ? 6 : 3,
                          letterSpacing: "0.02em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {sub.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Camp pace footer (if available). */}
          {campPaceLine(campAge) && (
            <div
              style={{
                textAlign: "center",
                fontSize: s ? 22 : 14,
                fontWeight: 500,
                color: MUTED,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Camp pace · {campPaceLine(campAge)}
            </div>
          )}
        </div>
      </CardShell>
    );
  },
);

FightFormScoreCard.displayName = "FightFormScoreCard";
