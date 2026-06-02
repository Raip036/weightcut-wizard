/**
 * KpiStrip — thin 4-tile horizontal strip sitting above the athlete list.
 *
 * Apple Fitness flavour: muted glass cards, big tabular display numbers,
 * uppercase eyebrow labels. The Alerts tile flips tier-coloured (red dot
 * + tinted value) when count > 0 so it reads as a status indicator rather
 * than another stat.
 *
 * Data is computed entirely from the inputs — this component does not
 * read from Convex. The dashboard composes the data and passes it down.
 */
import { motion, useReducedMotion } from "motion/react";

interface KpiStripProps {
  /** Total active athletes the coach is currently watching. */
  activeAthletes: number;
  /** Distinct logged sessions across the roster in the last 7 days. */
  sessionsThisWeek: number;
  /** Athletes whose fight target falls inside the current calendar month. */
  fightsThisMonth: number;
  /** Roster members currently flagged "alert" severity. */
  alerts: number;
}

interface Tile {
  value: number;
  label: string;
  /** Tailwind text-colour class for the value when this tile is "hot". */
  hotColor?: string;
}

export function KpiStrip({
  activeAthletes,
  sessionsThisWeek,
  fightsThisMonth,
  alerts,
}: KpiStripProps) {
  const prefersReduced = useReducedMotion();

  const tiles: Array<Tile & { hot: boolean }> = [
    { value: activeAthletes, label: "Athletes", hot: false },
    { value: sessionsThisWeek, label: "Sessions", hot: false },
    { value: fightsThisMonth, label: "Fights", hot: false },
    {
      value: alerts,
      label: "Alerts",
      hot: alerts > 0,
      hotColor: "text-func-danger-red",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2" role="list" aria-label="Roster KPIs">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          role="listitem"
          initial={prefersReduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: "easeOut", delay: i * 0.04 }}
          className="glass-card rounded-2xl border border-border/50 px-2.5 py-3 text-center relative overflow-hidden"
        >
          {/* Hot dot — only renders for the alerts tile when count > 0. */}
          {t.hot && (
            <span
              aria-hidden
              className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-func-danger-red"
            />
          )}
          <p
            className={`display-number text-[22px] leading-none tabular-nums ${
              t.hot && t.hotColor ? t.hotColor : "text-foreground"
            }`}
          >
            {t.value}
          </p>
          <p className="mt-1.5 text-[9px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
            {t.label}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
