import { forwardRef, useMemo } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";

const GREEN = "#22c55e";
const ORANGE = "#f97316";

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
}

function ComparisonRow({
  label,
  valueA,
  valueB,
  unit,
  higherIsBetter = false,
  large = false,
}: {
  label: string;
  valueA: string | number | null;
  valueB: string | number | null;
  unit?: string;
  higherIsBetter?: boolean;
  large?: boolean;
}) {
  const numA = typeof valueA === "number" ? valueA : null;
  const numB = typeof valueB === "number" ? valueB : null;
  const dispA = valueA !== null && valueA !== undefined ? `${valueA}${unit ?? ""}` : "-";
  const dispB = valueB !== null && valueB !== undefined ? `${valueB}${unit ?? ""}` : "-";

  let colorA = "#ffffff";
  let colorB = "#ffffff";
  if (numA !== null && numB !== null && numA !== numB) {
    const aWins = higherIsBetter ? numA > numB : numA < numB;
    colorA = aWins ? "#22c55e" : "#ef4444";
    colorB = aWins ? "#ef4444" : "#22c55e";
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        gap: large ? 24 : 16,
        alignItems: "center",
        padding: large ? "24px 0" : "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={{ textAlign: "right", fontSize: large ? 32 : 22, fontWeight: 700, color: colorA, fontVariantNumeric: "tabular-nums" }}>
        {dispA}
      </div>
      <div
        style={{
          fontSize: large ? 14 : 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.4)",
          textAlign: "center",
          minWidth: large ? 100 : 80,
        }}
      >
        {label}
      </div>
      <div style={{ textAlign: "left", fontSize: large ? 32 : 22, fontWeight: 700, color: colorB, fontVariantNumeric: "tabular-nums" }}>
        {dispB}
      </div>
    </div>
  );
}

function CampWaterfall({
  camp,
  large,
  width,
  height,
}: {
  camp: FightCamp;
  large: boolean;
  width: number;
  height: number;
}) {
  const start = camp.starting_weight_kg;
  const end = camp.end_weight_kg;
  const carb = camp.weight_via_carb_reduction ?? 0;
  const dehydration = camp.weight_via_dehydration ?? 0;

  if (!start || !end || start <= end) return null;

  const totalCut = start - end;
  const hasBreakdown = carb + dehydration > 0;

  // Normalise breakdown to match actual cut (in case they don't add up perfectly)
  const breakdownSum = carb + dehydration;
  const carbNorm = hasBreakdown ? (carb / breakdownSum) * totalCut : 0;
  const dehydNorm = hasBreakdown ? (dehydration / breakdownSum) * totalCut : 0;

  // Layout
  const padTop = large ? 50 : 36;
  const padBot = large ? 36 : 28;
  const barAreaH = height - padTop - padBot;
  const barW = large ? 100 : 72;
  const barX = (width - barW) / 2;
  const labelFs = large ? 22 : 16;
  const kgFs = large ? 28 : 20;
  const tagFs = large ? 16 : 12;
  const tagH = large ? 28 : 22;
  const tagR = large ? 8 : 6;

  // Y scale: top = start, bottom = end
  const toY = (kg: number) => padTop + ((start - kg) / totalCut) * barAreaH;

  if (hasBreakdown) {
    const carbY1 = toY(start);
    const carbY2 = toY(start - carbNorm);
    const dehydY1 = carbY2;
    const dehydY2 = toY(end);

    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Start weight label */}
        <text x={width / 2} y={padTop - (large ? 16 : 12)} textAnchor="middle" fill="#ffffff" fontSize={kgFs} fontWeight={800} fontFamily="Satoshi, system-ui, sans-serif" style={{ fontVariantNumeric: "tabular-nums" } as any}>
          {start.toFixed(1)}
          <tspan fill="rgba(255,255,255,0.4)" fontSize={labelFs} fontWeight={600}> kg</tspan>
        </text>

        {/* Carb cut bar (green) */}
        {carbNorm > 0 && (
          <>
            <rect x={barX} y={carbY1} width={barW} height={Math.max(1, carbY2 - carbY1)} rx={carbY2 === dehydY2 ? tagR : 0} fill={GREEN} />
            {/* Label inside if tall enough */}
            {(carbY2 - carbY1) > (large ? 40 : 30) && (
              <g>
                <rect x={width / 2 - (large ? 52 : 40)} y={(carbY1 + carbY2) / 2 - tagH / 2} width={large ? 104 : 80} height={tagH} rx={tagR} fill="rgba(0,0,0,0.5)" />
                <text x={width / 2} y={(carbY1 + carbY2) / 2 + tagFs / 3} textAnchor="middle" fill={GREEN} fontSize={tagFs} fontWeight={700} fontFamily="Satoshi, system-ui, sans-serif">
                  -{carbNorm.toFixed(1)} diet
                </text>
              </g>
            )}
          </>
        )}

        {/* Dehydration bar (orange) */}
        {dehydNorm > 0 && (
          <>
            <rect x={barX} y={dehydY1} width={barW} height={Math.max(1, dehydY2 - dehydY1)} rx={carbNorm === 0 ? tagR : 0} fill={ORANGE} />
            {(dehydY2 - dehydY1) > (large ? 40 : 30) && (
              <g>
                <rect x={width / 2 - (large ? 56 : 44)} y={(dehydY1 + dehydY2) / 2 - tagH / 2} width={large ? 112 : 88} height={tagH} rx={tagR} fill="rgba(0,0,0,0.5)" />
                <text x={width / 2} y={(dehydY1 + dehydY2) / 2 + tagFs / 3} textAnchor="middle" fill={ORANGE} fontSize={tagFs} fontWeight={700} fontFamily="Satoshi, system-ui, sans-serif">
                  -{dehydNorm.toFixed(1)} sweat
                </text>
              </g>
            )}
          </>
        )}

        {/* End weight label */}
        <text x={width / 2} y={toY(end) + (large ? 32 : 24)} textAnchor="middle" fill="#ffffff" fontSize={kgFs} fontWeight={800} fontFamily="Satoshi, system-ui, sans-serif" style={{ fontVariantNumeric: "tabular-nums" } as any}>
          {end.toFixed(1)}
          <tspan fill="rgba(255,255,255,0.4)" fontSize={labelFs} fontWeight={600}> kg</tspan>
        </text>
      </svg>
    );
  }

  // No breakdown: single bar showing total cut
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <text x={width / 2} y={padTop - (large ? 16 : 12)} textAnchor="middle" fill="#ffffff" fontSize={kgFs} fontWeight={800} fontFamily="Satoshi, system-ui, sans-serif" style={{ fontVariantNumeric: "tabular-nums" } as any}>
        {start.toFixed(1)}
        <tspan fill="rgba(255,255,255,0.4)" fontSize={labelFs} fontWeight={600}> kg</tspan>
      </text>
      <rect x={barX} y={toY(start)} width={barW} height={barAreaH} rx={tagR} fill={GREEN} />
      <g>
        <rect x={width / 2 - (large ? 44 : 34)} y={padTop + barAreaH / 2 - tagH / 2} width={large ? 88 : 68} height={tagH} rx={tagR} fill="rgba(0,0,0,0.5)" />
        <text x={width / 2} y={padTop + barAreaH / 2 + tagFs / 3} textAnchor="middle" fill="#ffffff" fontSize={tagFs} fontWeight={700} fontFamily="Satoshi, system-ui, sans-serif">
          -{totalCut.toFixed(1)} kg
        </text>
      </g>
      <text x={width / 2} y={toY(end) + (large ? 32 : 24)} textAnchor="middle" fill="#ffffff" fontSize={kgFs} fontWeight={800} fontFamily="Satoshi, system-ui, sans-serif" style={{ fontVariantNumeric: "tabular-nums" } as any}>
        {end.toFixed(1)}
        <tspan fill="rgba(255,255,255,0.4)" fontSize={labelFs} fontWeight={600}> kg</tspan>
      </text>
    </svg>
  );
}

export const CampComparisonCard = forwardRef<HTMLDivElement, CampComparisonCardProps>(
  ({ campA, campB, aspect = "square" }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: s ? 56 : 32 }}>
          <div
            style={{
              fontSize: s ? 18 : 14,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#2563eb",
              marginBottom: s ? 24 : 12,
            }}
          >
            CAMP vs CAMP
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: s ? 32 : 24,
              fontWeight: 700,
            }}
          >
            <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campA.name}</div>
              {campA.event_name && (
                <div style={{ fontSize: s ? 17 : 13, color: "#60a5fa", fontWeight: 500, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campA.event_name}</div>
              )}
            </div>
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: s ? 24 : 18, fontWeight: 700, flexShrink: 0, width: s ? 80 : 56, textAlign: "center" }}>VS</div>
            <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campB.name}</div>
              {campB.event_name && (
                <div style={{ fontSize: s ? 17 : 13, color: "#60a5fa", fontWeight: 500, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campB.event_name}</div>
              )}
            </div>
          </div>
        </div>

        {/* Comparison rows */}
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: s ? 28 : 20,
            padding: s ? "8px 36px" : "4px 24px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <ComparisonRow
            label="Start"
            valueA={campA.starting_weight_kg?.toFixed(1) ?? null}
            valueB={campB.starting_weight_kg?.toFixed(1) ?? null}
            unit=" kg"
            large={s}
          />
          <ComparisonRow
            label="End"
            valueA={campA.end_weight_kg?.toFixed(1) ?? null}
            valueB={campB.end_weight_kg?.toFixed(1) ?? null}
            unit=" kg"
            large={s}
          />
          <ComparisonRow
            label="Total Cut"
            valueA={campA.total_weight_cut?.toFixed(1) ?? null}
            valueB={campB.total_weight_cut?.toFixed(1) ?? null}
            unit=" kg"
            large={s}
          />
          <ComparisonRow
            label="Dehydration"
            valueA={campA.weight_via_dehydration?.toFixed(1) ?? null}
            valueB={campB.weight_via_dehydration?.toFixed(1) ?? null}
            unit=" kg"
            large={s}
          />
          <ComparisonRow
            label="Carb Cut"
            valueA={campA.weight_via_carb_reduction?.toFixed(1) ?? null}
            valueB={campB.weight_via_carb_reduction?.toFixed(1) ?? null}
            unit=" kg"
            large={s}
          />
        </div>

        {/* Weight cut waterfall charts: one per camp */}
        {(campA.starting_weight_kg && campA.end_weight_kg && campA.starting_weight_kg > campA.end_weight_kg) ||
         (campB.starting_weight_kg && campB.end_weight_kg && campB.starting_weight_kg > campB.end_weight_kg) ? (
          <div style={{ marginTop: s ? 40 : 20 }}>
            <div
              style={{
                display: "flex",
                gap: s ? 24 : 12,
              }}
            >
              {/* Camp A chart */}
              <div
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: s ? 24 : 16,
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: s ? "16px 8px 12px" : "10px 4px 8px",
                }}
              >
                <div style={{ fontSize: s ? 16 : 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: s ? 8 : 4, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {campA.name}
                </div>
                <CampWaterfall camp={campA} large={s} width={s ? 400 : 300} height={s ? 360 : 220} />
              </div>

              {/* Camp B chart */}
              <div
                style={{
                  flex: 1,
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: s ? 24 : 16,
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: s ? "16px 8px 12px" : "10px 4px 8px",
                }}
              >
                <div style={{ fontSize: s ? 16 : 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: s ? 8 : 4, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {campB.name}
                </div>
                <CampWaterfall camp={campB} large={s} width={s ? 400 : 300} height={s ? 360 : 220} />
              </div>
            </div>

            {/* Legend */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: s ? 40 : 20,
                marginTop: s ? 20 : 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: s ? 10 : 6 }}>
                <div style={{ width: s ? 14 : 10, height: s ? 14 : 10, borderRadius: s ? 4 : 3, background: GREEN }} />
                <span style={{ fontSize: s ? 16 : 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Diet</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: s ? 10 : 6 }}>
                <div style={{ width: s ? 14 : 10, height: s ? 14 : 10, borderRadius: s ? 4 : 3, background: ORANGE }} />
                <span style={{ fontSize: s ? 16 : 11, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Sweat</span>
              </div>
            </div>
          </div>
        ) : null}
      </CardShell>
    );
  }
);

CampComparisonCard.displayName = "CampComparisonCard";
