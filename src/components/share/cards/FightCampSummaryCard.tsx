import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { StatBlock } from "../templates/StatBlock";
import { usePremium } from "@/hooks/usePremium";

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

interface FightCampSummaryCardProps {
  camp: FightCamp;
  aspect?: AspectRatio;
}

const GREEN = "#22c55e";
const ORANGE = "#f97316";

export const FightCampSummaryCard = forwardRef<HTMLDivElement, FightCampSummaryCardProps>(
  ({ camp, aspect = "square" }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    const start = camp.starting_weight_kg;
    const end = camp.end_weight_kg;
    const totalCut = start && end ? start - end : camp.total_weight_cut;
    const carbCut = camp.weight_via_carb_reduction ?? 0;
    const dehydrationCut = camp.weight_via_dehydration ?? 0;
    const breakdownTotal = carbCut + dehydrationCut;

    // Build weight journey data points for the line graph
    const points: { label: string; kg: number }[] = [];
    if (start) {
      points.push({ label: "Start", kg: start });
      if (breakdownTotal > 0 && carbCut > 0) {
        points.push({ label: "After Carbs", kg: start - carbCut });
      }
      if (end) {
        points.push({ label: "Weigh-In", kg: end });
      }
    }

    // SVG dimensions
    const chartW = s ? 960 : 960;
    const chartH = s ? 520 : 340;
    const padX = s ? 100 : 80;
    const padTop = s ? 60 : 40;
    const padBot = s ? 80 : 60;

    const plotW = chartW - padX * 2;
    const plotH = chartH - padTop - padBot;

    // Compute scale
    const values = points.map((p) => p.kg);
    const minV = values.length > 0 ? Math.min(...values) - 0.5 : 0;
    const maxV = values.length > 0 ? Math.max(...values) + 0.5 : 1;
    const range = maxV - minV || 1;

    const toX = (i: number) => padX + (plotW / Math.max(1, points.length - 1)) * i;
    const toY = (v: number) => padTop + plotH - ((v - minV) / range) * plotH;

    // Build colored segments: green for carb loss, orange for dehydration
    const segments: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    if (points.length >= 2) {
      for (let i = 0; i < points.length - 1; i++) {
        const isLast = i === points.length - 2;
        const color = !isLast ? GREEN : breakdownTotal > 0 && carbCut > 0 ? ORANGE : GREEN;
        // If only 2 points (no carb mid-point), and both breakdown types exist, still orange for dehydration
        // Actually: first segment = carb (green), second = dehydration (orange)
        // If no carb mid-point, the single segment covers the full cut
        let segColor = GREEN;
        if (points.length === 3) {
          segColor = i === 0 ? GREEN : ORANGE;
        } else if (points.length === 2 && breakdownTotal > 0) {
          // Only dehydration or only carbs
          segColor = carbCut > 0 && dehydrationCut === 0 ? GREEN : dehydrationCut > 0 && carbCut === 0 ? ORANGE : GREEN;
        }
        segments.push({
          x1: toX(i),
          y1: toY(points[i].kg),
          x2: toX(i + 1),
          y2: toY(points[i + 1].kg),
          color: segColor,
        });
      }
    }

    // Stacked bar data for breakdown
    const barW = s ? 200 : 160;
    const barH = s ? 380 : 240;
    const barX = chartW - padX - barW;
    const barPadTop = padTop;

    const carbPct = breakdownTotal > 0 ? carbCut / breakdownTotal : 0;
    const dehydPct = breakdownTotal > 0 ? dehydrationCut / breakdownTotal : 0;

    const fightDate = new Date(camp.fight_date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium}>
        {/* Header */}
        <div style={{ marginBottom: s ? 40 : 24 }}>
          <div
            style={{
              fontSize: s ? 18 : 14,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#2563eb",
              marginBottom: s ? 10 : 4,
            }}
          >
            FIGHT CAMP
          </div>
          <div style={{ fontSize: s ? 36 : 26, fontWeight: 800, letterSpacing: "-0.01em" }}>
            {camp.name}
          </div>
          <div style={{ fontSize: s ? 20 : 15, color: "rgba(255,255,255,0.45)", fontWeight: 500, marginTop: s ? 6 : 2 }}>
            {camp.event_name && <span style={{ color: "#60a5fa", fontWeight: 600 }}>{camp.event_name} &middot; </span>}
            {fightDate}
          </div>
        </div>

        {/* Hero total cut */}
        {totalCut != null && totalCut > 0 && (
          <div style={{ textAlign: "center", marginBottom: s ? 48 : 28 }}>
            <div
              style={{
                fontSize: s ? 112 : 72,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: GREEN,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              -{totalCut.toFixed(1)}
              <span style={{ fontSize: s ? 40 : 28, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>kg</span>
            </div>
            <div
              style={{
                fontSize: s ? 18 : 14,
                color: "rgba(255,255,255,0.45)",
                marginTop: s ? 14 : 8,
                fontWeight: 600,
                letterSpacing: "0.1em",
              }}
            >
              TOTAL WEIGHT CUT
            </div>
          </div>
        )}

        {/* Weight journey graph + stacked bar */}
        {points.length >= 2 && (
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: s ? 28 : 20,
              padding: s ? "24px 12px" : "16px 8px",
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: s ? 48 : 24,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <svg
              width={chartW}
              height={chartH}
              viewBox={`0 0 ${chartW} ${chartH}`}
              style={{ width: "100%", height: "auto" }}
            >
              {/* Horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                const y = padTop + plotH - t * plotH;
                const v = minV + t * range;
                return (
                  <g key={t}>
                    <line
                      x1={padX}
                      y1={y}
                      x2={chartW - padX}
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={1}
                    />
                    <text
                      x={padX - 16}
                      y={y + 5}
                      textAnchor="end"
                      fill="rgba(255,255,255,0.3)"
                      fontSize={s ? 22 : 18}
                      fontWeight={600}
                      fontFamily="Satoshi, system-ui, sans-serif"
                    >
                      {v.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* Colored line segments */}
              {segments.map((seg, i) => (
                <line
                  key={i}
                  x1={seg.x1}
                  y1={seg.y1}
                  x2={seg.x2}
                  y2={seg.y2}
                  stroke={seg.color}
                  strokeWidth={s ? 6 : 4}
                  strokeLinecap="round"
                />
              ))}

              {/* Gradient fill under line: green to orange */}
              {points.length >= 2 && (
                <>
                  <defs>
                    <linearGradient id="campFill" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={GREEN} stopOpacity={0.15} />
                      <stop offset="100%" stopColor={segments.length > 1 ? ORANGE : GREEN} stopOpacity={0.15} />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M${toX(0)},${toY(points[0].kg)} ${points.map((p, i) => `L${toX(i)},${toY(p.kg)}`).join(" ")} L${toX(points.length - 1)},${padTop + plotH} L${toX(0)},${padTop + plotH} Z`}
                    fill="url(#campFill)"
                  />
                </>
              )}

              {/* Data points */}
              {points.map((p, i) => {
                const x = toX(i);
                const y = toY(p.kg);
                const dotColor = i === 0 ? "#ffffff" : i === points.length - 1 && segments.length > 1 ? ORANGE : GREEN;
                return (
                  <g key={i}>
                    <circle cx={x} cy={y} r={s ? 12 : 8} fill={dotColor} />
                    <circle cx={x} cy={y} r={s ? 6 : 4} fill="#0a0a0a" />
                    {/* Value label */}
                    <text
                      x={x}
                      y={y - (s ? 24 : 16)}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={s ? 26 : 20}
                      fontWeight={700}
                      fontFamily="Satoshi, system-ui, sans-serif"
                    >
                      {p.kg.toFixed(1)}
                    </text>
                    {/* Bottom label */}
                    <text
                      x={x}
                      y={padTop + plotH + (s ? 40 : 30)}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.4)"
                      fontSize={s ? 20 : 16}
                      fontWeight={600}
                      fontFamily="Satoshi, system-ui, sans-serif"
                    >
                      {p.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Breakdown bar: horizontal stacked */}
        {breakdownTotal > 0 && (
          <div
            style={{
              marginBottom: s ? 48 : 24,
            }}
          >
            {/* Bar */}
            <div
              style={{
                display: "flex",
                height: s ? 48 : 32,
                borderRadius: s ? 16 : 12,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {carbCut > 0 && (
                <div
                  style={{
                    width: `${carbPct * 100}%`,
                    background: GREEN,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: s ? 20 : 14,
                      fontWeight: 700,
                      color: "#000",
                    }}
                  >
                    {carbCut.toFixed(1)}kg
                  </span>
                </div>
              )}
              {dehydrationCut > 0 && (
                <div
                  style={{
                    width: `${dehydPct * 100}%`,
                    background: ORANGE,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: s ? 20 : 14,
                      fontWeight: 700,
                      color: "#000",
                    }}
                  >
                    {dehydrationCut.toFixed(1)}kg
                  </span>
                </div>
              )}
            </div>
            {/* Legend */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: s ? 40 : 24,
                marginTop: s ? 18 : 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: s ? 10 : 8 }}>
                <div
                  style={{
                    width: s ? 14 : 10,
                    height: s ? 14 : 10,
                    borderRadius: s ? 4 : 3,
                    background: GREEN,
                  }}
                />
                <span
                  style={{
                    fontSize: s ? 18 : 13,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  Carb Reduction
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: s ? 10 : 8 }}>
                <div
                  style={{
                    width: s ? 14 : 10,
                    height: s ? 14 : 10,
                    borderRadius: s ? 4 : 3,
                    background: ORANGE,
                  }}
                />
                <span
                  style={{
                    fontSize: s ? 18 : 13,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  Dehydration
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Stat blocks */}
        <div style={{ display: "grid", gridTemplateColumns: s ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: s ? 16 : 12 }}>
          <StatBlock label="Start" value={start?.toFixed(1) ?? "-"} unit="kg" size={s ? "large" : "default"} />
          <StatBlock label="Weigh-In" value={end?.toFixed(1) ?? "-"} unit="kg" size={s ? "large" : "default"} />
          <StatBlock
            label="Carb Cut"
            value={carbCut > 0 ? carbCut.toFixed(1) : "-"}
            unit="kg"
            color={GREEN}
            size={s ? "large" : "default"}
          />
          <StatBlock
            label="Dehydration"
            value={dehydrationCut > 0 ? dehydrationCut.toFixed(1) : "-"}
            unit="kg"
            color={ORANGE}
            size={s ? "large" : "default"}
          />
        </div>
      </CardShell>
    );
  }
);

FightCampSummaryCard.displayName = "FightCampSummaryCard";
