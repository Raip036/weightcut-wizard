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
  Lock,
  Flame,
  RotateCcw,
  Utensils,
  Beaker,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Weight Protocol — Flow C STORY (dev-only, route: /protocol-story-lab)
 *
 * The approved "weigh-in pivot" flow (brainstorm combined-v3), rebuilt as a
 * single progressive STORY: The Plan → The Cut (carb/water/sodium taper to
 * target) → The Scale (enter kilos sweated) → Rehydration (ORS + timeline) →
 * Walkout. Each chapter UNLOCKS as the athlete acts — press Generate, make
 * weight + log the cut, then rehydrate. Not wired into the app.
 * ------------------------------------------------------------------ */

// Per-chapter accents (inline hsl so Tailwind purge never drops them).
const BLUE = "217 91% 58%"; // the cut
const AMBER = "35 92% 58%"; // carbs / energy
const CYAN = "190 90% 55%"; // hydration
const GREEN = "152 64% 47%"; // made weight / health
const hsl = (t: string, a = 1) => `hsl(${t} / ${a})`;

const START = 74.0;
const TARGET = 70.0;
const DAYS_OUT = 5;

type TaperDay = { d: number; carbs: number; water: number; sodium: "High" | "Med" | "Low" | "None"; note?: string };
const TAPER: TaperDay[] = [
  { d: 5, carbs: 200, water: 6.0, sodium: "High", note: "Clean carbs, timed around training" },
  { d: 4, carbs: 150, water: 6.0, sodium: "High" },
  { d: 3, carbs: 100, water: 5.0, sodium: "Med", note: "Begin water-load taper" },
  { d: 2, carbs: 75, water: 3.0, sodium: "Low" },
  { d: 1, carbs: 50, water: 1.0, sodium: "None", note: "Sip only, weigh-in tomorrow" },
];

type RehydStep = { t: string; title: string; body: string };
const REHYD: RehydStep[] = [
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

/** Chapter heading: eyebrow ("Chapter 02 · The Cut") + big title + sub. */
function ChapterHead({ n, label, title, sub, accent }: { n: number; label: string; title: string; sub: string; accent: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: hsl(accent) }}>
        Chapter {String(n).padStart(2, "0")} · {label}
      </p>
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

/* progress spine — the journey map */
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
                <motion.span
                  className="flex h-7 w-7 items-center justify-center rounded-full border"
                  animate={{
                    backgroundColor: on ? hsl(c.accent, isActive ? 1 : 0.16) : "transparent",
                    borderColor: on ? hsl(c.accent, isActive ? 1 : 0.4) : "hsl(var(--border))",
                    scale: isActive ? 1.08 : 1,
                  }}
                >
                  {isDone ? (
                    <Check className="h-3.5 w-3.5" style={{ color: hsl(c.accent) }} strokeWidth={3} />
                  ) : (
                    <c.Icon className="h-3.5 w-3.5" style={{ color: on ? (isActive ? "#0a0a0a" : hsl(c.accent)) : "hsl(var(--muted-foreground))" }} />
                  )}
                </motion.span>
                <span className="text-[8px] font-semibold uppercase tracking-wide" style={{ color: on ? hsl(c.accent) : "hsl(var(--muted-foreground))" }}>{c.label}</span>
              </div>
              {i < CHAPTERS.length - 1 && (
                <div className="flex-1 h-px mx-1 mb-3" style={{ background: i < done ? hsl(CHAPTERS[i + 1].accent, 0.5) : "hsl(var(--border))" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SealedCard({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="relative rounded-2xl border border-border/40 bg-muted/20 p-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 shrink-0">
          <Lock className="h-4 w-4 text-muted-foreground" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-foreground/80">{label}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}

function PrimaryCta({ label, onClick, accent, Icon }: { label: string; onClick: () => void; accent: string; Icon: typeof ArrowRight }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-bold text-[#0a0a0a] active:scale-[0.98] transition-transform"
      style={{ background: hsl(accent), boxShadow: `0 8px 28px ${hsl(accent, 0.4)}` }}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

/* ============================ PAGE ============================ */
export default function WeightProtocolStoryLab() {
  const reduced = useReducedMotion();
  const [generated, setGenerated] = useState(false);
  const [sweatKg, setSweatKg] = useState("");
  const [rehydrated, setRehydrated] = useState(false);
  const [walkout, setWalkout] = useState(false);
  const sweatNum = parseFloat(sweatKg);
  const sweatValid = !Number.isNaN(sweatNum) && sweatNum >= 0.1 && sweatNum <= 10;
  const orsLitres = sweatValid ? (sweatNum * 1.5).toFixed(1) : null;

  // Active chapter for the spine.
  const activeIdx = walkout ? 4 : rehydrated ? 3 : generated ? 1 : 0;
  const doneCount = walkout ? 5 : rehydrated ? 3 : generated ? 1 : 0;

  const scrollRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setGenerated(false);
    setSweatKg("");
    setRehydrated(false);
    setWalkout(false);
  };

  const reveal = reduced ? { initial: false as const, animate: {} } : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: "easeOut" as const } };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div ref={scrollRef} className="mx-auto max-w-md px-5 pb-24">
        <Spine active={activeIdx} done={doneCount} />

        {/* Header */}
        <div className="pt-4 pb-2">
          <h1 className="text-[15px] font-bold tracking-tight">Weight Protocol</h1>
          <p className="text-[12px] text-muted-foreground">
            Moderate cut · Today · Day {DAYS_OUT} to weigh-in · {generated ? (rehydrated ? "Rehydrate" : "Cut") : "Prep"}
          </p>
        </div>

        <div className="space-y-5 pt-2">
          {/* ── Chapter 1 · The Plan / Generate ── */}
          {!generated && (
            <motion.div {...reveal}>
              <StoryCard accent={BLUE}>
                <ChapterHead n={1} label="The Plan" title="Your cut, one chapter at a time." sub="A day-by-day taper to weigh-in, then a rehydration plan after the scale. Tuned to your body and your weigh-in window." accent={BLUE} />
                <div className="flex items-center justify-center gap-3 my-4 text-center">
                  <div>
                    <p className="display-number text-2xl font-bold tabular-nums text-muted-foreground/70">{START.toFixed(1)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Start</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                  <div>
                    <p className="display-number text-2xl font-bold tabular-nums" style={{ color: hsl(BLUE) }}>{TARGET.toFixed(1)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">Target · kg</p>
                  </div>
                  <div className="ml-2 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: hsl(BLUE, 0.14), color: hsl(BLUE) }}>−{(START - TARGET).toFixed(1)} kg</div>
                </div>
                <PrimaryCta label="Generate my protocol" onClick={() => setGenerated(true)} accent={BLUE} Icon={Sparkles} />
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 2 · The Cut ── */}
          {generated && (
            <motion.div {...reveal}>
              {/* countdown anchor */}
              <div className="text-center mb-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Weigh-in countdown</p>
                <p className="display-number text-[52px] font-extrabold leading-none tabular-nums" style={{ color: DAYS_OUT <= 3 ? "hsl(var(--func-danger-red))" : "hsl(var(--foreground))" }}>{DAYS_OUT}</p>
                <p className="text-[12px] text-muted-foreground">days to weigh-in · Sat, Jul 4</p>
              </div>

              <StoryCard accent={BLUE}>
                <ChapterHead n={2} label="The Cut" title={`The cut · taper to ${TARGET.toFixed(1)} kg`} sub="Carbs down, water loaded then flushed, sodium tapered. Today is highlighted." accent={BLUE} />

                {/* approach pills */}
                <div className="flex gap-1.5 mb-3">
                  {["Gradual", "Standard", "Aggressive"].map((a, i) => (
                    <span key={a} className="flex-1 text-center rounded-full px-2 py-1.5 text-[11px] font-semibold" style={i === 1 ? { background: hsl(BLUE, 1), color: "#0a0a0a" } : { border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{a}</span>
                  ))}
                </div>

                {/* taper list */}
                <div className="space-y-1.5">
                  {TAPER.map((day, i) => {
                    const isToday = i === 0;
                    return (
                      <div key={day.d} className="rounded-lg px-3 py-2 flex items-center gap-3" style={{ background: isToday ? hsl(BLUE, 0.12) : "hsla(0,0%,100%,0.03)", border: isToday ? `1px solid ${hsl(BLUE, 0.4)}` : "1px solid transparent" }}>
                        <div className="w-9 text-center shrink-0">
                          <p className="text-[15px] font-bold tabular-nums leading-none" style={{ color: isToday ? hsl(BLUE) : "hsl(var(--foreground))" }}>D-{day.d}</p>
                          {isToday && <p className="text-[8px] uppercase tracking-wide font-bold" style={{ color: hsl(BLUE) }}>Today</p>}
                        </div>
                        <div className="flex-1 grid grid-cols-3 gap-1 text-center">
                          <span className="text-[11px]"><b className="tabular-nums" style={{ color: hsl(AMBER) }}>{day.carbs}g</b><br /><span className="text-[9px] text-muted-foreground/60">carbs</span></span>
                          <span className="text-[11px]"><b className="tabular-nums" style={{ color: hsl(CYAN) }}>{day.water.toFixed(1)}L</b><br /><span className="text-[9px] text-muted-foreground/60">water</span></span>
                          <span className="text-[11px]"><b className="tabular-nums text-foreground/90">{day.sodium}</b><br /><span className="text-[9px] text-muted-foreground/60">sodium</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground leading-snug">Clean carbs, timed around training. Sodium citrate to hold water early, then taper.</p>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 3 · The Scale (weigh-in hinge) ── */}
          {generated && !rehydrated && (
            <motion.div {...reveal}>
              {sweatValid ? null : <div className="mb-3"><SealedCard label="After the scale · Rehydration" hint="Unlocks when you log your weigh-in" /></div>}
              <StoryCard accent={AMBER}>
                <ChapterHead n={3} label="The Scale" title="Step on the scale." sub="Made weight? Log how many kilos you sweated off and I'll build your rehydration plan, scaled to you." accent={AMBER} />
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70 mb-1">Kilos sweated off</label>
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
                {orsLitres && <p className="mt-2 text-[12px]" style={{ color: hsl(CYAN) }}>≈ {orsLitres} L of ORS to replace it</p>}
                <div className="mt-3">
                  <PrimaryCta label="Start rehydrating" onClick={() => sweatValid && setRehydrated(true)} accent={AMBER} Icon={Droplets} />
                </div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 4 · Rehydration ── */}
          {rehydrated && !walkout && (
            <motion.div {...reveal}>
              <StoryCard accent={CYAN}>
                <ChapterHead n={4} label="Rehydrate" title="After the scale · refuel" sub={`Replace ≈ ${orsLitres ?? "3.0"} L over the next 24 hours. ORS first, then food.`} accent={CYAN} />

                {/* ORS recipe — moved ABOVE the timeline (combined-v3 tweak) */}
                <div className="rounded-xl border border-[hsl(190_90%_55%/0.3)] p-3 mb-3" style={{ background: hsl(CYAN, 0.08) }}>
                  <p className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 mb-1.5" style={{ color: hsl(CYAN) }}><Beaker className="h-3.5 w-3.5" /> Your ORS, per litre</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                    <span><b className="text-foreground">6 g</b><br /><span className="text-[9px] text-muted-foreground/60">salt</span></span>
                    <span><b className="text-foreground">25 g</b><br /><span className="text-[9px] text-muted-foreground/60">glucose</span></span>
                    <span><b className="text-foreground">1.5 g</b><br /><span className="text-[9px] text-muted-foreground/60">potassium</span></span>
                  </div>
                </div>

                {/* sip timeline */}
                <div className="space-y-2">
                  {REHYD.map((s) => (
                    <div key={s.t} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold tabular-nums" style={{ background: hsl(CYAN, 0.16), color: hsl(CYAN) }}>{s.t}</span>
                        <span className="flex-1 w-px my-0.5" style={{ background: hsl(CYAN, 0.25) }} />
                      </div>
                      <div className="pb-1">
                        <p className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                          {s.title === "Pre-fight meal" ? <Utensils className="h-3.5 w-3.5" style={{ color: hsl(CYAN) }} /> : <Droplets className="h-3.5 w-3.5" style={{ color: hsl(CYAN) }} />}
                          {s.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-snug">{s.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* do-not */}
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-func-danger-red/30 bg-func-danger-red/10 px-3 py-2">
                  <Flame className="h-4 w-4 text-func-danger-red shrink-0 mt-0.5" />
                  <p className="text-[11px] text-foreground/90 leading-snug">Don't chug plain water, it flushes the electrolytes you're trying to replace.</p>
                </div>

                <div className="mt-3">
                  <PrimaryCta label="See fight night" onClick={() => setWalkout(true)} accent={GREEN} Icon={Trophy} />
                </div>
              </StoryCard>
            </motion.div>
          )}

          {/* ── Chapter 5 · Walkout / Fight night ── */}
          {walkout && (
            <motion.div initial={reduced ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 22 }}>
              <div className="relative rounded-2xl overflow-hidden p-6 text-center" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${hsl(GREEN, 0.22)}, transparent 70%), hsl(var(--card))`, border: `1px solid ${hsl(GREEN, 0.4)}` }}>
                <Confetti count={30} />
                <motion.div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: hsl(GREEN, 0.18), boxShadow: `0 0 0 2px ${hsl(GREEN, 0.4)}, 0 0 40px ${hsl(GREEN, 0.35)}` }} initial={reduced ? false : { scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 360, damping: 16 }}>
                  <Trophy className="h-8 w-8" style={{ color: hsl(GREEN) }} />
                </motion.div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: hsl(GREEN) }}>Walkout · H+24</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">You made weight & refueled</h2>
                <p className="mt-1.5 text-[13px] text-muted-foreground">Fight time. Full and strong.</p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[["Made weight", `${TARGET.toFixed(1)} kg`], ["Rehydrated", `≈${orsLitres ?? "3.0"} L`], ["Walked in", `${(START).toFixed(1)} kg`]].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-background/40 border border-border/40 py-2">
                      <p className="text-[14px] font-bold tabular-nums text-foreground">{v}</p>
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70">{k}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <button onClick={reset} className="mt-6 mx-auto flex items-center gap-1.5 text-[12px] text-muted-foreground/60 active:text-foreground">
          <RotateCcw className="h-3 w-3" /> restart the story
        </button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground/50">Dev-only showroom · route <code>/protocol-story-lab</code> · not wired into the app</p>
      </div>
    </div>
  );
}
