/**
 * InlinePlanDisplay (v3 — 2026-05-18 revision) — generated post-onboarding
 * plan UI tuned for fighter-readability:
 *
 *   1. Hero ring (kg delta sized to fit inside the circle)
 *   2. Cal + macro stat strip (macros use the nutrition theme colors)
 *   3. Coach note (one-line plan intent, no em-dashes)
 *   4. Daily Focus block ONCE at the top (no per-week repetition)
 *   5. Phase pills stacked vertically full-width (no icons, no truncation)
 *   6. Week timeline — collapsed cards lead with the 4-tile macro grid
 *   7. Fight Week as a swipeable carousel (one big card per day)
 *   8. Plan rules + safety + tomorrow anchor + plan ID footer
 *   9. Sticky CTA
 *
 * Consumes the v2 `CutPlanSchema` shape — see `convex/_shared/aiSchemas.ts`.
 */
import { useMemo, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Sun, AlertTriangle } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

// ─── Types ───────────────────────────────────────────────────────────

type WeekPhase = "foundation" | "build" | "peak" | "final" | "fight_week";

interface WeekRow {
  week: number;
  targetWeight: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  phase: WeekPhase;
  heroLine: string;
  keyMetric: string;
  dailyFocus: string[];
  risk?: string;
  recovery?: string;
}

interface PhaseSummary {
  name: WeekPhase;
  label: string;
  weekStart: number;
  weekEnd: number;
  intent: string;
}

interface FightWeekBlock {
  lowCarb: string;
  sodium: string;
  waterLoading: string;
  nutrition: string;
}

type FightWeekPhase = "depletion" | "water-load" | "cut" | "weigh-in";

interface FightWeekDay {
  dayOffset: number;
  date: string;
  weekday: string;
  phase: FightWeekPhase;
  carbsGrams: number;
  proteinGrams: number;
  sodiumGrams: number;
  fluidLiters: number;
  notes: string;
  flag?: "sodium-cliff" | "fluid-cliff" | "weigh-in";
}

interface FightWeekRefeed {
  carbsGPerKgFirstHr: number;
  carbsGPerKgPhase2: number;
  sodiumGPerLiterFluid: number;
  firstMeal: string;
}

interface PlanData {
  weeklyPlan: WeekRow[];
  phases?: PhaseSummary[];
  personalNote?: string;
  toughestWeek?: { week: number; reason: string };
  summary: string;
  totalWeeks: number;
  weeklyLossTarget: string;
  maintenanceCalories?: number;
  deficit?: number;
  targetCalories?: number;
  safetyNotes?: string;
  fightWeek?: FightWeekBlock;
  fightWeekDays?: FightWeekDay[];
  fightWeekRefeed?: FightWeekRefeed;
  fightWeekSafetyFlag?: string;
  keyPrinciples?: string[];
  currentWeight?: number;
  goalWeight?: number;
  targetDate?: string;
}

interface InlinePlanDisplayProps {
  plan: any;
  planType: "cut" | "weight_loss";
  onContinue: () => void;
  /** Show the sticky "Continue to Dashboard" CTA. Default true (onboarding).
   *  The standalone review screen hides it and routes via its own close X. */
  showContinue?: boolean;
}

// ─── Macro colors (mirrors src/components/nutrition/MacroPieChart) ───
const MACRO_COLOR = {
  protein: "#3b82f6",
  carbs: "#f97316",
  fat: "#a855f7",
} as const;

// ─── Phase rail color (no icons per design feedback) ─────────────────
const PHASE_RAIL: Record<WeekPhase, string> = {
  foundation: "bg-sky-500",
  build: "bg-primary",
  peak: "bg-secondary",
  final: "bg-func-warning-yellow",
  fight_week: "bg-func-warning-yellow",
};

const PHASE_LABEL: Record<WeekPhase, string> = {
  foundation: "Foundation",
  build: "Build",
  peak: "Peak",
  final: "Final Week",
  fight_week: "Fight Week",
};

// ─── Util: clean em-dashes from any AI string ─────────────────────────
const cleanText = (s: string | undefined | null): string =>
  (s ?? "").replace(/—/g, ",").replace(/–/g, ",").replace(/\s*,\s*,\s*/g, ", ").trim();

// ─── Plan ID hash ────────────────────────────────────────────────────
function hashToPlanId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let id = "";
  let n = h;
  for (let i = 0; i < 4; i++) {
    id += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length);
  }
  return `WC-${id}`;
}

// ─── Hero ring ───────────────────────────────────────────────────────
function HeroRing({
  totalKg,
  goalLabel,
  weekCount,
}: {
  totalKg: number;
  goalLabel: string;
  weekCount: number;
}) {
  const reduced = useReducedMotion();
  const R = 56;
  const C = 2 * Math.PI * R;
  const arc = Math.min(1, weekCount / 16) * C;
  return (
    <div className="flex flex-col items-center pt-2 pb-1">
      <div className="relative h-[150px] w-[150px]">
        <svg
          viewBox="0 0 140 140"
          className="absolute inset-0"
          style={{ overflow: "visible" }}
        >
          <circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="6"
            opacity="0.4"
          />
          <motion.circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke="url(#heroGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${C - arc}`}
            strokeDashoffset={C * 0.25}
            transform="rotate(-90 70 70)"
            initial={{ strokeDashoffset: C * 0.25 + arc }}
            animate={{ strokeDashoffset: C * 0.25 }}
            transition={{
              duration: reduced ? 0 : 1.1,
              ease: [0.32, 0.72, 0, 1],
            }}
          />
          <defs>
            <linearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--secondary))" />
            </linearGradient>
          </defs>
        </svg>
        {/* Number sized to comfortably fit inside the ring (radius 56 → diameter 112 → safe text width ~96px). */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
          <p className="text-[30px] font-black tabular-nums leading-none bg-gradient-to-br from-primary to-secondary bg-clip-text text-transparent">
            {totalKg > 0 ? `-${totalKg.toFixed(1)}` : totalKg.toFixed(1)}
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mt-0.5">
            kg
          </p>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground mt-2.5">{goalLabel}</p>
    </div>
  );
}

// ─── Stat strip (kcal row + macro row) ───────────────────────────────
function StatStrip({
  maintenance,
  deficit,
  target,
  protein,
  carbs,
  fats,
}: {
  maintenance?: number;
  deficit?: number;
  target?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}) {
  if (!maintenance && !deficit && !target && !protein && !carbs && !fats) return null;
  const round100 = (n: number) => Math.round(n / 100) * 100;
  return (
    <div className="card-surface rounded-xs border border-border/40 overflow-hidden mt-3">
      {/* kcal row */}
      {(maintenance != null || deficit != null || target != null) && (
        <div className="flex divide-x divide-border/40">
          {maintenance != null && (
            <div className="flex-1 py-2.5 text-center">
              <p className="text-[16px] font-bold tabular-nums leading-none">
                {round100(maintenance).toLocaleString()}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Maintain
              </p>
            </div>
          )}
          {deficit != null && (
            <div className="flex-1 py-2.5 text-center">
              <p className="text-[16px] font-bold tabular-nums leading-none text-destructive">
                -{round100(deficit).toLocaleString()}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Deficit
              </p>
            </div>
          )}
          {target != null && (
            <div className="flex-1 py-2.5 text-center">
              <p className="text-[16px] font-bold tabular-nums leading-none text-primary">
                {round100(target).toLocaleString()}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Target
              </p>
            </div>
          )}
        </div>
      )}
      {/* Macro row */}
      {(protein != null || carbs != null || fats != null) && (
        <div className="flex divide-x divide-border/40 border-t border-border/40 bg-muted/10">
          {protein != null && (
            <div className="flex-1 py-2 text-center">
              <p className="text-[14px] font-bold tabular-nums leading-none" style={{ color: MACRO_COLOR.protein }}>
                {Math.round(protein)}g
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Protein
              </p>
            </div>
          )}
          {carbs != null && (
            <div className="flex-1 py-2 text-center">
              <p className="text-[14px] font-bold tabular-nums leading-none" style={{ color: MACRO_COLOR.carbs }}>
                {Math.round(carbs)}g
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Carbs
              </p>
            </div>
          )}
          {fats != null && (
            <div className="flex-1 py-2 text-center">
              <p className="text-[14px] font-bold tabular-nums leading-none" style={{ color: MACRO_COLOR.fat }}>
                {Math.round(fats)}g
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                Fat
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Daily Focus block — ONE place, top of plan ───────────────────────
function DailyFocusBlock({ bullets }: { bullets: string[] }) {
  if (!bullets || bullets.length === 0) return null;
  return (
    <div className="rounded-xs border border-primary/20 bg-primary/[0.04] p-4 mt-3">
      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary/80 mb-2">
        Daily Focus
      </p>
      <div className="space-y-1.5">
        {bullets.map((b, i) => (
          <p
            key={i}
            className="text-[13px] text-foreground/95 leading-snug flex items-start gap-2"
          >
            <span className="text-primary mt-0.5 shrink-0">→</span>
            <span>{cleanText(b)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── Coach note ─────────────────────────────────────────────────────
function CoachNote({ text }: { text: string }) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  return (
    <div className="rounded-xs border border-secondary/20 bg-secondary/[0.05] p-3.5 mt-3">
      <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-secondary/80 mb-1.5">
        Your Plan
      </p>
      <p className="text-[13px] leading-snug text-foreground/95 italic">
        {cleaned}
      </p>
    </div>
  );
}

// ─── Phase pills — stacked vertically, full-width, no icons ─────────
function PhasePills({
  phases,
  onTapPhase,
}: {
  phases: PhaseSummary[];
  onTapPhase: (weekStart: number) => void;
}) {
  if (!phases || phases.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold mb-2 px-1">
        Plan Phases
      </p>
      <div className="space-y-2">
        {phases.map((p) => (
          <button
            key={`${p.name}-${p.weekStart}`}
            type="button"
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              onTapPhase(p.weekStart);
            }}
            className="w-full flex rounded-xs border border-border/50 bg-card overflow-hidden active:scale-[0.99] transition-transform"
          >
            <div className={`w-1.5 shrink-0 ${PHASE_RAIL[p.name]}`} aria-hidden />
            <div className="flex-1 p-3.5 text-left min-w-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <p className="text-[14px] font-bold text-foreground">
                  {PHASE_LABEL[p.name]}
                </p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground tabular-nums shrink-0">
                  Wk {p.weekStart}{p.weekEnd !== p.weekStart ? `-${p.weekEnd}` : ""}
                </p>
              </div>
              <p className="text-[12px] text-muted-foreground leading-snug">
                {cleanText(p.intent)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Week card — big macro tiles, no daily focus repetition ──────────
function WeekCard({
  row,
  isToughest,
  toughReason,
}: {
  row: WeekRow;
  isToughest?: boolean;
  toughReason?: string;
}) {
  const rail = PHASE_RAIL[row.phase];
  return (
    <div
      id={`week-card-${row.week}`}
      className={`relative flex rounded-xs border border-border/50 bg-card overflow-hidden ${
        isToughest ? "ring-1 ring-func-warning-yellow/40" : ""
      }`}
    >
      <div className={`w-1.5 shrink-0 ${rail}`} aria-hidden />
      <div className="flex-1 p-3.5 min-w-0">
        {/* Header row */}
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
              Week {row.week}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-foreground/60">
              · {PHASE_LABEL[row.phase]}
            </span>
            {isToughest && (
              <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-func-warning-yellow/15 text-func-warning-yellow text-[9px] font-bold uppercase">
                Tough
              </span>
            )}
          </div>
          <p className="text-[14px] font-bold tabular-nums leading-none text-foreground shrink-0">
            {row.targetWeight.toFixed(1)} kg
          </p>
        </div>

        {/* Hero line */}
        <p className="text-[12px] text-muted-foreground leading-snug mb-2.5">
          {cleanText(row.heroLine)}
        </p>

        {/* 4-tile macro grid — the main focus */}
        <div className="grid grid-cols-4 gap-1.5">
          <div className="rounded-xs bg-muted/30 py-2 text-center">
            <p className="text-[18px] font-black tabular-nums leading-none text-foreground">
              {row.calories.toLocaleString()}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
              Cal
            </p>
          </div>
          <div className="rounded-xs bg-muted/30 py-2 text-center">
            <p
              className="text-[18px] font-black tabular-nums leading-none"
              style={{ color: MACRO_COLOR.protein }}
            >
              {row.protein_g}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
              Protein
            </p>
          </div>
          <div className="rounded-xs bg-muted/30 py-2 text-center">
            <p
              className="text-[18px] font-black tabular-nums leading-none"
              style={{ color: MACRO_COLOR.carbs }}
            >
              {row.carbs_g}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
              Carbs
            </p>
          </div>
          <div className="rounded-xs bg-muted/30 py-2 text-center">
            <p
              className="text-[18px] font-black tabular-nums leading-none"
              style={{ color: MACRO_COLOR.fat }}
            >
              {row.fats_g}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
              Fat
            </p>
          </div>
        </div>

        {/* Risk / recovery chips — only when present */}
        {(row.risk || row.recovery || toughReason) && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {toughReason && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-func-warning-yellow/15 border border-func-warning-yellow/25 text-[10px] text-func-warning-yellow leading-tight">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                {cleanText(toughReason)}
              </span>
            )}
            {row.risk && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/[0.06] border border-amber-500/20 text-[10px] text-amber-200/85 leading-tight">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-400/70" />
                {cleanText(row.risk)}
              </span>
            )}
            {row.recovery && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-func-recovery-green/10 border border-func-recovery-green/20 text-[10px] text-func-recovery-green leading-tight">
                <ShieldCheck className="h-2.5 w-2.5 shrink-0" />
                {cleanText(row.recovery)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fight Week day-stack ────────────────────────────────────────────
// Vertical one-row-per-day timeline. Each row shows carbs / sodium /
// fluid as inline chips with bodyweight-scaled numbers, plus a short
// coach cue. Replaces the prior 4-card carousel whose "Day -7 / Day -3"
// labels misrepresented multi-day overlapping ranges.

function FightWeekChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "carbs" | "hydration" | "warn" | "muted";
}) {
  const toneClass = {
    carbs:
      "text-func-carbs-orange/90 border-func-carbs-orange/20 bg-func-carbs-orange/[0.05]",
    hydration:
      "text-func-hydration-cyan/90 border-func-hydration-cyan/20 bg-func-hydration-cyan/[0.05]",
    warn:
      "text-amber-200/90 border-amber-500/20 bg-amber-500/[0.06]",
    muted:
      "text-foreground/75 border-border/40 bg-foreground/[0.03]",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${toneClass} text-[10.5px] font-medium tabular-nums leading-tight`}
    >
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function FightWeekDayStack({
  days,
  refeed,
  safetyFlag,
  target,
}: {
  days: FightWeekDay[];
  refeed?: FightWeekRefeed;
  safetyFlag?: string;
  target?: number;
}) {
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!days || days.length === 0) return null;

  // Bar widths are proportional to the protocol's peak carb day, so the
  // sharp drop at day -5 reads as a visible cliff in the bar lengths.
  const maxCarbs = Math.max(1, ...days.map((d) => d.carbsGrams));

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
          Fight Week Protocol
        </p>
        {typeof target === "number" && target > 0 && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
            Target {target.toFixed(1)} kg
          </p>
        )}
      </div>

      {safetyFlag && (
        <div className="rounded-xs border border-amber-500/20 bg-amber-500/[0.04] p-3 mb-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400/70 mt-0.5 shrink-0" />
          <p className="text-[12px] text-foreground/80 leading-snug">
            Aggressive cut for this timeline. Train light from day -2 and keep fluids steady until then.
          </p>
        </div>
      )}

      {/* Legend — the carb bar is the hero, so name it once. */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <span className="h-2 w-2 rounded-full bg-func-carbs-orange/70" />
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
          Carbs per day (g) — watch the day -5 drop
        </span>
      </div>

      <ul className="rounded-xs border border-border/40 bg-card/40 divide-y divide-border/30 overflow-hidden">
        {days.map((d, i) => {
          const isWeighIn = d.dayOffset === 0;
          const isCliff =
            d.flag === "sodium-cliff" || d.flag === "fluid-cliff";
          // Min 5% so a non-zero day is always visibly present.
          const barPct = isWeighIn
            ? 0
            : Math.max(
                d.carbsGrams > 0 ? 5 : 0,
                (d.carbsGrams / maxCarbs) * 100,
              );
          return (
            <li
              key={d.dayOffset}
              className={`px-3 py-2.5 flex items-start gap-3 ${
                isCliff ? "border-l-2 border-l-amber-500/50" : ""
              }`}
            >
              {/* Day number */}
              <div className="shrink-0 w-10 tabular-nums pt-0.5">
                <div className="text-[15px] font-bold text-foreground/90 leading-none">
                  {isWeighIn ? "0" : d.dayOffset}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                  {d.weekday || "—"}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {isWeighIn ? (
                  <div className="pt-0.5">
                    <p className="text-[13px] font-semibold text-foreground/90">
                      Weigh-in, then refuel
                    </p>
                    {refeed && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {refeed.carbsGPerKgFirstHr} g/kg/hr carbs for 2 hr, then {refeed.carbsGPerKgPhase2} g/kg/hr. Sodium {refeed.sodiumGPerLiterFluid} g per L fluid.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Carb taper bar — width shrinks down the list. */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 h-[18px] rounded-full bg-muted/20 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-func-carbs-orange/45 to-func-carbs-orange/85"
                          style={{
                            width:
                              prefersReduced || mounted ? `${barPct}%` : "0%",
                            transition: prefersReduced
                              ? "none"
                              : "width 700ms cubic-bezier(0.22,1,0.36,1)",
                            transitionDelay: prefersReduced
                              ? "0ms"
                              : `${i * 55}ms`,
                          }}
                        />
                      </div>
                      <span className="shrink-0 w-11 text-right text-[14px] font-bold tabular-nums text-func-carbs-orange/90 leading-none">
                        {d.carbsGrams}
                        <span className="text-[10px] font-semibold text-func-carbs-orange/60">g</span>
                      </span>
                    </div>

                    {/* Sodium + water as secondary chips. */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <FightWeekChip
                        label="Na"
                        value={d.sodiumGrams < 0.5 ? "cliff" : `${d.sodiumGrams}g`}
                        tone={d.flag === "sodium-cliff" ? "warn" : "muted"}
                      />
                      <FightWeekChip
                        label="H₂O"
                        value={d.fluidLiters < 0.5 ? "sips" : `${d.fluidLiters}L`}
                        tone={d.flag === "fluid-cliff" ? "warn" : "hydration"}
                      />
                    </div>

                    {d.notes && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-1.5">
                        {cleanText(d.notes)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────

export function InlinePlanDisplay({
  plan,
  planType,
  onContinue,
  showContinue = true,
}: InlinePlanDisplayProps): JSX.Element {
  const planData = plan as PlanData;
  const isWeightLoss = planType === "weight_loss";
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentWeight =
    planData.currentWeight ?? planData.weeklyPlan?.[0]?.targetWeight ?? 0;
  const goalWeight =
    planData.goalWeight ??
    planData.weeklyPlan?.[planData.weeklyPlan.length - 1]?.targetWeight ??
    0;
  const totalKg = Math.max(0, currentWeight - goalWeight);
  const weekCount = planData.totalWeeks ?? planData.weeklyPlan.length;

  const goalLabel = useMemo(() => {
    if (planData.targetDate) {
      try {
        const d = new Date(planData.targetDate);
        const formatted = d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return `by ${formatted}, ${weekCount} weeks`;
      } catch {
        /* fall through */
      }
    }
    return `${weekCount} weeks`;
  }, [planData.targetDate, weekCount]);

  const planId = useMemo(
    () =>
      hashToPlanId(
        `${currentWeight}|${goalWeight}|${weekCount}|${planType}|${planData.targetDate ?? ""}`,
      ),
    [currentWeight, goalWeight, weekCount, planType, planData.targetDate],
  );

  // Universal Daily Focus: derive 3 actionable bullets that apply every
  // day across the entire camp. Pull the most-common bullets from week 1
  // (the foundation week), deduped + capped at 3, falling back to the
  // first unique bullets across the plan if week 1 is sparse.
  const universalFocus = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (b: string) => {
      const cleaned = cleanText(b);
      const key = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!cleaned || key.length === 0 || seen.has(key)) return;
      seen.add(key);
      out.push(cleaned);
    };
    planData.weeklyPlan[0]?.dailyFocus?.forEach(push);
    if (out.length < 3) {
      for (const row of planData.weeklyPlan) {
        row.dailyFocus?.forEach(push);
        if (out.length >= 5) break;
      }
    }
    return out.slice(0, 3);
  }, [planData.weeklyPlan]);

  const toughestWeek = planData.toughestWeek?.week;
  const toughReason = planData.toughestWeek?.reason;

  const week1 = planData.weeklyPlan[0];

  const scrollToWeek = (week: number) => {
    const el = containerRef.current?.querySelector(`#week-card-${week}`);
    if (el) {
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
      className="w-full pb-24"
    >
      {/* HERO */}
      <div className="text-center mb-1">
        <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary/70">
          {isWeightLoss ? "Your Plan" : "Your Cut"}
        </p>
      </div>
      <HeroRing totalKg={totalKg} goalLabel={goalLabel} weekCount={weekCount} />

      {/* STAT STRIP — kcal + macros (using nutrition theme colors) */}
      <StatStrip
        maintenance={planData.maintenanceCalories}
        deficit={planData.deficit}
        target={planData.targetCalories}
        protein={week1?.protein_g}
        carbs={week1?.carbs_g}
        fats={week1?.fats_g}
      />

      {/* COACH NOTE */}
      {planData.personalNote && <CoachNote text={planData.personalNote} />}

      {/* DAILY FOCUS — once, at the top */}
      <DailyFocusBlock bullets={universalFocus} />

      {/* PHASE PILLS — vertical full-width stack */}
      {planData.phases && planData.phases.length > 1 && (
        <PhasePills phases={planData.phases} onTapPhase={scrollToWeek} />
      )}

      {/* WEEK TIMELINE */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold mt-5 mb-2 px-1">
        Week by Week
      </p>
      <div className="space-y-2">
        {planData.weeklyPlan.map((row) => (
          <WeekCard
            key={row.week}
            row={row}
            isToughest={toughestWeek === row.week}
            toughReason={toughestWeek === row.week ? toughReason : undefined}
          />
        ))}
      </div>

      {/* FIGHT WEEK DAY-STACK — cutting flow only */}
      {!isWeightLoss && planData.fightWeekDays && planData.fightWeekDays.length > 0 && (
        <FightWeekDayStack
          days={planData.fightWeekDays}
          refeed={planData.fightWeekRefeed}
          safetyFlag={planData.fightWeekSafetyFlag}
          target={
            planData.weeklyPlan?.[planData.weeklyPlan.length - 1]?.targetWeight
          }
        />
      )}

      {/* PLAN RULES */}
      {planData.keyPrinciples && planData.keyPrinciples.length > 0 && (
        <div className="card-surface rounded-xs border border-border/40 p-4 mt-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold mb-1">
            Plan Rules
          </p>
          {planData.keyPrinciples.map((p, i) => (
            <p
              key={i}
              className="text-[12px] text-foreground/85 leading-snug flex items-start gap-1.5"
            >
              <span className="text-primary mt-0.5">·</span>
              <span>{cleanText(p)}</span>
            </p>
          ))}
        </div>
      )}

      {/* SAFETY */}
      {planData.safetyNotes && (
        <div className="rounded-xs border border-func-recovery-green/20 bg-func-recovery-green/5 p-3.5 mt-3 flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-func-recovery-green mt-0.5 shrink-0" />
          <p className="text-[12px] text-emerald-200/90 leading-snug">
            {cleanText(planData.safetyNotes)}
          </p>
        </div>
      )}

      {/* TOMORROW-MORNING ANCHOR */}
      <div className="rounded-xs border border-border/40 bg-muted/20 p-3.5 mt-3 flex items-start gap-2.5">
        <Sun className="h-4 w-4 text-func-warning-yellow mt-0.5 shrink-0" />
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            Tomorrow, 7am, weigh in fasted.
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            That's your baseline. Same time, same conditions, every day.
          </p>
        </div>
      </div>

      {/* PLAN ID FOOTER */}
      <p className="text-center text-[10px] text-muted-foreground/60 mt-4 mb-2 tabular-nums">
        Plan ID, {planId}, Engine v2.0
      </p>

      {/* STICKY CTA — `bottom-safe-keyboard` rides this above the iOS
          keyboard (inner pb stays for safe-area padding). Hidden on the
          standalone review screen, where the close X handles the routing. */}
      {showContinue && (
        <div className="fixed bottom-0 bottom-safe-keyboard inset-x-0 z-30 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] bg-background/85 backdrop-blur-md border-t border-border/30">
          <Button
            onClick={onContinue}
            className="w-full h-12 rounded-xs bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-transform"
          >
            Continue to Dashboard
          </Button>
        </div>
      )}
    </motion.div>
  );
}
