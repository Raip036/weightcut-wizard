import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";
import wizard from "@/assets/wizard_3D.png";

interface FightCamp {
  name: string;
  event_name: string | null;
  fight_date: string;
  starting_weight_kg: number | null;
  end_weight_kg: number | null;
  total_weight_cut: number | null;
  weight_via_dehydration: number | null;
  weight_via_carb_reduction: number | null;
  weigh_in_timing: string | null;
  performance_feeling: string | null;
}

/** Live, camp-scoped extras surfaced on the card. All optional / defensive. */
export interface FightCampShareStats {
  topDiscipline?: { sport: string; level: number } | null;
  masteredCount?: number;
  sessions?: number;
  hours?: number;
}

interface FightCampSummaryCardProps {
  camp: FightCamp;
  aspect?: AspectRatio;
  stats?: FightCampShareStats;
  /** Weeks of camp (creation → fight date). */
  weeks?: number;
}

// Brand: weight loss stays GREEN (the headline achievement); everything else
// rides the blue wizard aura from CardShell.
const GREEN = "#34d399";
const BLUE = "#60a5fa";

export const FightCampSummaryCard = forwardRef<HTMLDivElement, FightCampSummaryCardProps>(
  ({ camp, aspect = "story", stats, weeks }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    const start = camp.starting_weight_kg;
    const end = camp.end_weight_kg;
    const totalCut = start && end ? start - end : camp.total_weight_cut;
    const kgCut = totalCut != null && totalCut > 0 ? +totalCut.toFixed(1) : null;
    const lbCut = kgCut != null ? +(kgCut * 2.20462).toFixed(1) : null;

    const top = stats?.topDiscipline ?? null;
    const dash = (v: string | number | null | undefined) =>
      v === null || v === undefined || v === "" ? "—" : v;

    // The four engagement boxes (2×2). Order chosen for impact.
    const boxes: { v: string | number; l: string; c: string }[] = [
      { v: top ? `${top.sport} Lv${top.level}` : "—", l: "Top discipline", c: BLUE },
      { v: dash(stats?.masteredCount), l: "Techniques mastered", c: BLUE },
      { v: dash(stats?.sessions), l: "Sessions logged", c: "#fff" },
      { v: stats?.hours != null ? `${stats.hours}h` : "—", l: "On the mats", c: "#fff" },
    ];

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          {/* Eyebrow + camp name */}
          <div
            style={{
              fontSize: s ? 24 : 16,
              fontWeight: 800,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: BLUE,
            }}
          >
            Camp Complete
          </div>
          <div style={{ fontSize: s ? 52 : 34, fontWeight: 900, letterSpacing: "-0.02em", marginTop: s ? 12 : 6, lineHeight: 1.02 }}>
            {camp.name}
          </div>

          {/* Mascot hero with static blue glow */}
          <div style={{ position: "relative", width: s ? 300 : 180, height: s ? 300 : 180, marginTop: s ? 24 : 12 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle, rgba(96,165,250,0.38) 0%, rgba(96,165,250,0.10) 42%, transparent 70%)",
              }}
            />
            <img
              src={wizard}
              alt=""
              style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>

          {/* Hero weight number */}
          {kgCut != null ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <span
                  style={{
                    fontSize: s ? 168 : 104,
                    fontWeight: 900,
                    letterSpacing: "-0.04em",
                    lineHeight: 0.82,
                    color: GREEN,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {kgCut}
                </span>
                <span style={{ fontSize: s ? 44 : 28, fontWeight: 900, color: GREEN, marginTop: s ? 14 : 8, marginLeft: 6 }}>
                  kg
                </span>
              </div>
              {/* Spacing between the number and the down/lb line. */}
              <div
                style={{
                  fontSize: s ? 22 : 14,
                  fontWeight: 700,
                  letterSpacing: "0.26em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.55)",
                  marginTop: s ? 28 : 16,
                }}
              >
                down{lbCut != null ? ` · ${lbCut} lb` : ""}{weeks ? ` · ${weeks} weeks` : ""}
              </div>
            </>
          ) : (
            <div style={{ fontSize: s ? 40 : 26, fontWeight: 800, color: "rgba(255,255,255,0.7)", marginTop: s ? 20 : 12 }}>
              {camp.name}
            </div>
          )}

          {/* 2×2 engagement grid — all text centred */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: s ? 20 : 12,
              width: "100%",
              marginTop: s ? 44 : 24,
            }}
          >
            {boxes.map((b) => (
              <div
                key={b.l}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: s ? 28 : 18,
                  padding: s ? "28px 16px" : "18px 12px",
                }}
              >
                <span style={{ fontSize: s ? 44 : 26, fontWeight: 900, color: b.c, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {b.v}
                </span>
                <span
                  style={{
                    fontSize: s ? 18 : 11,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.5)",
                    marginTop: s ? 12 : 7,
                  }}
                >
                  {b.l}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardShell>
    );
  }
);

FightCampSummaryCard.displayName = "FightCampSummaryCard";
