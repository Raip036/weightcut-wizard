import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import wizard from "@/assets/wizard_3D.png";

/**
 * Onboarding plan-generation loader — "blue aurora wizard". While the AI builds
 * the plan (~10-20s), the athlete's REAL numbers animate in: a fight-date
 * countdown (or weeks-to-goal), the current→fight-week→weigh-in cut bar, and
 * stat chips, over the app's reference premium aesthetic (blue 217 91% 58%,
 * wizard_3D, aurora wash, rising motes, breathing halo, shimmer). Degrades
 * gracefully when fields are missing and respects reduced-motion (settles to a
 * static final frame; loops freeze).
 */

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

interface WizardPlanForgeOverlayProps {
  isFighter?: boolean;
  currentWeightKg?: number;
  /** Weigh-in / final goal weight. */
  goalWeightKg?: number;
  /** Fighter intermediate target (start of fight week). Optional. */
  fightWeekTargetKg?: number;
  /** ISO date — fighters: fight day; others: target date. */
  targetDate?: string;
  /** Plan length in weeks (weight-loss flow). Derived from targetDate when omitted. */
  weeks?: number;
  /** "day_before" | "same_day" (fighter only). */
  weighInTiming?: string;
  /** Discipline slug or label (fighter only), e.g. "boxing" / "Muay Thai". */
  sport?: string;
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

const FIGHTER_STEPS = [
  "Reading your tale of the tape",
  "Crunching the weight-cut math",
  "Mapping your weeks to fight night",
  "Plotting fight week & rehydration",
  "Sealing your plan",
];
const LOSING_STEPS = [
  "Reading your numbers",
  "Crunching the weight-loss math",
  "Mapping your weeks",
  "Dialing in your macros",
  "Sealing your plan",
];

/** Eased count to `target` once mounted (instant under reduced-motion). */
function useCountUp(target: number, reduced: boolean | null, ms = 1200, decimals = 0): number {
  const [n, setN] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setN(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = target * eased;
      setN(decimals ? +v.toFixed(decimals) : Math.round(v));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms, decimals]);
  return n;
}

function CalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function WizardPlanForgeOverlay({
  isFighter,
  currentWeightKg,
  goalWeightKg,
  fightWeekTargetKg,
  targetDate,
  weeks,
  weighInTiming,
  sport,
}: WizardPlanForgeOverlayProps) {
  const reduced = useReducedMotion();
  const steps = isFighter ? FIGHTER_STEPS : LOSING_STEPS;

  // Rotating status line.
  const [statusIdx, setStatusIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % steps.length), 2400);
    return () => clearInterval(t);
  }, [steps.length]);

  // ── Derive the real stats (all guarded so missing fields just hide a piece) ──
  const targetMs = targetDate ? Date.parse(targetDate) : NaN;
  const hasDate = Number.isFinite(targetMs);
  const daysToFight = hasDate ? Math.max(0, Math.ceil((targetMs - Date.now()) / 86_400_000)) : null;
  const weeksToGoal =
    isNum(weeks) && weeks > 0
      ? Math.round(weeks)
      : hasDate
        ? Math.max(1, Math.ceil((targetMs - Date.now()) / (7 * 86_400_000)))
        : null;
  const totalCut =
    isNum(currentWeightKg) && isNum(goalWeightKg) ? +(currentWeightKg - goalWeightKg).toFixed(1) : null;
  const weeksForRate = weeksToGoal ?? (isNum(daysToFight) ? Math.max(1, Math.ceil(daysToFight / 7)) : null);
  const perWeek =
    isNum(totalCut) && totalCut > 0 && isNum(weeksForRate) && weeksForRate > 0
      ? +(totalCut / weeksForRate).toFixed(1)
      : null;

  // Hero: fighter → days-to-fight; else → weeks-to-goal.
  const heroIsDays = !!isFighter && isNum(daysToFight);
  const showHero = heroIsDays || isNum(weeksToGoal);
  const heroValue = heroIsDays ? (daysToFight as number) : (weeksToGoal ?? 0);
  const heroUnit = heroIsDays ? "days to fight" : "weeks to goal";
  const dateLabel =
    heroIsDays && hasDate
      ? new Date(targetMs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : null;

  const heroCount = useCountUp(showHero ? heroValue : 0, reduced, 1200);
  const cutCount = useCountUp(isNum(totalCut) ? Math.abs(totalCut) : 0, reduced, 1300, 1);

  // Cut bar: current → goal, with an optional fight-week marker in between.
  const showBar = isNum(currentWeightKg) && isNum(goalWeightKg) && currentWeightKg > goalWeightKg;
  const span = showBar ? (currentWeightKg as number) - (goalWeightKg as number) : 0;
  const fwInRange =
    showBar &&
    isNum(fightWeekTargetKg) &&
    fightWeekTargetKg < (currentWeightKg as number) &&
    fightWeekTargetKg > (goalWeightKg as number);
  const fwPct = fwInRange ? (((currentWeightKg as number) - (fightWeekTargetKg as number)) / span) * 100 : null;

  const [fill, setFill] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setFill(1), 360);
    return () => clearTimeout(t);
  }, [reduced]);

  // Chips.
  const chips = useMemo(() => {
    const out: Array<{ key: string; text: string; tone?: "ok" | "warn" | "risk" }> = [];
    if (sport && sport.trim()) out.push({ key: "sport", text: titleCase(sport) });
    if (isFighter && weighInTiming) {
      out.push({ key: "weighin", text: `${weighInTiming === "same_day" ? "Same-day" : "Day-before"} weigh-in` });
    }
    if (isNum(perWeek) && perWeek > 0) {
      out.push({ key: "rate", text: `${perWeek} kg/wk`, tone: perWeek <= 1 ? "ok" : perWeek <= 1.5 ? "warn" : "risk" });
    }
    return out;
  }, [sport, isFighter, weighInTiming, perWeek]);

  const motes = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({
      id: i, x: ((i * 47) % 170) - 85, delay: (i % 5) * 0.6, dur: 6 + (i % 4), size: 4 + (i % 3) * 2,
    })),
    [],
  );

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280 }}
      className="relative w-full overflow-hidden card-surface rounded-[28px] border border-primary/20 px-6 pt-8 pb-7 flex flex-col items-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Generating your plan"
    >
      {/* Aurora wash rising from the base. */}
      {!reduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(125% 75% at 50% 100%, ${hsl(0.3)}, transparent 72%)` }}
          animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${hsl(0.6)}, transparent)` }} />

      {/* Rising blue motes. */}
      {!reduced && motes.map((m) => (
        <motion.span
          key={m.id}
          aria-hidden
          className="absolute rounded-full"
          style={{ left: `calc(50% + ${m.x}px)`, bottom: 0, width: m.size, height: m.size, background: hsl(0.7), filter: "blur(0.5px)", boxShadow: `0 0 8px ${hsl(0.9)}` }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: -300, opacity: [0, 1, 0] }}
          transition={{ duration: m.dur, repeat: Infinity, ease: "easeOut", delay: m.delay }}
        />
      ))}

      {/* Haloed, bobbing 3D wizard. */}
      <div className="relative z-10 flex items-center justify-center" style={{ height: 120 }}>
        {!reduced && (
          <motion.div
            aria-hidden
            className="absolute"
            style={{ width: 150, height: 150, borderRadius: "50%", background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.15)} 42%, transparent 70%)`, filter: "blur(8px)" }}
            animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          style={{ width: 104, height: 104, objectFit: "contain", position: "relative", zIndex: 2, filter: `drop-shadow(0 0 18px ${hsl(0.45)})` }}
          initial={reduced ? false : { scale: 0.82, opacity: 0 }}
          animate={reduced ? { y: 0 } : { y: [0, -8, 0], scale: 1, opacity: 1 }}
          transition={{ y: { duration: 3.4, repeat: Infinity, ease: "easeInOut" }, scale: { type: "spring", damping: 18, stiffness: 240 }, opacity: { duration: 0.4 } }}
        />
      </div>

      <p className="relative z-10 mt-2 text-[10px] uppercase tracking-[0.24em] font-bold" style={{ color: hsl() }}>
        {isFighter ? "Forging your fight camp" : "Forging your plan"}
      </p>

      {/* Hero countdown. */}
      {showHero && (
        <>
          <motion.div
            className="relative z-10 mt-3 flex items-baseline gap-2"
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <span className="display-number font-bold tabular-nums leading-none text-foreground" style={{ fontSize: 48 }}>{heroCount}</span>
            <span className="text-[12px] uppercase tracking-[0.14em] font-semibold text-muted-foreground pb-1">{heroUnit}</span>
          </motion.div>
          {dateLabel && (
            <motion.div
              className="relative z-10 mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: hsl() }}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.42, duration: 0.5 }}
            >
              <CalIcon />
              {dateLabel}
            </motion.div>
          )}
        </>
      )}

      {/* Weight-cut bar. */}
      {showBar && (
        <motion.div
          className="relative z-10 mt-5 w-full max-w-[300px]"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5 }}
        >
          <div className="grid grid-cols-3 items-end mb-2">
            <div className="text-left">
              <p className="text-[14px] font-bold tabular-nums text-foreground leading-none">{(currentWeightKg as number).toFixed(1)}</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">now</p>
            </div>
            <div className="text-center">
              <p className="display-number text-[18px] font-extrabold tabular-nums leading-none" style={{ color: hsl() }}>−{cutCount.toFixed(1)} kg</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{isFighter ? "total cut" : "total loss"}</p>
            </div>
            <div className="text-right">
              <p className="text-[14px] font-bold tabular-nums text-foreground leading-none">{(goalWeightKg as number).toFixed(1)}</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{isFighter ? "weigh-in" : "goal"}</p>
            </div>
          </div>
          <div className="relative h-2 rounded-full bg-muted-foreground/15 overflow-hidden">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: `linear-gradient(90deg, ${hsl(0.55)}, ${hsl(1)})` }}
              animate={{ width: `${fill * 100}%` }}
              transition={{ duration: reduced ? 0 : 1.3, ease: [0.22, 1, 0.36, 1] }}
            />
            {!reduced && (
              <motion.div
                className="absolute inset-y-0 w-12"
                style={{ background: `linear-gradient(90deg, transparent, ${hsl(0.9)}, transparent)` }}
                animate={{ x: ["-3rem", "22rem"] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          {fwPct != null && (
            <div className="relative h-4 mt-1">
              <div className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${fwPct}%` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: hsl(), boxShadow: `0 0 6px ${hsl(0.8)}` }} />
                <span className="text-[8.5px] uppercase tracking-wider text-muted-foreground mt-0.5 whitespace-nowrap">fight week {(fightWeekTargetKg as number).toFixed(1)}</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Stat chips. */}
      {chips.length > 0 && (
        <div className="relative z-10 mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {chips.map((c, i) => (
            <motion.span
              key={c.key}
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={reduced ? { duration: 0 } : { delay: 0.7 + i * 0.12, type: "spring", stiffness: 300, damping: 20 }}
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border"
              style={
                c.tone === "warn"
                  ? { color: "hsl(38 92% 60%)", borderColor: "hsl(38 92% 60% / 0.3)", background: "hsl(38 92% 60% / 0.1)" }
                  : c.tone === "risk"
                    ? { color: "hsl(0 84% 64%)", borderColor: "hsl(0 84% 64% / 0.3)", background: "hsl(0 84% 64% / 0.1)" }
                    : { color: hsl(), borderColor: hsl(0.28), background: hsl(0.1) }
              }
            >
              {c.text}
            </motion.span>
          ))}
        </div>
      )}

      {/* Rotating status line. */}
      <div className="relative z-10 mt-5 h-5 overflow-hidden text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={statusIdx}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="text-[13px] text-muted-foreground"
          >
            {steps[statusIdx]}…
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Indeterminate shimmer bar. */}
      <div className="relative z-10 mt-3 h-1 w-44 rounded-full overflow-hidden" style={{ background: hsl(0.12) }}>
        {!reduced && (
          <motion.div
            className="h-full w-1/2 rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${hsl(1)}, transparent)` }}
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>
    </motion.section>
  );
}

export default WizardPlanForgeOverlay;
