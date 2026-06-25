import type { JSX } from "react";
import { Fragment, useState } from "react";
import { motion } from "motion/react";
import {
  Leaf, AlertTriangle, Info, Droplets, Moon, Check, RefreshCw, Ban,
  Scale, Trophy, TrendingDown, ClipboardList, ArrowLeftRight, Lock, ChevronRight,
} from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

/* ------------------------------------------------------------------ *
 * THROWAWAY MOCK LAB — /cut-lab
 *
 * Weight-Protocol redesign: the single long-scroll page is split into a
 * STEP FLOW driven by a premium blue-aurora timeline at the top.
 *
 *   Plan ─ Cut ─ Scale ─ Rehydrate ─ Walkout
 *
 * · Plan & Scale are input forms (pass-through gates).
 * · Cut & Rehydrate are the two living generated plans — the user flips
 *   between them freely (switcher + hint make this obvious).
 * · Walkout is the success finale animation.
 * · Progress fills left→right as the user advances.
 *
 * Delete this file + its route after sign-off.
 * ------------------------------------------------------------------ */

const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

// Live accent — premium blue carries the whole theme (no neon).
const BLUE = "217 91% 58%";
const BLUE_HI = "213 94% 64%";

// B · Cool palette — desaturated, harmonized.
const C_CARB = "30 70% 62%";
const C_WATER = "200 60% 62%";
const C_SODIUM = "220 22% 64%";
const C_FIBER = "165 38% 56%";
const C_DANGER = "6 70% 60%";
const AMBER = "35 92% 58%";

/* ----------------------------- data -------------------------------- */

type Day = {
  d: number; carbs: number; water: number;
  sodium: "High" | "Med" | "Low"; fiber: "Normal" | "Low" | "Minimal" | "None"; today?: boolean;
};
const DAYS: Day[] = [
  { d: 7, carbs: 152, water: 3.0, sodium: "High", fiber: "Normal" },
  { d: 6, carbs: 152, water: 3.0, sodium: "High", fiber: "Normal" },
  { d: 5, carbs: 38, water: 7.6, sodium: "High", fiber: "Low", today: true },
  { d: 4, carbs: 38, water: 7.6, sodium: "Med", fiber: "Low" },
  { d: 3, carbs: 38, water: 7.6, sodium: "Med", fiber: "Low" },
  { d: 2, carbs: 38, water: 7.6, sodium: "Med", fiber: "Low" },
  { d: 1, carbs: 38, water: 1.1, sodium: "Low", fiber: "Minimal" },
  { d: 0, carbs: 30, water: 0.0, sodium: "Low", fiber: "None" },
];
const FIBER_COPY = "Fiber stays normal until ~4 days out, then tapers over the final 2–3 days to empty the gut, minimal the day before and none the morning of weigh-in.";
const ORS_ROWS = [
  { name: "Glucose / dextrose", qty: "40", unit: "g", sub: "≈3 tbsp · drives sodium + water uptake" },
  { name: "Table salt (NaCl)", qty: "2.5", unit: "g", sub: "≈½ tsp · sodium" },
  { name: "Sodium citrate", qty: "1", unit: "g", sub: "buffer + taste" },
  { name: "Potassium chloride", qty: "1.5", unit: "g", sub: "Lite salt · ≈20 mmol K⁺" },
];
const REFUEL = ["White rice + lean chicken", "Pasta + light tomato sauce", "Oatmeal + honey", "White-bread sandwich", "Mashed white potato + salt"];
const SNACKS = ["Bananas / ripe fruit", "Rice cakes, pretzels", "Low-fat yogurt + honey", "Sports drink + salty snack", "White toast + honey"];
const DO_NOTS = ["Slam plain water post-weigh-in", "Eat a huge first meal", "Try new foods on fight day", "Skip electrolytes while rehydrating", "Cut more if you're already light"];

/* --------------------------- chrome -------------------------------- */

function AuroraCard({ children, radialGlow = false, className = "", motes = true }: { children: React.ReactNode; radialGlow?: boolean; className?: string; motes?: boolean }) {
  return (
    <div className={`relative rounded-2xl card-surface border border-primary/25 overflow-hidden ${className}`}>
      <WizardAuroraBackground intensity="subtle" radialGlow={radialGlow} motes={motes} />
      <div className="relative">{children}</div>
    </div>
  );
}

function ChapterHead({ n, t, sub }: { n: string; t: string; sub: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(BLUE) }}>{n}</p>
      <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">{t}</h2>
      <p className="text-[13px] text-muted-foreground leading-snug mt-1">{sub}</p>
    </div>
  );
}

/** Compact header — eyebrow + title only (no descriptive paragraph). */
function HeadOnly({ n, t }: { n: string; t: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(BLUE) }}>{n}</p>
      <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">{t}</h2>
    </div>
  );
}
function ScaleHead() {
  return <HeadOnly n="Chapter 03 · The Scale" t="Step on the scale." />;
}
function PlanHead() {
  return <HeadOnly n="Chapter 01 · The Plan" t="Cut to 75.0 kg" />;
}

function FiberNote() {
  return (
    <div className="mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5 surface-inset">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5" style={{ background: hsl(C_FIBER, 0.16) }}>
        <Leaf className="h-3 w-3" style={{ color: hsl(C_FIBER) }} />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{FIBER_COPY}</p>
    </div>
  );
}

function WarningNote() {
  return (
    <div className="mt-2.5 flex items-start gap-2.5 rounded-xl px-3 py-2.5 surface-inset relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: hsl(AMBER, 0.6) }} />
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5" style={{ background: hsl(AMBER, 0.16) }}>
        <AlertTriangle className="h-3 w-3" style={{ color: hsl(AMBER) }} />
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        <span className="text-foreground/90 font-medium">Stop immediately</span> if you feel dizzy, faint, confused, nauseous, or unwell.
      </p>
    </div>
  );
}

/* ===================================================================== */
/* TIMELINE STEPPER                                                       */
/* ===================================================================== */

type StepKey = "plan" | "cut" | "scale" | "rehydrate" | "walkout";
const STEPS: { key: StepKey; label: string; kind: "form" | "plan" | "finale"; icon: typeof Scale }[] = [
  { key: "plan", label: "Plan", kind: "form", icon: ClipboardList },
  { key: "cut", label: "Cut", kind: "plan", icon: TrendingDown },
  { key: "scale", label: "Scale", kind: "form", icon: Scale },
  { key: "rehydrate", label: "Rehydrate", kind: "plan", icon: Droplets },
  { key: "walkout", label: "Walkout", kind: "finale", icon: Trophy },
];

function FlowTimeline({ active, maxReached, onSelect }: { active: number; maxReached: number; onSelect: (i: number) => void }) {
  return (
    <div className="relative rounded-2xl card-surface border border-primary/20 overflow-hidden">
      <WizardAuroraBackground intensity="subtle" motes={false} />
      <div className="relative px-3 pt-4 pb-3.5">
        <div className="flex items-start">
          {STEPS.map((s, i) => {
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
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: i <= maxReached ? "100%" : "0%", background: `linear-gradient(90deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})` }} />
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
                      background: completed ? `linear-gradient(135deg, ${hsl(BLUE, 0.9)}, ${hsl(BLUE_HI, 0.9)})`
                        : current ? hsl(BLUE, 0.16) : hsl("220 14% 26%", 0.35),
                      border: current ? `1.5px solid ${hsl(BLUE)}`
                        : completed ? "1.5px solid transparent" : `1.5px solid ${hsl("220 12% 40%", 0.5)}`,
                      boxShadow: current ? `0 0 0 4px ${hsl(BLUE, 0.12)}, 0 4px 16px ${hsl(BLUE, 0.3)}`
                        : completed ? `0 4px 14px ${hsl(BLUE, 0.28)}` : "none",
                    }}
                  >
                    {completed ? (
                      living ? <StepIcon className="h-4 w-4 text-white" /> : <Check className="h-4 w-4 text-white" />
                    ) : reached ? (
                      <StepIcon className="h-4 w-4" style={{ color: current ? hsl(BLUE) : hsl("220 10% 60%") }} />
                    ) : (
                      <Lock className="h-3.5 w-3.5" style={{ color: hsl("220 10% 50%") }} />
                    )}
                    {/* living-plan marker ring */}
                    {living && reached && (
                      <span className="absolute -inset-[3px] rounded-full pointer-events-none"
                        style={{ border: `1px dashed ${hsl(BLUE, current || completed ? 0.5 : 0.3)}` }} />
                    )}
                  </div>
                  <span className="text-[9px] uppercase tracking-wide font-semibold leading-none transition-colors"
                    style={{ color: current ? hsl(BLUE) : living && reached ? hsl(BLUE, 0.85) : hsl("220 10% 58%") }}>
                    {s.label}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* relationship hint */}
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-full surface-inset px-3 py-1.5 mx-auto w-fit">
          <ArrowLeftRight className="h-3 w-3" style={{ color: hsl(BLUE) }} />
          <span className="text-[10px] text-muted-foreground">
            Tap <b className="text-foreground/80">Cut</b> or <b className="text-foreground/80">Rehydrate</b> anytime to switch plans
          </span>
        </div>
      </div>
    </div>
  );
}

/** Compact Cut ⇄ Rehydrate switcher shown on the two plan pages. */
function PlanSwitcher({ active, onSelect }: { active: StepKey; onSelect: (k: StepKey) => void }) {
  const items: { k: StepKey; label: string; icon: typeof Droplets }[] = [
    { k: "cut", label: "Cut", icon: TrendingDown },
    { k: "rehydrate", label: "Rehydrate", icon: Droplets },
  ];
  return (
    <div className="flex items-center gap-1 rounded-full p-1 surface-inset mb-3">
      {items.map((it) => {
        const on = active === it.k;
        return (
          <button key={it.k} onClick={() => onSelect(it.k)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-semibold transition-colors"
            style={{ background: on ? `linear-gradient(135deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})` : "transparent", color: on ? "white" : hsl("220 10% 62%") }}>
            <it.icon className="h-3.5 w-3.5" /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ===================================================================== */
/* PAGE: PLAN (form / gate)                                               */
/* ===================================================================== */

const APPROACHES = ["Gradual", "Standard", "Aggressive"] as const;

function PlanPage({ onGenerate }: { onGenerate: () => void }) {
  const [appr, setAppr] = useState<(typeof APPROACHES)[number]>("Standard");
  return (
    <AuroraCard radialGlow>
      <div className="p-5">
        <PlanHead />
        {/* weight spine */}
        <div className="my-4 flex items-end justify-center gap-6">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold mb-1">Now</p>
            <p className="display-number text-[32px] font-extrabold tabular-nums text-muted-foreground">80.4</p>
          </div>
          <ChevronRight className="h-5 w-5 mb-2" style={{ color: hsl(BLUE) }} />
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: hsl(BLUE) }}>Target</p>
            <p className="display-number text-[32px] font-extrabold tabular-nums text-foreground">75.0</p>
          </div>
        </div>
        <div className="flex gap-1.5 mb-4">
          {APPROACHES.map((a) => {
            const on = a === appr;
            return (
              <button key={a} onClick={() => setAppr(a)}
                className="flex-1 rounded-xl py-2 text-[11px] font-semibold transition-colors border"
                style={{ background: on ? hsl(BLUE, 0.16) : "transparent", borderColor: on ? hsl(BLUE, 0.5) : hsl("220 12% 32%", 0.5), color: on ? hsl(BLUE) : hsl("220 10% 62%") }}>
                {a}
              </button>
            );
          })}
        </div>
        <BlueCta label="Generate my cut" onClick={onGenerate} icon={TrendingDown} />
      </div>
    </AuroraCard>
  );
}

/* ===================================================================== */
/* PAGE: CUT (living plan)                                                */
/* ===================================================================== */

const COLS = [
  { label: "Carbs", tint: C_CARB }, { label: "Water", tint: C_WATER },
  { label: "Sodium", tint: C_SODIUM }, { label: "Fiber", tint: C_FIBER },
];

function CutPage() {
  return (
    <div className="relative rounded-2xl card-surface border overflow-hidden" style={{ borderColor: hsl(BLUE, 0.25) }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${hsl(BLUE, 0.06)}, transparent 60%)` }} />
      <div className="relative p-4">
        <ChapterHead n="Chapter 02 · The Cut" t="The cut · taper to 75.0 kg" sub="Carbs down, water loaded then flushed, sodium & fiber tapered. Today is highlighted." />
        {/* col header */}
        <div className="flex items-center gap-3 px-3 pb-1.5 mb-0.5">
          <div className="w-9 shrink-0" />
          <div className="flex-1 grid grid-cols-4 gap-1">
            {COLS.map((c) => (
              <div key={c.label} className="flex items-center justify-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hsl(c.tint) }} />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-0.5">
          {DAYS.map((day) => (
            <div key={day.d} className="rounded-xl px-3 py-2.5 flex items-center gap-3"
              style={{ background: day.today ? hsl(BLUE, 0.1) : "transparent", border: day.today ? `1px solid ${hsl(BLUE, 0.35)}` : "1px solid transparent" }}>
              <div className="w-9 shrink-0">
                <p className="text-[15px] font-bold tabular-nums leading-none" style={{ color: day.today ? hsl(BLUE) : "hsl(var(--foreground))" }}>D-{day.d}</p>
                {day.today && <p className="mt-1 text-[7px] uppercase tracking-[0.15em] font-bold" style={{ color: hsl(BLUE) }}>Today</p>}
              </div>
              <div className="flex-1 grid grid-cols-4 gap-1">
                <Tint v={`${day.carbs}g`} c={hsl(C_CARB)} />
                <Tint v={`${day.water.toFixed(1)}L`} c={hsl(C_WATER)} />
                <Tint v={day.sodium} c={hsl(C_SODIUM)} />
                <Tint v={day.fiber} c={hsl(C_FIBER)} />
              </div>
            </div>
          ))}
        </div>
        <FiberNote />
        <WarningNote />
      </div>
    </div>
  );
}
function Tint({ v, c }: { v: string; c: string }) {
  return <div className="flex items-center justify-center"><span className="text-[13px] font-semibold tabular-nums leading-none" style={{ color: c }}>{v}</span></div>;
}

/* ===================================================================== */
/* PAGE: SCALE (form / gate)                                              */
/* ===================================================================== */

function ScalePage({ onGenerate }: { onGenerate: () => void }) {
  const [sweat, setSweat] = useState("2.0");
  const [hours, setHours] = useState("24");
  return (
    <AuroraCard>
      <div className="p-4">
        <ScaleHead />
        <FieldLabel>Kilos sweated off</FieldLabel>
        <SuffixInput value={sweat} onChange={setSweat} suffix="kg" />
        <FieldLabel className="mt-4">Hours until you fight</FieldLabel>
        <SuffixInput value={hours} onChange={setHours} suffix="h" />
        <div className="mt-4 rounded-xl border surface-inset p-3" style={{ borderColor: hsl(BLUE, 0.22) }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Moon className="h-3.5 w-3.5 shrink-0" style={{ color: hsl(BLUE) }} />
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80 leading-none">Sleep window: no intake while you sleep</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1.5 items-center">
            <span className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground/60 leading-none">Sleep</span>
            <span aria-hidden />
            <span className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground/60 leading-none">Wake</span>
            <TimeStepper value="23:00" />
            <span aria-hidden className="text-[14px] font-bold leading-none text-center" style={{ color: hsl(BLUE, 0.7) }}>→</span>
            <TimeStepper value="07:00" />
          </div>
        </div>
        <div className="mt-4"><BlueCta label="Start rehydrating" onClick={onGenerate} icon={Droplets} /></div>
      </div>
    </AuroraCard>
  );
}
function FieldLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <label className={`block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1.5 ${className}`}>{children}</label>;
}
function SuffixInput({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix: string }) {
  return (
    <div className="grid grid-cols-[1fr_2rem] items-center gap-2">
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal"
        className="w-full min-w-0 rounded-xl surface-inset border border-border/60 px-3 py-2.5 text-[18px] font-bold tabular-nums text-foreground outline-none transition-colors"
        style={{ caretColor: hsl(BLUE) }}
        onFocus={(e) => (e.currentTarget.style.borderColor = hsl(BLUE))}
        onBlur={(e) => (e.currentTarget.style.borderColor = "")} />
      <span className="text-[14px] text-muted-foreground font-semibold text-right">{suffix}</span>
    </div>
  );
}
function TimeStepper({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-muted/30 border border-border/50 text-foreground/80 text-[14px] font-bold leading-none">−</span>
      <span className="flex-1 min-w-0 text-center text-[15px] font-bold tabular-nums text-foreground leading-none">{value}</span>
      <span className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-muted/30 border border-border/50 text-foreground/80 text-[14px] font-bold leading-none">+</span>
    </div>
  );
}

/* ===================================================================== */
/* PAGE: REHYDRATE (living plan)                                          */
/* ===================================================================== */

function RehydratePage() {
  return (
    <div className="space-y-4">
      {/* litres hero */}
      <AuroraCard radialGlow className="text-center">
        <div className="p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3" style={{ color: hsl(BLUE) }}>After the scale · Rehydration</p>
          <p className="text-foreground display-number font-extrabold tabular-nums leading-none">
            <span style={{ fontSize: 52 }}>3.0</span>
            <span className="text-muted-foreground/70 font-bold ml-1.5" style={{ fontSize: 24 }}>L</span>
          </p>
          <p className="text-[12px] text-muted-foreground mt-2 tracking-wide">to replace · over the first 6 hours</p>
        </div>
      </AuroraCard>

      {/* ORS recipe */}
      <div className="rounded-2xl card-surface border border-primary/20 p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: hsl(BLUE) }}>DIY ORS · per litre</p>
        <p className="text-[11px] text-muted-foreground/70 mt-1 mb-3.5">
          Mix this ratio, then make <b className="text-foreground/80 tabular-nums">3.0 L</b> total over the first 6 hours.
        </p>
        <div className="space-y-1">
          {ORS_ROWS.map((r) => (
            <div key={r.name} className="flex items-center gap-3">
              <div className="w-[3.25rem] shrink-0 rounded-lg surface-inset py-1.5 text-center leading-none">
                <span className="text-[15px] font-bold tabular-nums text-foreground">{r.qty}</span>
                <span className="text-[10px] text-muted-foreground/55 ml-0.5">{r.unit}</span>
              </div>
              <div className="min-w-0 py-1">
                <p className="text-[13px] font-medium text-foreground leading-tight">{r.name}</p>
                <p className="text-[10.5px] text-muted-foreground/55 leading-tight mt-0.5">{r.sub}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3.5 border-t border-border/40">
          <ChipBlock title="Shopping list" items={["Dextrose powder", "Table salt", "Sodium citrate", "Lite salt (KCl)", "Bottled water"]} />
          <ChipBlock title="Or use commercial" items={["LMNT", "Liquid I.V.", "DripDrop", "Pedialyte"]} bordered />
        </div>
      </div>

      {/* meal ideas */}
      <div className="card-surface rounded-2xl border border-primary/15 p-4">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-foreground">Meal ideas</p>
          <p className="text-[10px] text-muted-foreground/65">high-carb · easy · low-fat</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MealList heading="Refuel" items={REFUEL} tint={C_FIBER} />
          <MealList heading="Snacks" items={SNACKS} tint={C_CARB} />
        </div>
        <div className="mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5 surface-inset relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: hsl(AMBER, 0.6) }} />
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-px" style={{ background: hsl(AMBER, 0.16) }}>
            <AlertTriangle className="h-3 w-3" style={{ color: hsl(AMBER) }} />
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="text-foreground/90 font-medium">Avoid</span> fried/greasy, high-fat, high-fibre, very large meals, spicy or creamy foods, anything untested.
          </p>
        </div>
      </div>

      {/* do not + warning */}
      <DoNotBlock />
      <WarningNote />
    </div>
  );
}
function ChipBlock({ title, items, bordered = false }: { title: string; items: string[]; bordered?: boolean }) {
  return (
    <div className="mt-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/55 mb-1.5">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => <span key={it} className={bordered ? "rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-foreground/80" : "rounded-full bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"}>{it}</span>)}
      </div>
    </div>
  );
}
function MealList({ heading, items, tint }: { heading: string; items: string[]; tint: string }) {
  return (
    <div className="rounded-xl surface-inset p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: hsl(tint) }} />
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">{heading}</p>
      </div>
      <ul className="space-y-1">{items.map((i) => <li key={i} className="text-[11.5px] leading-snug text-foreground/80">{i}</li>)}</ul>
    </div>
  );
}
function DoNotBlock() {
  return (
    <div className="rounded-2xl surface-inset p-3.5 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: hsl(C_DANGER, 0.65) }} />
      <div className="flex items-center gap-2 mb-2.5 pl-1">
        <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: hsl(C_DANGER, 0.16) }}>
          <Ban className="h-3 w-3" style={{ color: hsl(C_DANGER) }} />
        </div>
        <p className="text-[11px] uppercase font-bold tracking-[0.16em]" style={{ color: hsl(C_DANGER) }}>Do not</p>
      </div>
      <ul className="space-y-1.5 pl-1">
        {DO_NOTS.map((i) => (
          <li key={i} className="flex gap-2 text-[12px] text-muted-foreground leading-snug">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full" style={{ background: hsl(C_DANGER, 0.7) }} />
            <span className="flex-1">{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ===================================================================== */
/* PAGE: WALKOUT (finale)                                                 */
/* ===================================================================== */

function WalkoutPage({ onRestart }: { onRestart: () => void }) {
  return (
    <AuroraCard radialGlow className="text-center">
      <div className="p-8">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", damping: 12, stiffness: 200 }}
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: `linear-gradient(135deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})`, boxShadow: `0 0 36px ${hsl(BLUE, 0.5)}` }}
        >
          <Trophy className="h-8 w-8 text-white" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1.5" style={{ color: hsl(BLUE) }}>The Walkout</p>
          <h2 className="text-[24px] font-bold tracking-tight text-foreground leading-tight">You made weight<br />&amp; refuelled</h2>
          <p className="text-[13px] text-muted-foreground mt-2 leading-snug px-2">Protocol complete. Go and compete — you did the hard part right.</p>
        </motion.div>
        <div className="mt-6 space-y-2">
          <BlueCta label="Share your walkout" onClick={() => {}} icon={Trophy} />
          <button onClick={onRestart} className="block w-full text-center text-[12px] text-muted-foreground/80 underline-offset-4 hover:text-foreground hover:underline transition-colors">
            Start a new protocol
          </button>
        </div>
      </div>
    </AuroraCard>
  );
}

/* ----------------------------- shared CTA -------------------------------- */

function BlueCta({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: typeof Droplets }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-bold text-white relative overflow-hidden active:scale-[0.98] transition-transform border border-primary/30"
      style={{ background: `linear-gradient(135deg, ${hsl(BLUE)}, ${hsl(BLUE_HI)})`, boxShadow: `0 8px 28px ${hsl(BLUE, 0.45)}` }}>
      <WizardAuroraBackground intensity="subtle" motes={false} />
      <span className="relative flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
    </button>
  );
}

/* ===================================================================== */
/* PAGE SHELL                                                             */
/* ===================================================================== */

export default function CutLab(): JSX.Element {
  // active = index of the step currently shown; maxReached = furthest unlocked.
  const [active, setActive] = useState(1); // land on Cut
  const [maxReached, setMaxReached] = useState(3); // Plan, Cut, Scale done; Rehydrate unlocked
  const step = STEPS[active];

  const advance = () => {
    const next = Math.min(active + 1, STEPS.length - 1);
    setMaxReached((m) => Math.max(m, next));
    setActive(next);
  };
  const goTo = (k: StepKey) => setActive(STEPS.findIndex((s) => s.key === k));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[420px] px-4 py-5">
        <div className="mb-1 flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          <h1 className="text-[15px] font-bold">Weight Protocol · stepped flow</h1>
        </div>
        <p className="text-[12px] text-muted-foreground mb-4">
          Each step is its own page. Tap the timeline to move. Progress fills left→right. <b className="text-foreground">Cut</b> & <b className="text-foreground">Rehydrate</b> swap freely.
        </p>

        {/* sticky timeline */}
        <div className="sticky top-2 z-20 mb-4">
          <FlowTimeline active={active} maxReached={maxReached} onSelect={setActive} />
        </div>

        {/* current page */}
        <div className="space-y-1">
          {(step.key === "cut" || step.key === "rehydrate") && (
            <PlanSwitcher active={step.key} onSelect={goTo} />
          )}

          {step.key === "plan" && <PlanPage onGenerate={advance} />}
          {step.key === "cut" && <CutPage />}
          {step.key === "scale" && <ScalePage onGenerate={advance} />}
          {step.key === "rehydrate" && <RehydratePage />}
          {step.key === "walkout" && <WalkoutPage onRestart={() => { setActive(0); setMaxReached(0); }} />}
        </div>

        {/* dev-only: simulate forward progress so the fill can be seen animating */}
        {maxReached < STEPS.length - 1 && step.key !== "cut" && step.key !== "rehydrate" && (
          <p className="mt-3 text-center text-[10px] text-muted-foreground/50">Tip: the form CTAs above advance the flow & fill the timeline.</p>
        )}
        {(step.key === "rehydrate") && maxReached < 4 && (
          <button onClick={advance} className="mt-4 w-full rounded-xl surface-inset py-2.5 text-[12px] font-semibold text-foreground/80 flex items-center justify-center gap-1.5">
            <Check className="h-3.5 w-3.5" style={{ color: hsl(BLUE) }} /> I've made weight & refuelled → Walkout
          </button>
        )}

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground/40">
          <RefreshCw className="h-3 w-3" /> /cut-lab · throwaway mock · delete after sign-off
        </p>
      </div>
    </div>
  );
}
