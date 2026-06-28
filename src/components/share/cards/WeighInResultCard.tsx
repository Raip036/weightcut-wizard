import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";

interface WeighInResultCardProps {
  startWeight: number;
  endWeight: number;
  targetWeight: number;
  aspect?: AspectRatio;
  transparent?: boolean;
}

// House share-card tokens. GREEN is reserved for the made-weight achievement
// (Trophy Hero rule); BLUE is the supporting accent; AMBER is the dignified
// "missed weight" tone (not an alarm red).
const BLUE = "#4AB4ED";
const GREEN = "#34D399";
const AMBER = "#FBBF24";

/** "#RRGGBB" + alpha (0..1) → "rgba(r,g,b,a)". */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Inline check glyph (no emoji, no icon font — capture-safe vector). */
function CheckMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path d="M5 12.5L10 17.5L19 7" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const WeighInResultCard = forwardRef<HTMLDivElement, WeighInResultCardProps>(
  ({ startWeight, endWeight, targetWeight, aspect = "story", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";
    const made = endWeight <= targetWeight;
    const accent = made ? GREEN : AMBER;
    const delta = startWeight - endWeight;
    const deltaPct = startWeight > 0 ? (delta / startWeight) * 100 : 0;
    const over = endWeight - targetWeight;

    const StravaStat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 12 : 7 }}>
        <span style={{ fontSize: s ? 30 : 17, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: hexA(BLUE, 0.85) }}>
          {label}
        </span>
        <span style={{ fontSize: s ? 150 : 90, fontWeight: 900, color: "#fff", lineHeight: 0.9, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>
          {value}
          {unit && <span style={{ fontSize: s ? 60 : 36, fontWeight: 800, color: "rgba(255,255,255,0.45)", marginLeft: 6 }}>{unit}</span>}
        </span>
      </div>
    );

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center", justifyContent: "center", gap: s ? 60 : 36 }}>
          {/* Hero unit: giant weigh-in number + achievement label. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 14 : 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                color: accent,
                fontWeight: 900,
                letterSpacing: "-0.05em",
                lineHeight: 0.9,
                textShadow: `0 0 ${s ? 80 : 50}px ${hexA(accent, 0.45)}`,
              }}
            >
              <span style={{ fontSize: s ? 320 : 210, fontVariantNumeric: "tabular-nums" }}>{endWeight.toFixed(1)}</span>
              <span style={{ fontSize: s ? 88 : 56, marginTop: s ? 36 : 22, marginLeft: s ? 10 : 6 }}>kg</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: s ? 16 : 10 }}>
              {made && <CheckMark size={s ? 52 : 32} color={GREEN} />}
              <span style={{ fontSize: s ? 50 : 32, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: accent }}>
                {made ? "Made Weight" : `${over.toFixed(1)} kg over`}
              </span>
            </div>
          </div>

          {/* Floating stats — no boxes. */}
          <div style={{ display: "flex", justifyContent: "center", gap: s ? 120 : 70 }}>
            <StravaStat label="Total cut" value={`-${delta.toFixed(1)}`} unit="kg" />
            <StravaStat label="Bodyweight" value={deltaPct.toFixed(1)} unit="%" />
          </div>
        </div>
      </CardShell>
    );
  }
);

WeighInResultCard.displayName = "WeighInResultCard";
