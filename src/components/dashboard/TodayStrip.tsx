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
  /** Marks today as a rest day (writes a Rest calendar entry). Absent → control hidden. */
  onMarkRestDay?: () => void | Promise<void>;
};

type PillKey = "weight" | "training" | "sleep" | "wellness" | "meals";

const PILLS: Array<{
  key: PillKey;
  label: string;
  href: string;
  /** Outline icon, shown while the section is still to-do. */
  icon: IonIconName;
  /** Filled variant, swapped in once logged, so it reads as "collected". */
  iconDone: IonIconName;
}> = [
  { key: "weight",   label: "Weight",   href: "/weight",            icon: "speedometerOutline", iconDone: "speedometer" },
  { key: "training", label: "Training", href: "/training-calendar", icon: "barbellOutline",     iconDone: "barbell"     },
  { key: "sleep",    label: "Sleep",    href: "/sleep",             icon: "moonOutline",         iconDone: "moon"        },
  { key: "wellness", label: "Wellness", href: "/recovery",          icon: "heartOutline",        iconDone: "heart"       },
  { key: "meals",    label: "Meals",    href: "/nutrition",         icon: "restaurantOutline",   iconDone: "restaurant"  },
];

// Completed sections read in the app's recovery-green, the established
// "done / success" hue (the same green used by the 5/5 counter), so
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

/**
 * The five logging tiles. Shared by the in-progress strip and the expanded
 * complete state so the deep-links + wellness routing live in one place.
 */
function PillsRow({
  logged,
  wellnessIsFree,
  prefersReduced,
}: {
  logged: Record<PillKey, boolean>;
  wellnessIsFree: boolean;
  prefersReduced: boolean | null;
}) {
  const tutorialAttr: Partial<Record<PillKey, string>> = {
    weight: "today-weight",
    sleep: "today-sleep",
    wellness: "today-wellness",
  };

  return (
    <div className="flex items-stretch gap-1.5 w-full">
      {PILLS.map(({ key, label, href, icon, iconDone }) => {
        const isLogged = logged[key];
        // Wellness pill routing keys off whether today's check-in is done:
        //   • not done  → open the full-screen survey at /recovery/check-in
        //   • done       → the Pro Recovery dashboard (/recovery). Free users
        //     can't open /recovery (Pro-gated), so they land on /dashboard.
        const finalHref =
          key === "wellness"
            ? !isLogged
              ? "/recovery/check-in"
              : wellnessIsFree
                ? "/dashboard"
                : "/recovery"
            : href;

        return (
          <Link
            key={key}
            to={finalHref}
            data-tutorial={tutorialAttr[key]}
            onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
            className={cn(
              "card-press relative flex-1 min-h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
              isLogged
                ? "border border-func-recovery-green/40 bg-func-recovery-green/12 text-func-recovery-green"
                : "border border-border/60 text-muted-foreground active:bg-muted/40",
            )}
            style={{ boxShadow: isLogged ? DONE_GLOW : undefined }}
            aria-label={`${label}${isLogged ? " logged" : " not logged"}`}
          >
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
          </Link>
        );
      })}
    </div>
  );
}

export default function TodayStrip({ adherence, mealsLoggedToday, onMarkRestDay }: Props) {
  const prefersReduced = useReducedMotion();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  const [restPending, setRestPending] = useState(false);

  // The wellness check-in survey is free (it feeds the free user's
  // fight-form score), but the Recovery dashboard at /recovery is Pro.
  // So free users must never be deep-linked into /recovery, only treat
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

  // ── Complete-state collapse + once-per-day celebration ─────────────
  // When complete, the strip collapses to a slim bar. The FIRST time the
  // dashboard sees a fully-logged day (gated on the local day-key, which
  // also catches "logged the last section elsewhere, then returned"), it
  // plays a short flourish (confetti + the tiles briefly expanded) and then
  // AUTO-MINIMISES into the slim bar. `userExpanded` lets the user reopen the
  // tiles to edit; it's ephemeral, so returning always rests collapsed.
  const [confettiKey, setConfettiKey] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const [userExpanded, setUserExpanded] = useState(false);
  const tilesOpen = celebrating || userExpanded;

  useEffect(() => {
    if (!allSet) return;
    const dayKey = `today_log_celebrated_${format(new Date(), "yyyy-MM-dd")}`;
    if (localStorage.getItem(dayKey)) return; // already celebrated today → rest collapsed
    localStorage.setItem(dayKey, "true");
    void triggerHapticSuccess();
    if (prefersReduced) return; // no flourish under reduced-motion; stay collapsed
    setConfettiKey((k) => k + 1);
    // Play the tiles-expanded flourish, then auto-minimise to the slim bar.
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 1900);
    return () => clearTimeout(t);
  }, [allSet, prefersReduced]);

  // Auto-unmount the burst once it has played so it doesn't linger.
  useEffect(() => {
    if (confettiKey === 0) return;
    const t = setTimeout(() => setConfettiKey(0), 1500);
    return () => clearTimeout(t);
  }, [confettiKey]);

  return (
    <div className="card-surface card-glow relative rounded-2xl px-3 pt-3 pb-4 space-y-2.5" data-tutorial="today-strip">
      <AnimatePresence>
        {confettiKey > 0 && <CompletionConfetti fireKey={confettiKey} />}
      </AnimatePresence>

      {allSet ? (
        /* ── COMPLETE, slim bar that auto-minimises, tap to expand ── */
        <>
          <motion.button
            type="button"
            onClick={() => setUserExpanded((e) => !e)}
            aria-expanded={tilesOpen}
            aria-label="Today's log complete, tap to view sections"
            className="w-full flex items-center gap-2.5 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/12 px-3 py-1.5 text-left"
            style={{ boxShadow: DONE_GLOW }}
            initial={prefersReduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={springs.gentle}
          >
            <motion.span
              className="flex h-5 w-5 items-center justify-center rounded-full bg-func-recovery-green shrink-0"
              initial={celebrating && !prefersReduced ? { scale: 0 } : false}
              animate={{ scale: 1 }}
              transition={springs.bouncy}
            >
              <Icon name="checkmarkOutline" size={12} className="text-background" />
            </motion.span>

            <span className="whitespace-nowrap text-[12px] font-semibold tracking-wide text-func-recovery-green">
              Today's log complete
            </span>

            <span className="ml-auto flex items-center gap-2">
              {/* The five collected pillars as tiny glyphs, a glanceable trophy
                  shelf. They pop in (staggered) during the completion flourish. */}
              <span className="flex items-center gap-1.5">
                {PILLS.map((p, i) => (
                  <motion.span
                    key={p.key}
                    initial={celebrating && !prefersReduced ? { scale: 0, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ ...springs.bouncy, delay: celebrating ? 0.18 + i * 0.06 : 0 }}
                    className="leading-none"
                  >
                    <Icon name={p.iconDone} size={14} className="text-func-recovery-green" />
                  </motion.span>
                ))}
              </span>
              <Icon
                name="chevronDownOutline"
                size={16}
                className={cn("text-muted-foreground transition-transform", tilesOpen && "rotate-180")}
              />
            </span>
          </motion.button>

          {/* Expandable tiles, shown during the flourish, then folded away;
              re-openable by tapping the bar. */}
          <AnimatePresence initial={false}>
            {tilesOpen && (
              <motion.div
                key="tiles"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={springs.gentle}
                className="overflow-hidden"
              >
                <div className="pt-1.5">
                  <PillsRow logged={logged} wellnessIsFree={wellnessIsFree} prefersReduced={prefersReduced} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        /* ── IN PROGRESS, header + progress bar + rest-day + tiles ── */
        <>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Today's log</p>
            <p className="text-note font-semibold tabular-nums text-muted-foreground">
              {doneCount} / {total}
            </p>
          </div>

          <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
            <motion.div
              className="relative h-full rounded-full bg-primary overflow-hidden"
              initial={prefersReduced ? false : { width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={springs.gentle}
              style={{ boxShadow: pct > 0 ? "0 0 10px -1px hsl(var(--primary) / 0.65)" : undefined }}
            >
              {/* Shimmer sweep, gives the fill an "earned" sheen. */}
              {!prefersReduced && pct > 0 && (
                <motion.span
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                  initial={{ x: "-130%" }}
                  animate={{ x: "330%" }}
                  transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" }}
                />
              )}
            </motion.div>
          </div>

          {/* Rest-day shortcut, visible only when training is not yet logged
              and the parent has wired the mutation handler. */}
          <AnimatePresence initial={false}>
            {onMarkRestDay && !logged.training && (
              <motion.div
                key="rest-day-row"
                initial={prefersReduced ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={springs.gentle}
                className="flex justify-center"
              >
                <button
                  type="button"
                  disabled={restPending}
                  aria-label="Mark today as a rest day"
                  onClick={async () => {
                    void triggerHaptic(ImpactStyle.Light);
                    setRestPending(true);
                    try {
                      await onMarkRestDay();
                    } finally {
                      setRestPending(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-muted-foreground/70 hover:text-muted-foreground active:text-muted-foreground/50 transition-colors disabled:opacity-50"
                >
                  <Icon name={restPending ? "refreshOutline" : "moonOutline"} size={13} className={restPending ? "animate-spin" : ""} />
                  <span className="text-[11px] tracking-[0.12em] font-medium">
                    {restPending ? "Saving…" : "Mark today as a rest day"}
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pt-1">
            <PillsRow logged={logged} wellnessIsFree={wellnessIsFree} prefersReduced={prefersReduced} />
          </div>
        </>
      )}
    </div>
  );
}

export { TodayStrip };
