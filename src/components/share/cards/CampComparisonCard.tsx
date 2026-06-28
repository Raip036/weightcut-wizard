import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";

// House share-card tokens. GREEN = the win (bigger cut); BLUE = supporting
// accent (sweat segment + labels).
const BLUE = "#4AB4ED";
const GREEN = "#34D399";

interface FightCamp {
  id: string;
  name: string;
  event_name: string | null;
  fight_date: string;
  starting_weight_kg: number | null;
  end_weight_kg: number | null;
  total_weight_cut: number | null;
  weight_via_dehydration: number | null;
  weight_via_carb_reduction: number | null;
}

interface CampComparisonCardProps {
  campA: FightCamp;
  campB: FightCamp;
  aspect?: AspectRatio;
  transparent?: boolean;
}

const num = (v: number | null | undefined) => (v != null ? v.toFixed(1) : "-");

/** "#RRGGBB" + alpha (0..1) → "rgba(r,g,b,a)". */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** A floating vertical cut-composition bar: diet (green) over sweat (blue). */
function CutBar({
  carb,
  dehydration,
  width,
  height,
  winner,
}: {
  carb: number;
  dehydration: number;
  width: number;
  height: number;
  winner: boolean;
}) {
  const total = carb + dehydration || 1;
  const carbH = (carb / total) * height;
  const dehydH = height - carbH;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: width * 0.22,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        opacity: winner ? 1 : 0.5,
        boxShadow: winner ? `0 0 60px ${hexA(GREEN, 0.25)}` : "none",
      }}
    >
      <div style={{ height: carbH, background: `linear-gradient(180deg, ${hexA(GREEN, 0.85)} 0%, ${GREEN} 100%)` }} />
      <div style={{ height: dehydH, background: `linear-gradient(180deg, ${hexA(BLUE, 0.85)} 0%, ${BLUE} 100%)` }} />
    </div>
  );
}

export const CampComparisonCard = forwardRef<HTMLDivElement, CampComparisonCardProps>(
  ({ campA, campB, aspect = "story", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";
    const cutA = campA.total_weight_cut ?? 0;
    const cutB = campB.total_weight_cut ?? 0;
    const aWins = cutA > cutB;
    const bWins = cutB > cutA;
    const colA = aWins ? GREEN : "#ffffff";
    const colB = bWins ? GREEN : "#ffffff";

    const barW = s ? 150 : 82;
    const barH = s ? 620 : 340;

    const Row = ({ label, a, b }: { label: string; a: string; b: string }) => (
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline", gap: s ? 20 : 12 }}>
        <span style={{ textAlign: "right", fontSize: s ? 62 : 38, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
          {a}<span style={{ fontSize: s ? 26 : 16, fontWeight: 800, color: "rgba(255,255,255,0.4)", marginLeft: 3 }}>kg</span>
        </span>
        <span style={{ textAlign: "center", minWidth: s ? 200 : 120, fontSize: s ? 24 : 14, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: hexA(BLUE, 0.85) }}>{label}</span>
        <span style={{ textAlign: "left", fontSize: s ? 62 : 38, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
          {b}<span style={{ fontSize: s ? 26 : 16, fontWeight: 800, color: "rgba(255,255,255,0.4)", marginLeft: 3 }}>kg</span>
        </span>
      </div>
    );

    const Name = ({ camp, color, align }: { camp: FightCamp; color: string; align: "right" | "left" }) => (
      <div style={{ flex: 1, minWidth: 0, textAlign: align }}>
        <div style={{ fontSize: s ? 58 : 36, fontWeight: 900, color, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.name}</div>
      </div>
    );

    const BarStack = ({ camp, win, col }: { camp: FightCamp; win: boolean; col: string }) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 18 : 10 }}>
        <span style={{ fontSize: s ? 28 : 17, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
          {num(camp.starting_weight_kg)}
        </span>
        <CutBar
          carb={camp.weight_via_carb_reduction ?? 0}
          dehydration={camp.weight_via_dehydration ?? 0}
          width={barW}
          height={barH}
          winner={win}
        />
        <span style={{ fontSize: s ? 28 : 17, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums" }}>
          {num(camp.end_weight_kg)}
        </span>
        <span style={{ fontSize: s ? 96 : 56, fontWeight: 900, color: col, lineHeight: 0.9, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", textShadow: win ? `0 0 ${s ? 56 : 32}px ${hexA(GREEN, 0.4)}` : "none" }}>
          {num(camp.total_weight_cut)}
          <span style={{ fontSize: s ? 38 : 22, fontWeight: 800, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>kg</span>
        </span>
      </div>
    );

    const Swatch = ({ color, label }: { color: string; label: string }) => (
      <div style={{ display: "flex", alignItems: "center", gap: s ? 12 : 7 }}>
        <span style={{ width: s ? 24 : 14, height: s ? 24 : 14, borderRadius: s ? 7 : 4, background: hexA(color, 0.9), flexShrink: 0 }} />
        <span style={{ fontSize: s ? 22 : 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{label}</span>
      </div>
    );

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center", gap: s ? 48 : 28 }}>
          {/* Camp names + VS */}
          <div style={{ display: "flex", alignItems: "center", gap: s ? 16 : 10 }}>
            <Name camp={campA} color={colA} align="right" />
            <span style={{ flexShrink: 0, fontSize: s ? 32 : 20, fontWeight: 900, color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em" }}>VS</span>
            <Name camp={campB} color={colB} align="left" />
          </div>

          {/* Hero: bars + legend + comparison rows grouped tight. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 26 : 15 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: s ? 64 : 34 }}>
              <BarStack camp={campA} win={aWins} col={colA} />
              <span style={{ flexShrink: 0, fontSize: s ? 40 : 24, fontWeight: 800, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em", alignSelf: "center" }}>VS</span>
              <BarStack camp={campB} win={bWins} col={colB} />
            </div>

            {/* Floating legend (no box). */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: s ? 40 : 22 }}>
              <Swatch color={GREEN} label="Diet" />
              <Swatch color={BLUE} label="Sweat" />
            </div>

            {/* Floating comparison rows — close under the bars. */}
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: s ? 22 : 13, marginTop: s ? 10 : 6 }}>
              <Row label="Sweat" a={num(campA.weight_via_dehydration)} b={num(campB.weight_via_dehydration)} />
              <Row label="Diet" a={num(campA.weight_via_carb_reduction)} b={num(campB.weight_via_carb_reduction)} />
              <Row label="Start" a={num(campA.starting_weight_kg)} b={num(campB.starting_weight_kg)} />
            </div>
          </div>
        </div>
      </CardShell>
    );
  }
);

CampComparisonCard.displayName = "CampComparisonCard";
