import { Fragment } from "react";
import {
  Scale, Droplets, Trophy, TrendingDown, ClipboardList, Check, Lock,
} from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

/* ------------------------------------------------------------------ *
 * Reusable protocol step-flow timeline and plan-switcher components.
 * Extracted from the CutLab throwaway mock for use in WeightProtocol.
 * Pure presentational — no Convex or data dependencies.
 * ------------------------------------------------------------------ */

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

const BLUE = "217 91% 58%";
const BLUE_HI = "213 94% 64%";

/* ------------------------------------------------------------------ */
/* Exports                                                              */
/* ------------------------------------------------------------------ */

export type StepKey = "plan" | "cut" | "scale" | "rehydrate" | "walkout";

export const PROTOCOL_STEPS: { key: StepKey; label: string; kind: "form" | "plan" | "finale"; icon: typeof Scale }[] = [
  { key: "plan",      label: "Plan",      kind: "form",   icon: ClipboardList },
  { key: "cut",       label: "Cut",       kind: "plan",   icon: TrendingDown  },
  { key: "scale",     label: "Scale",     kind: "form",   icon: Scale         },
  { key: "rehydrate", label: "Rehydrate", kind: "plan",   icon: Droplets      },
  { key: "walkout",   label: "Walkout",   kind: "finale", icon: Trophy        },
];

export function ProtocolFlowTimeline({
  active, maxReached, onSelect,
}: {
  active: number;
  maxReached: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="relative rounded-2xl card-surface border border-primary/20 overflow-hidden">
      <WizardAuroraBackground intensity="subtle" motes={false} />
      <div className="relative px-3 pt-4 pb-3.5">
        <div className="flex items-start">
          {PROTOCOL_STEPS.map((s, i) => {
            const completed = i < maxReached;
            const current = i === active;
            const reached = i <= maxReached;
            const living = s.kind === "plan";
            const StepIcon = s.icon;
            return (
              <Fragment key={s.key}>
                {i > 0 && (
                  <div className="flex-1 h-9 flex items-center pt-0 -mx-1">
                    <div className="h-[3px] w-full rounded-full overflow-hidden" style={{ background: hsl("220 14% 30%", 0.5) }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: i <= maxReached ? "100%" : "0%",
                          background: `linear-gradient(90deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <button
                  onClick={() => reached && onSelect(i)}
                  disabled={!reached}
                  className="flex flex-col items-center gap-1.5 shrink-0 group"
                  style={{ width: 58 }}
                >
                  <div
                    className="relative h-9 w-9 rounded-full grid place-items-center transition-all"
                    style={{
                      background: completed
                        ? `linear-gradient(135deg, ${hsl(BLUE, 0.9)}, ${hsl(BLUE_HI, 0.9)})`
                        : current
                        ? hsl(BLUE, 0.16)
                        : hsl("220 14% 26%", 0.35),
                      border: current
                        ? `1.5px solid ${hsl(BLUE)}`
                        : completed
                        ? "1.5px solid transparent"
                        : `1.5px solid ${hsl("220 12% 40%", 0.5)}`,
                      boxShadow: current
                        ? `0 0 0 4px ${hsl(BLUE, 0.12)}, 0 4px 16px ${hsl(BLUE, 0.3)}`
                        : completed
                        ? `0 4px 14px ${hsl(BLUE, 0.28)}`
                        : "none",
                    }}
                  >
                    {completed ? (
                      living ? <StepIcon className="h-4 w-4 text-white" /> : <Check className="h-4 w-4 text-white" />
                    ) : reached ? (
                      <StepIcon className="h-4 w-4" style={{ color: current ? hsl(BLUE) : hsl("220 10% 60%") }} />
                    ) : (
                      <Lock className="h-3.5 w-3.5" style={{ color: hsl("220 10% 50%") }} />
                    )}
                    {/* living-plan dashed marker ring */}
                    {living && reached && (
                      <span
                        className="absolute -inset-[3px] rounded-full pointer-events-none"
                        style={{ border: `1px dashed ${hsl(BLUE, current || completed ? 0.5 : 0.3)}` }}
                      />
                    )}
                  </div>
                  <span
                    className="text-[9px] uppercase tracking-wide font-semibold leading-none transition-colors"
                    style={{ color: current ? hsl(BLUE) : living && reached ? hsl(BLUE, 0.85) : hsl("220 10% 58%") }}
                  >
                    {s.label}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Compact Cut ⇄ Rehydrate segmented control shown on the two living-plan pages. */
export function ProtocolPlanSwitcher({
  active, onSelect,
}: {
  active: StepKey;
  onSelect: (k: StepKey) => void;
}) {
  const items: { k: StepKey; label: string; icon: typeof Droplets }[] = [
    { k: "cut",       label: "Cut",       icon: TrendingDown },
    { k: "rehydrate", label: "Rehydrate", icon: Droplets     },
  ];
  return (
    <div className="flex items-center gap-1 rounded-full p-1 surface-inset mb-3">
      {items.map((it) => {
        const on = active === it.k;
        return (
          <button
            key={it.k}
            onClick={() => onSelect(it.k)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: on ? `linear-gradient(135deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})` : "transparent",
              color: on ? "white" : hsl("220 10% 62%"),
            }}
          >
            <it.icon className="h-3.5 w-3.5" /> {it.label}
          </button>
        );
      })}
    </div>
  );
}
