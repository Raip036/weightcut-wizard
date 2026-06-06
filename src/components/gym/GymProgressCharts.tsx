import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { motion } from "motion/react";

/** Distinct, on-brand colours per muscle group for the balance ring + bars. */
const MUSCLE_HEX: Record<string, string> = {
  chest: "hsl(217 91% 60%)",
  back: "hsl(265 80% 62%)",
  shoulders: "hsl(25 85% 58%)",
  biceps: "hsl(190 80% 55%)",
  triceps: "hsl(330 80% 64%)",
  quads: "hsl(160 70% 46%)",
  legs: "hsl(160 70% 46%)",
  hamstrings: "hsl(150 65% 50%)",
  glutes: "hsl(0 75% 62%)",
  calves: "hsl(175 70% 45%)",
  abs: "hsl(45 90% 58%)",
  core: "hsl(45 90% 58%)",
  cardio: "hsl(0 75% 62%)",
  full_body: "hsl(231 70% 62%)",
};
const FALLBACK = ["hsl(217 91% 60%)", "hsl(265 80% 62%)", "hsl(25 85% 58%)", "hsl(160 70% 46%)", "hsl(330 80% 64%)", "hsl(190 80% 55%)"];

function muscleColor(name: string, idx = 0): string {
  const key = name.toLowerCase().replace(/\s+/g, "_").split("|")[0];
  return MUSCLE_HEX[key] ?? FALLBACK[idx % FALLBACK.length];
}

function VolumeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { day: string; volume: number } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xs border border-border/50 bg-card px-2.5 py-1.5 shadow-lg">
      <p className="text-[10px] text-muted-foreground">{p.day}</p>
      <p className="text-[13px] font-bold tabular-nums text-primary">{Math.round(p.volume).toLocaleString()} <span className="text-[10px] font-medium text-muted-foreground">kg</span></p>
    </div>
  );
}

/** Smooth gradient area chart of daily training volume. */
export function VolumeAreaChart({ days }: { days: { date: string; label: string; volume: number }[] }) {
  const data = days.map((d) => ({ ...d, day: new Date(d.date).toLocaleDateString("en-US", { weekday: "short" }) }));
  return (
    <div className="h-40 -mx-1.5">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="gymVolGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.12} vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval={0} />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip content={<VolumeTooltip />} cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.25, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="volume"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            fill="url(#gymVolGrad)"
            dot={{ r: 3, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut "muscle balance" ring with an animated legend of the top groups. */
export function MuscleBalanceRing({ rows }: { rows: [string, number][] }) {
  const top = rows.slice(0, 6);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const maxN = Math.max(1, ...top.map(([, n]) => n));
  const data = top.map(([name, value]) => ({ name, value }));

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={38} outerRadius={54} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} animationDuration={700}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={muscleColor(d.name, i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="display-number text-[20px] leading-none text-foreground">{total}</span>
          <span className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground mt-0.5">sessions</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {top.map(([muscle, count], i) => (
          <div key={muscle} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: muscleColor(muscle, i) }} />
            <span className="text-[11px] font-medium capitalize text-foreground/90 w-16 shrink-0 truncate">{muscle}</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: muscleColor(muscle, i) }}
                initial={{ width: 0 }}
                animate={{ width: `${(count / maxN) * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.06, ease: "easeOut" }}
              />
            </div>
            <span className="text-[11px] font-bold tabular-nums text-foreground/80 w-4 text-right shrink-0">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
