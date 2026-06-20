/**
 * InlinePlanDisplay (v4 — 2026-06-06 premium pass) — generated
 * post-onboarding plan UI, restyled to feel editorial and hand-crafted
 * rather than machine-generated. Mirrors the Recovery feature's visual
 * language: `card-surface` cards with a top accent stripe, soft radial
 * glow halos, spring entrances (damping 22 / stiffness 260) and a gentle
 * breath pulse on the hero.
 *
 *   1. Hero card — camp name + "YOUR CUT" kicker + count-up ring with a
 *      blue glow halo and breath pulse
 *   2. Daily Fuel card — big week-1 calories + a stacked macro proportion
 *      bar (carbs-leading) and the maintain/deficit/target math
 *   3. Coach note (one-line plan intent, no em-dashes)
 *   4. Daily Focus block ONCE at the top (no per-week repetition)
 *   5. Phase cards — icon badge + phase colour, staggered spring entrance
 *   6. Week-by-week accordion — collapsed summary row, expand for macros
 *   7. Fight Week protocol — carb bars, taper- or hold-aware header
 *   8. Plan rules + safety + tomorrow anchor (no plan-ID footer)
 *   9. Sticky CTA
 *
 * Consumes the v2 `CutPlanSchema` shape — see `convex/_shared/aiSchemas.ts`.
 */
import { useMemo, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Sun,
  AlertTriangle,
  ChevronDown,
  Flame,
  Moon,
  Sprout,
  Hammer,
  Mountain,
  Flag,
  Swords,
} from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { macroCycle, type TrainingDay } from "@/../convex/_shared/math";

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
  campName?: string;
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

// ─── Phase rail color (rail accent on cards) ─────────────────────────
const PHASE_RAIL: Record<WeekPhase, string> = {
  foundation: "bg-sky-500",
  build: "bg-primary",
  peak: "bg-secondary",
  final: "bg-func-warning-yellow",
  fight_week: "bg-func-warning-yellow",
};

// Dot + soft icon-badge tints, keyed per phase. The badge `bg` is the
// translucent wash, `text` is the icon colour (mirrors Recovery pillar
// `iconTone` styling: a 10x10 rounded-xl badge with a tinted glyph).
const PHASE_DOT: Record<WeekPhase, string> = {
  foundation: "bg-sky-500",
  build: "bg-primary",
  peak: "bg-secondary",
  final: "bg-func-warning-yellow",
  fight_week: "bg-func-warning-yellow",
};

const PHASE_BADGE: Record<WeekPhase, string> = {
  foundation: "text-sky-400",
  build: "text-primary",
  peak: "text-secondary",
  final: "text-func-warning-yellow",
  fight_week: "text-func-warning-yellow",
};

const PHASE_ICON: Record<WeekPhase, typeof Sprout> = {
  foundation: Sprout,
  build: Hammer,
  peak: Mountain,
  final: Flag,
  fight_week: Swords,
};

const PHASE_LABEL: Record<WeekPhase, string> = {
  foundation: "Foundation",
  build: "Build",
  peak: "Peak",
  final: "Final Week",
  fight_week: "Fight Week",
};

// Recovery-matched spring entrance — reused across the main sections.
const ENTER_SPRING = { type: "spring", damping: 22, stiffness: 260 } as const;

// ─── Util: clean em-dashes from any AI string ─────────────────────────
const cleanText = (s: string | undefined | null): string =>
  (s ?? "").replace(/—/g, ",").replace(/–/g, ",").replace(/\s*,\s*,\s*/g, ", ").trim();

// ─── Hero ring ───────────────────────────────────────────────────────
// The big −X.X kg counts up on mount (AnimatedNumber), the progress arc
// sweeps in, and the whole ring carries a slow 4s "breath" pulse — the
// same living-card feel as the Recovery readiness hero.
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
  const isLoss = totalKg > 0;
  return (
    <div className="flex flex-col items-center pt-1 pb-1">
      <motion.div
        className="relative h-[150px] w-[150px]"
        animate={reduced ? { scale: 1 } : { scale: [1, 1.012, 1] }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 4, repeat: Infinity, repeatType: "loop", ease: "easeInOut" }
        }
      >
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
            <AnimatedNumber
              value={totalKg}
              format={(n) => `${isLoss ? "-" : ""}${n.toFixed(1)}`}
              delay={250}
            />
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mt-0.5">
            kg
          </p>
        </div>
      </motion.div>
      <p className="text-[12px] text-muted-foreground mt-2.5">{goalLabel}</p>
    </div>
  );
}

// ─── Daily Fuel card (big kcal + carb-cycle segmented toggle) ────────
// Leads with the (constant) daily calorie target, then a Hard / Medium /
// Rest segmented control. Calories stay identical across all three days —
// only the macros swing: carbs lead and rise on hard days, protein climbs
// on rest days, fat is held at its floor. The stacked bar + gram labels
// re-tween when the day type changes. Falls back to a single static split
// (the passed week macros) when bodyweight/target is unavailable.
const DAY_TABS: {
  key: TrainingDay;
  label: string;
  Icon: typeof Flame;
}[] = [
  { key: "hard", label: "Hard", Icon: Flame },
  { key: "medium", label: "Medium", Icon: Sun },
  { key: "rest", label: "Rest", Icon: Moon },
];

function DailyFuelCard({
  maintenance,
  deficit,
  target,
  calories,
  protein,
  carbs,
  fats,
  weightKg,
}: {
  maintenance?: number;
  deficit?: number;
  target?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  weightKg?: number;
}) {
  const [day, setDay] = useState<TrainingDay>("hard");

  const hasMacros = carbs != null || protein != null || fats != null;
  if (!hasMacros && calories == null && maintenance == null && target == null) {
    return null;
  }
  const round100 = (n: number) => Math.round(n / 100) * 100;

  // The calorie budget the cycle is built against (constant across day types).
  const cycleKcal = calories ?? target;
  const canCycle = weightKg != null && weightKg > 0 && cycleKcal != null;
  const cycle = canCycle ? macroCycle(cycleKcal as number, weightKg as number) : null;

  // Active macros: the selected day's cycle, else the passed static week macros.
  const active = cycle
    ? cycle[day]
    : { carb_g: carbs ?? 0, protein_g: protein ?? 0, fat_g: fats ?? 0 };
  const c = active.carb_g;
  const p = active.protein_g;
  const f = active.fat_g;

  // kcal share per macro drives the segment widths (carbs/protein = 4, fat = 9).
  const cKcal = c * 4;
  const pKcal = p * 4;
  const fKcal = f * 9;
  const totalKcal = Math.max(1, cKcal + pKcal + fKcal);
  // Carbs FIRST — the leading, largest macro.
  const segments = [
    { key: "carbs", label: "Carbs", grams: c, color: MACRO_COLOR.carbs, pct: (cKcal / totalKcal) * 100 },
    { key: "protein", label: "Protein", grams: p, color: MACRO_COLOR.protein, pct: (pKcal / totalKcal) * 100 },
    { key: "fat", label: "Fat", grams: f, color: MACRO_COLOR.fat, pct: (fKcal / totalKcal) * 100 },
  ].filter((s) => s.grams > 0);

  const bigKcal = calories ?? target;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...ENTER_SPRING, delay: 0.05 }}
      className="relative overflow-hidden card-surface rounded-2xl border border-border/50 border-t-2 border-t-primary p-4 mt-4"
    >
      {/* Soft top glow halo — Recovery's blur-2xl radial trick. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 h-32 w-64 rounded-full opacity-10 blur-2xl text-primary"
        style={{ background: "radial-gradient(circle, currentColor 0%, transparent 70%)" }}
      />

      <div className="relative flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-semibold">
            Daily Fuel
          </p>
          {bigKcal != null && (
            <p className="mt-1 text-[34px] font-black tabular-nums leading-none text-foreground">
              {round100(bigKcal).toLocaleString()}
              <span className="ml-1.5 text-[13px] font-bold text-muted-foreground/70 align-baseline">
                kcal
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Hard / Medium / Rest segmented control — same calories, carbs swing. */}
      {canCycle && (
        <div className="relative mt-4 flex rounded-full bg-muted/25 p-0.5">
          {DAY_TABS.map((t) => {
            const activeTab = t.key === day;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  if (t.key !== day) {
                    setDay(t.key);
                    triggerHaptic(ImpactStyle.Light);
                  }
                }}
                className={`relative z-10 flex-1 flex items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  activeTab ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {activeTab && (
                  <motion.span
                    layoutId="dayfuel-active-tab"
                    className="absolute inset-0 -z-10 rounded-full bg-foreground/10 border border-border/50"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <t.Icon
                  className="h-3.5 w-3.5"
                  strokeWidth={2.4}
                  style={{ color: activeTab ? MACRO_COLOR.carbs : undefined }}
                />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stacked macro proportion bar — carbs lead. Re-tweens on day change. */}
      {segments.length > 0 && (
        <>
          <div className="relative mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted/25">
            {segments.map((s, i) => (
              <motion.div
                key={s.key}
                className={`h-full ${i > 0 ? "border-l border-background/40" : ""}`}
                style={{ background: s.color }}
                initial={{ width: 0 }}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.55, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </div>

          {/* Per-macro gram labels, carbs leading. */}
          <div className="mt-3 flex items-center justify-between">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: s.color }}
                  aria-hidden
                />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {s.label}
                </span>
                <span
                  className="text-[13px] font-bold tabular-nums leading-none"
                  style={{ color: s.color }}
                >
                  {Math.round(s.grams)}g
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cycle explainer — only when the toggle is live. */}
      {canCycle && (
        <p className="mt-3 text-[11px] text-muted-foreground/80 leading-snug">
          Same calories every day. Carbs lead and climb on hard sessions;
          protein rises on rest days to recover and stay lean.
        </p>
      )}

      {/* Maintain · Deficit · Target math line. */}
      {(maintenance != null || deficit != null || target != null) && (
        <p className="mt-3.5 pt-3 border-t border-border/30 text-[11px] text-muted-foreground tabular-nums">
          {maintenance != null && (
            <span>Maintain {round100(maintenance).toLocaleString()}</span>
          )}
          {deficit != null && (
            <span> · Deficit -{round100(deficit).toLocaleString()}</span>
          )}
          {target != null && (
            <span className="text-foreground/80">
              {" "}· Target {round100(target).toLocaleString()}
            </span>
          )}
        </p>
      )}
    </motion.div>
  );
}

// ─── Daily Focus block — ONE place, top of plan ───────────────────────
function DailyFocusBlock({ bullets }: { bullets: string[] }) {
  if (!bullets || bullets.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_SPRING, delay: 0.12 }}
      className="card-surface rounded-2xl border border-border/50 p-4 mt-3"
    >
      <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/70 mb-2.5">
        Daily Focus
      </p>
      <div className="space-y-2">
        {bullets.map((b, i) => (
          <p
            key={i}
            className="text-[13px] text-foreground/95 leading-snug flex items-start gap-2.5"
          >
            <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
            <span>{cleanText(b)}</span>
          </p>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Coach note — editorial, hand-written feel ───────────────────────
function CoachNote({ text }: { text: string }) {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_SPRING, delay: 0.1 }}
      className="relative card-surface rounded-2xl border border-border/50 border-l-2 border-l-secondary/60 pl-4 pr-4 py-3.5 mt-3"
    >
      <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-secondary/80 mb-1.5">
        From your coach
      </p>
      <p className="text-[13.5px] leading-relaxed text-foreground/95">
        {cleaned}
      </p>
    </motion.div>
  );
}

// ─── Phase cards — icon badge + phase colour, staggered entrance ─────
function PhasePills({
  phases,
  onTapPhase,
}: {
  phases: PhaseSummary[];
  onTapPhase: (weekStart: number) => void;
}) {
  const reduced = useReducedMotion();
  if (!phases || phases.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold mb-2.5 px-1">
        Plan Phases
      </p>
      <div className="space-y-2">
        {phases.map((p, index) => {
          const PhaseIcon = PHASE_ICON[p.name];
          return (
            <motion.button
              key={`${p.name}-${p.weekStart}`}
              type="button"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...ENTER_SPRING, delay: index * 0.06 }}
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                onTapPhase(p.weekStart);
              }}
              className="w-full flex card-surface rounded-2xl border border-border/50 overflow-hidden active:scale-[0.99] transition-transform"
            >
              <div className={`w-1 shrink-0 ${PHASE_RAIL[p.name]}`} aria-hidden />
              <div className="flex-1 flex items-center gap-3 p-3.5 text-left min-w-0">
                <div
                  className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${PHASE_BADGE[p.name]}`}
                >
                  <PhaseIcon className="h-5 w-5" strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <p className="text-[14px] font-bold text-foreground">
                      {PHASE_LABEL[p.name]}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground tabular-nums shrink-0">
                      Wk {p.weekStart}
                      {p.weekEnd !== p.weekStart ? `-${p.weekEnd}` : ""}
                    </p>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-snug">
                    {cleanText(p.intent)}
                  </p>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week accordion row ──────────────────────────────────────────────
// Collapsed: phase dot + "Week N · Phase" + target weight + calories +
// chevron. Expanded (Recovery height/opacity transition): the 4 macro
// tiles + any risk / recovery / tough chips. The phase rail accent stays
// down the left edge.
function WeekAccordionRow({
  row,
  isToughest,
  toughReason,
  open,
  onToggle,
}: {
  row: WeekRow;
  isToughest?: boolean;
  toughReason?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const rail = PHASE_RAIL[row.phase];
  const dot = PHASE_DOT[row.phase];
  return (
    <div
      id={`week-card-${row.week}`}
      className={`relative flex card-surface rounded-2xl border border-border/50 overflow-hidden ${
        isToughest ? "ring-1 ring-func-warning-yellow/40" : ""
      }`}
    >
      <div className={`w-1 shrink-0 ${rail}`} aria-hidden />
      <div className="flex-1 min-w-0">
        {/* Collapsed summary row — always visible, tappable. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`Week ${row.week}, ${PHASE_LABEL[row.phase]} — ${row.targetWeight.toFixed(1)} kg`}
          className="w-full flex items-center gap-3 p-3.5 text-left active:bg-muted/10 transition-colors"
        >
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-bold text-foreground truncate">
              Week {row.week}
              <span className="text-[11px] font-medium text-muted-foreground">
                {" · "}
                {PHASE_LABEL[row.phase]}
              </span>
              {isToughest && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {" · "}Toughest week
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {row.calories.toLocaleString()} kcal
            </p>
          </div>
          <p className="text-[15px] font-bold tabular-nums leading-none text-foreground shrink-0">
            {row.targetWeight.toFixed(1)}
            <span className="text-[10px] font-semibold text-muted-foreground ml-0.5">kg</span>
          </p>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>

        {/* Expanded detail — macro tiles + chips. */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: { duration: 0.25 }, opacity: { duration: 0.2 } }}
              className="overflow-hidden"
            >
              <div className="px-3.5 pb-3.5 pt-1 border-t border-border/30">
                {row.heroLine && (
                  <p className="text-[12px] text-muted-foreground leading-snug mb-2.5 mt-2">
                    {cleanText(row.heroLine)}
                  </p>
                )}

                {/* 4-tile macro grid. */}
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="rounded-xs bg-muted/20 py-2 text-center">
                    <p className="text-[18px] font-black tabular-nums leading-none text-foreground">
                      {row.calories.toLocaleString()}
                    </p>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                      Cal
                    </p>
                  </div>
                  <div className="rounded-xs bg-muted/20 py-2 text-center">
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
                  <div className="rounded-xs bg-muted/20 py-2 text-center">
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
                  <div className="rounded-xs bg-muted/20 py-2 text-center">
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

                {/* Risk / recovery notes — plain text lines in the body font,
                    normal colours, no tinted pill boxes. */}
                {(row.risk || row.recovery || toughReason) && (
                  <div className="flex flex-col gap-1.5 mt-2.5">
                    {toughReason && (
                      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground leading-snug">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/70" />
                        {cleanText(toughReason)}
                      </p>
                    )}
                    {row.risk && (
                      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground leading-snug">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/70" />
                        {cleanText(row.risk)}
                      </p>
                    )}
                    {row.recovery && (
                      <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground leading-snug">
                        <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/70" />
                        {cleanText(row.recovery)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
  maintenanceCalories,
}: {
  days: FightWeekDay[];
  refeed?: FightWeekRefeed;
  safetyFlag?: string;
  target?: number;
  maintenanceCalories?: number;
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

  // The backend may HOLD carbs for day-of weigh-ins (flat or non-decreasing
  // bars) instead of tapering. Detect that so the header reads honestly: if
  // every non-weigh-in day's carbs is roughly equal-to or higher-than the
  // day before (within a small tolerance), there's no real taper to "watch".
  const carbDays = days.filter((d) => d.dayOffset !== 0);
  const carbsHeld =
    carbDays.length > 1 &&
    carbDays.every((d, i) => i === 0 || d.carbsGrams >= carbDays[i - 1].carbsGrams * 0.92);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_SPRING, delay: 0.08 }}
      className="relative overflow-hidden card-surface rounded-2xl border border-border/50 border-t-2 border-t-func-warning-yellow p-4 mt-4"
    >
      {/* Soft warm glow halo at top. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 h-32 w-64 rounded-full opacity-10 blur-2xl text-func-warning-yellow"
        style={{ background: "radial-gradient(circle, currentColor 0%, transparent 70%)" }}
      />

      <div className="relative flex items-baseline justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/70">
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

      {/* Fuel strategy — eat at maintenance; the cut comes from carbs, water and
          sodium, not a calorie deficit, so fuel stays high. */}
      <div className="rounded-xs border border-primary/20 bg-primary/[0.05] p-3 mb-2.5">
        <p className="text-[12px] font-semibold text-foreground">Eat at maintenance this week</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Fat loss over fight week is negligible, your drop comes from carbs, water
          and sodium, not calories. Eat around your maintenance
          {maintenanceCalories ? ` (~${(Math.round(maintenanceCalories / 100) * 100).toLocaleString()} kcal)` : ""}
          {carbsHeld
            ? " so you carry maximum fuel and glycogen into the fight."
            : " so you carry maximum fuel into the fight while carbs taper down."}
        </p>
      </div>

      {/* Legend — the carb bar is the hero, so name it once. The copy adapts
          to whether carbs taper or are held flat for the fight. */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5">
        <span className="h-2 w-2 rounded-full bg-func-carbs-orange/70" />
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {carbsHeld
            ? "Carbs held — fuel for the fight"
            : "Carbs per day (g) — watch the day -5 drop"}
        </span>
      </div>

      <ul className="rounded-xs bg-muted/[0.04] border border-border/30 divide-y divide-border/30 overflow-hidden">
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
                      {carbsHeld ? "Weigh-in, then rehydrate" : "Weigh-in, then refuel"}
                    </p>
                    {carbsHeld ? (
                      d.notes && (
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {cleanText(d.notes)}
                        </p>
                      )
                    ) : (
                      refeed && (
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {refeed.carbsGPerKgFirstHr} g/kg/hr carbs for 2 hr, then {refeed.carbsGPerKgPhase2} g/kg/hr. Sodium {refeed.sodiumGPerLiterFluid} g per L fluid.
                        </p>
                      )
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
    </motion.div>
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

  // Week accordion: auto-expand the toughest week if flagged, else week 1.
  // Tapping a row toggles it; tapping a phase opens + scrolls to its start.
  const defaultOpenWeek = toughestWeek ?? planData.weeklyPlan[0]?.week ?? 1;
  const [openWeek, setOpenWeek] = useState<number | null>(defaultOpenWeek);

  const scrollToWeek = (week: number) => {
    setOpenWeek(week);
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`#week-card-${week}`);
      if (el) {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
      className="w-full pb-24"
    >
      {/* HERO CARD — camp name + kicker + count-up ring, in a premium
          card-surface card with a top accent stripe and a blue glow halo
          behind the ring (mirrors the Recovery readiness hero). */}
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={ENTER_SPRING}
        className="relative overflow-hidden card-surface rounded-2xl border border-border/50 border-t-2 border-t-primary px-5 pt-5 pb-4"
      >
        {/* Blue glow halo behind the ring — Recovery's blur-2xl radial. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 h-44 w-44 rounded-full opacity-10 blur-2xl text-primary"
          style={{ background: "radial-gradient(circle, currentColor 0%, transparent 70%)" }}
        />
        <div className="relative text-center mb-1">
          {planData.campName && planData.campName.trim() !== "" && (
            <p className="text-[16px] font-bold text-foreground tracking-tight mb-1">
              {planData.campName}
            </p>
          )}
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary/70">
            {isWeightLoss ? "Your Plan" : "Your Cut"}
          </p>
        </div>
        <div className="relative">
          <HeroRing totalKg={totalKg} goalLabel={goalLabel} weekCount={weekCount} />
        </div>
      </motion.div>

      {/* DAILY FUEL — big kcal + Hard/Medium/Rest carb-cycle toggle */}
      <DailyFuelCard
        maintenance={planData.maintenanceCalories}
        deficit={planData.deficit}
        target={planData.targetCalories}
        calories={week1?.calories}
        protein={week1?.protein_g}
        carbs={week1?.carbs_g}
        fats={week1?.fats_g}
        weightKg={currentWeight || undefined}
      />

      {/* COACH NOTE */}
      {planData.personalNote && <CoachNote text={planData.personalNote} />}

      {/* DAILY FOCUS — once, at the top */}
      <DailyFocusBlock bullets={universalFocus} />

      {/* PHASE PILLS — vertical full-width stack */}
      {planData.phases && planData.phases.length > 1 && (
        <PhasePills phases={planData.phases} onTapPhase={scrollToWeek} />
      )}

      {/* WEEK-BY-WEEK ACCORDION */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold mt-5 mb-2 px-1">
        Week by Week
      </p>
      <div className="space-y-2">
        {planData.weeklyPlan.map((row) => (
          <WeekAccordionRow
            key={row.week}
            row={row}
            isToughest={toughestWeek === row.week}
            toughReason={toughestWeek === row.week ? toughReason : undefined}
            open={openWeek === row.week}
            onToggle={() =>
              setOpenWeek((cur) => (cur === row.week ? null : row.week))
            }
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
          maintenanceCalories={planData.maintenanceCalories}
        />
      )}

      {/* PLAN RULES — editorial glass card */}
      {planData.keyPrinciples && planData.keyPrinciples.length > 0 && (
        <div className="card-surface rounded-2xl border border-border/50 p-4 mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-semibold mb-1">
            Plan Rules
          </p>
          {planData.keyPrinciples.map((p, i) => (
            <p
              key={i}
              className="text-[12.5px] text-foreground/90 leading-snug flex items-start gap-2.5"
            >
              <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden />
              <span>{cleanText(p)}</span>
            </p>
          ))}
        </div>
      )}

      {/* SAFETY */}
      {planData.safetyNotes && (
        <div className="card-surface rounded-2xl border border-func-recovery-green/25 border-l-2 border-l-func-recovery-green/60 p-3.5 mt-3 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-func-recovery-green mt-0.5 shrink-0" />
          <p className="text-[12.5px] text-emerald-200/90 leading-relaxed">
            {cleanText(planData.safetyNotes)}
          </p>
        </div>
      )}

      {/* TOMORROW-MORNING ANCHOR */}
      <div className="card-surface rounded-2xl border border-border/50 p-3.5 mt-3 flex items-start gap-2.5">
        <Sun className="h-4 w-4 text-func-warning-yellow mt-0.5 shrink-0" />
        <div>
          <p className="text-[12.5px] font-semibold text-foreground">
            Tomorrow, 7am, weigh in fasted.
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            That's your baseline. Same time, same conditions, every day.
          </p>
        </div>
      </div>

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
