// CampTrends — the "your cut, fight over fight" longitudinal view (Pro).
//
// Surfaces a fighter's cut history across camps: a sparkline of cut size per
// camp, average cut / rebound stats, and a short list of recent camps. Gated
// behind AI_FIGHT_CAMP_COACH — free users get a compact locked teaser that
// opens the paywall on tap.
//
// Data is self-contained: the component owns its `useQuery` against
// `coachTrends.getCampTrends` (built by a sibling agent) and returns `null`
// while loading or when there's no camp history yet.
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { CampTrends as CampTrendsData } from "@/../convex/coachTrends";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";

interface CampTrendsProps {
  className?: string;
}

// ── Sparkline geometry (mirrors PhaseCoachCard's buildChart approach) ────────
interface ChartData {
  path: string;
  bars: { x: number; w: number; y: number; h: number }[];
  w: number;
  h: number;
}

function buildChart(series: { x: string; y: number }[]): ChartData | null {
  const points = series
    .map((p) => p.y)
    .filter((y) => Number.isFinite(y));
  if (points.length < 1) return null;

  const w = 320;
  const h = 56;
  const padX = 4;
  const padY = 6;

  const yMax = Math.max(...points, 0);
  const yMin = Math.min(...points, 0);
  const yPad = Math.max(0.3, (yMax - yMin) * 0.12);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const n = points.length;
  const innerW = w - padX * 2;
  const slot = innerW / n;
  const barW = Math.max(3, slot * 0.45);

  const sy = (kg: number) =>
    padY + ((yHi - kg) / (yHi - yLo)) * (h - padY * 2);
  const cx = (i: number) => padX + slot * (i + 0.5);

  const baselineY = sy(yLo);

  const bars = points.map((kg, i) => {
    const top = sy(kg);
    return {
      x: cx(i) - barW / 2,
      w: barW,
      y: Math.min(top, baselineY),
      h: Math.abs(baselineY - top),
    };
  });

  const path = points
    .map((kg, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${sy(kg).toFixed(1)}`)
    .join("");

  return { path, bars, w, h };
}

// ── Trend pill ───────────────────────────────────────────────────────────
const TREND_META: Record<
  NonNullable<CampTrendsData["trend"]>,
  { label: string; icon: IonIconName; tone: string }
> = {
  improving: { label: "Improving", icon: "trendingDownOutline", tone: "text-primary bg-primary/10" },
  worsening: { label: "Worsening", icon: "trendingUpOutline", tone: "text-red-400 bg-red-400/10" },
  steady: { label: "Steady", icon: "removeOutline", tone: "text-muted-foreground bg-muted/40" },
};

function formatDate(dateISO: string): string {
  const ts = Date.parse(dateISO);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

// ── Locked teaser (free users) ─────────────────────────────────────────────
function LockedTrends({
  onUpgrade,
  className,
}: {
  onUpgrade: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        onUpgrade();
      }}
      className={`w-full min-h-[44px] card-surface rounded-2xl border border-border/50 p-3.5 text-left flex items-center gap-3 active:scale-[0.99] transition-transform ${className}`}
    >
      <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-400/10 flex items-center justify-center text-amber-400/90">
        <Icon name="trendingDownOutline" size={18} aria-label="Multi-camp trends" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground leading-tight">
          Multi-camp trends
        </p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
          See your cut, fight over fight — Pro
        </p>
      </div>
      <Icon
        name="lockClosedOutline"
        size={14}
        className="shrink-0 text-amber-400/80"
        aria-label="Pro feature"
      />
    </button>
  );
}

// ── Outer ──────────────────────────────────────────────────────────────────
export function CampTrends({ className = "" }: CampTrendsProps): JSX.Element | null {
  const { hasAccess } = useFeatureAccess("AI_FIGHT_CAMP_COACH");
  const { openPaywall } = useSubscription();

  // Only query when the user has access — free users see the teaser without
  // touching the backend.
  const trends = useQuery(
    (api as any).coachTrends?.getCampTrends,
    hasAccess ? {} : "skip",
  ) as CampTrendsData | null | undefined;

  const chart = useMemo(
    () => (trends ? buildChart(trends.cutSeries) : null),
    [trends],
  );

  if (!hasAccess) {
    return <LockedTrends onUpgrade={openPaywall} className={className} />;
  }

  // Loading or no history yet — render nothing.
  if (trends === undefined || trends.camps.length === 0) {
    return null;
  }

  const trendPill = trends.trend ? TREND_META[trends.trend] : null;
  const recent = trends.camps.slice(0, 4);

  return (
    <div className={`card-surface rounded-2xl border border-border/50 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Cut over cut
        </h3>
        {trendPill && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${trendPill.tone}`}
          >
            <Icon name={trendPill.icon} size={11} aria-hidden />
            {trendPill.label}
          </span>
        )}
      </div>

      {chart && (
        <div className="mt-3">
          <svg
            viewBox={`0 0 ${chart.w} ${chart.h}`}
            preserveAspectRatio="none"
            className="w-full h-14"
            aria-hidden
          >
            {chart.bars.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={1.5}
                className="fill-primary/25"
              />
            ))}
            <path
              d={chart.path}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              className="text-primary"
            />
          </svg>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/30 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
            avg cut
          </p>
          <p className="display-number text-[18px] text-foreground leading-tight">
            {trends.avgCutKg != null ? `${trends.avgCutKg.toFixed(1)}` : "—"}
            <span className="text-[11px] font-normal text-muted-foreground ml-0.5">kg</span>
          </p>
        </div>
        <div className="rounded-xl bg-muted/30 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
            avg rebound
          </p>
          <p className="display-number text-[18px] text-foreground leading-tight">
            {trends.avgReboundKg != null ? `${trends.avgReboundKg.toFixed(1)}` : "—"}
            <span className="text-[11px] font-normal text-muted-foreground ml-0.5">kg</span>
          </p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/40">
        {recent.map((camp) => (
          <li
            key={`${camp.name}-${camp.dateISO}`}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-foreground truncate leading-tight">
                {camp.name}
              </p>
              <p className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">
                {formatDate(camp.dateISO)}
                {camp.performanceFeeling ? ` · ${camp.performanceFeeling}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-[12.5px] font-semibold tabular-nums text-foreground/90">
              {camp.cutKg != null ? `${camp.cutKg.toFixed(1)} kg` : "—"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
