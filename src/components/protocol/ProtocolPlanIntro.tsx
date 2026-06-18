import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { type CutApproach } from "@/components/protocol/CutApproachSelector";

const APPROACHES: readonly CutApproach[] = ["gradual", "standard", "aggressive"];

/**
 * Chapter 01 · The Plan — the clean intro shown on the Weight Protocol page
 * before generation. The athlete's weight, target and profile are already
 * known, so this is just the read + the one Generate action.
 *
 * Numbers are a vertical "spine": a muted start dot up top and a glowing target
 * dot whose row is in line with the big target number, which ticks down from
 * start → target on mount (dynamic, not a static figure). A descending track
 * carries the "drop" so no separate delta label / arrows are needed.
 */

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

function useCountDown(from: number, to: number, run: boolean, ms = 1100): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced || !run ? to : from);
  useEffect(() => {
    if (!run) return;
    if (reduced) { setN(to); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, run, ms, reduced]);
  return n;
}

export function ProtocolPlanIntro({
  startKg,
  targetKg,
  daysToWeighIn,
  approach,
  onApproachChange,
  onGenerate,
}: {
  startKg: number;
  targetKg: number | null;
  daysToWeighIn: number | null;
  approach: CutApproach;
  onApproachChange: (a: CutApproach) => void;
  onGenerate: () => void;
}) {
  const reduced = useReducedMotion();
  const hasNums = startKg > 0 && targetKg != null && targetKg > 0;
  const hero = useCountDown(startKg, targetKg ?? 0, hasNums);

  return (
    <div className="pt-2">
      <div className="relative rounded-2xl card-surface border border-primary/20 overflow-hidden p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(120% 80% at 80% 0%, ${hsl(0.08)}, transparent 55%)` }}
        />
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl() }}>
            Chapter 01 · The Plan
          </p>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">
            Your cut, one chapter at a time.
          </h2>
          <p className="text-[13px] text-muted-foreground leading-snug mt-1.5">
            A day-by-day taper to weigh-in, then a rehydration plan after the
            scale. Tuned to your weight, training and weigh-in window.
          </p>

          {hasNums ? (
            <div className="my-5">
              {/* start — muted dot in line with the "from" line */}
              <div className="flex items-center gap-3">
                <span className="w-3 flex justify-center shrink-0">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
                </span>
                <p className="text-[12px] text-muted-foreground/70">
                  From{" "}
                  <span className="tabular-nums font-semibold text-muted-foreground">
                    {startKg.toFixed(1)} kg
                  </span>
                </p>
              </div>

              {/* connector — sits under the dot centres */}
              <div
                className="ml-1.5 w-px h-7 my-1"
                style={{ background: `linear-gradient(${hsl(0.2)}, ${hsl()})` }}
              />

              {/* target — glowing dot in line with the big ticking number */}
              <div className="flex items-center gap-3">
                <span className="w-3 flex justify-center shrink-0">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: hsl(), boxShadow: `0 0 10px ${hsl(0.7)}` }}
                  />
                </span>
                <div className="flex items-end gap-1.5">
                  <span
                    className="display-number font-extrabold tabular-nums leading-none"
                    style={{ fontSize: 56, color: hsl() }}
                  >
                    {hero.toFixed(1)}
                  </span>
                  <span className="text-[18px] font-bold text-muted-foreground mb-1.5">kg</span>
                </div>
              </div>

              {/* label + descending track, aligned under the number (dot 12 + gap 12) */}
              <div className="ml-6 mt-1.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
                  Weigh-in target
                </p>
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: hsl(0.12) }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: hsl() }}
                    initial={{ width: "100%" }}
                    animate={{ width: `${((targetKg ?? 0) / startKg) * 100}%` }}
                    transition={{ duration: reduced ? 0 : 1.1, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="my-5 text-[13px] text-muted-foreground">
              Your target is set from your camp. Generate to see your plan.
            </p>
          )}

          {daysToWeighIn != null && (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Icon name="calendarOutline" size={14} />
              {daysToWeighIn <= 0
                ? "Weigh-in today"
                : `${daysToWeighIn} day${daysToWeighIn === 1 ? "" : "s"} to weigh-in`}
            </p>
          )}

          {/* Approach — chosen before generating; drives the day plan */}
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1.5">
              Approach
            </p>
            <div className="flex gap-1.5">
              {APPROACHES.map((a) => {
                const active = approach === a;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => onApproachChange(a)}
                    className="flex-1 rounded-full py-1.5 text-[11px] font-semibold capitalize transition-colors"
                    style={
                      active
                        ? { background: hsl(), color: "#0a0a0a" }
                        : { border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
                    }
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            className="w-full mt-5 flex items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
          >
            Generate my protocol
          </button>
        </div>
      </div>
    </div>
  );
}
