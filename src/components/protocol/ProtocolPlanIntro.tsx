import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { type CutApproach } from "@/components/protocol/CutApproachSelector";

const APPROACHES: readonly CutApproach[] = ["gradual", "standard", "aggressive"];

/**
 * Chapter 01 · The Plan: the clean intro shown on the Weight Protocol page
 * before generation. The athlete's weight, target and profile are already
 * known, so this is just the read + the one Generate action.
 *
 * Numbers are shown as a horizontal "Now → Target" row so both values read
 * at a glance: muted start on the left, blue-accented target on the right,
 * separated by a chevron. The target ticks down from start → target on mount.
 */

const BLUE = "217 91% 58%";
const BLUE_HI = "213 94% 64%";
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
            Cut to {targetKg != null ? targetKg.toFixed(1) : "—"} kg
          </h2>

          {hasNums ? (
            <div className="my-5 flex items-end justify-center gap-6">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold mb-1">Now</p>
                <p className="display-number text-[32px] font-extrabold tabular-nums text-muted-foreground">
                  {startKg.toFixed(1)}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 mb-2" style={{ color: hsl() }} />
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: hsl() }}>Target</p>
                <p className="display-number text-[32px] font-extrabold tabular-nums text-foreground">
                  {hero.toFixed(1)}
                </p>
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

          {/* Approach: chosen before generating; drives the day plan */}
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
            className="w-full mt-5 flex items-center justify-center rounded-2xl px-4 py-3.5 text-[14px] font-bold text-white relative overflow-hidden active:scale-[0.98] transition-transform border border-primary/30"
            style={{
              background: `linear-gradient(135deg, ${hsl()}, hsl(${BLUE_HI}))`,
              boxShadow: `0 8px 28px ${hsl(0.45)}`,
            }}
          >
            <WizardAuroraBackground intensity="subtle" motes={false} />
            <span className="relative">Generate my protocol</span>
          </button>
        </div>
      </div>
    </div>
  );
}
