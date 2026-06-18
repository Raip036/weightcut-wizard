import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarDays, RotateCcw } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Plan Card Lab (dev-only, route: /plan-card-lab)
 *
 * Chosen "Chapter 01 · The Plan" direction: A (hero number ticks start → target
 * + descending track) MERGED with B's vertical spine — no "−12 kg to cut" label,
 * no arrow icons, and the days-to-weigh-in line has no background. Not wired in.
 * ------------------------------------------------------------------ */

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;
const START = 82.0;
const TARGET = 70.0;
const DAYS = 15;

/** Count from `from` → `to`, easing out. Re-runs when `runKey` changes. */
function useCount(from: number, to: number, runKey: number, ms = 1100) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? to : from);
  useEffect(() => {
    if (reduced) { setN(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, runKey, ms, reduced]);
  return n;
}

function PlanCard({ k }: { k: number }) {
  const reduced = useReducedMotion();
  const hero = useCount(START, TARGET, k);
  return (
    <div className="relative overflow-hidden rounded-2xl card-surface border border-primary/20 p-5">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 80% at 80% 0%, ${hsl(0.08)}, transparent 55%)` }} />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl() }}>Chapter 01 · The Plan</p>
        <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">Your cut, one chapter at a time.</h2>
        <p className="text-[13px] text-muted-foreground leading-snug mt-1.5">A day-by-day taper to weigh-in, then a rehydration plan after the scale.</p>

        {/* numbers — start dot ↔ "from" line, target dot in line with the big number */}
        <div className="my-5">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50 shrink-0" />
            <p className="text-[12px] text-muted-foreground/70">
              From <span className="tabular-nums font-semibold text-muted-foreground">{START.toFixed(1)} kg</span>
            </p>
          </div>
          <div className="ml-[5px] w-px h-7 my-1" style={{ background: `linear-gradient(${hsl(0.2)}, ${hsl()})` }} />
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ background: hsl(), boxShadow: `0 0 10px ${hsl(0.7)}` }} />
            <div className="flex items-end gap-1.5">
              <span className="display-number font-extrabold tabular-nums leading-none" style={{ fontSize: 56, color: hsl() }}>{hero.toFixed(1)}</span>
              <span className="text-[18px] font-bold text-muted-foreground mb-1.5">kg</span>
            </div>
          </div>
          <div className="ml-6 mt-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Weigh-in target</p>
            <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: hsl(0.12) }}>
              <motion.div key={k} className="h-full rounded-full" style={{ background: hsl() }} initial={{ width: "100%" }} animate={{ width: `${(TARGET / START) * 100}%` }} transition={{ duration: reduced ? 0 : 1.1, ease: "easeOut" }} />
            </div>
          </div>
        </div>

        {/* days to weigh-in — plain text, no background */}
        <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" /> {DAYS} days to weigh-in
        </p>

        <button className="w-full mt-5 flex items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.98] transition-transform">
          Generate my protocol
        </button>
      </div>
    </div>
  );
}

export default function PlanCardLab() {
  const [k, setK] = useState(0);
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-5">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Plan Card Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Chosen direction: A's ticking hero number + descending track, with B's vertical spine. No "−12 kg to cut", no arrows, no background behind the days line.</p>
        </header>
        <div className="flex justify-end">
          <button onClick={() => setK((n) => n + 1)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground active:scale-95">
            <RotateCcw className="h-3.5 w-3.5" /> Replay
          </button>
        </div>
        <PlanCard k={k} />
        <p className="text-[11px] text-muted-foreground/50">Dev-only · route <code>/plan-card-lab</code> · not wired in</p>
      </div>
    </div>
  );
}
