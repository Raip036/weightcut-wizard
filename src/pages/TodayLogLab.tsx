import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Gauge,
  Dumbbell,
  Moon,
  Heart,
  Utensils,
  Check,
  ChevronDown,
  Flame,
  Play,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Today's Log Lab — design exploration (dev-only, route: /todaylog-lab)
 *
 * The dashboard "Today's Log" card stays full-height even when 5/5 is done
 * (header + big "complete" pill + a row of five 52px tiles ≈ 175px). These are
 * compact COMPLETE-state options that shrink it while keeping the win + edit
 * access. The incomplete (<5/5) state is unchanged. Not wired into the app.
 * ------------------------------------------------------------------ */

const DONE_GLOW = "0 0 14px -4px rgba(35,197,153,0.55)";

const PILLS = [
  { key: "weight", label: "Weight", Icon: Gauge },
  { key: "training", label: "Training", Icon: Dumbbell },
  { key: "sleep", label: "Sleep", Icon: Moon },
  { key: "wellness", label: "Wellness", Icon: Heart },
  { key: "meals", label: "Meals", Icon: Utensils },
] as const;

/** The full 52px tile row (shared by the current card + Variation A expanded). */
function TileRow() {
  return (
    <div className="flex items-stretch gap-1.5 w-full">
      {PILLS.map(({ key, label, Icon }) => (
        <div
          key={key}
          className="relative flex-1 min-h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border border-func-recovery-green/40 bg-func-recovery-green/[0.12] text-func-recovery-green"
          style={{ boxShadow: DONE_GLOW }}
        >
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-func-recovery-green ring-2 ring-background">
            <Check className="h-2.5 w-2.5 text-background" strokeWidth={3} />
          </span>
          <Icon className="h-[17px] w-[17px]" />
          <span className="text-[10px] font-semibold leading-none tracking-tight">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ children, label, height }: { children: React.ReactNode; label: string; height: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-foreground">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{height}</span>
      </div>
      <div className="card-surface rounded-2xl px-3 pt-3 pb-4 space-y-2.5 border border-white/5">{children}</div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Today's log</p>
      <p className="text-note font-semibold tabular-nums text-func-recovery-green flex items-center gap-1">
        5 / 5 <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </p>
    </div>
  );
}

/* ── CURRENT (the problem) ─────────────────────────────────────────── */
function CurrentComplete() {
  return (
    <Card label="Current — complete state" height="≈175px">
      <Header />
      <div
        className="flex items-center justify-center gap-1.5 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/[0.12] py-1.5"
        style={{ boxShadow: DONE_GLOW }}
      >
        <span className="text-[11px] font-semibold tracking-wide text-func-recovery-green">Today's log complete</span>
      </div>
      <div className="pt-1">
        <TileRow />
      </div>
    </Card>
  );
}

/* Small confetti burst for the lab preview (mirrors the real one). */
function LabConfetti({ fireKey }: { fireKey: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const angle = (i / 24) * Math.PI * 2;
        const dist = 80 + (i % 5) * 22;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 24,
          rot: (i * 53) % 360,
          size: 5 + (i % 3) * 2,
          color: ["#23C599", "#3B82F6", "#FAC146", "#23C599", "#9DE7D0"][i % 5],
        };
      }),
    [],
  );
  return (
    <div key={fireKey} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-hidden>
      <div className="relative">
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-[2px]"
            style={{ width: p.size, height: p.size * 1.4, background: p.color }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
            animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot, scale: 1 }}
            transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── VARIATION A — slim bar + auto-celebrate-then-collapse (chosen) ── */
function VariantA() {
  const [userExpanded, setUserExpanded] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const tilesOpen = celebrating || userExpanded;

  // Demo of the real behaviour: on "completion", expand tiles + confetti +
  // staggered glyph pop, then auto-minimise to the slim bar after ~1.9s.
  const playCompletion = () => {
    setUserExpanded(false);
    setConfettiKey((k) => k + 1);
    setCelebrating(true);
  };
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), 1900);
    return () => clearTimeout(t);
  }, [celebrating]);

  return (
    <Card label="A · Slim bar + auto-celebrate (chosen)" height={tilesOpen ? "≈110px" : "≈48px"}>
      <div className="relative">
        <AnimatePresence>{confettiKey > 0 && <LabConfetti fireKey={confettiKey} />}</AnimatePresence>

        <motion.button
          type="button"
          onClick={() => setUserExpanded((e) => !e)}
          className="w-full flex items-center gap-2.5 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/[0.12] px-3 py-2 text-left"
          style={{ boxShadow: DONE_GLOW }}
          initial={false}
          animate={{ scale: 1 }}
        >
          <motion.span
            className="flex h-5 w-5 items-center justify-center rounded-full bg-func-recovery-green shrink-0"
            initial={celebrating ? { scale: 0 } : false}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
          >
            <Check className="h-3 w-3 text-background" strokeWidth={3} />
          </motion.span>
          <span className="text-[13px] font-semibold text-func-recovery-green">Today's log complete</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1.5">
              {PILLS.map(({ key, Icon }, i) => (
                <motion.span
                  key={key}
                  initial={celebrating ? { scale: 0, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18, delay: celebrating ? 0.18 + i * 0.06 : 0 }}
                >
                  <Icon className="h-3.5 w-3.5 text-func-recovery-green" />
                </motion.span>
              ))}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${tilesOpen ? "rotate-180" : ""}`} />
          </span>
        </motion.button>

        <AnimatePresence initial={false}>
          {tilesOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-1.5">
                <TileRow />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        onClick={playCompletion}
        className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary active:opacity-70"
      >
        <Play className="h-3 w-3" /> Play completion
      </button>
    </Card>
  );
}

/* ── VARIATION B — minimal icon cluster, no expand ─────────────────── */
function VariantB() {
  return (
    <Card label="B · Minimal cluster (icons stay tappable)" height="≈64px">
      <Header />
      <div className="flex items-center justify-center gap-5 pt-0.5">
        {PILLS.map(({ key, label, Icon }) => (
          <span key={key} className="flex flex-col items-center" title={label}>
            <Icon className="h-[22px] w-[22px] text-func-recovery-green" />
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ── VARIATION C — fold into the streak card ───────────────────────── */
function VariantC() {
  return (
    <Card label="C · Fold into the streak card (boldest)" height="≈24px footer · card removed">
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-orange-500/70">
          <Flame className="h-4 w-4 text-orange-400" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-foreground">12-day streak</p>
          <p className="text-[11px] text-muted-foreground">Locked in for today</p>
        </div>
      </div>
      <div className="border-t border-white/5 -mx-3 px-3 pt-2 flex items-center gap-2">
        <Check className="h-3.5 w-3.5 text-func-recovery-green" strokeWidth={3} />
        <span className="text-[12px] font-medium text-func-recovery-green">All 5 logged today</span>
        <button className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground active:text-foreground">
          Edit <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </Card>
  );
}

/* ── INCOMPLETE (unchanged, for context) ───────────────────────────── */
function IncompleteContext() {
  const done = 2;
  return (
    <Card label="Incomplete state — unchanged" height="(stays as-is)">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Today's log</p>
        <p className="text-note font-semibold tabular-nums text-muted-foreground">{done} / 5</p>
      </div>
      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(done / 5) * 100}%`, boxShadow: "0 0 10px -1px hsl(var(--primary) / 0.65)" }} />
      </div>
      <div className="flex items-stretch gap-1.5 w-full pt-1">
        {PILLS.map(({ key, label, Icon }, i) => {
          const logged = i < done;
          return (
            <div
              key={key}
              className={`relative flex-1 min-h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border ${
                logged ? "border-func-recovery-green/40 bg-func-recovery-green/[0.12] text-func-recovery-green" : "border-border/60 text-muted-foreground"
              }`}
              style={{ boxShadow: logged ? DONE_GLOW : undefined }}
            >
              {logged && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-func-recovery-green ring-2 ring-background">
                  <Check className="h-2.5 w-2.5 text-background" strokeWidth={3} />
                </span>
              )}
              <Icon className="h-[17px] w-[17px]" />
              <span className="text-[10px] font-semibold leading-none tracking-tight">{label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function TodayLogLab() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Today's Log Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compact ways to show the Today's Log card once it's 5/5 done — it's currently ~175px tall with nothing left
            to do. Tap card A to expand/collapse. The incomplete state is unchanged.
          </p>
        </header>

        <CurrentComplete />

        <div className="h-px bg-border/40" />

        <VariantA />
        <VariantB />
        <VariantC />

        <div className="h-px bg-border/40" />
        <IncompleteContext />

        <p className="text-[11px] text-muted-foreground/60">Dev-only showroom · route <code>/todaylog-lab</code> · not wired into the app</p>
      </div>
    </div>
  );
}
