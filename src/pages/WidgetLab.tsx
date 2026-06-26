import { ChevronRight } from "lucide-react";
import { TrendLine, ProgressRing, WeekStrip } from "@/components/dashboardlab/iosCharts";

/* ------------------------------------------------------------------ *
 * THROWAWAY MOCK LAB - /widget-lab
 *
 * iOS-native redesigns of the four dashboard stat widgets
 * (Weight · Training · Sleep · Recovery).
 *
 *   0 · Reference     the current floating-on-black take
 *   A · Health Tiles  discrete squircle material cards, gradient charts
 *   B · Bento Panel   one unified widget, 2x2 with hairline dividers
 *
 * Delete this file + iosCharts.tsx + the route after sign-off.
 * ------------------------------------------------------------------ */

const BLUE = "hsl(217 91% 58%)";
const SKY = "hsl(213 94% 68%)";
const VIOLET = "hsl(270 60% 62%)";

const WEIGHT = [80.6, 80.3, 80.1, 79.7, 79.5, 79.2, 79.0];
const SLEEP = [6.2, 7.1, 6.5, 5.8, 6.9, 7.8, 7.6];
const RECOVERY = [71, 74, 68, 60, 70, 82, 79];
const WEEK = [true, true, true, true, false, false, false];

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

/* ---------- 0 · Reference (as shipped today) -------------------- */

function Reference() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-7 px-1">
      <div>
        <p className="section-header flex items-center justify-between">WEIGHT <ChevronRight className="h-3.5 w-3.5" /></p>
        <p className="mt-1"><span className="font-display display-number text-4xl">79.0</span> <span className="text-sm text-muted-foreground">kg</span></p>
        <div className="mt-3 h-12"><TrendLine id="r-w" values={WEIGHT} color={BLUE} /></div>
        <Caption>Jun 26</Caption>
      </div>
      <div>
        <p className="section-header flex items-center justify-between">TRAINING <ChevronRight className="h-3.5 w-3.5" /></p>
        <div className="mt-2 flex items-center gap-3">
          <ProgressRing progress={0.25} color={BLUE} center="1" size={56} />
          <p><span className="font-display display-number text-3xl">1</span> <span className="text-sm text-muted-foreground">hrs</span></p>
        </div>
        <div className="mt-2"><WeekStrip active={WEEK} today={2} color={BLUE} /></div>
      </div>
      <div>
        <p className="section-header flex items-center justify-between">SLEEP <ChevronRight className="h-3.5 w-3.5" /></p>
        <p className="mt-1"><span className="font-display display-number text-4xl">7.6</span> <span className="text-sm text-muted-foreground">h</span></p>
        <div className="mt-3 h-12"><TrendLine id="r-s" values={SLEEP} color={BLUE} smooth /></div>
        <Caption>avg 6.7h</Caption>
      </div>
      <div>
        <p className="section-header flex items-center justify-between">RECOVERY <ChevronRight className="h-3.5 w-3.5" /></p>
        <p className="mt-1"><span className="font-display display-number text-4xl">79</span></p>
        <div className="mt-3 h-12"><TrendLine id="r-r" values={RECOVERY} color={BLUE} smooth /></div>
        <Caption>avg 73</Caption>
      </div>
    </div>
  );
}

/* ---------- A · Health Tiles ------------------------------------ */

function TileShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="card-press relative overflow-hidden rounded-[26px] border p-4"
      style={{
        backgroundColor: "hsl(0 0% 100% / 0.045)",
        borderColor: "hsl(0 0% 100% / 0.07)",
        boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.06)",
      }}
    >
      {children}
    </div>
  );
}

function TileHead({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: accent }}>
        {label}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
    </div>
  );
}

function HealthTiles() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TileShell>
        <TileHead label="Weight" accent={BLUE} />
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-display display-number text-4xl">79.0</span>
          <span className="text-sm font-medium text-muted-foreground">kg</span>
        </div>
        <p className="mt-0.5 text-[11px] font-medium" style={{ color: BLUE }}>↓ 1.6 kg this week</p>
        <div className="-mx-4 -mb-4 mt-3 h-14"><TrendLine id="a-w" values={WEIGHT} color={BLUE} height={56} /></div>
      </TileShell>

      <TileShell>
        <TileHead label="Training" accent={BLUE} />
        <div className="mt-3 flex items-center gap-3">
          <ProgressRing progress={0.25} color={BLUE} center="1h" unit="of 4" size={68} />
          <div className="leading-tight">
            <p className="font-display text-base font-semibold">Session 1</p>
            <p className="text-[11px] text-muted-foreground">3 to go</p>
          </div>
        </div>
        <div className="mt-4"><WeekStrip active={WEEK} today={2} color={BLUE} /></div>
      </TileShell>

      <TileShell>
        <TileHead label="Sleep" accent={SKY} />
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-display display-number text-4xl">7.6</span>
          <span className="text-sm font-medium text-muted-foreground">h</span>
        </div>
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">avg 6.7h · 7 nights</p>
        <div className="-mx-4 -mb-4 mt-3 h-14"><TrendLine id="a-s" values={SLEEP} color={SKY} smooth height={56} /></div>
      </TileShell>

      <TileShell>
        <TileHead label="Recovery" accent={VIOLET} />
        <div className="mt-2 flex items-baseline gap-1">
          <span className="font-display display-number text-4xl">79</span>
          <span className="text-sm font-medium text-muted-foreground">/100</span>
        </div>
        <p className="mt-0.5 text-[11px] font-medium" style={{ color: VIOLET }}>Primed</p>
        <div className="-mx-4 -mb-4 mt-3 h-14"><TrendLine id="a-r" values={RECOVERY} color={VIOLET} smooth height={56} /></div>
      </TileShell>
    </div>
  );
}

/* ---------- B · Bento Panel ------------------------------------- */

function BentoCell({
  label,
  accent,
  children,
  className = "",
  style,
}: {
  label: string;
  accent: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card-press flex flex-col p-4 ${className}`} style={style}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: accent }}>{label}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      {children}
    </div>
  );
}

function BentoPanel() {
  const divider = "hsl(0 0% 100% / 0.07)";
  return (
    <div
      className="overflow-hidden rounded-[28px] border"
      style={{ backgroundColor: "hsl(0 0% 100% / 0.04)", borderColor: "hsl(0 0% 100% / 0.07)" }}
    >
      <div className="grid grid-cols-2">
        <BentoCell label="Weight" accent={BLUE} className="border-b border-r" style={{ borderColor: divider }}>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-display display-number text-3xl">79.0</span>
            <span className="text-xs text-muted-foreground">kg</span>
          </div>
          <div className="mt-2 h-9"><TrendLine id="b-w" values={WEIGHT} color={BLUE} height={40} /></div>
        </BentoCell>

        <BentoCell label="Training" accent={BLUE} className="border-b" style={{ borderColor: divider }}>
          <div className="mt-2 flex items-center gap-2.5">
            <ProgressRing progress={0.25} color={BLUE} center="1h" size={48} />
            <div className="flex-1"><WeekStrip active={WEEK} today={2} color={BLUE} /></div>
          </div>
        </BentoCell>

        <BentoCell label="Sleep" accent={SKY} className="border-r" style={{ borderColor: divider }}>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-display display-number text-3xl">7.6</span>
            <span className="text-xs text-muted-foreground">h</span>
          </div>
          <div className="mt-2 h-9"><TrendLine id="b-s" values={SLEEP} color={SKY} smooth height={40} /></div>
        </BentoCell>

        <BentoCell label="Recovery" accent={VIOLET}>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-display display-number text-3xl">79</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="mt-2 h-9"><TrendLine id="b-r" values={RECOVERY} color={VIOLET} smooth height={40} /></div>
        </BentoCell>
      </div>
    </div>
  );
}

/* ---------- page ------------------------------------------------ */

function SectionLabel({ tag, title, blurb }: { tag: string; title: string; blurb: string }) {
  return (
    <div className="mb-4 mt-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BLUE }}>{tag}</p>
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
    </div>
  );
}

export default function WidgetLab() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-4 py-8 space-y-10">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Widget studies</h1>
          <p className="mt-1 text-sm text-muted-foreground">Three takes on the dashboard stat row.</p>
        </header>

        <section>
          <SectionLabel tag="Reference" title="As shipped today" blurb="Metrics float directly on black, no container." />
          <Reference />
        </section>

        <section>
          <SectionLabel tag="Direction A" title="Health tiles" blurb="Each metric is a discrete material card. Gradient charts bleed to the edge, colored category labels, chevron tap target." />
          <HealthTiles />
        </section>

        <section>
          <SectionLabel tag="Direction B" title="Bento panel" blurb="One unified widget split into quadrants by hairline dividers. Reads as a single Home-screen tile." />
          <BentoPanel />
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}
