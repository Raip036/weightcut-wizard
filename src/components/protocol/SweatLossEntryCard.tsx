// WP-T16: SweatLossEntryCard
// Inline entry card for manual, sweat-driven rehydration generation. Shown
// once the carb-cut plan exists but the rehydration plan hasn't been built
// yet (or when the athlete chooses to re-enter their sweat loss). The
// athlete types how many kg they sweated off in the final cut, and the
// rehydration plan scales to that figure.
//
// Pure presentational: the caller owns the Convex action call
// (`generateRehydrationProtocol.run({ campId, sweatLossKg })`), loading
// state, and error. This card just collects + validates the number and
// fires `onGenerate(sweatLossKg)`.
//
// Visual conventions mirror OrsRecipeCard / TodaysActionHero chrome:
//   - card-surface rounded-2xl border border-border/50 p-5
//   - 10px uppercase tracker for the section header
//   - tabular-nums on the input + live preview
//   - mount: fade + slide-up (16px, 320ms spring), guarded by reduced motion
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SweatLossEntryCardProps {
  /** Fires with the validated kg value when the athlete confirms. */
  onGenerate: (sweatLossKg: number) => void;
  /** Disables the form + shows the button loading state while generating. */
  isLoading?: boolean;
  /** Error copy from a failed generation attempt. */
  error?: string | null;
  /** Prefill when re-entering an existing plan's sweat-loss figure. */
  defaultValue?: number;
  /** ORS replacement multiplier for the live "≈ X.X L" preview. */
  replacementFactor?: number;
  className?: string;
}

// Sensible kg bounds: a final-cut sweat-off below 0.1kg isn't worth a plan,
// and anything above ~10kg is almost certainly a typo.
const MIN_KG = 0.1;
const MAX_KG = 10;

export function SweatLossEntryCard({
  onGenerate,
  isLoading = false,
  error = null,
  defaultValue,
  replacementFactor = 1.5,
  className,
}: SweatLossEntryCardProps) {
  const prefersReduced = useReducedMotion();
  const [raw, setRaw] = useState<string>(
    defaultValue != null ? String(defaultValue) : "",
  );

  // Parse once per render. `value` is null when the field is empty or not a
  // finite number; `isValid` additionally enforces the kg bounds.
  const value = useMemo(() => {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [raw]);

  const isValid = value != null && value >= MIN_KG && value <= MAX_KG;
  const showPreview = value != null && value > 0;
  const litres = showPreview ? value * replacementFactor : 0;

  const submit = () => {
    if (!isValid || isLoading || value == null) return;
    onGenerate(value);
  };

  return (
    <motion.section
      role="region"
      aria-label="Enter final-cut sweat loss to generate rehydration plan"
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={cn(
        "card-surface rounded-2xl border border-border/50 p-5",
        className,
      )}
    >
      {/* Header */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
        After the scale · Rehydration
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
        Once you've made weight, enter how much you sweated off in the final
        cut. Your rehydration plan scales to it.
      </p>

      {/* kg input */}
      <div className="mt-4">
        <label
          htmlFor="sweat-loss-kg"
          className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground"
        >
          Sweat lost
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border/50 bg-card px-3 py-2.5 focus-within:border-primary/60 transition-colors">
          <input
            id="sweat-loss-kg"
            type="number"
            inputMode="decimal"
            step={0.1}
            min={MIN_KG}
            max={MAX_KG}
            value={raw}
            disabled={isLoading}
            placeholder="0.0"
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            aria-label="Sweat lost in kilograms"
            aria-invalid={value != null && !isValid}
            className="min-w-0 flex-1 bg-transparent text-[22px] font-bold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="shrink-0 text-[14px] font-semibold text-muted-foreground">
            kg
          </span>
        </div>

        {/* Live ORS preview */}
        {showPreview && (
          <p className="mt-2 text-[13px] font-semibold text-primary/90 tabular-nums leading-snug">
            ≈ {litres.toFixed(1)} L ORS to replace
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="mt-3 text-[12px] text-[rgb(var(--func-danger-red))] leading-snug"
        >
          {error}
        </p>
      )}

      {/* Primary action */}
      <button
        type="button"
        onClick={submit}
        disabled={!isValid || isLoading}
        className={cn(
          "mt-4 w-full rounded-xl bg-primary px-4 py-3 text-[14px] font-bold text-primary-foreground transition-opacity",
          "disabled:cursor-not-allowed disabled:opacity-40",
          !isValid || isLoading ? "" : "hover:opacity-90 active:opacity-80",
        )}
      >
        {isLoading ? "Generating rehydration plan…" : "Generate rehydration plan"}
      </button>
    </motion.section>
  );
}
