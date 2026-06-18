import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Trophy, Zap, Info, RotateCcw, Sparkles, RefreshCw } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Missions Lab — design exploration (dev-only, route: /missions-lab)
 *
 * Two features, one matched design language:
 *   1. Training Missions  (single checklist, XP/level header)
 *   2. Sparring To-Do List (per-discipline groups, technique → when-to-use →
 *      setups/counters)
 *
 * Locked direction (applies to BOTH):
 *  • Minimal, text-only rows; no background behind discipline/level labels
 *  • Secondary detail tucked behind a disclosure ("Why this mission" /
 *    "Setups & counters") to cut clutter; em/en-dashes stripped
 *  • Per-item reward animation (checkbox pop → checkmark draw → strikethrough
 *    sweep → XP float → ring/bar fill)
 *  • Complete-all → full-screen takeover celebration
 *  • Collapse state persists across navigation (localStorage)
 * Nothing here is wired into the app.
 * ------------------------------------------------------------------ */

const BJJ = "--coach-bjj";
const MT = "--coach-muay-thai";
const SPAR = "--coach-sparring";

const hsl = (token: string, a = 1) => `hsl(var(${token}) / ${a})`;
const accent = (a = 1) => hsl(BJJ, a); // missions demo discipline

/** Strip em/en dashes (— –) — they read as AI-generated. Swap for a comma. */
function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").trim();
}

const XP_PER_ITEM = 10;

/* =============================== shared =============================== */

function useCountUp(target: number, run: boolean, ms = 700) {
  const [n, setN] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!run) return;
    if (reduced) { setN(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms, reduced]);
  return n;
}

function Confetti({ count = 26 }: { count?: number }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const dist = 90 + (i % 6) * 26;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 30,
          rot: (i * 61) % 360,
          size: 5 + (i % 3) * 3,
          color: ["#23C599", "#3B82F6", "#FAC146", "#F08439", "#9DE7D0"][i % 5],
        };
      }),
    [count],
  );
  if (reduced) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      <div className="relative">
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-[2px]"
            style={{ width: p.size, height: p.size * 1.4, background: p.color }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
            animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot, scale: 1 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>
    </div>
  );
}

/** Animated checkbox + checkmark draw, shared by both features. */
function AnimatedCheckbox({ done, token }: { done: boolean; token: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="relative h-[18px] w-[18px] rounded-md border flex items-center justify-center flex-shrink-0 mt-[1px]"
      animate={{
        backgroundColor: done ? hsl(token, 1) : "hsla(0,0%,100%,0)",
        borderColor: done ? hsl(token, 1) : "hsl(var(--border))",
        scale: done && !reduced ? [1, 1.3, 1] : 1,
      }}
      transition={{ duration: 0.32, ease: "easeOut" }}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} className="text-background">
        <motion.path
          d="M5 12.5 L10 17.5 L19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: done ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.28, ease: "easeOut", delay: done ? 0.08 : 0 }}
        />
      </svg>
    </motion.span>
  );
}

/** Floating "+N XP" that rises on tick. */
function XpFloat({ floatKey, done, token }: { floatKey: number; done: boolean; token: string }) {
  return (
    <AnimatePresence>
      {floatKey > 0 && done && (
        <motion.span
          key={floatKey}
          className="absolute right-3 top-1.5 text-[11px] font-extrabold tabular-nums pointer-events-none"
          style={{ color: hsl(token, 1) }}
          initial={{ opacity: 0, y: 0, scale: 0.8 }}
          animate={{ opacity: [0, 1, 1, 0], y: -22, scale: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          +{XP_PER_ITEM} XP
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* --------------------- full-screen celebration --------------------- */
function FullScreenCelebration({
  onClose,
  token,
  eyebrow,
  title,
  subtitle,
  totalXp,
}: {
  onClose: () => void;
  token: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  totalXp: number;
}) {
  const reduced = useReducedMotion();
  const xp = useCountUp(totalXp, true);
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center px-8 bg-background/85 backdrop-blur-md"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
    >
      <Confetti count={34} />
      <motion.div
        className="relative text-center"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reduced ? { duration: 0.2 } : { type: "spring", stiffness: 360, damping: 20 }}
      >
        <div className="mx-auto mb-4 h-20 w-20 rounded-full flex items-center justify-center" style={{ background: hsl(token, 0.16), boxShadow: `0 0 0 2px ${hsl(token, 0.4)}, 0 0 40px ${hsl(token, 0.35)}` }}>
          <Trophy className="h-10 w-10" style={{ color: hsl(token, 1) }} />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: hsl(token, 1) }}>{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="mt-2 text-[13px] text-muted-foreground">{subtitle}</p>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[15px] font-extrabold tabular-nums" style={{ background: hsl(token, 0.16), color: hsl(token, 1) }}>
          <Zap className="h-4 w-4" /> +{xp} XP
        </div>
        <p className="mt-4 text-[12px] font-semibold text-muted-foreground">tap anywhere to close</p>
      </motion.div>
    </motion.div>
  );
}

type Celebration = { token: string; eyebrow: string; title: string; subtitle: string; totalXp: number };

/* ====================== 1. TRAINING MISSIONS ====================== */

type Item = { id: string; text: string; done: boolean };

const MISSION_ITEMS: Item[] = [
  { id: "i1", text: "Drill the cross-collar grip break from closed guard, 3×10 each side", done: false },
  { id: "i2", text: "Live-roll focusing only on hip escapes when pinned in side control", done: false },
  { id: "i3", text: "Shadow the arm-drag to back-take entry, slow then at pace", done: false },
  { id: "i4", text: "Sweep from butterfly guard, 20 controlled reps each side", done: false },
  { id: "i5", text: "Knee-shield re-guard off a pass attempt with a partner", done: false },
  { id: "i6", text: "Finish the triangle from broken-down posture, 10 reps", done: false },
  { id: "i7", text: "Two 5-min positional rounds starting from bottom mount", done: false },
];
const MISSION_RATIONALE =
  "Your last two rolls stalled in side control — these drills rebuild the escape and re-guard chain so you're not stuck under pressure.";

function TickRow({ item, onToggle }: { item: Item; onToggle: () => void }) {
  const reduced = useReducedMotion();
  const [floatKey, setFloatKey] = useState(0);
  const done = item.done;
  const handle = () => {
    if (!done) setFloatKey((k) => k + 1);
    onToggle();
  };
  return (
    <motion.button
      type="button" onClick={handle} layout
      className="relative w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left overflow-hidden"
      animate={{ backgroundColor: done ? accent(0.06) : "hsla(0,0%,100%,0.03)" }}
      whileTap={{ scale: 0.99 }} aria-pressed={done}
    >
      <AnimatePresence>
        {done && !reduced && (
          <motion.span key="flash" className="absolute inset-0 pointer-events-none" style={{ background: accent(0.18) }} initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} />
        )}
      </AnimatePresence>
      <AnimatedCheckbox done={done} token={BJJ} />
      <div className="flex-1 min-w-0">
        <span className="relative inline-block">
          <motion.span className="block text-[12.5px] leading-snug line-clamp-2" animate={{ color: done ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
            {item.text}
          </motion.span>
          <motion.span className="absolute left-0 top-1/2 h-[1.5px] origin-left" style={{ background: "hsl(var(--muted-foreground))", width: "100%" }} initial={false} animate={{ scaleX: done ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }} />
        </span>
      </div>
      <XpFloat floatKey={floatKey} done={done} token={BJJ} />
    </motion.button>
  );
}

const MISSION_COLLAPSE_KEY = "wcw_missionlab_expanded";
const COLLAPSED_COUNT = 5;

function MissionCard({ title, onComplete }: { title: string; onComplete: () => void }) {
  const reduced = useReducedMotion();
  const [items, setItems] = useState<Item[]>(() => MISSION_ITEMS.map((i) => ({ ...i })));
  const [showWhy, setShowWhy] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(MISSION_COLLAPSE_KEY);
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch { /* ignore */ }
    return items.length <= COLLAPSED_COUNT;
  });
  useEffect(() => {
    try { localStorage.setItem(MISSION_COLLAPSE_KEY, expanded ? "1" : "0"); } catch { /* ignore */ }
  }, [expanded]);

  const prevAllDone = useRef(false);
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = (done / total) * 100;
  const allDone = done === total;
  useEffect(() => {
    if (allDone && !prevAllDone.current) onComplete();
    prevAllDone.current = allDone;
  }, [allDone, onComplete]);

  const toggle = (id: string) => setItems((arr) => arr.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const reset = () => { setItems(MISSION_ITEMS.map((i) => ({ ...i }))); prevAllDone.current = false; };
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);

  return (
    <div className="relative w-full rounded-2xl card-surface border overflow-hidden" style={{ borderColor: accent(0.25) }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent(0.05)}, transparent)` }} />
      <div className="relative px-4 pt-3 pb-2.5 flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <svg width={42} height={42} viewBox="0 0 42 42">
            <circle cx={21} cy={21} r={18} fill="none" stroke="hsl(var(--muted) / 0.3)" strokeWidth={3} />
            <motion.circle cx={21} cy={21} r={18} fill="none" stroke={accent(1)} strokeWidth={3} strokeLinecap="round" transform="rotate(-90 21 21)" strokeDasharray={2 * Math.PI * 18} animate={{ strokeDashoffset: 2 * Math.PI * 18 * (1 - pct / 100) }} transition={{ duration: reduced ? 0 : 0.5, ease: "easeOut" }} />
            <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="hsl(var(--foreground))" fontSize={13} className="font-bold tabular-nums">7</text>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent(1) }}>BJJ</span>
            <span className="text-[10px] font-bold uppercase tracking-wider tabular-nums text-muted-foreground/70">Lv 7</span>
          </div>
          <p className="text-[14px] font-semibold text-foreground leading-snug break-words">{title}</p>
        </div>
        <span className="text-[12px] tabular-nums font-bold flex-shrink-0" style={{ color: done > 0 ? accent(1) : "hsl(var(--muted-foreground))" }}>{done}/{total}</span>
      </div>
      <div className="px-4">
        <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ background: accent(1) }} animate={{ width: `${pct}%` }} transition={{ duration: reduced ? 0 : 0.5 }} />
        </div>
      </div>
      <div className="relative px-4 pt-3 pb-3.5">
        <div className="mb-2.5">
          <button onClick={() => setShowWhy((w) => !w)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/70 active:text-foreground">
            <Info className="h-3 w-3" /> Why this mission
            <ChevronDown className={`h-3 w-3 transition-transform ${showWhy ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {showWhy && (
              <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-[11.5px] text-muted-foreground leading-snug mt-1.5">
                {stripDashes(MISSION_RATIONALE)}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <ul className="space-y-1.5">
          {visible.map((item) => (<li key={item.id}><TickRow item={item} onToggle={() => toggle(item.id)} /></li>))}
        </ul>
        {total > COLLAPSED_COUNT && (
          <button onClick={() => setExpanded((e) => !e)} className="w-full mt-2 min-h-[34px] flex items-center justify-center gap-1.5 text-[12px] font-semibold text-muted-foreground/80 active:text-foreground">
            {expanded ? "Show fewer" : `Show all ${total} items`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
        <button onClick={reset} className="mt-1 w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/50 active:text-foreground"><RotateCcw className="h-3 w-3" /> reset</button>
      </div>
    </div>
  );
}

/* ====================== 2. SPARRING TO-DO LIST ====================== */

type SparItem = {
  id: string;
  discipline: string;
  token: string;
  technique: string;
  whenToUse: string;
  setups: string[];
  counters: string[];
  done: boolean;
};

const SPARRING_ITEMS: SparItem[] = [
  { id: "s1", discipline: "BJJ", token: BJJ, technique: "Knee-cut pass", whenToUse: "When they open half guard and frame on your hip", setups: ["Pin the far ankle, then slide the shin across", "Strong cross-face to kill the underhook"], counters: ["If they get the underhook, switch to a backstep pass"], done: false },
  { id: "s2", discipline: "BJJ", token: BJJ, technique: "Arm-drag to the back", whenToUse: "From seated guard when they post a lazy hand", setups: ["Snap the wrist down, drag across your centre"], counters: ["If they square up, threaten the single leg"], done: false },
  { id: "s3", discipline: "BJJ", token: BJJ, technique: "Triangle from guard", whenToUse: "When they reach in with one arm posted", setups: ["Break posture, control the wrist, shoot the legs"], counters: ["If they stack, swing to an armbar"], done: false },
  { id: "s4", discipline: "BJJ", token: BJJ, technique: "Hip-bump sweep", whenToUse: "When they sit back to posture out of closed guard", setups: ["Trap the arm, swing your hips up and over"], counters: ["If they base wide, transition to kimura"], done: false },
  { id: "s5", discipline: "BJJ", token: BJJ, technique: "Guard retention shrimp", whenToUse: "As they start to pass toward side control", setups: ["Shrimp early, re-frame on the shoulder"], counters: [], done: false },
  { id: "m1", discipline: "Muay Thai", token: MT, technique: "Switch kick to the body", whenToUse: "When they're square and flat-footed", setups: ["Feint the jab, switch step, turn the hip over"], counters: ["If they check, follow with a low kick"], done: false },
  { id: "m2", discipline: "Muay Thai", token: MT, technique: "Teep to control range", whenToUse: "When they walk you down", setups: ["Pendulum step back, snap the lead teep"], counters: ["If they catch it, pivot off the line"], done: false },
  { id: "m3", discipline: "Muay Thai", token: MT, technique: "Lead hook off the 1-2", whenToUse: "After landing the cross and they cover up", setups: ["Sit on the 1-2, roll into the hook"], counters: ["If they slip, re-pivot and reset"], done: false },
];

function SparringRow({ row, onToggle }: { row: SparItem; onToggle: () => void }) {
  const reduced = useReducedMotion();
  const [floatKey, setFloatKey] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const done = row.done;
  const hasDetails = row.setups.length > 0 || row.counters.length > 0;
  const handle = () => {
    if (!done) setFloatKey((k) => k + 1);
    onToggle();
  };
  return (
    <motion.div layout className="relative rounded-lg overflow-hidden" animate={{ backgroundColor: done ? hsl(row.token, 0.06) : "hsla(0,0%,100%,0.03)" }}>
      <AnimatePresence>
        {done && !reduced && (
          <motion.span key="flash" className="absolute inset-0 pointer-events-none" style={{ background: hsl(row.token, 0.18) }} initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} />
        )}
      </AnimatePresence>
      {/* main tap area toggles done */}
      <motion.button type="button" onClick={handle} whileTap={{ scale: 0.99 }} className="relative w-full flex items-start gap-2.5 px-2.5 py-2 text-left" aria-pressed={done}>
        <AnimatedCheckbox done={done} token={row.token} />
        <div className="flex-1 min-w-0">
          <span className="relative inline-block">
            <motion.span className="block text-[13px] font-semibold leading-snug" animate={{ color: done ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
              {row.technique}
            </motion.span>
            <motion.span className="absolute left-0 top-1/2 h-[1.5px] origin-left" style={{ background: "hsl(var(--muted-foreground))", width: "100%" }} initial={false} animate={{ scaleX: done ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.3 }} />
          </span>
          {row.whenToUse && (
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-1">{stripDashes(row.whenToUse)}</p>
          )}
        </div>
        <XpFloat floatKey={floatKey} done={done} token={row.token} />
      </motion.button>

      {/* per-row disclosure for setups/counters — keeps the feature, cuts clutter */}
      {hasDetails && (
        <div className="px-2.5 pb-2 -mt-1">
          <button type="button" onClick={() => setDetailsOpen((o) => !o)} className="ml-[28px] inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 active:text-foreground">
            Setups & counters
            <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden ml-[28px] mt-1.5 space-y-1.5">
                {row.setups.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-0.5">Setups</p>
                    {row.setups.map((s, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground/90 leading-snug">· {stripDashes(s)}</p>
                    ))}
                  </div>
                )}
                {row.counters.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-0.5">Counters</p>
                    {row.counters.map((c, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground/90 leading-snug">· {stripDashes(c)}</p>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

const SPAR_DEFAULT_VISIBLE = 4;

function SparringGroup({ discipline, token, rows, onToggle }: { discipline: string; token: string; rows: SparItem[]; onToggle: (id: string) => void }) {
  const minKey = `wcw_sparlab_min_${discipline}`;
  const expKey = `wcw_sparlab_exp_${discipline}`;
  const [minimised, setMinimised] = useState<boolean>(() => {
    try { return localStorage.getItem(minKey) === "1"; } catch { return false; }
  });
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(expKey) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(minKey, minimised ? "1" : "0"); } catch { /* ignore */ } }, [minimised, minKey]);
  useEffect(() => { try { localStorage.setItem(expKey, expanded ? "1" : "0"); } catch { /* ignore */ } }, [expanded, expKey]);

  const todos = rows.filter((r) => !r.done);
  const dones = rows.filter((r) => r.done);
  const ordered = [...todos, ...dones];
  const collapsed = todos.slice(0, SPAR_DEFAULT_VISIBLE);
  const visible = expanded ? ordered : collapsed;
  const hasMore = ordered.length > collapsed.length;

  return (
    <div className="space-y-2">
      {/* header — plain coloured label (no pill bg) */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: hsl(token, 1) }}>{discipline}</span>
        <span className="text-[10px] tabular-nums font-bold text-muted-foreground/60">{todos.length} to go</span>
        <button className="ml-auto h-7 w-7 flex items-center justify-center rounded text-muted-foreground/60 active:text-foreground active:bg-muted/25 transition-colors" aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setMinimised((m) => !m)} className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground/60 active:text-foreground active:bg-muted/25 transition-colors" aria-label={minimised ? "Expand" : "Minimise"}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${minimised ? "-rotate-90" : ""}`} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {!minimised && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-1.5">
              {visible.map((row) => (<SparringRow key={row.id} row={row} onToggle={() => onToggle(row.id)} />))}
            </div>
            {hasMore && (
              <button onClick={() => setExpanded((e) => !e)} className="w-full mt-2 min-h-[32px] flex items-center justify-center gap-1.5 text-[12px] font-semibold text-muted-foreground/80 active:text-foreground">
                {expanded ? "Show fewer" : `Show all (${ordered.length})`}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SparringCard({ onComplete }: { onComplete: () => void }) {
  const [rows, setRows] = useState<SparItem[]>(() => SPARRING_ITEMS.map((r) => ({ ...r })));
  const prevAllDone = useRef(false);
  const totalTodo = rows.filter((r) => !r.done).length;
  useEffect(() => {
    if (totalTodo === 0 && !prevAllDone.current) onComplete();
    prevAllDone.current = totalTodo === 0;
  }, [totalTodo, onComplete]);

  const grouped = useMemo(() => {
    const map = new Map<string, SparItem[]>();
    for (const r of rows) {
      const e = map.get(r.discipline);
      if (e) e.push(r); else map.set(r.discipline, [r]);
    }
    return Array.from(map.entries());
  }, [rows]);

  const toggle = (id: string) => setRows((arr) => arr.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));
  const reset = () => { setRows(SPARRING_ITEMS.map((r) => ({ ...r }))); prevAllDone.current = false; };

  return (
    <div>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80 mb-2">Sparring to-do list</h2>
      <div className="relative w-full rounded-2xl card-surface border overflow-hidden" style={{ borderColor: hsl(SPAR, 0.25) }}>
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${hsl(SPAR, 0.05)}, transparent)` }} />
        <div className="relative p-4 space-y-4">
          {grouped.map(([discipline, drows]) => (
            <SparringGroup key={discipline} discipline={discipline} token={drows[0].token} rows={drows} onToggle={toggle} />
          ))}
          <button onClick={reset} className="w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/50 active:text-foreground"><RotateCcw className="h-3 w-3" /> reset</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ PAGE ============================ */
export default function MissionsLab() {
  const [celebrate, setCelebrate] = useState<Celebration | null>(null);

  const missionCele: Celebration = { token: BJJ, eyebrow: "Mission cleared", title: "Every item ticked", subtitle: "Sharp work. Log your next session to unlock the next mission.", totalXp: 120 };
  const sparringCele: Celebration = { token: SPAR, eyebrow: "Sparring ready", title: "To-do list cleared", subtitle: "Every focus ticked off. Log more techniques to refresh your list.", totalXp: 90 };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Missions Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Both features in one matched design: minimal text-only rows, no backgrounds behind labels, secondary detail
            behind a disclosure, the rewarding tick animation, and a <strong className="text-foreground">full-screen</strong> complete-all.
            Tick everything to see it. Collapse any list (or a sparring discipline), reload — it stays.
          </p>
        </header>

        <div className="mb-6 grid gap-2 sm:grid-cols-3">
          {[
            ["Plain labels", "No rounded backgrounds behind BJJ / Muay Thai / Lv — coloured text only."],
            ["Less text up front", "Rationale / setups+counters behind a toggle; em-dashes stripped."],
            ["Persistent collapse", "Saved per list and per sparring discipline; survives leaving the page."],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
              <p className="text-[12px] font-semibold text-foreground">{k}</p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{v}</p>
            </div>
          ))}
        </div>

        {/* 1. Training Missions */}
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">1</span>
          Training Missions
        </h2>
        <MissionCard title="Escape and re-guard under pressure" onComplete={() => setCelebrate(missionCele)} />

        {/* 2. Sparring To-Do List */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">2</span>
            Sparring To-Do List
          </h2>
          <SparringCard onComplete={() => setCelebrate(sparringCele)} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button onClick={() => setCelebrate(missionCele)} className="rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground active:scale-95 transition inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Preview mission celebration</button>
          <button onClick={() => setCelebrate(sparringCele)} className="rounded-lg border border-border/60 px-3 py-2 text-[12px] font-semibold active:scale-95 transition inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Preview sparring celebration</button>
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground/60">Dev-only showroom · route <code>/missions-lab</code> · not wired into the app</p>
      </div>

      <AnimatePresence>
        {celebrate && (
          <FullScreenCelebration
            onClose={() => setCelebrate(null)}
            token={celebrate.token}
            eyebrow={celebrate.eyebrow}
            title={celebrate.title}
            subtitle={celebrate.subtitle}
            totalXp={celebrate.totalXp}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
