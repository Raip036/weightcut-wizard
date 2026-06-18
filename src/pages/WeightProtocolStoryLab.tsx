import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Sparkles,
  TrendingDown,
  Scale,
  Droplets,
  Trophy,
  Check,
  ArrowRight,
  Flame,
  RotateCcw,
  Utensils,
  Leaf,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Weight Protocol — Flow C STORY (dev-only, route: /protocol-story-lab)
 *
 * Progressive story: Plan (approach + weigh-in timing → drives generation) →
 * The Cut (carb/water/sodium/FIBER taper; same-day weigh-in holds carbs) →
 * The Scale (enter kilos sweated) → Rehydrate (litres HERO + redesigned ORS) →
 * Walkout (success on the Finish button). The spine ticks: Scale on sweat
 * submit, Rehydrate on generation, Walkout on Finish. Not wired into the app.
 * ------------------------------------------------------------------ */

const BLUE = "217 91% 58%";
const AMBER = "35 92% 58%";
const CYAN = "190 90% 55%";
const GREEN = "152 64% 47%";
const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

const START = 74.0;
const TARGET = 70.0;
const DAYS_OUT = 5;
const APPROACHES = ["gradual", "standard", "aggressive"] as const;
type Approach = (typeof APPROACHES)[number];

type TaperDay = { d: number; carbs: number; water: number; sodium: string; fiber: string };
const TAPER: TaperDay[] = [
  { d: 5, carbs: 200, water: 6.0, sodium: "High", fiber: "Normal" },
  { d: 4, carbs: 150, water: 6.0, sodium: "High", fiber: "Normal" },
  { d: 3, carbs: 100, water: 5.0, sodium: "Med", fiber: "Low" },
  { d: 2, carbs: 75, water: 3.0, sodium: "Low", fiber: "None" },
  { d: 1, carbs: 50, water: 1.0, sodium: "None", fiber: "None" },
];

const ORS = [
  { name: "Glucose / dextrose", amt: "40 g", sub: "energy + sodium co-transport" },
  { name: "Table salt (NaCl)", amt: "2.5 g", sub: "≈ ½ tsp" },
  { name: "Sodium citrate", amt: "1 g", sub: "buffer + taste" },
  { name: "Potassium chloride", amt: "1.5 g", sub: "≈ 20 mmol K⁺" },
];
const SHOPPING = ["Dextrose powder", "Table salt", "Sodium citrate", "Lite salt (KCl)", "Bottled water"];
const COMMERCIAL = ["LMNT", "Liquid I.V.", "DripDrop", "Pedialyte"];

const REHYD = [
  { t: "H+0", title: "ORS + electrolytes", body: "Easy carbs: banana, rice. Small sips, not gulps." },
  { t: "H+1", title: "Water + electrolytes", body: "Keep carbs flowing. Re-check the scale." },
  { t: "H+3", title: "Steady fluids", body: "Light carbs, stay ahead of thirst." },
  { t: "H+6", title: "Pre-fight meal", body: "Easy to digest, nothing new." },
];

const CHAPTERS = [
  { id: "plan", label: "Plan", Icon: Sparkles, accent: BLUE },
  { id: "cut", label: "The Cut", Icon: TrendingDown, accent: BLUE },
  { id: "scale", label: "The Scale", Icon: Scale, accent: AMBER },
  { id: "rehydrate", label: "Rehydrate", Icon: Droplets, accent: CYAN },
  { id: "walkout", label: "Walkout", Icon: Trophy, accent: GREEN },
] as const;

/* ----------------------------- shared bits ----------------------------- */
function Confetti({ count = 28 }: { count?: number }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const dist = 90 + (i % 6) * 26;
        return { id: i, dx: Math.cos(a) * dist, dy: Math.sin(a) * dist - 30, rot: (i * 53) % 360, size: 5 + (i % 3) * 2, color: ["#23C599", "#3B82F6", "#FAC146", "#22D3EE", "#9DE7D0"][i % 5] };
      }),
    [count],
  );
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-hidden>
      <div className="relative">
        {pieces.map((p) => (
          <motion.span key={p.id} className="absolute rounded-[2px]" style={{ width: p.size, height: p.size * 1.4, background: p.color }} initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }} animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot, scale: 1 }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
        ))}
      </div>
    </div>
  );
}

function ChapterHead({ n, label, title, sub, accent }: { n: number; label: string; title: string; sub: string; accent: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(accent) }}>Chapter {String(n).padStart(2, "0")} · {label}</p>
      <h2 className="text-[22px] font-bold tracking-tight text-foreground leading-tight">{title}</h2>
      <p className="text-[13px] text-muted-foreground leading-snug mt-1">{sub}</p>
    </div>
  );
}

function StoryCard({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div className="relative rounded-2xl card-surface border overflow-hidden" style={{ borderColor: hsl(accent, 0.25) }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${hsl(accent, 0.06)}, transparent 60%)` }} />
      <div className="relative p-4">{children}</div>
    </div>
  );
}

function Spine({ active, done }: { active: number; done: number }) {
  return (
    <div className="sticky top-0 z-30 -mx-5 px-5 py-3 bg-background/85 backdrop-blur-md border-b border-border/40">
      <div className="flex items-center justify-between">
        {CHAPTERS.map((c, i) => {
          const isDone = i < done;
          const isActive = i === active;
          const on = isDone || isActive;
          return (
            <div key={c.id} className="flex items-center" style={{ flex: i < CHAPTERS.length - 1 ? 1 : "0 0 auto" }}>
              <div className="flex flex-col items-center gap-1">
                <motion.span className="flex h-7 w-7 items-center justify-center rounded-full border" animate={{ backgroundColor: on ? hsl(c.accent, isActive ? 1 : 0.16) : "transparent", borderColor: on ? hsl(c.accent, isActive ? 1 : 0.4) : "hsl(var(--border))", scale: isActive ? 1.08 : 1 }}>
                  {isDone ? <Check className="h-3.5 w-3.5" style={{ color: hsl(c.accent) }} strokeWidth={3} /> : <c.Icon className="h-3.5 w-3.5" style={{ color: on ? (isActive ? "#0a0a0a" : hsl(c.accent)) : "hsl(var(--muted-foreground))" }} />}
                </motion.span>
                <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: on ? hsl(c.accent) : "hsl(var(--muted-foreground))" }}>{c.label}</span>
              </div>
              {i < CHAPTERS.length - 1 && <div className="flex-1 h-px mx-1 mb-3" style={{ background: i < done ? hsl(CHAPTERS[i + 1].accent, 0.5) : "hsl(var(--border))" }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrimaryCta({ label, onClick, accent, Icon, disabled }: { label: string; onClick: () => void; accent: string; Icon: typeof ArrowRight; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-bold text-[#0a0a0a] active:scale-[0.98] transition-transform disabled:opacity-50" style={{ background: hsl(accent), boxShadow: `0 8px 28px ${hsl(accent, 0.4)}` }}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function Pills<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className="flex-1 rounded-full py-1.5 text-[11px] font-semibold capitalize transition-colors" style={value === o ? { background: hsl(BLUE), color: "#0a0a0a" } : { border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{o}</button>
      ))}
    </div>
  );
}

/* ============================ PAGE ============================ */
export default function WeightProtocolStoryLab() {
  const reduced = useReducedMotion();
  const [approach, setApproach] = useState<Approach>("standard");
  const [sameDay, setSameDay] = useState(false); // prefilled from camp (day-before default)
  const [generated, setGenerated] = useState(false);
  const [sweatKg, setSweatKg] = useState("");
  const [generatingRehyd, setGeneratingRehyd] = useState(false);
  const [rehydrated, setRehydrated] = useState(false);
  const [walkout, setWalkout] = useState(false);
  const timer = useRef<number | null>(null);

  const sweatNum = parseFloat(sweatKg);
  const sweatValid = !Number.isNaN(sweatNum) && sweatNum >= 0.1 && sweatNum <= 10;
  const orsLitres = sweatValid ? (sweatNum * 1.5).toFixed(1) : "3.0";

  // Spine progression: Scale ✓ on sweat submit, Rehydrate ✓ on generation,
  // Walkout on Finish.
  const activeIdx = walkout ? 4 : rehydrated ? 4 : generatingRehyd ? 3 : generated ? 1 : 0;
  const doneCount = walkout ? 5 : rehydrated ? 4 : generatingRehyd ? 3 : generated ? 1 : 0;

  const startRehydrating = () => {
    if (!sweatValid) return;
    setGeneratingRehyd(true);
    timer.current = window.setTimeout(() => { setGeneratingRehyd(false); setRehydrated(true); }, 1300);
  };
  const reset = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setGenerated(false); setSweatKg(""); setGeneratingRehyd(false); setRehydrated(false); setWalkout(false);
  };
  const reveal = reduced ? { initial: false as const, animate: {} } : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: "easeOut" as const } };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 pb-24">
        <Spine active={activeIdx} done={doneCount} />

        <div className="pt-4 pb-2">
          <h1 className="text-[15px] font-bold tracking-tight">Weight Protocol</h1>
          <p className="text-[12px] text-muted-foreground">Day {DAYS_OUT} to weigh-in · {generated ? (rehydrated ? "Rehydrate" : "Cut") : "Prep"}</p>
        </div>

        <div className="space-y-5 pt-2">
          {/* ── Chapter 1 · The Plan (approach + weigh-in timing drive generation) ── */}
          {!generated && (
            <motion.div {...reveal}>
              <StoryCard accent={BLUE}>
                <ChapterHead n={1} label="The Plan" title="Set your cut, then generate." sub="A day-by-day taper to weigh-in, then a rehydration plan after the scale. Your choices below shape the plan." accent={BLUE} />
                <div className="flex items-center justify-center gap-3 my-4 text-center">
                  <div><p className="display-number text-2xl font-bold tabular-nums text-muted-foreground/70">{START.toFixed(1)}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Start</p></div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                  <div><p className="display-number text-2xl font-bold tabular-nums" style={{ color: hsl(BLUE) }}>{TARGET.toFixed(1)}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Target · kg</p></div>
                  <div className="ml-2 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: hsl(BLUE, 0.14), color: hsl(BLUE) }}>−{(START - TARGET).toFixed(1)} kg</div>
                </div>

                {/* Approach — moved here; affects generation */}
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1.5">Approach</p>
                <Pills options={APPROACHES} value={approach} onChange={setApproach} />

                {/* Weigh-in timing — drives carb logic */}
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1.5 mt-4">Weigh-in</p>
                <div className="flex gap-1.5">
                  {([["Day before", false], ["Same day", true]] as const).map(([label, val]) => (
                    <button key={label} onClick={() => setSameDay(val)} className="flex-1 rounded-xl py-2 text-[12px] font-semibold transition-colors" style={sameDay === val ? { background: hsl(BLUE), color: "#0a0a0a" } : { border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{label}</button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{sameDay ? "Same-day weigh-in: no carb cut — water load, sodium and fiber only." : "Day-before weigh-in: full taper (carbs, water, sodium, fiber)."}</p>

                <div className="mt-4"><PrimaryCta label="Generate my protocol" onClick={() => setGenerated(true)} accent={BLUE} Icon={Sparkles} /></div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 2 · The Cut (fiber column + callout; same-day holds carbs) ── */}
          {generated && (
            <motion.div {...reveal}>
              <div className="text-center mb-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Weigh-in countdown</p>
                <p className="display-number text-[52px] font-extrabold leading-none tabular-nums" style={{ color: DAYS_OUT <= 3 ? "hsl(var(--func-danger-red))" : "hsl(var(--foreground))" }}>{DAYS_OUT}</p>
                <p className="text-[12px] text-muted-foreground">days to weigh-in · Sat, Jul 4</p>
              </div>

              <StoryCard accent={BLUE}>
                <ChapterHead n={2} label="The Cut" title={`The cut · taper to ${TARGET.toFixed(1)} kg`} sub={`${approach} approach. ${sameDay ? "Carbs held — water, sodium & fiber only." : "Carbs down, water loaded then flushed, sodium & fiber tapered."}`} accent={BLUE} />

                {sameDay && (
                  <div className="mb-3 rounded-lg px-3 py-2 text-[11px] font-medium" style={{ background: hsl(AMBER, 0.12), color: hsl(AMBER) }}>Same-day weigh-in — no carb cut. Water, sodium & fiber only.</div>
                )}

                {/* taper list — 4 columns incl. fiber */}
                <div className="space-y-1.5">
                  {TAPER.map((day, i) => {
                    const isToday = i === 0;
                    return (
                      <div key={day.d} className="rounded-lg px-2.5 py-2 flex items-center gap-2.5" style={{ background: isToday ? hsl(BLUE, 0.12) : "hsla(0,0%,100%,0.03)", border: isToday ? `1px solid ${hsl(BLUE, 0.4)}` : "1px solid transparent" }}>
                        <div className="w-8 text-center shrink-0">
                          <p className="text-[14px] font-bold tabular-nums leading-none" style={{ color: isToday ? hsl(BLUE) : "hsl(var(--foreground))" }}>D-{day.d}</p>
                          {isToday && <p className="text-[8px] uppercase tracking-wide font-bold" style={{ color: hsl(BLUE) }}>Today</p>}
                        </div>
                        <div className="flex-1 grid grid-cols-4 gap-1 text-center">
                          <span className="text-[10px]"><b className="tabular-nums" style={{ color: sameDay ? "hsl(var(--muted-foreground))" : hsl(AMBER) }}>{sameDay ? "Hold" : `${day.carbs}g`}</b><br /><span className="text-[8px] text-muted-foreground/60">carbs</span></span>
                          <span className="text-[10px]"><b className="tabular-nums" style={{ color: hsl(CYAN) }}>{day.water.toFixed(1)}L</b><br /><span className="text-[8px] text-muted-foreground/60">water</span></span>
                          <span className="text-[10px]"><b className="tabular-nums text-foreground/90">{day.sodium}</b><br /><span className="text-[8px] text-muted-foreground/60">sodium</span></span>
                          <span className="text-[10px]"><b className="tabular-nums" style={{ color: hsl(GREEN) }}>{day.fiber}</b><br /><span className="text-[8px] text-muted-foreground/60">fiber</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* fiber callout */}
                <div className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: hsl(GREEN, 0.1) }}>
                  <Leaf className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: hsl(GREEN) }} />
                  <p className="text-[11px] text-foreground/90 leading-snug">Cut fiber from 2 days out to empty the gut and shed gut weight. Clean carbs, sodium citrate to hold water early then taper.</p>
                </div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 3 · The Scale ── */}
          {generated && !rehydrated && !generatingRehyd && (
            <motion.div {...reveal}>
              <StoryCard accent={AMBER}>
                <ChapterHead n={3} label="The Scale" title="Step on the scale." sub="Made weight? Log how many kilos you sweated off and I'll build your rehydration plan, scaled to you." accent={AMBER} />
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">Kilos sweated off</label>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" step={0.1} value={sweatKg} onChange={(e) => setSweatKg(e.target.value)} placeholder="2.0" className="flex-1 rounded-xl bg-muted/20 border border-border/60 px-3 py-2.5 text-[18px] font-bold tabular-nums text-foreground outline-none focus:border-[hsl(35_92%_58%)]" />
                  <span className="text-[14px] text-muted-foreground font-semibold">kg</span>
                </div>
                {sweatValid && <p className="mt-2 text-[12px]" style={{ color: hsl(CYAN) }}>≈ {orsLitres} L of ORS to replace it</p>}
                <div className="mt-3"><PrimaryCta label="Start rehydrating" onClick={startRehydrating} accent={AMBER} Icon={Droplets} disabled={!sweatValid} /></div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Generating bridge (Scale ✓, Rehydrate active) ── */}
          {generatingRehyd && (
            <motion.div {...reveal}>
              <StoryCard accent={CYAN}>
                <div className="flex flex-col items-center py-6">
                  <span className="h-9 w-9 rounded-full border-2 animate-spin" style={{ borderColor: hsl(CYAN, 0.25), borderTopColor: hsl(CYAN) }} />
                  <p className="mt-3 text-[13px] text-muted-foreground">Building your rehydration plan…</p>
                </div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 4 · Rehydrate (litres HERO + redesigned ORS) ── */}
          {rehydrated && !walkout && (
            <motion.div {...reveal}>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: hsl(CYAN) }}>After the scale</p>

              {/* litres HERO on top */}
              <div className="rounded-2xl border text-center p-5 mb-3" style={{ borderColor: hsl(CYAN, 0.3), background: hsl(CYAN, 0.06) }}>
                <p className="display-number font-extrabold tabular-nums leading-none" style={{ fontSize: 60, color: hsl(CYAN) }}>{orsLitres} L</p>
                <p className="text-[12px] text-muted-foreground mt-1.5">to replace · over the first 6 hours</p>
              </div>

              {/* redesigned ORS — clean 2-col rows */}
              <StoryCard accent={CYAN}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: hsl(CYAN) }}>DIY ORS · per litre</p>
                <div className="divide-y divide-border/40">
                  {ORS.map((r) => (
                    <div key={r.name} className="flex items-center justify-between py-2.5">
                      <span className="text-[13px] text-foreground">{r.name}</span>
                      <span className="text-right">
                        <b className="text-[14px] tabular-nums text-foreground">{r.amt}</b>
                        <span className="block text-[10px] text-muted-foreground/60">{r.sub}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60 mb-1.5">Shopping list</p>
                  <div className="flex flex-wrap gap-1.5">{SHOPPING.map((s) => (<span key={s} className="rounded-full bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">{s}</span>))}</div>
                </div>
                <div className="mt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/60 mb-1.5">Or use commercial</p>
                  <div className="flex flex-wrap gap-1.5">{COMMERCIAL.map((s) => (<span key={s} className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-foreground/80">{s}</span>))}</div>
                </div>
              </StoryCard>

              {/* sip timeline */}
              <div className="mt-3 space-y-2">
                {REHYD.map((s) => (
                  <div key={s.t} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold tabular-nums" style={{ background: hsl(CYAN, 0.16), color: hsl(CYAN) }}>{s.t}</span>
                      <span className="flex-1 w-px my-0.5" style={{ background: hsl(CYAN, 0.25) }} />
                    </div>
                    <div className="pb-1">
                      <p className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">{s.title === "Pre-fight meal" ? <Utensils className="h-3.5 w-3.5" style={{ color: hsl(CYAN) }} /> : <Droplets className="h-3.5 w-3.5" style={{ color: hsl(CYAN) }} />}{s.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-start gap-2 rounded-lg border border-func-danger-red/30 bg-func-danger-red/10 px-3 py-2">
                <Flame className="h-4 w-4 text-func-danger-red shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground/90 leading-snug">Don't chug plain water, it flushes the electrolytes you're trying to replace.</p>
              </div>

              {/* Finish button → success */}
              <div className="mt-4"><PrimaryCta label="I've made weight & refuelled" onClick={() => setWalkout(true)} accent={GREEN} Icon={Trophy} /></div>
            </motion.div>
          )}

          {/* ── Chapter 5 · Walkout success ── */}
          {walkout && (
            <motion.div initial={reduced ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 22 }}>
              <div className="relative rounded-2xl overflow-hidden p-6 text-center" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${hsl(GREEN, 0.22)}, transparent 70%), hsl(var(--card))`, border: `1px solid ${hsl(GREEN, 0.4)}` }}>
                <Confetti count={30} />
                <motion.div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: hsl(GREEN, 0.18), boxShadow: `0 0 0 2px ${hsl(GREEN, 0.4)}, 0 0 40px ${hsl(GREEN, 0.35)}` }} initial={reduced ? false : { scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 360, damping: 16 }}>
                  <Trophy className="h-8 w-8" style={{ color: hsl(GREEN) }} />
                </motion.div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: hsl(GREEN) }}>Walkout</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">You made weight & refueled</h2>
                <p className="mt-1.5 text-[13px] text-muted-foreground">Fight time. Full and strong.</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[["Made weight", `${TARGET.toFixed(1)} kg`], ["Rehydrated", `≈${orsLitres} L`], ["Walked in", `${START.toFixed(1)} kg`]].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-background/40 border border-border/40 py-2"><p className="text-[14px] font-bold tabular-nums text-foreground">{v}</p><p className="text-[9px] uppercase tracking-wide text-muted-foreground/70">{k}</p></div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <button onClick={reset} className="mt-6 mx-auto flex items-center gap-1.5 text-[12px] text-muted-foreground/60 active:text-foreground"><RotateCcw className="h-3 w-3" /> restart the story</button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground/50">Dev-only showroom · route <code>/protocol-story-lab</code> · not wired into the app</p>
      </div>
    </div>
  );
}
