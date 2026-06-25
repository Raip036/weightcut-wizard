// RehydrationTimeline: full hour-by-hour rehydration plan.
//
// Expands a handful of sparse "anchor" hours into a complete H+0 … H+gapHours
// plan (missing hours are linearly interpolated), then PRESENTS it as a
// phone-readable SUMMARY stat band + COLLAPSIBLE phase cards. Each phase folds
// its hours into one scannable header (hour range + total ml + headline cue);
// expanding reveals comfortable full-width per-hour rows (big fluid ml, Na/carb
// chips, cue, MEAL tag + meal name). Sleep is its own collapsed block.
//
// 2026-06-19: the backend now emits a dense per-hour plan carrying sodium (mg)
// + carbs (g) + an `isSleep` flag. `expandHours` carries those through; the
// display surfaces Na/carbs on each row and shows SLEEP rows as "no intake".
// Pure presentational: no Convex, no business logic.
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Droplet, AlertTriangle, Moon, ChevronDown } from "lucide-react";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { MedicalDisclaimerBanner } from "@/components/protocol/MedicalDisclaimerBanner";

// ── Public types ─────────────────────────────────────────────────────

export interface RehydrationAnchor {
  /** Hours after weigh-in, e.g. 0, 3, 8, 16, 24. Sparse input. */
  hourOffset: number;
  /** Fluid volume for this hour in millilitres. */
  liquidsMl: number;
  /** Short title, e.g. "Front-load". */
  label?: string;
  /** Fluid composition copy, e.g. "ORS + electrolytes". */
  liquidsComposition?: string;
  /** Food copy. Presence of this marks the hour as a meal. */
  foodCopy?: string;
  /** Free-form notes / cue. */
  notes?: string;
  // ── New rich shape (backend now emits every hour), preferred when present ──
  /** Imperative cue for the hour. Preferred over notes/foodCopy. */
  cue?: string;
  /** Explicit meal flag from the generator. */
  isMeal?: boolean;
  /** Meal name; rendered as the bold lead-in on meal rows. */
  mealLabel?: string | null;
  /** Running cumulative ml through this hour (unused in layout, kept for parity). */
  cumulativeMl?: number;
  // ── Hourly rehydrate/refeed additions (2026-06-19) ──
  /** Sodium delivered with this hour's fluid, mg. */
  sodiumMg?: number;
  /** Carbohydrate to ingest this hour, g. */
  carbG?: number;
  /** True for hours inside the sleep window (no intake). */
  isSleep?: boolean;
  /** Deterministic phase classification from the generator. */
  phase?: string;
}

export interface RehydrationTimelineProps {
  /** Sparse anchor hours. Order does not matter. */
  anchors: RehydrationAnchor[];
  /** Weigh-in → fight gap in hours. Rows render H+0 … H+gapHours inclusive. */
  gapHours: number;
  /** Total litres target for the header line. Omit to hide the "L" part. */
  totalLitresTarget?: number;
  /**
   * When true the deficit couldn't be safely replaced inside the available
   * waking hours, surface a "you cut too much for this gap" warning.
   */
  deficitTooLarge?: boolean;
  className?: string;
}

// Phase a given hour belongs to. Walkout is always the final hour.
// The backend `phase` field is a free string; these are the values we know
// how to classify/style. Unknown strings still render (title-cased fallback).
type Phase =
  | "front-load"
  | "refeed"
  | "pre-sleep"
  | "sleep"
  | "wake-dose"
  | "top-up"
  | "pre-fight"
  // legacy strings still emitted by older payloads
  | "overnight"
  | "walkout";

/** A fully-expanded, render-ready hour row. */
export interface ExpandedHour {
  hourOffset: number;
  /** Fluid in ml. `null` => render an em-dash (walkout / sleep with no fluid). */
  liquidsMl: number | null;
  /** Sodium in mg for the hour, or null when unknown / sleep. */
  sodiumMg: number | null;
  /** Carbs in g for the hour, or null when unknown / sleep. */
  carbG: number | null;
  /** Cue text shown in the notes column. */
  cue: string;
  /** Bold lead-in (label) rendered before the cue, when present. */
  lead?: string;
  isMeal: boolean;
  isSleep: boolean;
  phase: Phase;
}

const DEFAULT_CUE = "Sip steadily. Water + electrolytes.";
const SLEEP_CUE = "Sleep, no intake";

// Functional-palette tokens are space-separated RGB triplets in index.css
// (e.g. `--func-hydration-cyan: 18 202 230`), so they compose via `rgb(...)`.
const CYAN = "var(--func-hydration-cyan)";
const AMBER = "var(--func-warning-yellow)";
const GREEN = "var(--func-recovery-green)";
const CARBS = "var(--func-carbs-orange)";

// ── Helpers ──────────────────────────────────────────────────────────

/** Classify an hour into a rehydration phase. `gapHours` is the walkout. */
function phaseForHour(hour: number, gapHours: number): Phase {
  if (hour >= gapHours) return "walkout";
  if (hour <= 2) return "front-load";
  if (hour <= 8) return "refeed";
  if (hour <= 15) return "overnight";
  return "top-up"; // 16 .. gapHours - 1
}

/** First non-empty trimmed string from the list, or undefined. */
function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Round to the nearest 50ml; used for interpolated values. */
function roundTo50(ml: number): number {
  return Math.round(ml / 50) * 50;
}

/**
 * Expand sparse anchors into every hour H+0 … H+gapHours inclusive.
 * Anchored hours use their own values (cue = foodCopy ?? notes ?? composition
 * ?? label; isMeal = !!foodCopy). Gaps are linearly interpolated (rounded to
 * 50ml) with a default cue; ends hold the nearest anchor's volume. The walkout
 * hour shows `null` fluid when its anchor is absent or zero. Sleep hours (from
 * the rich `isSleep` flag) show `null` fluid + the sleep cue.
 * Pure + exported so it can be unit-tested independently of React.
 */
export function expandHours(
  anchors: RehydrationAnchor[],
  gapHours: number,
): ExpandedHour[] {
  // Defensive: render through the later of the requested gap and the highest
  // anchor offset, so a dense payload always shows all its hours even if the
  // caller's gapHours is stale/0.
  const maxAnchor = anchors.reduce(
    (m, a) => Math.max(m, Math.round(a.hourOffset)),
    0,
  );
  const lastHour = Math.max(Math.floor(gapHours) || 0, maxAnchor, 0);

  // Index anchors by hour (later duplicates win, last write).
  const byHour = new Map<number, RehydrationAnchor>();
  for (const a of anchors) {
    byHour.set(Math.round(a.hourOffset), a);
  }

  // Sorted unique anchor offsets that fall within range, for interpolation.
  const sortedOffsets = [...byHour.keys()]
    .filter((h) => h >= 0 && h <= lastHour)
    .sort((x, y) => x - y);

  const interpolate = (hour: number): number => {
    if (sortedOffsets.length === 0) return 0;

    // Find bounding anchors.
    let lower: number | undefined;
    let upper: number | undefined;
    for (const off of sortedOffsets) {
      if (off <= hour) lower = off;
      if (off >= hour && upper === undefined) upper = off;
    }

    if (lower === undefined && upper !== undefined) {
      return byHour.get(upper)!.liquidsMl; // before first anchor
    }
    if (upper === undefined && lower !== undefined) {
      return byHour.get(lower)!.liquidsMl; // after last anchor
    }
    if (lower === undefined || upper === undefined) return 0;
    if (lower === upper) return byHour.get(lower)!.liquidsMl;

    const loMl = byHour.get(lower)!.liquidsMl;
    const hiMl = byHour.get(upper)!.liquidsMl;
    const t = (hour - lower) / (upper - lower);
    return roundTo50(loMl + (hiMl - loMl) * t);
  };

  const rows: ExpandedHour[] = [];
  for (let hour = 0; hour <= lastHour; hour++) {
    const anchor = byHour.get(hour);
    const isSleep = anchor?.isSleep === true;
    const basePhase = phaseForHour(hour, lastHour);
    const phase: Phase = isSleep ? "sleep" : basePhase;

    if (anchor) {
      const isMeal =
        !isSleep &&
        (anchor.isMeal ??
          !!(anchor.foodCopy && anchor.foodCopy.trim().length > 0));
      const cue = isSleep
        ? firstNonEmpty(anchor.cue) ?? SLEEP_CUE
        : firstNonEmpty(
            anchor.cue,
            anchor.foodCopy,
            anchor.notes,
            anchor.liquidsComposition,
            anchor.label,
          ) ?? DEFAULT_CUE;
      // When it's a meal, surface the meal name as the bold lead-in.
      const lead = isMeal
        ? firstNonEmpty(anchor.mealLabel ?? undefined, anchor.label)
        : undefined;

      const isWalkoutEmpty = phase === "walkout" && (anchor.liquidsMl ?? 0) <= 0;
      const noFluid = isSleep || isWalkoutEmpty;

      rows.push({
        hourOffset: hour,
        liquidsMl: noFluid ? null : anchor.liquidsMl,
        sodiumMg: isSleep ? null : anchor.sodiumMg ?? null,
        carbG: isSleep ? null : anchor.carbG ?? null,
        cue,
        lead,
        isMeal,
        isSleep,
        phase,
      });
      continue;
    }

    // No anchor: interpolate fluid, default cue. Walkout w/o anchor → null.
    rows.push({
      hourOffset: hour,
      liquidsMl: phase === "walkout" ? null : interpolate(hour),
      sodiumMg: null,
      carbG: null,
      cue: phase === "walkout" ? "Fight time. Full and strong." : DEFAULT_CUE,
      isMeal: false,
      isSleep: false,
      phase,
    });
  }

  return rows;
}

// Plain-language display copy for each phase string. Backend may emit any of
// these (incl. legacy `overnight`/`walkout`); unknown strings fall back to a
// title-cased version of the raw key.
const PHASE_TITLES: Record<string, string> = {
  "front-load": "Drink up",
  refeed: "Eat & drink",
  "pre-sleep": "Before bed",
  sleep: "Sleep",
  "wake-dose": "After waking",
  "top-up": "Steady sips",
  "pre-fight": "Walkout",
  // legacy
  overnight: "Sleep",
  walkout: "Walkout",
};

/** Title-case an unknown phase key, e.g. "cool-down" → "Cool Down". */
function titleCasePhase(phase: string): string {
  return phase
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Human-readable header for a phase group. */
function phaseTitle(phase: string): string {
  return PHASE_TITLES[phase] ?? titleCasePhase(phase) ?? "Phase";
}

/** True when the phase represents the final walkout (incl. legacy/new keys). */
function isWalkoutPhase(phase: string): boolean {
  return phase === "walkout" || phase === "pre-fight";
}

function fmtMl(ml: number): string {
  return `${Math.round(ml)} ml`;
}
function fmtSodiumG(mg: number): string {
  if (mg >= 1000) return `${(mg / 1000).toFixed(1)} g`;
  return `${Math.round(mg)} mg`;
}
function rangeLabel(a: number, b: number): string {
  return a === b ? `H+${a}` : `H+${a} → H+${b}`;
}

// ── Phase grouping ───────────────────────────────────────────────────

interface PhaseGroup {
  key: string;
  phase: Phase;
  title: string;
  isSleep: boolean;
  isWalkout: boolean;
  hours: ExpandedHour[];
  startH: number;
  endH: number;
  totalMl: number;
  mealCount: number;
  headlineCue: string;
}

/**
 * Collapse the flat expanded-hour list into contiguous phase groups. A run
 * breaks when either the `phase` changes OR the sleep flag flips, so a sleep
 * block becomes its own card.
 */
function groupHours(hours: ExpandedHour[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const h of hours) {
    const last = groups[groups.length - 1];
    const sameRun =
      last && last.phase === h.phase && last.isSleep === h.isSleep;
    if (sameRun) {
      last.hours.push(h);
    } else {
      groups.push({
        key: `${h.phase}-${h.hourOffset}-${h.isSleep ? "s" : "a"}`,
        phase: h.phase,
        title: phaseTitle(h.phase),
        isSleep: h.isSleep,
        isWalkout: isWalkoutPhase(h.phase),
        hours: [h],
        startH: h.hourOffset,
        endH: h.hourOffset,
        totalMl: 0,
        mealCount: 0,
        headlineCue: "",
      });
    }
  }
  // Second pass: derive summaries.
  for (const g of groups) {
    g.endH = g.hours[g.hours.length - 1].hourOffset;
    g.totalMl = g.hours.reduce((s, h) => s + (h.liquidsMl ?? 0), 0);
    g.mealCount = g.hours.filter((h) => h.isMeal).length;
    // Headline never names a specific food; meal phases read as "Fuel up";
    // otherwise fall back to the first hour's cue.
    g.headlineCue = g.isSleep
      ? "No intake, rest"
      : g.mealCount > 0
        ? "Meal + fluids"
        : g.hours[0]?.cue?.trim() || "Sip steadily";
  }
  return groups;
}

// ── Summary stat tile ────────────────────────────────────────────────

function StatTile({
  icon,
  value,
  label,
  accent,
}: {
  icon: IonIconName;
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="surface-inset flex flex-col gap-1.5 rounded-2xl p-3">
      <span style={accent ? { color: `rgb(${accent})` } : undefined}>
        <Icon name={icon} size={16} className="opacity-90" />
      </span>
      <span
        className="display-number text-[19px] leading-none tabular-nums"
        style={accent ? { color: `rgb(${accent})` } : undefined}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70">
        {label}
      </span>
    </div>
  );
}

// ── Per-hour row (inside an expanded phase) ──────────────────────────

function HourRow({ h }: { h: ExpandedHour }) {
  if (h.isSleep) {
    return (
      <div className="flex items-center gap-3 py-2.5">
        <span className="w-12 shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground/45">
          H+{h.hourOffset}
        </span>
        <Moon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
        <span className="flex-1 text-[12.5px] text-muted-foreground/45">
          {SLEEP_CUE}
        </span>
        <span className="text-[13px] tabular-nums text-muted-foreground/35">
          -
        </span>
      </div>
    );
  }

  const fluid = h.liquidsMl ?? 0;
  const hasFluid = h.liquidsMl !== null && fluid > 0;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl py-2.5",
        h.isMeal && "-mx-2 bg-func-recovery-green/[0.07] px-2",
      )}
    >
      {/* Hour anchor */}
      <span
        className="w-12 shrink-0 pt-[1px] text-[13px] font-bold tabular-nums"
        style={{ color: `rgb(${CYAN})` }}
      >
        H+{h.hourOffset}
      </span>

      {/* Body: cue + macro line */}
      <div className="min-w-0 flex-1">
        {/* Meal rows show a neutral FUEL chip; the specific food suggestions
            live in the "Meal ideas" box below, not prescribed per hour. */}
        {h.isMeal && (
          <div className="flex items-center gap-2">
            <span className="inline-flex min-w-[46px] items-center justify-center rounded-md border border-func-recovery-green/30 bg-func-recovery-green/10 px-1.5 py-[2px] text-[9px] font-extrabold uppercase tracking-[0.12em] text-func-recovery-green">
              Meal
            </span>
            {(h.carbG ?? 0) > 0 && (
              <span className="truncate text-[13px] font-semibold text-foreground/90 tabular-nums">
                ~{Math.round(h.carbG ?? 0)} g carbs
              </span>
            )}
          </div>
        )}
        <p
          className={cn(
            "text-[12.5px] leading-[1.4] text-muted-foreground",
            h.isMeal && "mt-0.5",
          )}
        >
          {h.cue}
        </p>
        {/* macro chips */}
        {(((h.sodiumMg ?? 0) > 0) || ((h.carbG ?? 0) > 0)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
            {(h.sodiumMg ?? 0) > 0 && (
              <span className="text-primary/80">
                <span className="text-muted-foreground/50">Na</span>{" "}
                {Math.round(h.sodiumMg ?? 0)} mg
              </span>
            )}
            {(h.carbG ?? 0) > 0 && !h.isMeal && (
              <span className="text-func-carbs-orange/85">
                <span className="text-muted-foreground/50">Carb</span>{" "}
                {Math.round(h.carbG ?? 0)} g
              </span>
            )}
          </div>
        )}
      </div>

      {/* Fluid amount: right rail */}
      <div className="shrink-0 pt-[1px] text-right">
        <span
          className="block text-[14px] font-bold tabular-nums"
          style={{ color: `rgb(${CYAN})` }}
        >
          {hasFluid ? Math.round(fluid) : "-"}
        </span>
        {hasFluid && (
          <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50">
            ml
          </span>
        )}
      </div>
    </div>
  );
}

// ── Collapsible phase card ───────────────────────────────────────────

function PhaseCard({
  group,
  open,
  onToggle,
}: {
  group: PhaseGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const accent = group.isWalkout ? GREEN : group.isSleep ? null : CYAN;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-[rgb(var(--neutral-800))]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-white/[0.02]"
      >
        {/* Phase icon, no background box. Walkout uses a finish-line flag. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
          {group.isSleep ? (
            <Moon className="h-5 w-5 text-muted-foreground/55" />
          ) : group.isWalkout ? (
            <span style={{ color: `rgb(${accent})` }}>
              <Icon name="flagOutline" size={20} />
            </span>
          ) : (
            <Droplet className="h-5 w-5" style={{ color: `rgb(${accent})` }} />
          )}
        </span>

        {/* Title + summary */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Hour range IS the title (bold). The generic phase words
                ("Drink up" etc.) are dropped; only the meaningful Sleep /
                Walkout keep a small secondary label. */}
            <span
              className={cn(
                "text-[14px] font-bold tabular-nums",
                group.isSleep ? "text-muted-foreground/70" : "text-foreground",
              )}
            >
              {rangeLabel(group.startH, group.endH)}
            </span>
            {(group.isSleep || group.isWalkout) && (
              <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/55">
                {group.title}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground/75">
            {group.isSleep ? (
              "No intake, rest"
            ) : (
              <>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: accent ? `rgb(${accent})` : undefined }}
                >
                  {group.totalMl > 0 ? fmtMl(group.totalMl) : "no intake"}
                </span>
                {group.mealCount > 0 && (
                  <span className="text-muted-foreground/55">
                    {" · "}
                    {group.mealCount} meal{group.mealCount > 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-muted-foreground/45">
                  {" · "}
                  {group.headlineCue}
                </span>
              </>
            )}
          </p>
        </div>

        {/* Chevron */}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0 text-muted-foreground/50"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-4 pb-2 pt-1">
              {/* Walkout always surfaces a fast-carb prompt, regardless of the
                  generated cue, so it can't be missed at the wire. */}
              {group.isWalkout && (
                <div
                  className="mt-2.5 mb-1 flex items-start gap-2 rounded-xl border p-2.5"
                  style={{
                    borderColor: `rgb(${CARBS} / 0.35)`,
                    background: `rgb(${CARBS} / 0.1)`,
                  }}
                >
                  <span
                    className="mt-[1px] shrink-0"
                    style={{ color: `rgb(${CARBS})` }}
                  >
                    <Icon name="flashOutline" size={14} />
                  </span>
                  <p
                    className="text-[12.5px] font-semibold leading-snug"
                    style={{ color: `rgb(${CARBS})` }}
                  >
                    Fast sugar now: gummy bears, honey, or a gel as you walk
                    out.
                  </p>
                </div>
              )}
              <div className="space-y-1">
                {group.hours.map((h) => (
                  <HourRow key={h.hourOffset} h={h} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Meal ideas box ───────────────────────────────────────────────────

const REFUEL_MEALS = [
  "White rice + lean chicken",
  "Pasta + light tomato sauce",
  "Oatmeal with water + honey",
  "White-bread sandwich (jam or turkey)",
  "Mashed white potato + a little salt",
];

const QUICK_SNACKS = [
  "Bananas / ripe fruit",
  "Rice cakes, pretzels, crackers",
  "Low-fat yogurt + honey",
  "Sports drink + a salty snack",
  "White toast + honey/jam",
];

/** Static "what to eat" reference. Pure presentational, no inputs. */
function MealIdeasBox() {
  return (
    <div className="card-surface mt-5 rounded-2xl p-4 border border-primary/15">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
          Meal ideas
        </p>
        <p className="text-[10px] text-muted-foreground/65">
          high-carb · easy · low-fat
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-2 gap-3">
        <MealIdeaList
          heading="Refuel"
          items={REFUEL_MEALS}
          dotColor="hsl(165 38% 56% / 1)"
        />
        <MealIdeaList
          heading="Snacks"
          items={QUICK_SNACKS}
          dotColor="hsl(30 70% 62% / 1)"
        />
      </div>

      {/* Foods to avoid */}
      <div className="mt-3 surface-inset rounded-xl px-3 py-2.5 relative overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: `rgb(${AMBER} / 0.6)` }}
        />
        <div className="flex items-start gap-2">
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-px"
            style={{ background: `rgb(${AMBER} / 0.16)`, color: `rgb(${AMBER})` }}
          >
            <Icon name="warningOutline" size={12} />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            <span className="font-semibold" style={{ color: `rgb(${AMBER})` }}>
              Avoid{" "}
            </span>
            fried/greasy, high-fat, high-fibre, very large meals, spicy or
            creamy foods, and anything new/untested.
          </p>
        </div>
      </div>
    </div>
  );
}

function MealIdeaList({
  heading,
  items,
  dotColor,
}: {
  heading: string;
  items: string[];
  dotColor: string;
}) {
  return (
    <div className="rounded-xl surface-inset p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: dotColor }}
        />
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
          {heading}
        </p>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-[11.5px] leading-snug text-foreground/80">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function RehydrationTimeline({
  anchors,
  gapHours,
  totalLitresTarget,
  deficitTooLarge,
  className,
}: RehydrationTimelineProps) {
  const rows = useMemo(() => expandHours(anchors, gapHours), [anchors, gapHours]);
  const groups = useMemo(() => groupHours(rows), [rows]);

  // Use the actual last rendered hour for the header so it matches the rows.
  const effectiveGap = rows.length ? rows[rows.length - 1].hourOffset : gapHours;

  // Summary totals derived from the expanded plan.
  const summedLitres = rows.reduce((s, r) => s + (r.liquidsMl ?? 0), 0) / 1000;
  const totalLitres =
    totalLitresTarget !== undefined && totalLitresTarget > 0
      ? totalLitresTarget
      : summedLitres;
  const totalCarb = rows.reduce((s, r) => s + (r.carbG ?? 0), 0);
  const totalSodium = rows.reduce((s, r) => s + (r.sodiumMg ?? 0), 0);
  const mealCount = rows.filter((r) => r.isMeal).length;

  // Default: expand the first 2 active (non-sleep) phases, collapse the rest.
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    let active = 0;
    for (const g of groups) {
      if (!g.isSleep && active < 2) {
        set.add(g.key);
        active += 1;
      }
    }
    return set;
  }, [groups]);

  const [openKeys, setOpenKeys] = useState<Set<string>>(initialOpen);

  const toggle = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section
      role="region"
      aria-label="Hour-by-hour rehydration plan"
      className={cn("w-full", className)}
    >
      {/* Eyebrow + title */}
      <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
        Step 2 · Rehydration plan
      </p>
      <h2 className="mt-1 text-[20px] font-bold leading-tight text-foreground">
        Replace fluid over {effectiveGap} h
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground/75">
        Weigh-in → walkout · {groups.length} phase
        {groups.length === 1 ? "" : "s"}, paced hour by hour.
      </p>

      {/* Shortfall warning: the cut was too deep to safely replace in time. */}
      {deficitTooLarge && (
        <div
          className="mt-4 flex items-start gap-2.5 rounded-2xl border p-3.5"
          style={{
            borderColor: `rgb(${AMBER} / 0.35)`,
            background: `rgb(${AMBER} / 0.08)`,
          }}
        >
          <AlertTriangle
            className="mt-[1px] h-4 w-4 shrink-0"
            style={{ color: `rgb(${AMBER})` }}
          />
          <div>
            <p
              className="text-[12.5px] font-bold"
              style={{ color: `rgb(${AMBER})` }}
            >
              You cut too much for this gap
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-foreground/85">
              There isn't enough waking time to safely replace all of it. The
              plan front-loads what's safe (capped ~1 L/h), so expect to walk in
              slightly under-replaced.
            </p>
          </div>
        </div>
      )}

      {/* Summary stat band */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <StatTile
          icon="waterOutline"
          value={`${Number(totalLitres.toFixed(1))} L`}
          label="Total fluid"
          accent={CYAN}
        />
        <StatTile
          icon="timeOutline"
          value={`${effectiveGap} h`}
          label="Window"
        />
        <StatTile
          icon="flameOutline"
          value={`${Math.round(totalCarb)} g`}
          label="Carbs"
          accent={CARBS}
        />
        <StatTile
          icon="restaurantOutline"
          value={`${mealCount}`}
          label={`${fmtSodiumG(totalSodium)} sodium · meals`}
        />
      </div>

      {/* Phase cards */}
      <div className="mt-5 flex flex-col gap-2.5">
        {groups.map((g) => (
          <PhaseCard
            key={g.key}
            group={g}
            open={openKeys.has(g.key)}
            onToggle={() => toggle(g.key)}
          />
        ))}
      </div>

      {/* What to eat: neutral reference (specific foods live here, not per-hour). */}
      <MealIdeasBox />

      {/* Compact stop-immediately notice — rehydration follows the dehydration
          cut, so the abort triggers belong next to it. */}
      <MedicalDisclaimerBanner variant="compact" className="mt-4" />

      {/* Footer hint */}
      <p className="mt-4 text-center text-[10.5px] text-muted-foreground/45">
        Tap a phase to expand its hour-by-hour breakdown.
      </p>
    </section>
  );
}
