// THROWAWAY mock lab — BUILD-widget line chart redesign. Delete after sign-off.
import { useNavigate } from "react-router-dom";
import VariantSpline from "@/components/chartlab/VariantSpline";
import VariantGlow from "@/components/chartlab/VariantGlow";
import { PhaseCoachCard } from "@/components/dashboard/PhaseCoachCard";
import type { PlanData } from "@/components/dashboard/CutPaceForecast";
import VariantMinimal from "@/components/chartlab/VariantMinimal";
import VariantMilestone from "@/components/chartlab/VariantMilestone";
import {
  MOCK_LOGS,
  MOCK_PLAN,
  START_KG,
  TARGET_KG,
  buildScales,
  linePath,
  project,
} from "@/components/chartlab/mockData";

// Reproduce the CURRENT production look (straight segments, 320x64 viewBox
// stretched into h-24 with preserveAspectRatio="none") so before/after is honest.
function VariantCurrent() {
  const s = buildScales(320, 64, 4, 6);
  const actual = linePath(project(MOCK_LOGS, s));
  const plan = linePath(project(MOCK_PLAN, s));
  const first = project([MOCK_LOGS[0]], s)[0];
  const last = project([MOCK_LOGS[MOCK_LOGS.length - 1]], s)[0];
  const area = `${actual} L${last.x.toFixed(1)},64 L${first.x.toFixed(1)},64 Z`;
  return (
    <div>
      <svg viewBox="0 0 320 64" preserveAspectRatio="none" className="w-full h-24 text-emerald-400">
        <defs>
          <linearGradient id="curFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#curFill)" stroke="none" />
        <path d={plan} className="stroke-foreground/30" strokeWidth={1.25} strokeDasharray="3 3" fill="none" />
        <path d={actual} stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}

const VARIANTS: { id: string; title: string; blurb: string; node: React.ReactNode }[] = [
  { id: "current", title: "Current (before)", blurb: "Straight daily segments, stretched 320×64 viewBox", node: <VariantCurrent /> },
  { id: "glow-on", title: "C · Gradient Glow — On plan", blurb: "Emerald→teal gradient stroke + halo (chosen)", node: <VariantGlow verdict="on" /> },
  { id: "glow-amber", title: "C · Gradient Glow — Caution", blurb: "Amber gradient glow (slightly off plan)", node: <VariantGlow verdict="amber" /> },
  { id: "glow-orange", title: "C · Gradient Glow — Over", blurb: "Orange gradient glow (over plan)", node: <VariantGlow verdict="orange" /> },
  { id: "glow-rose", title: "C · Gradient Glow — Critical", blurb: "Rose/red gradient glow (well over plan)", node: <VariantGlow verdict="rose" /> },
  { id: "spline", title: "A · Refined Spline (alt)", blurb: "Smooth monotone curve + soft area", node: <VariantSpline /> },
  { id: "minimal", title: "D · Minimal (alt)", blurb: "Thin line, week ticks, hairline baseline", node: <VariantMinimal /> },
  { id: "milestone", title: "E · Journey (alt)", blurb: "Past solid vs road-left dashed, now-guide", node: <VariantMilestone /> },
];

// Realistic noisy weigh-ins over the last 30 days that descend from 83.3 to the
// given current weight, with day-to-day water swing, for the LIVE production card.
function realLogs(currentKg: number): { date: string; weight_kg: string }[] {
  const start = 83.3;
  const n = 30;
  const swing = [0, 0.3, -0.2, 0.4, -0.3, 0.2, -0.1, 0.3, -0.4, 0.2, -0.2, 0.3, -0.3, 0.1, -0.2];
  const today = Date.parse("2026-06-27T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const trend = start + ((currentKg - start) * i) / (n - 1);
    const kg = i === n - 1 ? currentKg : trend + swing[i % swing.length];
    return {
      date: new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
      weight_kg: kg.toFixed(1),
    };
  });
}

const REAL_PLAN: PlanData = {
  weeklyPlan: [
    { week: 1, targetWeight: 82.6, phase: "build" },
    { week: 2, targetWeight: 81.6, phase: "build" },
    { week: 3, targetWeight: 80.6, phase: "build" },
    { week: 4, targetWeight: 79.6, phase: "peak" },
    { week: 5, targetWeight: 78.6, phase: "peak" },
    { week: 6, targetWeight: 74.0, phase: "fight_week" },
  ],
  totalWeeks: 6,
  targetDate: "2026-07-18",
} as unknown as PlanData;

export default function ChartLab() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background px-4 py-8 pb-24">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">BUILD chart · mockups</h1>
          <button onClick={() => navigate(-1)} className="text-sm text-primary">Back</button>
        </div>

        {/* LIVE production PhaseCoachCard with real plan + projection, to verify
            the actual shipped component (smoothing + glow + plan/projection). */}
        <div className="mb-7">
          <div className="mb-1.5 px-1">
            <p className="text-[13px] font-semibold text-foreground">★ LIVE production card — on plan</p>
            <p className="text-[11px] text-muted-foreground">Real PhaseCoachCard + REAL_PLAN projection</p>
          </div>
          <div className="rounded-2xl bg-card">
            <PhaseCoachCard phase="build" daysUntilFight={21} weightLogs={realLogs(80.6)} currentWeight={80.6} targetWeight={74.0} targetDateISO="2026-07-18" plan={REAL_PLAN} />
          </div>
          <div className="mt-3 mb-1.5 px-1">
            <p className="text-[13px] font-semibold text-foreground">★ LIVE production card — over plan</p>
            <p className="text-[11px] text-muted-foreground">Heavier than this week's target → warmer glow</p>
          </div>
          <div className="rounded-2xl bg-card">
            <PhaseCoachCard phase="build" daysUntilFight={21} weightLogs={realLogs(82.4)} currentWeight={82.4} targetWeight={74.0} targetDateISO="2026-07-18" plan={REAL_PLAN} />
          </div>
        </div>

        <div className="space-y-5">
          {VARIANTS.map((v) => (
            <div key={v.id}>
              <div className="mb-1.5 px-1">
                <p className="text-[13px] font-semibold text-foreground">{v.title}</p>
                <p className="text-[11px] text-muted-foreground">{v.blurb}</p>
              </div>
              {/* Faithful PhaseCoachCard frame */}
              <div className="w-full rounded-2xl bg-card p-4 text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">BUILD</p>
                <div className="mt-3">{v.node}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-[12px] font-semibold leading-none tabular-nums text-emerald-400">
                    <span className="text-[11px] leading-none">→</span> On plan
                  </span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">80.0 kg now</span>
                </div>
                <p className="mt-3 border-t border-border/40 pt-3 text-[12px] leading-snug text-foreground/90">
                  Room to add about 100 kcal a day to fuel training.
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
