// WP-T17: FeelChecksList (values + tier + AI feedback)
//
// Each row is a tappable summary of the most recent server-stored feel-check
// value (urine colour, weight rebound, energy, headache, cramps). Tapping
// opens a per-metric bottom Sheet with a tailored input UI. On save we:
//   1. fire `weightProtocols.recordFeelCheck({ campId, metric, value })`
//      server computes `tier` deterministically and clears any stale
//      `aiFeedback`.
//   2. fire `feelCheckFeedback.generate({ campId, metric, value })`,
//      ~1-2s Groq call that writes a 1-line coach instruction back to the
//      row. The reactive `getCurrentForUser` query picks it up and the row
//      re-renders without us threading state.
//
// Tier colour drives the leading status dot AND the AI feedback line
// background. Empty rows render a neutral "Tap to log" hint with no tier
// colour.
//
// Phase gating lives on the page (WeightProtocol.tsx). This component
// renders identically regardless of phase.
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type FeelCheckMetric =
  | "urine_colour"
  | "weigh_back_kg"
  | "energy_1to10"
  | "headache"
  | "no_cramps";

export type FeelCheckTier = "green" | "amber" | "red";

export interface FeelCheck {
  metric: FeelCheckMetric;
  /** Raw value the user last logged (string-encoded per schema docs). */
  value?: string;
  /** Server-computed tier: drives the leading dot + feedback tint. */
  tier?: FeelCheckTier;
  /** 1-line AI instruction. Cached on the row; arrives ~1-2s after save. */
  aiFeedback?: string;
  /** Unix-ms timestamp of the most recent log. */
  loggedAt?: number;
}

export interface FeelChecksListProps {
  /** Active fight camp id. `null` disables interactions (no active camp). */
  campId: Id<"fight_camps"> | null;
  /** Used to derive the weigh-back target hint inside that metric's sheet. */
  cutDepthKg?: number;
  checks: FeelCheck[];
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Static metric copy (label, icon, sheet title, "why" caption)
// ─────────────────────────────────────────────────────────────────────────

interface MetricSpec {
  label: string;
  icon: IonIconName;
  sheetTitle: string;
  /** Sub-headline shown inside the sheet, beneath the input. */
  whyCopy: string;
}

const METRIC_SPECS: Record<FeelCheckMetric, MetricSpec> = {
  urine_colour: {
    label: "Urine colour",
    icon: "waterOutline",
    sheetTitle: "Urine colour",
    whyCopy:
      "Best early-warning signal for dehydration. Match the closest shade; pale straw means you're on track.",
  },
  weigh_back_kg: {
    label: "Weight rebound",
    icon: "scaleOutline",
    sheetTitle: "Weight rebound",
    whyCopy:
      "Post-weigh-in body weight after ORS + first meal. Restoring 80-100% of the cut depth signals the rehydration plan is landing.",
  },
  energy_1to10: {
    label: "Energy",
    icon: "flashOutline",
    sheetTitle: "Energy level",
    whyCopy:
      "Subjective gas-in-the-tank. Below 6 the day before a fight is a flag, so call your corner.",
  },
  headache: {
    label: "Headache",
    icon: "medkitOutline",
    sheetTitle: "Headache",
    whyCopy:
      "Mild = electrolyte imbalance, usually fixed by sipping ORS. Severe = stop cutting and contact your corner.",
  },
  no_cramps: {
    label: "Cramps",
    icon: "bodyOutline",
    sheetTitle: "Cramps",
    whyCopy:
      "Any cramping during refeed means sodium is lagging fluid. Add a pinch of salt to the next ORS bottle.",
  },
};

// Urine chart 1 → 8, hex values approximate the Armstrong chart.
const URINE_CHART: ReadonlyArray<{ value: string; hex: string }> = [
  { value: "1", hex: "#f7f4d3" },
  { value: "2", hex: "#f3eaa8" },
  { value: "3", hex: "#eedf78" },
  { value: "4", hex: "#e7cf4f" },
  { value: "5", hex: "#d9b837" },
  { value: "6", hex: "#cba62b" },
  { value: "7", hex: "#a78420" },
  { value: "8", hex: "#7a5c14" },
];

const HEADACHE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "no", label: "No" },
  { value: "mild", label: "Mild" },
  { value: "severe", label: "Severe" },
];

const CRAMP_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "none", label: "None" },
  { value: "calf", label: "Calf" },
  { value: "thigh", label: "Thigh" },
  { value: "back", label: "Back" },
  { value: "other", label: "Other" },
];

// ─────────────────────────────────────────────────────────────────────────
// Tier styling: single source of truth so dot + feedback line stay synced.
// ─────────────────────────────────────────────────────────────────────────

function tierDotClasses(tier: FeelCheckTier | undefined): string {
  switch (tier) {
    case "green":
      return "bg-func-recovery-green shadow-[0_0_0_3px_rgb(var(--func-recovery-green)/0.18)]";
    case "amber":
      return "bg-func-warning-yellow shadow-[0_0_0_3px_rgb(var(--func-warning-yellow)/0.18)]";
    case "red":
      return "bg-func-danger-red shadow-[0_0_0_3px_rgb(var(--func-danger-red)/0.22)]";
    default:
      return "bg-muted-foreground/40";
  }
}

function feedbackToneClasses(tier: FeelCheckTier | undefined): string {
  switch (tier) {
    case "green":
      return "bg-func-recovery-green/[0.06] text-func-recovery-green border-func-recovery-green/30";
    case "amber":
      return "bg-func-warning-yellow/[0.06] text-func-warning-yellow border-func-warning-yellow/30";
    case "red":
      return "bg-func-danger-red/[0.06] text-func-danger-red border-func-danger-red/30";
    default:
      return "bg-muted/30 text-muted-foreground border-border/40";
  }
}

// Convert a stored value back into the human display string for the row.
function formatValueDisplay(metric: FeelCheckMetric, value: string): string {
  switch (metric) {
    case "urine_colour":
      return `Shade ${value}`;
    case "weigh_back_kg": {
      const n = parseFloat(value);
      return Number.isFinite(n) ? `${n.toFixed(1)} kg` : value;
    }
    case "energy_1to10":
      return `${value} / 10`;
    case "headache": {
      const opt = HEADACHE_OPTIONS.find((o) => o.value === value);
      return opt ? opt.label : value;
    }
    case "no_cramps": {
      const opt = CRAMP_OPTIONS.find((o) => o.value === value);
      return opt ? opt.label : value;
    }
    default:
      return value;
  }
}

// "X min ago" / "Xh ago" / "just now", keeps the row dense.
function formatTimeAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level list
// ─────────────────────────────────────────────────────────────────────────

export function FeelChecksList({
  campId,
  cutDepthKg,
  checks,
  className = "",
}: FeelChecksListProps) {
  const [activeMetric, setActiveMetric] = useState<FeelCheckMetric | null>(
    null,
  );
  // Mirrors the row that just saved so we can render a "Thinking…" line
  // while the AI feedback action is in flight.
  const [pendingFeedback, setPendingFeedback] = useState<
    Partial<Record<FeelCheckMetric, true>>
  >({});

  const recordCheck = useMutation(api.weightProtocols.recordFeelCheck);
  const generateFeedback = useAction(api.feelCheckFeedback.generate);

  // Re-tick once per minute so the "X min ago" strings stay fresh without
  // requiring server round-trips.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const disabled = campId === null;
  const activeSpec = activeMetric ? METRIC_SPECS[activeMetric] : null;
  const activeCheck = useMemo(
    () => (activeMetric ? checks.find((c) => c.metric === activeMetric) : null),
    [activeMetric, checks],
  );

  // Clear any "Thinking…" placeholder once the row carries fresh aiFeedback.
  useEffect(() => {
    setPendingFeedback((prev) => {
      let mutated = false;
      const next = { ...prev };
      for (const c of checks) {
        if (next[c.metric] && c.aiFeedback) {
          delete next[c.metric];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [checks]);

  const handleSave = async (metric: FeelCheckMetric, value: string) => {
    if (disabled || !campId) return;
    void triggerHapticSelection();
    setPendingFeedback((prev) => ({ ...prev, [metric]: true }));
    setActiveMetric(null);

    try {
      await recordCheck({ campId, metric, value });
    } catch {
      // Roll back the "thinking" placeholder so the empty state returns.
      setPendingFeedback((prev) => {
        const next = { ...prev };
        delete next[metric];
        return next;
      });
      return;
    }

    // Fire-and-forget feedback. Failures inside the action are swallowed
    // server-side; the reactive query simply never gets an `aiFeedback`
    // update and the "Thinking…" line falls off after a timeout.
    try {
      await generateFeedback({ campId, metric, value });
    } catch {
      // Silent: UI keeps the value + tier from the deterministic compute.
      setPendingFeedback((prev) => {
        const next = { ...prev };
        delete next[metric];
        return next;
      });
    }
  };

  return (
    <div
      className={`card-surface rounded-2xl border border-border/50 p-4 ${className}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          Feel checks
        </p>
        <p className="text-[10px] text-muted-foreground/70">Tap to log</p>
      </div>

      <div className="mt-2 divide-y divide-border/40">
        {checks.map((c) => {
          const spec = METRIC_SPECS[c.metric];
          const hasValue = !!c.value;
          const isThinking = !!pendingFeedback[c.metric] && !c.aiFeedback;
          return (
            <button
              key={c.metric}
              type="button"
              aria-label={`Log ${spec.label}`}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                void triggerHapticSelection();
                setActiveMetric(c.metric);
              }}
              className={`w-full flex items-start gap-3 py-3 text-left ${
                disabled ? "opacity-50 cursor-not-allowed" : "active:opacity-80"
              }`}
            >
              {/* Icon column */}
              <span
                aria-hidden="true"
                className="mt-0.5 h-9 w-9 shrink-0 rounded-xl border border-border/40 bg-muted/20 flex items-center justify-center text-muted-foreground"
              >
                <Icon name={spec.icon} size={18} />
              </span>

              {/* Label + status */}
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-foreground leading-snug">
                    {spec.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${tierDotClasses(c.tier)}`}
                  />
                  {hasValue ? (
                    <span className="text-[12px] font-medium text-foreground/85 tabular-nums">
                      {formatValueDisplay(c.metric, c.value!)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground italic">
                      Tap to log
                    </span>
                  )}
                  {c.loggedAt !== undefined && (
                    <span className="ml-auto text-[10.5px] text-muted-foreground/70 tabular-nums">
                      {formatTimeAgo(c.loggedAt, now)}
                    </span>
                  )}
                </span>

                {/* AI feedback / thinking line */}
                {isThinking && (
                  <span
                    className={`mt-1.5 block rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${feedbackToneClasses(c.tier)}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ThinkingDots />
                      Coach is reviewing…
                    </span>
                  </span>
                )}
                {!isThinking && c.aiFeedback && (
                  <span
                    className={`mt-1.5 block rounded-lg border px-2.5 py-1.5 text-[11.5px] leading-snug ${feedbackToneClasses(c.tier)}`}
                  >
                    {c.aiFeedback}
                  </span>
                )}
              </span>

              <Icon
                name="chevronForwardOutline"
                size={14}
                className="mt-2 shrink-0 text-muted-foreground/60"
              />
            </button>
          );
        })}
      </div>

      {/* Per-metric input sheet (single instance, swapped via state) */}
      <Sheet
        open={activeMetric !== null}
        onOpenChange={(open) => {
          if (!open) setActiveMetric(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <VisuallyHidden>
            <SheetTitle>{activeSpec?.sheetTitle ?? "Feel check"}</SheetTitle>
          </VisuallyHidden>

          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-1">
            <div
              className="w-10 h-1 rounded-full bg-muted-foreground/25"
              aria-hidden
            />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Feel check
              </p>
              <h2 className="text-[19px] font-bold tracking-tight">
                {activeSpec?.sheetTitle}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveMetric(null)}
              aria-label="Close"
              className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
            >
              <Icon name="closeOutline" size={16} />
            </button>
          </div>

          {/* Body: swap by metric */}
          <div className="px-5 pb-5 space-y-4">
            {activeMetric === "urine_colour" && (
              <UrineColourPicker
                initial={activeCheck?.value}
                onSave={(v) => void handleSave("urine_colour", v)}
              />
            )}
            {activeMetric === "weigh_back_kg" && (
              <WeighBackInput
                initial={activeCheck?.value}
                cutDepthKg={cutDepthKg}
                onSave={(v) => void handleSave("weigh_back_kg", v)}
              />
            )}
            {activeMetric === "energy_1to10" && (
              <EnergyPicker
                initial={activeCheck?.value}
                onSave={(v) => void handleSave("energy_1to10", v)}
              />
            )}
            {activeMetric === "headache" && (
              <HeadachePicker
                initial={activeCheck?.value}
                onSave={(v) => void handleSave("headache", v)}
              />
            )}
            {activeMetric === "no_cramps" && (
              <CrampsPicker
                initial={activeCheck?.value}
                onSave={(v) => void handleSave("no_cramps", v)}
              />
            )}

            {activeSpec && (
              <p className="pt-1 text-[11.5px] italic leading-snug text-muted-foreground">
                {activeSpec.whyCopy}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Thinking dots: three-dot bouncing indicator, respects reduced motion.
// ─────────────────────────────────────────────────────────────────────────

function ThinkingDots() {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) {
    return (
      <span aria-hidden="true" className="inline-flex gap-0.5">
        <span className="h-1 w-1 rounded-full bg-current opacity-70" />
        <span className="h-1 w-1 rounded-full bg-current opacity-70" />
        <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full bg-current"
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Save bar: reused across every input variant.
// ─────────────────────────────────────────────────────────────────────────

function SaveBar({
  disabled,
  onSave,
  caption,
}: {
  disabled: boolean;
  onSave: () => void;
  caption?: string;
}) {
  return (
    <div className="pt-2">
      {caption && (
        <p className="mb-2 text-[11.5px] text-muted-foreground">{caption}</p>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className={`w-full h-12 rounded-xl font-semibold text-[14px] transition ${
          disabled
            ? "bg-muted/40 text-muted-foreground/60 cursor-not-allowed"
            : "bg-primary text-primary-foreground active:scale-[0.99]"
        }`}
      >
        Save
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Per-metric inputs
// ─────────────────────────────────────────────────────────────────────────

function UrineColourPicker({
  initial,
  onSave,
}: {
  initial?: string;
  onSave: (value: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Tap the shade closest to your most recent sample.
      </p>
      <div className="flex gap-1.5">
        {URINE_CHART.map(({ value, hex }) => {
          const active = picked === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                void triggerHapticSelection();
                setPicked(value);
              }}
              aria-label={`Shade ${value}`}
              aria-pressed={active}
              className={`flex-1 aspect-square rounded-lg border-2 transition ${
                active
                  ? "border-primary scale-105"
                  : "border-border/30 active:scale-95"
              }`}
              style={{ backgroundColor: hex }}
            >
              <span
                className={`block text-center text-[11px] font-bold ${
                  parseInt(value, 10) <= 4 ? "text-neutral-900" : "text-white"
                }`}
              >
                {value}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
        <span>1 · Clear</span>
        <span>8 · Dark</span>
      </div>
      <SaveBar
        disabled={!picked}
        onSave={() => picked && onSave(picked)}
        caption="Target: shades 1-3 (pale straw)."
      />
    </div>
  );
}

function WeighBackInput({
  initial,
  cutDepthKg,
  onSave,
}: {
  initial?: string;
  cutDepthKg?: number;
  onSave: (value: string) => void;
}) {
  const initialNum = (() => {
    const n = parseFloat(initial ?? "");
    return Number.isFinite(n) ? n : 0;
  })();
  const [value, setValue] = useState<number>(initialNum);

  const adjust = (delta: number) => {
    void triggerHapticSelection();
    setValue((v) => {
      const next = Math.max(0, Math.round((v + delta) * 10) / 10);
      return next;
    });
  };

  const targetLow = cutDepthKg ? (cutDepthKg * 0.8).toFixed(1) : null;
  const targetHigh = cutDepthKg ? (cutDepthKg * 1.0).toFixed(1) : null;
  const caption =
    targetLow && targetHigh
      ? `Target: 80-100% of cut depth = +${targetLow} to +${targetHigh} kg.`
      : "Log how much weight you've put back on since the scale.";

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Bodyweight rebound (kg gained since weigh-in).
      </p>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-muted/20 px-3 py-4">
        <button
          type="button"
          onClick={() => adjust(-0.1)}
          aria-label="Decrease 0.1 kg"
          className="h-11 w-11 rounded-xl border border-border/40 bg-background/40 flex items-center justify-center text-foreground active:scale-95 transition"
        >
          <Icon name="removeOutline" size={18} />
        </button>
        <div className="flex-1 text-center">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={value}
            onChange={(e) => {
              const next = parseFloat(e.target.value);
              setValue(Number.isFinite(next) ? Math.max(0, next) : 0);
            }}
            className="w-full bg-transparent text-center text-[34px] font-bold tabular-nums tracking-tight text-foreground outline-none"
          />
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
            kg
          </p>
        </div>
        <button
          type="button"
          onClick={() => adjust(0.1)}
          aria-label="Increase 0.1 kg"
          className="h-11 w-11 rounded-xl border border-border/40 bg-background/40 flex items-center justify-center text-foreground active:scale-95 transition"
        >
          <Icon name="addOutline" size={18} />
        </button>
      </div>
      <SaveBar
        disabled={value <= 0}
        onSave={() => onSave(value.toFixed(1))}
        caption={caption}
      />
    </div>
  );
}

function EnergyPicker({
  initial,
  onSave,
}: {
  initial?: string;
  onSave: (value: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Rate your gas-in-the-tank right now.
      </p>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((value) => {
          const active = picked === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                void triggerHapticSelection();
                setPicked(value);
              }}
              aria-pressed={active}
              className={`h-11 rounded-lg border text-[12px] font-bold tabular-nums transition ${
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/40 bg-muted/30 text-foreground/80 active:bg-muted/50"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
        <span>1 · Crashed</span>
        <span>10 · Peak</span>
      </div>
      <SaveBar
        disabled={!picked}
        onSave={() => picked && onSave(picked)}
        caption="Target: 7+ pre-fight."
      />
    </div>
  );
}

function HeadachePicker({
  initial,
  onSave,
}: {
  initial?: string;
  onSave: (value: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Pick the closest match to how your head feels.
      </p>
      <div className="flex gap-1.5">
        {HEADACHE_OPTIONS.map((opt) => {
          const active = picked === opt.value;
          // Encode severity into the active border colour so the user sees
          // the tier they'll get before they hit save.
          const activeClass =
            opt.value === "no"
              ? "border-func-recovery-green/60 text-func-recovery-green bg-func-recovery-green/[0.06]"
              : opt.value === "mild"
                ? "border-func-warning-yellow/60 text-func-warning-yellow bg-func-warning-yellow/[0.06]"
                : "border-func-danger-red/60 text-func-danger-red bg-func-danger-red/[0.06]";
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                void triggerHapticSelection();
                setPicked(opt.value);
              }}
              aria-pressed={active}
              className={`flex-1 h-12 rounded-xl border text-[13.5px] font-semibold transition ${
                active
                  ? activeClass
                  : "border-border/40 bg-muted/30 text-foreground/80 active:bg-muted/50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <SaveBar
        disabled={!picked}
        onSave={() => picked && onSave(picked)}
        caption="Severe = stop the cut and contact your corner."
      />
    </div>
  );
}

function CrampsPicker({
  initial,
  onSave,
}: {
  initial?: string;
  onSave: (value: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial ?? null);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Any cramping in the last hour? Tap the worst spot.
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {CRAMP_OPTIONS.map((opt) => {
          const active = picked === opt.value;
          const activeClass =
            opt.value === "none"
              ? "border-func-recovery-green/60 text-func-recovery-green bg-func-recovery-green/[0.06]"
              : "border-func-warning-yellow/60 text-func-warning-yellow bg-func-warning-yellow/[0.06]";
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                void triggerHapticSelection();
                setPicked(opt.value);
              }}
              aria-pressed={active}
              className={`h-12 rounded-xl border text-[12.5px] font-semibold transition ${
                active
                  ? activeClass
                  : "border-border/40 bg-muted/30 text-foreground/80 active:bg-muted/50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <SaveBar
        disabled={!picked}
        onSave={() => picked && onSave(picked)}
        caption="Add a pinch of salt to the next ORS bottle if cramping returns."
      />
    </div>
  );
}
