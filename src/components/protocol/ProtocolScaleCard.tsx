import { useState } from "react";
import { Droplets } from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

/**
 * ProtocolScaleCard: the "Chapter 03 · The Scale" StoryCard from the approved
 * WeightProtocolStoryLab mockup, extracted into a real, self-contained component.
 *
 * The user logs how many kilos they sweated off after weigh-in, how many hours
 * remain until the fight (prefilled from the camp's weigh-in→fight gap, but
 * editable), and (when that gap spans overnight) their sleep window. Once
 * valid we let them generate an hour-by-hour rehydration + refeed plan that
 * schedules NO intake during sleep.
 */

// Accent tokens (HSL channels), matching the blue-aurora theme.
const BLUE = "217 91% 58%";
const BLUE_HI = "213 94% 64%";

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

/** Args passed to the generator. */
export interface ProtocolScaleSubmit {
  sweatKg: number;
  hoursUntilFight: number;
  /** Hour-of-day (0-24) the athlete sleeps; null when no overnight gap. */
  sleepStartHour: number | null;
  /** Hour-of-day (0-24) the athlete wakes; null when no overnight gap. */
  sleepEndHour: number | null;
}

// Default night window when the gap spans overnight (23:00 → 07:00).
const DEFAULT_SLEEP_START = 23;
const DEFAULT_SLEEP_END = 7;
// Gaps shorter than this are treated as same-day → no sleep block.
const OVERNIGHT_THRESHOLD_HOURS = 10;

export function ProtocolScaleCard(props: {
  onGenerate: (args: ProtocolScaleSubmit) => void | Promise<void>;
  isLoading: boolean;
  error: string | null;
  defaultValue?: number;
  /** Prefill for hours-until-fight, from `protocol.weighInToFightGapHours`. */
  defaultHoursUntilFight?: number;
}): JSX.Element {
  const { onGenerate, isLoading, error, defaultValue, defaultHoursUntilFight } =
    props;

  const [sweatKg, setSweatKg] = useState(
    defaultValue !== undefined ? String(defaultValue) : "",
  );
  const [hoursUntilFight, setHoursUntilFight] = useState(
    defaultHoursUntilFight !== undefined && defaultHoursUntilFight > 0
      ? String(Math.round(defaultHoursUntilFight))
      : "",
  );
  const [sleepStartHour, setSleepStartHour] = useState(DEFAULT_SLEEP_START);
  const [sleepEndHour, setSleepEndHour] = useState(DEFAULT_SLEEP_END);

  const sweatNum = parseFloat(sweatKg);
  const sweatValid = !Number.isNaN(sweatNum) && sweatNum >= 0.1 && sweatNum <= 10;

  const hoursNum = parseInt(hoursUntilFight, 10);
  const hoursValid = !Number.isNaN(hoursNum) && hoursNum >= 1 && hoursNum <= 48;

  // Sleep window is only relevant when the gap spans overnight.
  const spansOvernight = hoursValid && hoursNum >= OVERNIGHT_THRESHOLD_HOURS;

  const canSubmit = sweatValid && hoursValid && !isLoading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void onGenerate({
      sweatKg: sweatNum,
      hoursUntilFight: hoursNum,
      sleepStartHour: spansOvernight ? sleepStartHour : null,
      sleepEndHour: spansOvernight ? sleepEndHour : null,
    });
  };

  return (
    <div className="relative rounded-2xl card-surface border border-primary/25 overflow-hidden">
      <WizardAuroraBackground intensity="subtle" />
      <div className="relative p-4">
        {/* ChapterHead */}
        <header className="mb-4">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1.5"
            style={{ color: hsl(BLUE) }}
          >
            Chapter 03 · The Scale
          </p>
          <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">
            Step on the scale.
          </h2>
        </header>

        {/* Field: Kilos sweated off */}
        <Field label="Kilos sweated off">
          <CenteredNumberInput
            value={sweatKg}
            onChange={setSweatKg}
            placeholder="2.0"
            inputMode="decimal"
            step={0.1}
            focusToken={BLUE}
          />
        </Field>

        {/* Field: Hours until you fight */}
        <Field label="Hours until you fight" className="mt-4">
          <CenteredNumberInput
            value={hoursUntilFight}
            onChange={setHoursUntilFight}
            placeholder="24"
            inputMode="numeric"
            step={1}
            min={1}
            max={48}
            focusToken={BLUE}
          />
        </Field>

        {/* Sleep window: only when the gap spans overnight */}
        {spansOvernight && (
          <div
            className="mt-4 rounded-xl border surface-inset p-3"
            style={{ borderColor: hsl(BLUE, 0.2) }}
          >
            <p className="mb-3 text-center text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80 leading-none">
              Sleep window
            </p>

            {/* Sleep → wake steppers. Sides are clear from the order, so the
                Sleep/Wake column labels are dropped. */}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 items-center">
              <SleepHourStepper
                label="Sleep"
                value={sleepStartHour}
                onChange={setSleepStartHour}
              />
              <span
                aria-hidden
                className="text-[14px] font-bold leading-none text-center"
                style={{ color: hsl(BLUE, 0.7) }}
              >
                →
              </span>
              <SleepHourStepper
                label="Wake"
                value={sleepEndHour}
                onChange={setSleepEndHour}
              />
            </div>
          </div>
        )}

        {/* PrimaryCta */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-bold text-white relative overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-60 disabled:active:scale-100 border border-primary/30"
          style={{
            background: `linear-gradient(135deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})`,
            boxShadow: `0 8px 28px ${hsl(BLUE, 0.45)}`,
          }}
        >
          <WizardAuroraBackground intensity="subtle" motes={false} />
          <span className="relative flex items-center gap-2">
            <Droplets className="h-4 w-4 shrink-0" />
            <span className="truncate">{isLoading ? "Generating…" : "Start rehydrating"}</span>
          </span>
        </button>

        {error && (
          <p className="mt-2 text-[12px] text-destructive leading-snug">{error}</p>
        )}
      </div>
    </div>
  );
}

/** A labelled field group with consistent label spacing and a left edge. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A full-width numeric input with the value centered. Units aren't shown
 * inline — the field label above ("Kilos sweated off" / "Hours until you
 * fight") already carries them.
 */
function CenteredNumberInput({
  value,
  onChange,
  placeholder,
  inputMode,
  step,
  min,
  max,
  focusToken,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  inputMode: "decimal" | "numeric";
  step: number;
  min?: number;
  max?: number;
  focusToken: string;
}): JSX.Element {
  return (
    <input
      type="number"
      inputMode={inputMode}
      step={step}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-0 rounded-xl surface-inset border border-border/60 px-3 py-2.5 text-center text-[18px] font-bold tabular-nums text-foreground outline-none transition-colors"
      style={{ caretColor: hsl(focusToken) }}
      onFocus={(e) => (e.currentTarget.style.borderColor = hsl(focusToken))}
      onBlur={(e) => (e.currentTarget.style.borderColor = "")}
    />
  );
}

/** Two-digit "HH:00" stepper for a sleep boundary, clamped to [0, 23]. */
function SleepHourStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}): JSX.Element {
  const set = (next: number) => onChange(((next % 24) + 24) % 24);
  const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        aria-label={`Decrease ${label} hour`}
        onClick={() => set(value - 1)}
        className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-muted/30 border border-border/50 text-foreground/80 text-[14px] font-bold leading-none active:scale-95 transition-transform"
      >
        −
      </button>
      <span className="flex-1 min-w-0 text-center text-[15px] font-bold tabular-nums text-foreground leading-none">
        {fmt(value)}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label} hour`}
        onClick={() => set(value + 1)}
        className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-muted/30 border border-border/50 text-foreground/80 text-[14px] font-bold leading-none active:scale-95 transition-transform"
      >
        +
      </button>
    </div>
  );
}
