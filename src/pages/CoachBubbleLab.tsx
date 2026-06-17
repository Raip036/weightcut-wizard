import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  ChevronRight,
  Scale,
  Utensils,
  Dumbbell,
  Droplet,
  HeartPulse,
  Clock,
  HelpCircle,
  Check,
  AlertTriangle,
  Bell,
  Sparkles,
  MessageCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Orb } from "@/components/chat/Orb";

/* ------------------------------------------------------------------ *
 * Coach Bubble Lab — design exploration (dev-only, route: /coach-bubble-lab)
 *
 * Variations of the proactive coach speech bubble shown in context (faux
 * dashboard + the real Orb). Direction chosen: Variant B (Refined Card) with
 * CONTEXT-AWARE actions — the primary CTA matches what the coach is nudging
 * about (weigh-in → Log weigh-in, nutrition → Log a meal, etc.) and deep-links
 * to the right screen. Also includes the proposed anti-annoyance frequency model.
 * Nothing here is wired into the app yet.
 * ------------------------------------------------------------------ */

type Tier = "redFlag" | "priority" | "greeting";

type Scenario = {
  id: string;
  label: string;
  tier: Tier;
  message: string;
  short: string; // for the minimal pill
  /** null => no specific action, primary CTA is just "Chat". */
  action: { label: string; Icon: LucideIcon; route: string } | null;
  stats: { k: string; v: string; tone?: string }[];
};

/* The key idea the user asked for: the message's INTENT drives the CTA + route.
 * In production this comes from the server briefing (an `action` field), not by
 * parsing text. These mirror real coachBriefing outputs + real app routes. */
const SCENARIOS: Scenario[] = [
  {
    id: "weighIn",
    label: "Weigh-in",
    tier: "priority",
    message: "A quick weigh-in helps me keep you on plan, whenever suits",
    short: "Quick weigh-in?",
    action: { label: "Log weigh-in", Icon: Scale, route: "/weight" },
    stats: [
      { k: "3d", v: "to weigh-in" },
      { k: "3d", v: "since log" },
    ],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    tier: "priority",
    message: "You're ~600 kcal under today. A quick meal log keeps the plan honest",
    short: "Log today's meals?",
    action: { label: "Log a meal", Icon: Utensils, route: "/nutrition" },
    stats: [
      { k: "600", v: "kcal left" },
      { k: "2", v: "meals in" },
    ],
  },
  {
    id: "training",
    label: "Training",
    tier: "priority",
    message: "Trained today? Logging the session keeps your load and recovery honest",
    short: "Log your session?",
    action: { label: "Log session", Icon: Dumbbell, route: "/training-calendar?openLogSession=true" },
    stats: [
      { k: "4", v: "this week" },
      { k: "+2h", v: "vs last", tone: "text-func-recovery-green" },
    ],
  },
  {
    id: "hydration",
    label: "Hydration",
    tier: "redFlag",
    message: "Water-load day. Could start with 1L now, then keep it steady",
    short: "Start water-loading",
    action: { label: "Open protocol", Icon: Droplet, route: "/weight-protocol" },
    stats: [
      { k: "2d", v: "to weigh-in" },
      { k: "1L", v: "target now" },
    ],
  },
  {
    id: "recovery",
    label: "Recovery",
    tier: "priority",
    message: "Readiness dipped. A quick check-in tells me how hard to push tomorrow",
    short: "How are you feeling?",
    action: { label: "Check in", Icon: HeartPulse, route: "/recovery/check-in" },
    stats: [
      { k: "48", v: "readiness" },
      { k: "-12", v: "vs avg", tone: "text-func-danger-red" },
    ],
  },
  {
    id: "greeting",
    label: "Greeting",
    tier: "greeting",
    message: "Morning Pratik. 3 days out, 0.4kg to go, on plan",
    short: "3 days out, on plan",
    action: null, // no specific ask → Chat only
    stats: [
      { k: "3d", v: "out" },
      { k: "0.4kg", v: "to go" },
    ],
  },
];

const TIER_META: Record<Tier, { label: string; dot: string; ring: string; text: string }> = {
  redFlag: { label: "Red flag", dot: "bg-func-danger-red", ring: "border-func-danger-red/40", text: "text-func-danger-red" },
  priority: { label: "Priority", dot: "bg-primary", ring: "border-primary/35", text: "text-primary" },
  greeting: { label: "Greeting", dot: "bg-muted-foreground", ring: "border-border/60", text: "text-muted-foreground" },
};

/** Bold any number / unit inside the message — mirrors the real bubble helper. */
function boldNumbers(text: string) {
  const parts = text.split(/(\d[\d.,]*\s?(?:kg|lbs?|%|ml|L|g|hrs?|h|min|days?|wk|d)?)/gi);
  return parts.map((p, i) =>
    p && /^\d/.test(p) ? (
      <strong key={i} className="font-bold text-foreground">
        {p}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Phone frame — faux dashboard backdrop + orb anchored bottom-right.
 * ------------------------------------------------------------------ */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[300px] h-[420px] rounded-[2rem] border border-border/60 bg-background overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
      <div className="absolute inset-0 p-4 select-none pointer-events-none">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 mb-3">Your Stats</p>
        <div className="grid grid-cols-2 gap-2.5">
          {["WEIGHT", "TRAINING", "SLEEP", "RECOVERY"].map((l) => (
            <div key={l} className="rounded-2xl border border-border/40 bg-card/60 h-[88px] p-2.5 flex flex-col justify-between">
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">{l}</span>
              <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/15" />
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-[92px] right-4 left-4 flex justify-end z-20">{children}</div>
      <div className="absolute bottom-5 right-5 z-10">
        <Orb size={56} state="idle" />
      </div>
    </div>
  );
}

function Tail({ tone = "border-primary/35" }: { tone?: string }) {
  return <div className={`absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 bg-card/95 border-r border-b ${tone}`} />;
}

/* ============================ VARIATIONS ============================ */

/* A — Minimal Pill */
function VariantPill({ s }: { s: Scenario }) {
  const [expanded, setExpanded] = useState(false);
  const m = TIER_META[s.tier];
  return (
    <motion.button
      layout
      type="button"
      onClick={() => setExpanded((e) => !e)}
      initial={{ opacity: 0, scale: 0.7, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: [0, -2, 0] }}
      transition={{ y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 420, damping: 24 } }}
      style={{ transformOrigin: "right bottom" }}
      className="relative pointer-events-auto max-w-[230px] text-left"
    >
      <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-card/90 backdrop-blur-xl pl-2.5 pr-3 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <span className={`h-1.5 w-1.5 rounded-full ${m.dot} shrink-0`} />
        <span className="text-[12px] leading-none text-foreground">{expanded ? boldNumbers(s.message) : s.short}</span>
        <ChevronRight className="h-3.5 w-3.5 text-primary/70 shrink-0" />
      </div>
      <Tail tone={m.ring} />
    </motion.button>
  );
}

/* B — Refined Card with CONTEXT-AWARE action (chosen direction). */
function VariantRefined({ s }: { s: Scenario }) {
  const [open, setOpen] = useState(true);
  const m = TIER_META[s.tier];
  if (!open) return <ReplayChip onReplay={() => setOpen(true)} />;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -3, 0] }}
      transition={{ y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 420, damping: 24 } }}
      style={{ transformOrigin: "right bottom" }}
      className="relative max-w-[244px] pointer-events-auto"
    >
      <div className={`rounded-2xl border ${m.ring} bg-card/90 backdrop-blur-xl px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${m.text}`}>Coach</span>
          {s.tier === "redFlag" && <AlertTriangle className="h-3 w-3 text-func-danger-red ml-auto" />}
        </div>
        <p className="text-[13px] leading-snug text-foreground">{boldNumbers(s.message)}</p>
        <div className="mt-2.5 flex items-center gap-2">
          {s.action ? (
            <>
              <button className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95 transition">
                <s.action.Icon className="h-3 w-3" /> {s.action.label}
              </button>
              <button className="flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground active:scale-95 transition">
                <MessageCircle className="h-3 w-3" /> Chat
              </button>
            </>
          ) : (
            <button className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground active:scale-95 transition">
              <MessageCircle className="h-3 w-3" /> Chat with coach
            </button>
          )}
        </div>
        {/* shows the deep-link target for clarity in the lab */}
        {s.action && (
          <p className="mt-1.5 text-[9px] text-muted-foreground/50">→ {s.action.route}</p>
        )}
      </div>
      <DismissBtn onClick={() => setOpen(false)} />
      <Tail tone={m.ring} />
    </motion.div>
  );
}

/* C — Quick-reply chips */
function VariantChips({ s }: { s: Scenario }) {
  const [state, setState] = useState<"open" | "done" | "later" | "closed">("open");
  const m = TIER_META[s.tier];
  if (state === "closed") return <ReplayChip onReplay={() => setState("open")} />;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -3, 0] }}
      transition={{ y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 420, damping: 24 } }}
      style={{ transformOrigin: "right bottom" }}
      className="relative max-w-[244px] pointer-events-auto"
    >
      <div className={`rounded-2xl border ${m.ring} bg-card/90 backdrop-blur-xl px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${m.text}`}>Coach</span>
        </div>
        <p className="text-[13px] leading-snug text-foreground">{boldNumbers(s.message)}</p>
        <AnimatePresence mode="wait">
          {state === "open" ? (
            <motion.div key="chips" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2.5 flex flex-wrap gap-1.5">
              <Chip icon={<Check className="h-3 w-3" />} label="Done" onClick={() => setState("done")} accent />
              <Chip icon={<Clock className="h-3 w-3" />} label="Later" onClick={() => setState("later")} />
              <Chip icon={<HelpCircle className="h-3 w-3" />} label="Why?" onClick={() => setState("closed")} />
            </motion.div>
          ) : (
            <motion.p key="ack" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 text-[11px] font-medium text-muted-foreground">
              {state === "done" ? "Nice — logged. I'll keep quiet 👊" : "No worries, I'll nudge you later"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <DismissBtn onClick={() => setState("closed")} />
      <Tail tone={m.ring} />
    </motion.div>
  );
}

/* D — Contextual stat card (also context-aware CTA) */
function VariantStat({ s }: { s: Scenario }) {
  const [open, setOpen] = useState(true);
  const m = TIER_META[s.tier];
  if (!open) return <ReplayChip onReplay={() => setOpen(true)} />;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -3, 0] }}
      transition={{ y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 420, damping: 24 } }}
      style={{ transformOrigin: "right bottom" }}
      className="relative max-w-[252px] pointer-events-auto"
    >
      <div className={`rounded-2xl border ${m.ring} bg-card/90 backdrop-blur-xl px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}>
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${m.text}`}>Coach</span>
        </div>
        <div className="flex items-center gap-2 mb-2 text-[10px] tabular-nums">
          {s.stats.map((st, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-border">·</span>}
              <span className="flex items-baseline gap-1">
                <span className={`font-bold ${st.tone ?? "text-foreground"}`}>{st.k}</span>
                <span className="text-muted-foreground/70">{st.v}</span>
              </span>
            </span>
          ))}
        </div>
        <p className="text-[13px] leading-snug text-foreground">{boldNumbers(s.message)}</p>
        {s.action ? (
          <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/15 border border-primary/30 px-3 py-2 text-[12px] font-semibold text-primary active:scale-[0.97] transition">
            <s.action.Icon className="h-3.5 w-3.5" /> {s.action.label}
          </button>
        ) : (
          <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/15 border border-primary/30 px-3 py-2 text-[12px] font-semibold text-primary active:scale-[0.97] transition">
            <MessageCircle className="h-3.5 w-3.5" /> Chat with coach
          </button>
        )}
      </div>
      <DismissBtn onClick={() => setOpen(false)} />
      <Tail tone={m.ring} />
    </motion.div>
  );
}

/* E — Tiered / adaptive */
function VariantTiered({ s }: { s: Scenario }) {
  const [open, setOpen] = useState(true);
  const m = TIER_META[s.tier];
  if (!open) return <ReplayChip onReplay={() => setOpen(true)} />;
  const accentBg = s.tier === "redFlag" ? "bg-func-danger-red/10" : s.tier === "priority" ? "bg-primary/10" : "bg-muted/40";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -3, 0] }}
      transition={{ y: { duration: 2.6, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", stiffness: 420, damping: 24 } }}
      style={{ transformOrigin: "right bottom" }}
      className="relative max-w-[244px] pointer-events-auto"
    >
      <div className={`overflow-hidden rounded-2xl border ${m.ring} bg-card/90 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}>
        <div className={`flex items-center gap-1.5 px-3.5 pt-2.5 pb-1.5 ${accentBg}`}>
          {s.tier === "redFlag" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-func-danger-red" />
          ) : s.tier === "priority" ? (
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          ) : (
            <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
          )}
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${m.text}`}>
            {s.tier === "redFlag" ? "Coach · Heads up" : s.tier === "priority" ? "Coach · Today" : "Coach"}
          </span>
        </div>
        <div className="px-3.5 pb-3 pt-2">
          <p className="text-[13px] leading-snug text-foreground">{boldNumbers(s.message)}</p>
          <span className="mt-1.5 block text-[10px] font-medium text-primary/80">
            {s.action ? `${s.action.label} →` : "Tap to chat →"}
          </span>
        </div>
      </div>
      <DismissBtn onClick={() => setOpen(false)} />
      <Tail tone={m.ring} />
    </motion.div>
  );
}

/* ----------------------------- bits ----------------------------- */
function Chip({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium active:scale-95 transition ${
        accent ? "bg-primary/15 text-primary border border-primary/30" : "border border-border/60 text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DismissBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute -top-2.5 -right-2.5 h-7 w-7 rounded-full bg-muted/95 border border-border/60 flex items-center justify-center text-muted-foreground active:scale-90 transition shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
      aria-label="Dismiss"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

function ReplayChip({ onReplay }: { onReplay: () => void }) {
  return (
    <button onClick={onReplay} className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground active:scale-95 transition">
      <RotateCcw className="h-3 w-3" /> Replay
    </button>
  );
}

/* ============================ FREQUENCY MODEL ============================ */

type Outcome = "act" | "dismiss" | "snooze" | "ignore";
const COOLDOWN_HRS: Record<Outcome, number> = { act: 24, dismiss: 8, snooze: 4, ignore: 6 };

function FrequencyModel() {
  const [tier, setTier] = useState<Tier>("priority");
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [ignoreStreak, setIgnoreStreak] = useState(0);
  const [shownToday, setShownToday] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const cooldownFor = (o: Outcome, streak: number) =>
    o === "ignore" ? Math.min(COOLDOWN_HRS.ignore * Math.pow(2, streak), 48) : COOLDOWN_HRS[o];

  const DAILY_CAP = 3;
  const overCap = shownToday >= DAILY_CAP && tier !== "redFlag";

  const apply = (o: Outcome) => {
    const streak = o === "ignore" ? ignoreStreak : 0;
    const cd = cooldownFor(o, streak);
    setLastOutcome(o);
    setIgnoreStreak(o === "ignore" ? ignoreStreak + 1 : 0);
    const line =
      o === "act" ? `Acted → message retired, next nudge in ${cd}h`
      : o === "dismiss" ? `Dismissed → quiet for ${cd}h`
      : o === "snooze" ? `Snoozed → back in ${cd}h`
      : `Ignored (auto-collapsed) → backoff ${cd}h (streak ${streak + 1})`;
    setLog((l) => [line, ...l].slice(0, 6));
  };

  const showNudge = () => {
    if (overCap) {
      setLog((l) => [`Suppressed — daily cap of ${DAILY_CAP} reached (red flags exempt)`, ...l].slice(0, 6));
      return;
    }
    setShownToday((n) => n + 1);
    setLog((l) => [`Shown (${TIER_META[tier].label.toLowerCase()})`, ...l].slice(0, 6));
  };

  const rules = [
    ["Session cap", "Once per cold open — never re-fires on every route change"],
    ["Auto-collapse", "Peeks ~6s then folds back into the orb; never sits there nagging"],
    ["Outcome cooldowns", "Act 24h · Dismiss 8h · Snooze 4h · Ignore 6h→escalating (max 48h)"],
    ["Per-message dedupe", "Same text never shown twice in a row (hash tracked)"],
    ["Tier priority", "Red flags can interrupt; greetings only 1×/day & lowest priority"],
    ["Daily ceiling", "Hard cap 3 bubbles/day (red flags exempt for safety)"],
    ["Event-anchored", "Prefer firing after a relevant event over blind on-mount"],
  ];

  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-5">
      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
        <Bell className="h-4 w-4 text-primary" /> Anti-annoyance frequency model
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Today there's only a single 4h dismiss cooldown — it re-appears on every load. This is the proposed engine.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {rules.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border/40 bg-background/40 px-3 py-2">
            <p className="text-[11px] font-semibold text-foreground">{k}</p>
            <p className="text-[11px] text-muted-foreground leading-snug">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-primary mb-3">Live simulator</p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[11px] text-muted-foreground">Tier:</span>
          {(["redFlag", "priority", "greeting"] as Tier[]).map((t) => (
            <button key={t} onClick={() => setTier(t)} className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${tier === t ? "bg-primary text-primary-foreground" : "border border-border/60 text-muted-foreground"}`}>
              {TIER_META[t].label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          <SimBtn label="Show nudge" onClick={showNudge} primary />
          <SimBtn label="Act" onClick={() => apply("act")} />
          <SimBtn label="Dismiss" onClick={() => apply("dismiss")} />
          <SimBtn label="Snooze" onClick={() => apply("snooze")} />
          <SimBtn label="Ignore" onClick={() => apply("ignore")} />
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
          <span>Shown today: <strong className="text-foreground">{shownToday}/{DAILY_CAP}</strong></span>
          {overCap && <span className="text-func-danger-red font-medium">cap reached</span>}
          {lastOutcome && <span>last: <strong className="text-foreground">{lastOutcome}</strong></span>}
        </div>
        <div className="rounded-lg bg-background/60 border border-border/40 p-2 min-h-[72px]">
          {log.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60 italic">Interact to see how often it would fire…</p>
          ) : (
            <ul className="space-y-1">
              {log.map((l, i) => (
                <li key={i} className={`text-[11px] ${i === 0 ? "text-foreground" : "text-muted-foreground/70"}`}>• {l}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SimBtn({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold active:scale-95 transition ${primary ? "bg-primary text-primary-foreground" : "border border-border/60 text-foreground"}`}>
      {label}
    </button>
  );
}

/* ============================ PAGE ============================ */

const VARIANTS = [
  { id: "A", name: "Minimal Pill", desc: "Lowest intrusion. One short line, expands on tap.", Comp: VariantPill },
  { id: "B", name: "Refined Card ✓", desc: "Chosen direction — context-aware primary action + Chat. CTA + deep-link match the topic.", Comp: VariantRefined },
  { id: "C", name: "Quick-reply Chips", desc: "Conversational. Done / Later / Why? — ack & snooze built in.", Comp: VariantChips },
  { id: "D", name: "Contextual Stat", desc: "Most informative: micro-context strip + context-aware CTA.", Comp: VariantStat },
  { id: "E", name: "Tiered / Adaptive", desc: "Urgency-coded header; link label follows the action.", Comp: VariantTiered },
] as const;

export default function CoachBubbleLab() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Coach Bubble Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Variant B is the pick. The primary action is now <strong className="text-foreground">context-aware</strong> — it
            matches what the coach is nudging about and deep-links to the right screen. Switch scenarios below to watch the
            CTA change (Log weigh-in → Log a meal → Log session → Open protocol → Check in → Chat).
          </p>
        </header>

        {/* scenario switcher */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Coach is talking about:</span>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenarioId(s.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                scenarioId === s.id ? "bg-primary text-primary-foreground" : "border border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${TIER_META[s.tier].dot}`} />
              {s.label}
            </button>
          ))}
          <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            CTA:{" "}
            <span className="font-semibold text-primary">
              {scenario.action ? scenario.action.label : "Chat with coach"}
            </span>
            {scenario.action && <span className="text-muted-foreground/50">→ {scenario.action.route}</span>}
          </span>
        </div>

        <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
          {VARIANTS.map(({ id, name, desc, Comp }) => (
            <div key={id} className={`rounded-2xl border p-4 ${id === "B" ? "border-primary/40 bg-primary/[0.04]" : "border-border/50 bg-card/30"}`}>
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{id}</span>
                  <h2 className="text-base font-semibold">{name}</h2>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground leading-snug">{desc}</p>
              </div>
              <PhoneFrame>
                <Comp s={scenario} />
              </PhoneFrame>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <FrequencyModel />
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground/60">Dev-only showroom · route <code>/coach-bubble-lab</code> · not wired into the app</p>
      </div>
    </div>
  );
}
