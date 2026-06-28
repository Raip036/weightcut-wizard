// THROWAWAY chart-lab variant: "Gradient Glow Line".
// Gradient-stroked smooth actual line with a soft SVG-blur halo over a rich dark
// area fill. Whoop / energy-core aesthetic, kept tasteful. Color follows the
// drift verdict (on-plan emerald -> teal, then amber / orange / rose as you go
// over plan) so every state keeps the same premium glow. Delete after sign-off.
import {
  SMOOTH_LOGS,
  MOCK_PLAN,
  START_KG,
  CURRENT_KG,
  TARGET_KG,
  TODAY_TS,
  TARGET_TS,
  buildScales,
  smoothPath,
  project,
} from "./mockData";

export type GlowVerdict = "on" | "amber" | "orange" | "rose";

// Two-tone gradient per verdict. `from` warms the left, `to` the right; `core`
// is the bright stop reused for the today dot and target ring so the whole
// chart speaks one hue.
export const GLOW_PALETTE: Record<GlowVerdict, { from: string; to: string; core: string }> = {
  on: { from: "hsl(152 69% 55%)", to: "hsl(173 70% 52%)", core: "hsl(152 69% 55%)" },
  amber: { from: "hsl(43 96% 58%)", to: "hsl(33 95% 54%)", core: "hsl(43 96% 56%)" },
  orange: { from: "hsl(28 96% 60%)", to: "hsl(16 92% 56%)", core: "hsl(25 95% 58%)" },
  rose: { from: "hsl(350 90% 64%)", to: "hsl(2 84% 58%)", core: "hsl(350 89% 60%)" },
};

export default function VariantGlow({ verdict = "on" }: { verdict?: GlowVerdict }) {
  const s = buildScales(320, 140);
  const pal = GLOW_PALETTE[verdict];
  // Namespace defs ids per verdict so multiple instances never collide.
  const uid = `glow-${verdict}`;

  const actualPts = project(SMOOTH_LOGS, s);
  const actualPath = smoothPath(actualPts);

  const firstX = actualPts[0].x;
  const lastX = actualPts[actualPts.length - 1].x;
  const areaPath = `${actualPath} L${lastX.toFixed(2)},140 L${firstX.toFixed(2)},140 Z`;

  const planPath = smoothPath(project(MOCK_PLAN, s));

  const targetX = s.sx(TARGET_TS);
  const targetY = s.sy(TARGET_KG);
  const todayX = s.sx(TODAY_TS);
  const todayY = s.sy(CURRENT_KG);

  return (
    <div>
      <svg viewBox="0 0 320 140" preserveAspectRatio="none" className="w-full h-[140px]">
        <defs>
          <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={pal.from} />
            <stop offset="100%" stopColor={pal.to} />
          </linearGradient>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={pal.core} stopOpacity="0.28" />
            <stop offset="100%" stopColor={pal.core} stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-blur`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
        </defs>

        <path d={areaPath} fill={`url(#${uid}-fill)`} stroke="none" />

        <path
          d={planPath}
          fill="none"
          className="stroke-foreground/20"
          strokeWidth={1.25}
          strokeDasharray="3 3"
          strokeLinecap="round"
        />

        {/* Glow (thick, blurred) */}
        <path
          d={actualPath}
          fill="none"
          stroke={`url(#${uid}-stroke)`}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${uid}-blur)`}
          opacity={0.5}
        />
        {/* Crisp line on top */}
        <path
          d={actualPath}
          fill="none"
          stroke={`url(#${uid}-stroke)`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Target marker (hollow) */}
        <circle cx={targetX} cy={targetY} r={4} fill="none" stroke={pal.to} strokeWidth={1.5} />

        {/* Today dot (glow + halo + core) */}
        <circle cx={todayX} cy={todayY} r={10} fill={pal.core} opacity={0.25} />
        <circle cx={todayX} cy={todayY} r={6} className="fill-[hsl(var(--card))]" />
        <circle cx={todayX} cy={todayY} r={4} fill={pal.core} />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}
