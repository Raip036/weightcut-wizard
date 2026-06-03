import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { format, parseISO } from "date-fns";
import { ImpactStyle } from "@capacitor/haptics";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";
import { springs } from "@/lib/motion";
import { useSubscription } from "@/hooks/useSubscription";

// ---------------------------------------------------------------------------
// Types — mirrors the weeklyCompleteness query shape exactly.
// ---------------------------------------------------------------------------

export type WeeklyDayLogged = {
  weight: boolean;
  training: boolean;
  sleep: boolean;
  wellness: boolean;
  meals: boolean;
};

export type WeeklyDay = {
  date: string;       // "yyyy-MM-dd"
  weekday: string;    // "Mon", "Tue", etc.
  logged: WeeklyDayLogged;
  count: number;
  total: number;
  status: "full" | "partial" | "none" | "rest";
};

type Props = {
  days: Array<WeeklyDay> | null | undefined;
};

// ---------------------------------------------------------------------------
// Pillar config — mirrors TodayStrip's PILLS array for routing + icons.
// ---------------------------------------------------------------------------

type PillarKey = "weight" | "training" | "sleep" | "wellness" | "meals";

const PILLARS: Array<{
  key: PillarKey;
  label: string;
  href: string;
  icon: IonIconName;
  iconDone: IonIconName;
}> = [
  { key: "weight",   label: "Weight",   href: "/weight",            icon: "speedometerOutline", iconDone: "speedometer"    },
  { key: "training", label: "Training", href: "/training-calendar", icon: "barbellOutline",     iconDone: "barbell"        },
  { key: "sleep",    label: "Sleep",    href: "/sleep",             icon: "moonOutline",         iconDone: "moon"           },
  { key: "wellness", label: "Wellness", href: "/recovery",          icon: "heartOutline",        iconDone: "heart"          },
  { key: "meals",    label: "Meals",    href: "/nutrition",         icon: "restaurantOutline",   iconDone: "restaurant"     },
];

// ---------------------------------------------------------------------------
// Notch — one button per day in the 7-notch row.
// ---------------------------------------------------------------------------

function Notch({
  day,
  isToday,
  isSelected,
  onClick,
}: {
  day: WeeklyDay;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { status, weekday } = day;

  const barClassName = cn(
    "relative w-full rounded-full transition-all duration-200",
    isSelected ? "h-8" : "h-6",
    status === "full"    && "bg-func-recovery-green",
    status === "partial" && "bg-func-warning-yellow",
    status === "rest"    && "bg-muted-foreground/25",
    status === "none"    && "border border-border/60 bg-transparent",
  );

  // Glow under the selected notch
  const barStyle =
    isSelected && status === "full"
      ? { boxShadow: "0 0 10px -2px rgba(35,197,153,0.55)" }
      : isSelected && status === "partial"
        ? { boxShadow: "0 0 10px -2px rgba(250,193,70,0.45)" }
        : undefined;

  return (
    <button
      type="button"
      aria-label={`${weekday}: ${status}`}
      aria-pressed={isSelected}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 flex-1 min-w-0 py-1 rounded-md transition-colors",
        isSelected ? "bg-white/[0.04]" : "hover:bg-white/[0.02] active:bg-white/[0.04]",
      )}
    >
      {/* Rest-day icon (moon) or coloured bar */}
      {status === "rest" ? (
        <div className={cn("relative flex items-center justify-center w-full rounded-full transition-all duration-200", isSelected ? "h-8" : "h-6")}>
          <Icon
            name="moonOutline"
            size={12}
            className="text-muted-foreground/50"
          />
        </div>
      ) : (
        <div className={barClassName} style={barStyle} />
      )}

      {/* Weekday initial — bold when today */}
      <span
        className={cn(
          "text-[9px] leading-none font-medium tracking-tight transition-colors",
          isToday ? "text-foreground/80" : "text-muted-foreground/50",
        )}
      >
        {weekday.slice(0, 1)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DayDetail — expandable section showing the 5 pillar chips for a day.
// ---------------------------------------------------------------------------

function DayDetail({
  day,
  prefersReduced,
  wellnessHref,
}: {
  day: WeeklyDay;
  prefersReduced: boolean | null;
  /** Resolved wellness route — free users get the free check-in survey
   *  (the Recovery dashboard at /recovery is Pro-gated), mirroring TodayStrip. */
  wellnessHref: string;
}) {
  const isRestDay = day.status === "rest";
  const formattedDate = (() => {
    try {
      return format(parseISO(day.date), "EEE, MMM d");
    } catch {
      return day.date;
    }
  })();

  return (
    <motion.div
      key={day.date}
      initial={prefersReduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={prefersReduced ? false : { opacity: 0, height: 0 }}
      transition={springs.gentle}
      className="overflow-hidden"
    >
      <div className="pt-2.5 pb-0.5 space-y-2">
        {/* Date label */}
        <p className="text-[11px] font-semibold text-foreground/80 leading-none">
          {formattedDate}
          {isRestDay && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">
              · rest day
            </span>
          )}
        </p>

        {/* 5 pillar chips — single condensed row, equal widths. Green fill =
            logged; muted outline = not logged (tap to log). */}
        <div className="flex items-stretch gap-1">
          {PILLARS.map(({ key, label, href, icon, iconDone }) => {
            const isLogged = day.logged[key as keyof WeeklyDayLogged];

            if (isLogged) {
              // Logged — green non-interactive chip
              return (
                <span
                  key={key}
                  className="flex-1 min-w-0 inline-flex items-center justify-center gap-0.5 px-0.5 py-1 rounded-md text-[9.5px] font-semibold border border-func-recovery-green/35 bg-func-recovery-green/10 text-func-recovery-green"
                >
                  <Icon name={iconDone} size={10} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
              );
            }

            // Not logged — muted chip linking to the log page. Wellness routes
            // to the free check-in survey for free users (not the Pro page).
            const logHref = key === "wellness" ? wellnessHref : href;
            return (
              <Link
                key={key}
                to={logHref}
                onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
                className="flex-1 min-w-0 inline-flex items-center justify-center gap-0.5 px-0.5 py-1 rounded-md text-[9.5px] font-medium border border-border/50 text-muted-foreground/70 hover:text-muted-foreground active:opacity-60 transition-colors"
              >
                <Icon name={icon} size={10} className="shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// CompletenessMeter — main export
// ---------------------------------------------------------------------------

const COLLAPSE_KEY = "completeness_meter_collapsed";

export default function CompletenessMeter({ days }: Props) {
  const prefersReduced = useReducedMotion();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Free users can take the wellness survey but not open the Pro Recovery
  // dashboard — route them to the free check-in (matches TodayStrip). Only
  // treat as free once subscription state has resolved so Pro users aren't
  // briefly mis-routed.
  const wellnessHref =
    isSubscriptionResolved && !checkFeatureAccess("RECOVERY")
      ? "/recovery/check-in"
      : "/recovery";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  const toggleCollapsed = () => {
    void triggerHaptic(ImpactStyle.Light);
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (next) setSelectedIndex(null); // collapsing also closes any open day-detail
      return next;
    });
  };

  // Guard: nothing to show while loading or unauthenticated.
  if (!days || days.length === 0) return null;

  // "Showed up" = any data logged OR explicitly marked as rest.
  const showedUpCount = days.filter((d) => d.count > 0 || d.status === "rest").length;
  const showedUpHigh = showedUpCount >= 5;

  const todayIndex = days.length - 1; // oldest → newest; today is last

  const handleNotchClick = (i: number) => {
    void triggerHaptic(ImpactStyle.Light);
    setSelectedIndex((prev) => (prev === i ? null : i));
  };

  return (
    <div className={cn("card-surface rounded-2xl px-3 pt-3", collapsed ? "pb-3" : "pb-3 space-y-2")}>
      {/* Header row — tap to collapse/expand the whole widget */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show last 7 days" : "Hide last 7 days"}
        className="flex w-full items-center justify-between rounded-md -mx-1 px-1 py-0.5 active:bg-white/[0.03] transition-colors"
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          Last 7 days
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[11px] font-semibold tabular-nums transition-colors",
              showedUpHigh ? "text-func-recovery-green" : "text-muted-foreground",
            )}
          >
            {showedUpCount} / 7
          </span>
          <motion.span
            animate={prefersReduced ? undefined : { rotate: collapsed ? 0 : 180 }}
            transition={springs.gentle}
            className="leading-none text-muted-foreground/60"
          >
            <Icon name="chevronDownOutline" size={13} />
          </motion.span>
        </span>
      </button>

      {/* Collapsible body — notch row + day-detail */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="meter-body"
            initial={prefersReduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={prefersReduced ? false : { opacity: 0, height: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            {/* 7-notch row */}
            <div className="flex items-end gap-1 pt-2">
              {days.map((day, i) => (
                <Notch
                  key={day.date}
                  day={day}
                  isToday={i === todayIndex}
                  isSelected={selectedIndex === i}
                  onClick={() => handleNotchClick(i)}
                />
              ))}
            </div>

            {/* Day-detail accordion */}
            <AnimatePresence initial={false}>
              {selectedIndex !== null && days[selectedIndex] && (
                <DayDetail
                  key={days[selectedIndex].date}
                  day={days[selectedIndex]}
                  prefersReduced={prefersReduced}
                  wellnessHref={wellnessHref}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { CompletenessMeter };
