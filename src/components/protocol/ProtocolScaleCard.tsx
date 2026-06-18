import { useState } from "react";
import { Droplets } from "lucide-react";

/**
 * ProtocolScaleCard — the "Chapter 03 · The Scale" StoryCard from the approved
 * WeightProtocolStoryLab mockup, extracted into a real, self-contained component.
 *
 * The user logs how many kilos they sweated off after weigh-in; once valid we
 * preview the ORS volume to replace and let them generate a rehydration plan.
 */

// Accent tokens (HSL channels), matching the mockup.
const AMBER = "35 92% 58%"; // carbs / energy
const CYAN = "190 90% 55%"; // hydration

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

export function ProtocolScaleCard(props: {
  onGenerate: (sweatKg: number) => void | Promise<void>;
  isLoading: boolean;
  error: string | null;
  defaultValue?: number;
}): JSX.Element {
  const { onGenerate, isLoading, error, defaultValue } = props;

  const [sweatKg, setSweatKg] = useState(
    defaultValue !== undefined ? String(defaultValue) : "",
  );

  const sweatNum = parseFloat(sweatKg);
  const sweatValid = !Number.isNaN(sweatNum) && sweatNum >= 0.1 && sweatNum <= 10;
  const orsLitres = sweatValid ? (sweatNum * 1.5).toFixed(1) : null;

  const canSubmit = sweatValid && !isLoading;

  const handleSubmit = () => {
    if (canSubmit) {
      void onGenerate(sweatNum);
    }
  };

  return (
    <div
      className="relative rounded-2xl card-surface border overflow-hidden"
      style={{ borderColor: hsl(AMBER, 0.25) }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${hsl(AMBER, 0.06)}, transparent 60%)` }}
      />
      <div className="relative p-4">
        {/* ChapterHead */}
        <div className="mb-3">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1"
            style={{ color: hsl(AMBER) }}
          >
            Chapter 03 · The Scale
          </p>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">
            Step on the scale.
          </h2>
          <p className="text-[13px] text-muted-foreground leading-snug mt-1">
            Made weight? Log how many kilos you sweated off and I'll build your
            rehydration plan, scaled to you.
          </p>
        </div>

        <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">
          Kilos sweated off
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            value={sweatKg}
            onChange={(e) => setSweatKg(e.target.value)}
            placeholder="2.0"
            className="flex-1 rounded-xl bg-muted/20 border border-border/60 px-3 py-2.5 text-[18px] font-bold tabular-nums text-foreground outline-none focus:border-[hsl(35_92%_58%)]"
          />
          <span className="text-[14px] text-muted-foreground font-semibold">kg</span>
        </div>
        {orsLitres && (
          <p className="mt-2 text-[12px]" style={{ color: hsl(CYAN) }}>
            ≈ {orsLitres} L of ORS to replace it
          </p>
        )}
        <div className="mt-3">
          {/* PrimaryCta */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-bold text-[#0a0a0a] active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100"
            style={{ background: hsl(AMBER), boxShadow: `0 8px 28px ${hsl(AMBER, 0.4)}` }}
          >
            <Droplets className="h-4 w-4" /> {isLoading ? "Generating…" : "Start rehydrating"}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-[12px] text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
