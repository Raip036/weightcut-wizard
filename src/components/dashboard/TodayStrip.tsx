import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
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
  /** True once today's adherence has actually loaded. The rest-day prompt is
   *  withheld until then, so it doesn't flash in (and collapse back out) on
   *  every dashboard mount while `adherence.training` is still defaulting to
   *  false during the query's load window. Defaults to true (show immediately)
   *  for callers that don't pass it. */
  restDayReady?: boolean;
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

// Per-pill tutorial anchors (the onboarding tour points at these).
const TUTORIAL_ATTR: Partial<Record<PillKey, string>> = {
  weight: "today-weight",
  sleep: "today-sleep",
  wellness: "today-wellness",
};

// Spring-y ease for the completion pop (overshoots slightly, then settles).
const POP_EASE: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

export default function TodayStrip({ adherence, mealsLoggedToday, onMarkRestDay, restDayReady = true }: Props) {
  const prefersReduced = useReducedMotion();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  const [restPending, setRestPending] = useState(false);

  // The wellness check-in survey is free (it feeds the free user's fight-form
  // score), but the Recovery dashboard at /recovery is Pro. So free users must
  // never be deep-linked into /recovery. Only treat the user as free once
  // subscription state has resolved, so paid users aren't briefly redirected.
  const wellnessIsFree = isSubscriptionResolved && !checkFeatureAccess("RECOVERY");

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

  // ── Once-per-day completion celebration ────────────────────────────
  // The FIRST time the dashboard sees a fully-logged day (gated on the local
  // day-key, which also catches "logged the last section elsewhere, then
  // returned"), the circles do a staggered spring pop, a soft glow expands
  // behind the row, and the header morphs to "Today complete". Minimal, iOS
  // native, and never replays for the rest of the day. Reduced-motion users
  // still get the success haptic + complete state, just no flourish.
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (!allSet) return;
    const dayKey = `today_log_celebrated_${format(new Date(), "yyyy-MM-dd")}`;
    if (localStorage.getItem(dayKey)) return; // already celebrated today
    localStorage.setItem(dayKey, "true");
    void triggerHapticSuccess();
    if (prefersReduced) return;
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 1400);
    return () => clearTimeout(t);
  }, [allSet, prefersReduced]);

  return (
    <section data-tutorial="today-strip" className="relative">
      {/* Header: label + progress, morphs to "Today complete" when all set. */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          Today's log
        </p>
        {allSet ? (
          <motion.span
            initial={celebrating && !prefersReduced ? { opacity: 0, y: 5, scale: 0.94 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springs.gentle}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-primary"
          >
            <Icon name="checkmarkOutline" size={13} className="text-primary" />
            Today complete
          </motion.span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {doneCount}/{total} done
          </span>
        )}
      </div>

      {/* Circle row. */}
      <div className="relative flex items-start justify-between gap-2">
        {/* Soft glow that expands behind the row on completion. */}
        {celebrating && !prefersReduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-7 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.40), transparent 65%)" }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: [0, 0.85, 0], scale: [0.7, 1.5, 1.5] }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}

        {PILLS.map(({ key, label, href, icon, iconDone }, idx) => {
          const isLogged = logged[key];
          // Wellness routing keys off whether today's check-in is done:
          //   • not done → open the full-screen survey at /recovery/check-in
          //   • done      → the Pro Recovery dashboard (/recovery). Free users
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
              onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
              className="card-press relative z-10 flex flex-1 flex-col items-center gap-2"
              aria-label={`${label}${isLogged ? " logged" : " not logged"}`}
            >
              <motion.span
                // Per-pill tutorial anchor lives on the circle itself (not the
                // full-width Link) so the onboarding spotlight frames the round
                // chip tightly instead of a wide column.
                data-tutorial={TUTORIAL_ATTR[key]}
                className="relative flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-300"
                style={
                  isLogged
                    ? {
                        backgroundColor: "hsl(var(--primary))",
                        boxShadow:
                          "0 6px 18px -4px hsl(var(--primary) / 0.55), inset 0 1px 0 rgba(255,255,255,0.22)",
                      }
                    : {
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(0 0% 100% / 0.10)",
                      }
                }
                animate={celebrating && !prefersReduced ? { scale: [1, 1.16, 1] } : { scale: 1 }}
                transition={
                  celebrating && !prefersReduced
                    ? { duration: 0.5, ease: POP_EASE, delay: idx * 0.07 }
                    : springs.responsive
                }
              >
                <Icon
                  name={isLogged ? iconDone : icon}
                  size={22}
                  className={isLogged ? "text-white" : "text-muted-foreground"}
                />

                {isLogged && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-background"
                    style={{ backgroundColor: "hsl(var(--secondary))" }}
                  >
                    <Icon name="checkmarkOutline" size={11} className="text-white" />
                  </span>
                )}
              </motion.span>

              <span
                className={cn(
                  "text-[11px] leading-none transition-colors duration-300",
                  isLogged ? "text-foreground/85" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Rest-day shortcut, visible only when training is not yet logged and
          the parent has wired the mutation handler. */}
      <AnimatePresence initial={false}>
        {restDayReady && onMarkRestDay && !logged.training && (
          <motion.div
            key="rest-day-row"
            initial={prefersReduced ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={springs.gentle}
            className="mt-3 flex justify-center"
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
    </section>
  );
}

export { TodayStrip };
