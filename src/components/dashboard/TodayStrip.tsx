import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { format } from "date-fns";
import { ImpactStyle } from "@capacitor/haptics";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { springs } from "@/lib/motion";
import { useSubscription } from "@/hooks/useSubscription";

export type Adherence = {
  weight: boolean;
  training: boolean;
  sleep: boolean;
  wellnessCheckin: boolean;
};

type Props = {
  adherence: Adherence;
  mealsLoggedToday: boolean;
};

type PillKey = "weight" | "training" | "sleep" | "wellness" | "meals";

const PILLS: Array<{
  key: PillKey;
  label: string;
  href: string;
  /** Outline icon — shown while the section is still to-do. */
  icon: IonIconName;
  /** Filled variant — swapped in once logged, so it reads as "collected". */
  iconDone: IonIconName;
}> = [
  { key: "weight",   label: "Weight",   href: "/weight",            icon: "speedometerOutline", iconDone: "speedometer" },
  { key: "training", label: "Training", href: "/training-calendar", icon: "barbellOutline",     iconDone: "barbell"     },
  { key: "sleep",    label: "Sleep",    href: "/sleep",             icon: "moonOutline",         iconDone: "moon"        },
  { key: "wellness", label: "Wellness", href: "/recovery",          icon: "heartOutline",        iconDone: "heart"       },
  { key: "meals",    label: "Meals",    href: "/nutrition",         icon: "restaurantOutline",   iconDone: "restaurant"  },
];

// Completed sections read in the app's recovery-green — the established
// "done / success" hue (the same green used by the 5/5 counter) — so
// finishing a section feels like a reward rather than just another blue
// highlight identical to everything else.
const DONE_GLOW = "0 0 14px -4px rgba(35,197,153,0.55)";

/**
 * One-shot completion celebration, anchored over the strip. Mirrors the
 * repo's existing ConfettiLayer / ConfettiBurst pattern (deterministic
 * fan-out via `motion`) so it stays dependency-free; reduced-motion is
 * honoured by simply never mounting it.
 */
function CompletionConfetti({ fireKey }: { fireKey: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const angle = (i / 26) * Math.PI * 2;
        const dist = 90 + (i % 5) * 26;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 30,
          rot: (i * 53) % 360,
          size: 5 + (i % 3) * 2,
          // Theme-aligned palette: success green, primary blue, gold.
          color: ["#23C599", "#3B82F6", "#FAC146", "#23C599", "#9DE7D0"][i % 5],
        };
      }),
    [],
  );

  return (
    <div
      key={fireKey}
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
      aria-hidden
    >
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

export default function TodayStrip({ adherence, mealsLoggedToday }: Props) {
  const prefersReduced = useReducedMotion();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();

  // The wellness check-in survey is free (it feeds the free user's
  // fight-form score), but the Recovery dashboard at /recovery is Pro.
  // So free users must never be deep-linked into /recovery — only treat
  // the user as free once subscription state has resolved, so paid users
  // aren't briefly redirected.
  const wellnessIsFree =
    isSubscriptionResolved && !checkFeatureAccess("RECOVERY");

  const logged: Record<PillKey, boolean> = {
    weight:   adherence.weight,
    training: adherence.training,
    sleep:    adherence.sleep,
    wellness: adherence.wellnessCheckin,
    meals:    mealsLoggedToday,
  };

  const doneCount = PILLS.filter((p) => logged[p.key]).length;
  const total = PILLS.length;
  const allSet = doneCount === total;
  const pct = (doneCount / total) * 100;

  // ── Once-per-day completion celebration ───────────────────────────
  // Fires the first time the strip renders fully logged on a given local
  // day. Gating on `allSet && !celebratedToday` (rather than a strict
  // <5→5 transition) catches the common flow where the user logs the
  // final section on another screen and returns already complete.
  const [confettiKey, setConfettiKey] = useState(0);
  useEffect(() => {
    if (!allSet) return;
    const dayKey = `today_log_celebrated_${format(new Date(), "yyyy-MM-dd")}`;
    if (localStorage.getItem(dayKey)) return;
    localStorage.setItem(dayKey, "true");
    void triggerHapticSuccess();
    if (!prefersReduced) setConfettiKey((k) => k + 1);
  }, [allSet, prefersReduced]);

  // Auto-unmount the burst once it has played so it doesn't linger.
  useEffect(() => {
    if (confettiKey === 0) return;
    const t = setTimeout(() => setConfettiKey(0), 1500);
    return () => clearTimeout(t);
  }, [confettiKey]);

  return (
    <div className="card-surface card-glow relative rounded-2xl px-3 pt-3 pb-4 space-y-2.5">
      <AnimatePresence>
        {confettiKey > 0 && <CompletionConfetti fireKey={confettiKey} />}
      </AnimatePresence>

      {/* Header row — label + count */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Today's log</p>
        <p className={cn(
          "text-note font-semibold tabular-nums transition-colors",
          allSet ? "text-func-recovery-green" : "text-muted-foreground",
        )}>
          {doneCount} / {total}
          {allSet && <Icon name="checkmarkOutline" size={14} className="inline ml-1 mb-0.5" />}
        </p>
      </div>

      {/* Progress region — animated bar while in-progress, celebratory
          banner once everything is logged. */}
      <AnimatePresence mode="wait" initial={false}>
        {allSet ? (
          <motion.div
            key="banner"
            initial={prefersReduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springs.gentle}
            className="flex items-center justify-center gap-1.5 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/12 py-1.5"
            style={{ boxShadow: DONE_GLOW }}
          >
            <Icon name="sparkles" size={13} className="text-func-recovery-green" />
            <span className="text-[11px] font-semibold tracking-wide text-func-recovery-green">
              Today's log complete
            </span>
            <Icon name="sparkles" size={13} className="text-func-recovery-green" />
          </motion.div>
        ) : (
          <motion.div
            key="bar"
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-2 w-full rounded-full bg-muted/50 overflow-hidden"
          >
            <motion.div
              className="relative h-full rounded-full bg-primary overflow-hidden"
              initial={prefersReduced ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={springs.gentle}
              style={{ boxShadow: pct > 0 ? "0 0 10px -1px hsl(var(--primary) / 0.65)" : undefined }}
            >
              {/* Shimmer sweep — gives the fill an "earned" sheen. */}
              {!prefersReduced && pct > 0 && (
                <motion.span
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                  initial={{ x: "-130%" }}
                  animate={{ x: "330%" }}
                  transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pills */}
      <div className="flex items-stretch gap-1.5 w-full pt-1">
        {PILLS.map(({ key, label, href, icon, iconDone }) => {
          const isLogged = logged[key];
          // The wellness survey is FREE — route into the full-screen check-in
          // when it's not done yet. Once logged, the "review" target is the
          // Pro Recovery dashboard, so free users go to /dashboard instead of
          // a locked page; Pro users get the dashboard as before.
          // Wellness now lands on the Recovery/Wellness page (href = "/recovery"),
          // matching the other pills — the page then prompts the daily check-in.
          // Exception: /recovery is Pro-gated, so free users (who can't open it)
          // are still routed straight to the free quiz at /recovery/check-in.
          const finalHref =
            key === "wellness"
              ? wellnessIsFree
                ? "/recovery/check-in"
                : "/recovery"
              : href;

          const pillClassName = cn(
            "card-press relative flex-1 min-h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
            isLogged
              ? "border border-func-recovery-green/40 bg-func-recovery-green/12 text-func-recovery-green"
              : "border border-border/60 text-muted-foreground active:bg-muted/40",
          );

          const pillInner = (
            <>
              {/* Completed check badge — pops in when the section is logged. */}
              <AnimatePresence initial={false}>
                {isLogged && (
                  <motion.span
                    key="badge"
                    initial={prefersReduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={springs.bouncy}
                    className="absolute -top-1.5 -right-1.5 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-func-recovery-green ring-2 ring-background"
                  >
                    <Icon name="checkmarkOutline" size={10} className="text-background" />
                  </motion.span>
                )}
              </AnimatePresence>

              {/* Icon — fades / scales between outline and filled on state change. */}
              <motion.span
                key={isLogged ? "on" : "off"}
                initial={prefersReduced ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springs.responsive}
                className="leading-none"
              >
                <Icon
                  name={isLogged ? iconDone : icon}
                  size={17}
                  className={isLogged ? "text-func-recovery-green" : "text-muted-foreground"}
                />
              </motion.span>

              <span
                className={cn(
                  "text-[10px] font-semibold leading-none tracking-tight",
                  isLogged ? "text-func-recovery-green" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </>
          );

          return (
            <Link
              key={key}
              to={finalHref}
              onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
              className={pillClassName}
              style={{ boxShadow: isLogged ? DONE_GLOW : undefined }}
              aria-label={`${label}${isLogged ? " logged" : " not logged"}`}
            >
              {pillInner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export { TodayStrip };
